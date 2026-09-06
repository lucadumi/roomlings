import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { createApp } from '../server/app.ts'
import { Store } from '../server/store.ts'
import { balances } from '../shared/domain.ts'
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
    store.close()
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
  it('isolates sample kitchens and never opens demo invitations to other roommates', async () => {
    const a: Session = await (await call('/demo', {})).json()
    const b: Session = await (await call('/demo', {})).json()
    assert.notEqual(a.household.id, b.household.id)
    assert.equal(a.household.demo, true)
    assert.equal(a.household.expenses.length, 6)
    assert.equal((await call('/join', { inviteCode: a.household.inviteCode, name: 'Another' })).status, 404)
  })
})
