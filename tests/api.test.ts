import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { createApp } from '../server/app.ts'
import { Store } from '../server/store.ts'
import { balances, billingDate, householdSchema, localDate, monthlyGroceries } from '../shared/domain.ts'
import { addMonths, monthlyBills } from '../shared/bills.ts'
import type { Session } from '../shared/domain.ts'

describe('shared kitchen API', () => {
  const store = new Store(':memory:')
  let server: Server
  let origin: string
  before(async () => {
    server = createApp(store).listen(0, '127.0.0.1')
    await once(server, 'listening')
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(async () => {
    server.close()
    await once(server, 'close')
    await store.close()
  })
  const call = (path: string, body?: unknown, token?: string, method?: string) => fetch(`${origin}/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const create = async (): Promise<Session> => {
    const response = await call('/households', { name: 'Our kitchen', memberName: 'Ada', currency: 'EUR', budget: 30000 })
    assert.equal(response.status, 201)
    return response.json()
  }
  const createBill = async (session: Session): Promise<Session> => {
    const response = await call('/bills', {
      name: 'Internet', amount: 3000, firstDueDate: `${billingDate(session.household.billingTimeZone).slice(0, 7)}-01`,
      participants: session.household.members.map((member) => member.id), version: session.household.version,
    }, session.token)
    assert.equal(response.status, 200)
    return { ...session, household: householdSchema.parse((await response.json()).household) }
  }
  it('keeps kitchens private and joins roommates into the same persistent ledger', async () => {
    assert.equal((await call('/household')).status, 401)
    const first = await create()
    const join = await call('/join', { inviteCode: first.household.inviteCode, name: 'Ben' })
    assert.equal(join.status, 201)
    const second: Session = await join.json()
    assert.equal(second.household.id, first.household.id)
    assert.equal(second.household.members.length, 2)
    const updated = await call('/household', undefined, first.token)
    assert.equal((await updated.json()).household.members.length, 2)
    assert.equal((await call('/join', { inviteCode: first.household.inviteCode, name: 'ben' })).status, 409)
    const other = await create()
    assert.notEqual(other.household.id, first.household.id)
  })
  it('keeps unexpected read failures distinct from unconfirmed writes', async (context) => {
    const session = await create()
    const authenticate = context.mock.method(store, 'authenticate', () => { throw new Error('Private store diagnostic') })
    const read = await call('/household', undefined, session.token)
    assert.equal(read.status, 500)
    assert.deepEqual(await read.json(), { error: 'Server unavailable.' })
    const write = await call('/expenses', {}, session.token)
    assert.equal(write.status, 500)
    assert.deepEqual(await write.json(), { error: 'Server unavailable. Unconfirmed request.' })
    authenticate.mock.restore()
    const current = await call('/household', undefined, session.token)
    assert.deepEqual((await current.json()).household, session.household)
  })
  it('protects updates against stale versions and unknown roommates', async () => {
    const session = await create()
    const input = { description: 'Milk', amount: 301, paidBy: session.memberId, participants: [session.memberId], category: 'dairy', date: '2026-09-01', version: 0 }
    assert.equal((await call('/expenses', { ...input, participants: [randomUUID()] }, session.token)).status, 400)
    assert.equal((await call('/expenses', { ...input, participants: [session.memberId, session.memberId] }, session.token)).status, 400)
    assert.equal((await call('/expenses', input, session.token)).status, 200)
    assert.equal((await call('/expenses', input, session.token)).status, 409)
    const current = await (await call('/household', undefined, session.token)).json()
    assert.equal(current.household.expenses.length, 1)
    assert.equal((await call('/household', { name: 'New kitchen', currency: 'USD', budget: 30000, version: 1 }, session.token, 'PATCH')).status, 400)
  })
  it('records and reverses payments without accepting overpayments', async () => {
    const first = await create()
    const second: Session = await (await call('/join', { inviteCode: first.household.inviteCode, name: 'Ben' })).json()
    const expense = await (await call('/expenses', { description: 'Groceries', amount: 2001, paidBy: first.memberId, participants: [first.memberId, second.memberId], category: 'pantry', date: '2026-09-01', version: 1 }, first.token)).json()
    const amount = -balances(expense.household).get(second.memberId)!
    const payment = { from: second.memberId, to: first.memberId, amount, version: 2 }
    assert.equal((await call('/settlements', { ...payment, amount: amount + 1 }, second.token)).status, 409)
    const paid = await (await call('/settlements', payment, second.token)).json()
    assert.ok([...balances(paid.household).values()].every((value) => value === 0))
    assert.equal(paid.household.expenses.length, 1)
    const undone = await (await call(`/settlements/${paid.household.settlements[0].id}`, { version: 3 }, first.token, 'DELETE')).json()
    assert.equal(balances(undone.household).get(second.memberId), -amount)
  })
  it('records a valid repayment larger than an individual expense limit', async () => {
    const first = await create()
    const second: Session = await (await call('/join', { inviteCode: first.household.inviteCode, name: 'Ben' })).json()
    let household = second.household
    for (let index = 0; index < 3; index++) {
      const response = await call('/expenses', {
        description: `Large shared purchase ${index + 1}`, amount: 100_000_000, paidBy: first.memberId,
        participants: [first.memberId, second.memberId], category: 'other', date: localDate(), version: household.version,
      }, first.token)
      assert.equal(response.status, 200)
      household = householdSchema.parse((await response.json()).household)
    }
    const amount = -balances(household).get(second.memberId)!
    assert.equal(amount, 150_000_000)
    const response = await call('/settlements', {
      from: second.memberId, to: first.memberId, amount, version: household.version,
    }, second.token)
    assert.equal(response.status, 200)
    const paid = householdSchema.parse((await response.json()).household)
    assert.equal(paid.settlements[0].amount, amount)
    assert.ok([...balances(paid).values()].every((balance) => balance === 0))
  })
  it('replays a confirmed mutation without duplicating it or restoring a later deletion', async () => {
    const session = await create()
    const input = {
      description: 'Receipt saved once', amount: 1301, paidBy: session.memberId, participants: [session.memberId],
      category: 'pantry', date: localDate(), version: 0, mutationId: randomUUID(), mutationVersion: 0,
    }
    const response = await call('/expenses', input, session.token)
    assert.equal(response.status, 200)
    const first = householdSchema.parse((await response.json()).household)
    for (const version of [0, first.version]) {
      const replay = await call('/expenses', { ...input, version }, session.token)
      assert.equal(replay.status, 200)
      const result = await replay.json()
      assert.equal(result.replayed, true)
      assert.equal(result.household.version, first.version)
      assert.equal(result.household.expenses.length, 1)
    }
    const changed = await call('/expenses', { ...input, amount: 1401, version: first.version }, session.token)
    assert.equal(changed.status, 409)
    assert.equal((await changed.json()).code, 'MUTATION_PAYLOAD_CHANGED')
    const removed = await call(`/expenses/${first.expenses[0].id}`, { version: first.version }, session.token, 'DELETE')
    assert.equal(removed.status, 200)
    const latest = householdSchema.parse((await removed.json()).household)
    const replay = await call('/expenses', { ...input, version: latest.version }, session.token)
    assert.equal(replay.status, 200)
    const result = await replay.json()
    assert.equal(result.replayed, true)
    assert.equal(result.household.expenses.length, 0)
    assert.equal(result.household.version, latest.version)
  })
  it('does not reserve a mutation identifier for a rejected input', async () => {
    const session = await create()
    const input = {
      description: 'Corrected receipt', amount: 301, paidBy: session.memberId, participants: [randomUUID()],
      category: 'dairy', date: localDate(), version: 0, mutationId: randomUUID(), mutationVersion: 0,
    }
    assert.equal((await call('/expenses', input, session.token)).status, 400)
    const response = await call('/expenses', { ...input, participants: [session.memberId] }, session.token)
    assert.equal(response.status, 200)
    const household = householdSchema.parse((await response.json()).household)
    assert.equal(household.expenses.length, 1)
    assert.equal(household.version, 1)
  })
  it('retires invitation links without revoking existing member sessions', async () => {
    const session = await create()
    const rotated = await call('/invite/rotate', { version: 0 }, session.token)
    assert.equal(rotated.status, 200)
    const next = await rotated.json()
    assert.notEqual(next.household.inviteCode, session.household.inviteCode)
    assert.equal((await call('/join', { inviteCode: session.household.inviteCode, name: 'Ben' })).status, 404)
    assert.equal((await call('/household', undefined, session.token)).status, 200)
    assert.equal((await call('/join', { inviteCode: next.household.inviteCode, name: 'Ben' })).status, 201)
  })
  it('does not expose a sample household creation endpoint', async () => {
    const response = await call('/demo', {})
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Action not found.' })
  })
  it('records one bill expense per month even with concurrent or repeated submissions', async () => {
    const owner = await create()
    const roommate: Session = await (await call('/join', { inviteCode: owner.household.inviteCode, name: 'Ben' })).json()
    const session = await createBill({ ...owner, household: roommate.household })
    const bill = session.household.bills[0]
    const month = billingDate(session.household.billingTimeZone).slice(0, 7)
    const input = {
      month, amount: 3101, paidBy: owner.memberId, participants: session.household.members.map((member) => member.id),
      date: localDate(), version: session.household.version,
    }
    const attempts = await Promise.all([
      call(`/bills/${bill.id}/payments`, input, owner.token),
      call(`/bills/${bill.id}/payments`, input, roommate.token),
    ])
    assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409])
    const current = householdSchema.parse((await (await call('/household', undefined, owner.token)).json()).household)
    assert.equal(current.expenses.length, 1)
    assert.equal(current.expenses[0].amount, 3101)
    assert.equal(current.expenses[0].bill?.billId, bill.id)
    assert.equal(monthlyGroceries(current, month).length, 0)
    assert.equal(monthlyBills(current, month)[0].status, 'paid')
    assert.equal([...balances(current).values()].reduce((sum, value) => sum + value, 0), 0)
    assert.equal((await call(`/bills/${bill.id}/payments`, { ...input, version: current.version }, owner.token)).status, 409)
    const removed = await call(`/expenses/${current.expenses[0].id}`, { version: current.version }, owner.token, 'DELETE')
    const restored = householdSchema.parse((await removed.json()).household)
    assert.equal(restored.expenses.length, 0)
    assert.notEqual(monthlyBills(restored, month)[0].status, 'paid')
    assert.equal((await call(`/bills/${bill.id}/payments`, { ...input, version: restored.version }, owner.token)).status, 200)
  })
  it('preserves bill payment snapshots while defaults change and pauses future months', async () => {
    const session = await createBill(await create())
    const bill = session.household.bills[0]
    const month = billingDate(session.household.billingTimeZone).slice(0, 7)
    const payment = {
      month, amount: 3205, paidBy: session.memberId, participants: [session.memberId], date: localDate(),
      version: session.household.version,
    }
    const recorded = await call(`/bills/${bill.id}/payments`, payment, session.token)
    const paid = householdSchema.parse((await recorded.json()).household)
    const edited = await call(`/bills/${bill.id}`, {
      name: 'New internet plan', amount: 4000, dueDay: 31, participants: [session.memberId], version: paid.version,
    }, session.token, 'PATCH')
    const current = householdSchema.parse((await edited.json()).household)
    assert.equal(current.expenses[0].description, 'Internet')
    assert.equal(current.expenses[0].amount, 3205)
    const pausedResponse = await call(`/bills/${bill.id}/pause`, { paused: true, version: current.version }, session.token)
    const paused = householdSchema.parse((await pausedResponse.json()).household)
    assert.equal(monthlyBills(paused, month)[0].status, 'paid')
    assert.equal(monthlyBills(paused, addMonths(month, 1)).length, 0)
    assert.equal((await call(`/bills/${bill.id}/payments`, {
      ...payment, month: addMonths(month, 1), version: paused.version,
    }, session.token)).status, 409)
    const resumedResponse = await call(`/bills/${bill.id}/pause`, { paused: false, version: paused.version }, session.token)
    const resumed = householdSchema.parse((await resumedResponse.json()).household)
    assert.equal(monthlyBills(resumed, addMonths(month, 1))[0].amount, 4000)
    assert.equal(resumed.expenses.length, 1)
  })
  it('validates bills, protects household boundaries and keeps planned amounts in their currency', async () => {
    const session = await createBill(await create())
    const bill = session.household.bills[0]
    const input = { name: 'Internet', amount: 4000, dueDay: 15, participants: [session.memberId], version: session.household.version }
    assert.equal((await call(`/bills/${bill.id}`, input, undefined, 'PATCH')).status, 401)
    assert.equal((await call(`/bills/${bill.id}`, { ...input, version: 0 }, session.token, 'PATCH')).status, 409)
    assert.equal((await call(`/bills/${bill.id}`, { ...input, participants: [randomUUID()] }, session.token, 'PATCH')).status, 400)
    assert.equal((await call(`/bills/${bill.id}`, { ...input, participants: [session.memberId, session.memberId] }, session.token, 'PATCH')).status, 400)
    assert.equal((await call(`/bills/${bill.id}`, { ...input, dueDay: 32 }, session.token, 'PATCH')).status, 400)
    assert.equal((await call('/bills', { ...input, firstDueDate: '2026-02-30' }, session.token)).status, 400)
    const other = await create()
    assert.equal((await call(`/bills/${bill.id}`, { ...input, version: 0 }, other.token, 'PATCH')).status, 404)
    assert.equal((await call(`/bills/${bill.id}/payments`, {
      month: localDate().slice(0, 7), date: localDate(), amount: 3000, paidBy: randomUUID(),
      participants: [session.memberId], version: session.household.version,
    }, session.token)).status, 400)
    assert.equal((await call('/household', {
      name: 'Other currency', budget: 30000, currency: 'USD', version: session.household.version,
    }, session.token, 'PATCH')).status, 400)
    const current = householdSchema.parse((await (await call('/household', undefined, session.token)).json()).household)
    assert.equal(current.version, session.household.version)
    assert.equal(current.expenses.length, 0)
  })
  it('keeps one household billing time zone after the first bill establishes it', async () => {
    const session = await create()
    const input = {
      name: 'Rent', amount: 90000, firstDueDate: localDate(), participants: [session.memberId], timeZone: 'Pacific/Auckland',
    }
    const first = await call('/bills', { ...input, version: 0 }, session.token)
    const initial = householdSchema.parse((await first.json()).household)
    assert.equal(initial.billingTimeZone, 'Pacific/Auckland')
    const next = await call('/bills', { ...input, name: 'Electricity', timeZone: 'America/New_York', version: initial.version }, session.token)
    const current = householdSchema.parse((await next.json()).household)
    assert.equal(current.billingTimeZone, 'Pacific/Auckland')
    assert.equal(current.bills.length, 2)
  })
})
