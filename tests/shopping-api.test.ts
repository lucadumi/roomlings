import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Store } from '../server/store.ts'
import { createApp } from '../server/app.ts'
import { balances, householdSchema, localDate } from '../shared/domain.ts'
import type { Household, Session, ShoppingItem } from '../shared/domain.ts'

describe('shared shopping API', () => {
  let store: Store
  let server: Server
  let origin: string
  beforeEach(async () => {
    store = new Store(':memory:')
    server = createApp(store).listen(0, '127.0.0.1')
    await once(server, 'listening')
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterEach(async () => {
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
    const response = await call('/households', { name: 'Our shopping house', memberName: 'Ada', currency: 'EUR', budget: 45000 })
    return response.json()
  }
  const current = async (session: Session): Promise<Household> => {
    const response = await call('/household', undefined, session.token)
    return householdSchema.parse((await response.json()).household)
  }
  const change = async (session: Session, path: string, body: Record<string, unknown>, method?: string) => {
    const state = await current(session)
    const response = await call(path, { ...body, version: state.version }, session.token, method)
    assert.equal(response.status, 200)
    return householdSchema.parse((await response.json()).household)
  }
  const add = async (session: Session, name = 'Milk') => {
    const state = await change(session, '/shopping/items', { name, quantity: '2 cartons', notes: 'Unsweetened' })
    return state.shopping.items.at(-1)!
  }
  const pick = async (session: Session, item: ShoppingItem) => {
    const state = await change(session, `/shopping/items/${item.id}/pick`, { itemVersion: item.version, pickedUp: true })
    return state.shopping.items.find((entry) => entry.id === item.id)!
  }
  const checkout = (session: Session, item: ShoppingItem) => ({
    checkoutId: randomUUID(), items: [{ id: item.id, version: item.version }],
    description: 'The shared grocery run', amount: 1001, paidBy: session.memberId,
    participants: session.household.members.map((member) => member.id), category: 'dairy', date: localDate(),
  })

  it('supports collaborative edits and exclusive claims without creating expenses', async () => {
    const owner = await create()
    const roommate: Session = await (await call('/join', { inviteCode: owner.household.inviteCode, name: 'Ben' })).json()
    const entry = await add(owner)
    const edited = await change(roommate, `/shopping/items/${entry.id}`, { name: 'Oat milk', quantity: '3 cartons', notes: 'Plain', itemVersion: 0 }, 'PATCH')
    assert.equal(edited.shopping.items[0].createdBy, owner.memberId)
    assert.equal(edited.shopping.items[0].version, 1)
    const claims = await Promise.all([
      call(`/shopping/items/${entry.id}/claim`, { claimed: true, itemVersion: 1, version: edited.version }, owner.token),
      call(`/shopping/items/${entry.id}/claim`, { claimed: true, itemVersion: 1, version: edited.version }, roommate.token),
    ])
    assert.deepEqual(claims.map((response) => response.status).sort(), [200, 409])
    const claimed = await current(owner)
    const shopper = claimed.shopping.items[0].claimedBy === owner.memberId ? owner : roommate
    const other = shopper === owner ? roommate : owner
    assert.equal((await call(`/shopping/items/${entry.id}/pick`, {
      pickedUp: true, itemVersion: 2, version: claimed.version,
    }, other.token)).status, 409)
    await pick(shopper, claimed.shopping.items[0])
    const state = await current(owner)
    assert.equal(state.shopping.items[0].pickedUp, true)
    assert.equal(state.expenses.length, 0)
    assert.equal(state.budget, 45000)
    assert.ok([...balances(state).values()].every((value) => value === 0))
  })

  it('checks out selected items once and leaves other baskets untouched', async () => {
    const owner = await create()
    const roommate: Session = await (await call('/join', { inviteCode: owner.household.inviteCode, name: 'Ben' })).json()
    owner.household = roommate.household
    const selected = await pick(owner, await add(owner))
    const remaining = await pick(owner, await add(owner, 'Bread'))
    const theirs = await pick(roommate, await add(roommate, 'Apples'))
    const before = await current(owner)
    const input = { ...checkout(owner, selected), version: before.version }
    const attempts = await Promise.all([
      call('/shopping/checkout', input, owner.token),
      call('/shopping/checkout', input, owner.token),
    ])
    assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409])
    const saved = await current(owner)
    assert.equal(saved.expenses.length, 1)
    assert.equal(saved.expenses[0].shoppingRunId, input.checkoutId)
    assert.equal(saved.shopping.runs.length, 1)
    assert.equal(saved.shopping.runs[0].expenseId, saved.expenses[0].id)
    assert.equal(saved.shopping.runs[0].items[0].id, selected.id)
    assert.equal(saved.shopping.runs[0].items[0].quantity, '2 cartons')
    assert.deepEqual(saved.shopping.items.map((item) => item.id), [remaining.id, theirs.id])
    assert.equal([...balances(saved).values()].reduce((sum, value) => sum + value, 0), 0)
    assert.equal((await call('/shopping/checkout', { ...input, version: saved.version }, owner.token)).status, 409)
    await change(owner, `/expenses/${saved.expenses[0].id}`, {}, 'DELETE')
    const removed = await current(owner)
    assert.equal(removed.expenses.length, 0)
    assert.equal(removed.shopping.runs.length, 1)
    assert.equal((await call('/shopping/checkout', { ...input, version: removed.version }, owner.token)).status, 409)
  })

  it('keeps picked-up items and the checkout key available when persistence fails', async (context) => {
    const owner = await create()
    const selected = await pick(owner, await add(owner))
    const before = await current(owner)
    const input = { ...checkout(owner, selected), version: before.version }
    const failingSave = context.mock.method(store, 'save', () => { throw new Error('Simulated shopping save failure') })
    assert.equal((await call('/shopping/checkout', input, owner.token)).status, 500)
    failingSave.mock.restore()
    assert.deepEqual(await current(owner), before)
    assert.equal((await call('/shopping/checkout', input, owner.token)).status, 200)
    const saved = await current(owner)
    assert.equal(saved.shopping.items.length, 0)
    assert.equal(saved.shopping.runs.length, 1)
    assert.equal(saved.expenses.length, 1)
  })

  it('rejects stale item snapshots, invalid splits and foreign-household items', async () => {
    const owner = await create()
    const original = await pick(owner, await add(owner))
    await change(owner, `/shopping/items/${original.id}/pick`, { pickedUp: false, itemVersion: original.version })
    const editable = (await current(owner)).shopping.items[0]
    await change(owner, `/shopping/items/${original.id}`, { name: 'Milk', quantity: '4 cartons', notes: '', itemVersion: editable.version }, 'PATCH')
    await pick(owner, (await current(owner)).shopping.items[0])
    const fresh = await current(owner)
    assert.equal((await call('/shopping/checkout', { ...checkout(owner, original), version: fresh.version }, owner.token)).status, 409)
    const valid = checkout(owner, fresh.shopping.items[0])
    assert.equal((await call('/shopping/checkout', { ...valid, participants: [randomUUID()], version: fresh.version }, owner.token)).status, 400)
    assert.equal((await call('/shopping/checkout', { ...valid, items: [valid.items[0], valid.items[0]], version: fresh.version }, owner.token)).status, 400)
    const other = await create()
    assert.equal((await call(`/shopping/items/${original.id}/claim`, { claimed: true, itemVersion: 0, version: 0 }, other.token)).status, 404)
    assert.equal((await call('/shopping/items', { name: 'Milk', quantity: '', version: fresh.version }, owner.token)).status, 400)
    assert.equal((await call('/shopping/items', { name: 'Milk', version: 0 })).status, 401)
    assert.equal((await current(owner)).expenses.length, 0)
  })

  it('requires a claim to be released before another roommate edits or removes an item', async () => {
    const owner = await create()
    const roommate: Session = await (await call('/join', { inviteCode: owner.household.inviteCode, name: 'Ben' })).json()
    const selected = await pick(roommate, await add(owner))
    const before = await current(owner)
    assert.equal((await call(`/shopping/items/${selected.id}`, {
      name: 'Changed', quantity: '1', notes: '', itemVersion: selected.version, version: before.version,
    }, owner.token, 'PATCH')).status, 409)
    assert.equal((await call(`/shopping/items/${selected.id}`, { itemVersion: selected.version, version: before.version }, owner.token, 'DELETE')).status, 409)
    const released = await change(owner, `/shopping/items/${selected.id}/claim`, { claimed: false, itemVersion: selected.version })
    assert.equal(released.shopping.items[0].claimedBy, null)
    assert.equal(released.shopping.items[0].pickedUp, false)
    await change(owner, `/shopping/items/${selected.id}`, { itemVersion: released.shopping.items[0].version }, 'DELETE')
    assert.equal((await current(owner)).shopping.items.length, 0)
  })
})
