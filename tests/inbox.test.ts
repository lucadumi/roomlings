import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { createApp } from '../server/app.ts'
import { Store } from '../server/store.ts'
import { choreSchema, householdSchema } from '../shared/domain.ts'
import type { Household, Session } from '../shared/domain.ts'
import { inboxItems, inboxUnread, mergeInboxRead, readAll } from '../shared/inbox.ts'
import type { InboxState } from '../shared/inbox.ts'

const now = Date.parse('2026-09-20T12:00:00.000Z')
const today = '2026-09-20'

function home(): Household {
  return householdSchema.parse({
    id: randomUUID(), name: 'The inbox house', currency: 'EUR', budget: 45000, inviteCode: 'test-invitation', version: 0,
    members: ['Ada', 'Ben', 'Cara'].map((name) => ({ id: randomUUID(), name, color: '#789359' })),
    expenses: [], settlements: [],
  })
}

function chore(household: Household, dueDate: string, rotation = [household.members[0].id], overrides: Record<string, unknown> = {}) {
  return choreSchema.parse({
    id: randomUUID(), title: 'Scrub the sink', notes: '', roomId: 'kitchen', area: 'sink', dueDate, repeatDays: 7, rotation, turn: 0,
    createdBy: household.members[0].id, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    version: 0, occurrence: 0, archived: false, ...overrides,
  })
}

describe('inbox items', () => {
  it('lists my due and overdue turns, money others paid that I share, and repayments to me', () => {
    const household = home()
    const [ada, ben, cara] = household.members.map((member) => member.id)
    household.chores.items.push(
      chore(household, '2026-09-17'), chore(household, today, [ada], { title: 'Water the plant' }),
      chore(household, '2026-09-15', [ben], { title: 'Empty the bin' }), chore(household, '2026-09-22', [ada], { title: 'Mop' }),
    )
    household.expenses.push(
      { id: randomUUID(), description: 'Groceries', amount: 2410, paidBy: ben, participants: [ada, ben, cara], category: 'produce', date: '2026-09-19', createdAt: '2026-09-19T10:00:00.000Z' },
      { id: randomUUID(), description: 'My own shop', amount: 900, paidBy: ada, participants: [ada, ben], category: 'pantry', date: '2026-09-19', createdAt: '2026-09-19T11:00:00.000Z' },
      { id: randomUUID(), description: 'Not mine', amount: 500, paidBy: ben, participants: [ben, cara], category: 'pantry', date: '2026-09-19', createdAt: '2026-09-19T12:00:00.000Z' },
      { id: randomUUID(), description: 'Old', amount: 500, paidBy: ben, participants: [ada, ben], category: 'pantry', date: '2026-07-01', createdAt: '2026-07-01T12:00:00.000Z' },
    )
    household.settlements.push(
      { id: randomUUID(), from: cara, to: ada, amount: 1200, createdAt: '2026-09-18T09:00:00.000Z' },
      { id: randomUUID(), from: ada, to: cara, amount: 300, createdAt: '2026-09-18T10:00:00.000Z' },
    )
    const items = inboxItems(household, ada, today, now)
    assert.deepEqual(items.map((item) => item.title), [
      'Scrub the sink is 3 days overdue', 'Water the plant is due today', 'Ben paid Groceries', 'Cara paid you back',
    ])
    assert.deepEqual(items[2].target, { page: 'groceries', month: '2026-09' })
    assert.equal(items[2].detail, 'Split 3 ways')
    assert.equal(items[0].detail, 'Kitchen; your turn')
  })

  it('reads one item or everything up to the newest item, keeping later entries unread', () => {
    const household = home()
    const [ada, ben] = household.members.map((member) => member.id)
    household.chores.items.push(chore(household, '2026-09-17'))
    household.expenses.push({ id: randomUUID(), description: 'Groceries', amount: 2410, paidBy: ben, participants: [ada, ben], category: 'produce', date: '2026-09-19', createdAt: '2026-09-19T10:00:00.000Z' })
    let state: InboxState = { readThrough: null, readIds: [] }
    const items = inboxItems(household, ada, today, now)
    assert.ok(items.every((item) => inboxUnread(item, state)))
    state = mergeInboxRead(state, { ids: [items[1].id] })
    assert.deepEqual(items.map((item) => inboxUnread(item, state)), [true, false])
    assert.equal(items[0].kind, 'chore')
    state = mergeInboxRead(state, { through: readAll(items, state).readThrough! })
    assert.ok(items.every((item) => !inboxUnread(item, state)))
    household.settlements.push({ id: randomUUID(), from: ben, to: ada, amount: 100, createdAt: '2026-09-20T09:00:00.000Z' })
    const later = inboxItems(household, ada, today, now)
    assert.equal(later.filter((item) => inboxUnread(item, state)).length, 1)
    // An older cursor never moves the saved one backwards.
    assert.equal(mergeInboxRead(state, { through: '2026-01-01T00:00:00.000Z' }).readThrough, state.readThrough)
  })
})

describe('inbox API', () => {
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

  it('keeps read state private per roommate without changing the household version', async () => {
    assert.equal((await call('/inbox')).status, 401)
    const first: Session = await (await call('/households', { name: 'Our kitchen', memberName: 'Ada', currency: 'EUR', budget: 30000 })).json()
    const second: Session = await (await call('/join', { inviteCode: first.household.inviteCode, name: 'Ben' })).json()
    assert.deepEqual(await (await call('/inbox', undefined, first.token)).json(), { readThrough: null, readIds: [] })
    const id = `settlement:${randomUUID()}`
    const saved = await call('/inbox', { ids: [id], through: '2026-09-19T10:00:00.000Z' }, first.token, 'PUT')
    assert.equal(saved.status, 200)
    assert.deepEqual(await saved.json(), { readThrough: '2026-09-19T10:00:00.000Z', readIds: [id] })
    assert.deepEqual(await (await call('/inbox', undefined, first.token)).json(), { readThrough: '2026-09-19T10:00:00.000Z', readIds: [id] })
    assert.deepEqual(await (await call('/inbox', undefined, second.token)).json(), { readThrough: null, readIds: [] })
    const household = await store.get(first.household.id)
    assert.equal(household?.version, second.household.version)
    for (const body of [{}, { ids: ['not-an-item'] }, { through: 'yesterday' }, { ids: [id], extra: true }]) {
      assert.equal((await call('/inbox', body, first.token, 'PUT')).status, 400)
    }
  })
})
