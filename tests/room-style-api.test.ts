import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from '../server/app.ts'
import { Store } from '../server/store.ts'
import { balances, householdSchema, roomStyleSchema, suggestedTransfers } from '../shared/domain.ts'
import type { Household, RoomStyle, Session } from '../shared/domain.ts'

const styles: RoomStyle[] = ['sage', 'clay', 'linen', 'original']
const invalidStyles = [undefined, null, '', 'Sage', 'custom', '#7d9070', 1, ['sage'], { wall: '#7d9070' }]

async function serve(store: Store) {
  const server = createApp(store).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    call: (path: string, body?: unknown, token?: string, method?: string) => fetch(`${origin}/api${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    async close() {
      server.close()
      await once(server, 'close')
    },
  }
}

function withHistory(session: Session): Household {
  const { household, memberId } = session
  const roommate = household.members.find((member) => member.id !== memberId)
  assert.ok(roommate)
  const participants = [memberId, roommate.id]
  const billId = randomUUID()
  const runId = randomUUID()
  const receiptId = randomUUID()
  const now = new Date().toISOString()
  return householdSchema.parse({
    ...household,
    billingTimeZone: 'Europe/Bucharest',
    bills: [{
      id: billId, createdAt: now, startMonth: '2026-09', pauses: [],
      revisions: [{ fromMonth: '2026-09', name: 'Rent', amount: 90000, dueDay: 1, participants }],
    }],
    expenses: [...household.expenses, {
      id: randomUUID(), description: 'Rent', amount: 90001, paidBy: memberId, participants,
      category: 'other', date: '2026-09-01', createdAt: now,
      bill: { billId, month: '2026-09', dueDate: '2026-09-01' },
    }, {
      id: receiptId, description: 'Milk run', amount: 503, paidBy: memberId, participants,
      category: 'dairy', date: '2026-09-01', createdAt: now, shoppingRunId: runId,
    }],
    settlements: [{ id: randomUUID(), from: roommate.id, to: memberId, amount: 101, createdAt: now }],
    shopping: {
      items: [{
        id: randomUUID(), name: 'Bread', quantity: '1 loaf', notes: 'Wholemeal', createdBy: roommate.id,
        createdAt: now, updatedAt: now, version: 3, claimedBy: roommate.id, pickedUp: true,
      }],
      runs: [{
        id: runId, expenseId: receiptId, name: 'Milk run', completedBy: memberId, completedAt: now,
        items: [{ id: randomUUID(), name: 'Milk', quantity: '2 cartons', notes: 'Plain', createdBy: memberId, createdAt: now }],
      }],
    },
  })
}

describe('shared room style API', () => {
  let store: Store
  let api: Awaited<ReturnType<typeof serve>>
  beforeEach(async () => {
    store = new Store(':memory:')
    api = await serve(store)
  })
  afterEach(async () => {
    await api.close()
    store.close()
  })
  const create = async (): Promise<Session> => {
    const response = await api.call('/households', { name: 'Our room', memberName: 'Ada', currency: 'EUR', budget: 45000 })
    assert.equal(response.status, 201)
    return response.json()
  }
  const current = async (session: Session): Promise<Household> => {
    const response = await api.call('/household', undefined, session.token)
    assert.equal(response.status, 200)
    return (await response.json()).household
  }
  const patch = (body: unknown, token?: string) => api.call('/household/room-style', body, token, 'PATCH')
  const error = async (response: Response, status: number) => {
    assert.equal(response.status, status)
    const body = await response.json()
    assert.deepEqual(Object.keys(body), ['error'])
    assert.equal(typeof body.error, 'string')
    return body
  }

  it('defaults new, demo and legacy households to original without accepting arbitrary styles', async () => {
    const owner = await create()
    const demoResponse = await api.call('/demo', {})
    assert.equal(demoResponse.status, 201)
    const demo: Session = await demoResponse.json()
    for (const session of [owner, demo]) {
      assert.equal(session.household.roomStyle, 'original')
      assert.equal(session.household.version, 0)
      assert.deepEqual(await current(session), session.household)
      const legacy = JSON.parse(JSON.stringify({ ...session.household, roomStyle: undefined }))
      assert.deepEqual(householdSchema.parse(legacy), session.household)
      for (const roomStyle of invalidStyles.filter((style) => style !== undefined)) {
        assert.equal(householdSchema.safeParse({ ...legacy, roomStyle }).success, false)
      }
    }
    assert.deepEqual(roomStyleSchema.options, ['original', 'sage', 'clay', 'linen'])
    assert.equal(roomStyleSchema.safeParse(undefined).success, false)
  })

  it('shares every supported preset with roommates and saves exactly once per confirmation', async (context) => {
    const owner = await create()
    const joined = await api.call('/join', { inviteCode: owner.household.inviteCode, name: 'Ben' })
    assert.equal(joined.status, 201)
    const roommate: Session = await joined.json()
    let before = roommate.household
    const save = context.mock.method(store, 'save')
    assert.deepEqual(await current(owner), before)
    assert.equal(save.mock.callCount(), 0)
    for (const [index, roomStyle] of styles.entries()) {
      const response = await patch({ roomStyle, version: before.version }, index % 2 ? roommate.token : owner.token)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const expected = { ...before, roomStyle, version: before.version + 1 }
      assert.deepEqual(await response.json(), { household: expected })
      assert.deepEqual(await current(owner), expected)
      assert.deepEqual(await current(roommate), expected)
      assert.equal(save.mock.callCount(), index + 1)
      before = expected
    }
  })

  it('rejects missing and invalid presets without resetting an existing style or saving', async (context) => {
    const owner = await create()
    assert.equal((await patch({ roomStyle: 'clay', version: 0 }, owner.token)).status, 200)
    const before = await current(owner)
    const save = context.mock.method(store, 'save')
    for (const roomStyle of invalidStyles) {
      await error(await patch({ roomStyle, version: before.version }, owner.token), 400)
      assert.deepEqual(await current(owner), before)
    }
    await error(await api.call('/household', { roomStyle: 'linen', version: before.version }, owner.token, 'PATCH'), 400)
    assert.deepEqual(await current(owner), before)
    assert.equal(save.mock.callCount(), 0)
  })

  it('uses the existing version and authentication failures without changing the household', async (context) => {
    const owner = await create()
    assert.equal((await patch({ roomStyle: 'sage', version: 0 }, owner.token)).status, 200)
    const before = await current(owner)
    const save = context.mock.method(store, 'save')
    for (const version of [undefined, null, -1, 0.5, '1']) {
      await error(await patch({ roomStyle: 'linen', version }, owner.token), 400)
    }
    await error(await patch(undefined, owner.token), 400)
    const stale = await error(await patch({ roomStyle: 'linen', version: 0 }, owner.token), 409)
    const staleSettings = await error(await api.call('/household', {
      name: before.name, currency: before.currency, budget: before.budget, version: 0,
    }, owner.token, 'PATCH'), 409)
    assert.deepEqual(stale, staleSettings)
    await error(await patch({ roomStyle: 'linen', version: before.version + 1 }, owner.token), 409)
    const unauthorized = await error(await api.call('/household'), 401)
    for (const token of [undefined, 'invalid-session']) {
      assert.deepEqual(await error(await patch({ roomStyle: 'linen', version: before.version }, token), 401), unauthorized)
    }
    assert.deepEqual(await current(owner), before)
    assert.equal(save.mock.callCount(), 0)
  })

  it('allows only one concurrent shared-version change', async (context) => {
    const owner = await create()
    const joined = await api.call('/join', { inviteCode: owner.household.inviteCode, name: 'Ben' })
    assert.equal(joined.status, 201)
    const roommate: Session = await joined.json()
    const before = roommate.household
    const save = context.mock.method(store, 'save')
    const responses = await Promise.all([
      patch({ roomStyle: 'sage', version: before.version }, owner.token),
      patch({ roomStyle: 'linen', version: before.version }, roommate.token),
    ])
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
    const winner = responses.find((response) => response.status === 200)!
    const saved = (await winner.json()).household
    assert.ok(['sage', 'linen'].includes(saved.roomStyle))
    assert.deepEqual(saved, { ...before, roomStyle: saved.roomStyle, version: before.version + 1 })
    assert.deepEqual(await current(owner), saved)
    assert.equal(save.mock.callCount(), 1)
  })

  it('scopes changes to the authenticated household and stores no other submitted fields', async () => {
    const owner = await create()
    const other = await create()
    const response = await patch({
      roomStyle: 'clay', version: 0, householdId: other.household.id, id: other.household.id,
      name: 'Not a settings change', budget: 1, colors: { wall: '#123456' }, expenses: [],
      shopping: { items: [], runs: [] },
    }, owner.token)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { household: { ...owner.household, roomStyle: 'clay', version: 1 } })
    assert.deepEqual(await current(other), other.household)
    assert.equal((await create()).household.roomStyle, 'original')
  })

  it('reports failed saves and leaves the prior preset and version available for retry', async (context) => {
    const owner = await create()
    assert.equal((await patch({ roomStyle: 'sage', version: 0 }, owner.token)).status, 200)
    const before = await current(owner)
    const input = { roomStyle: 'linen', version: before.version }
    const save = context.mock.method(store, 'save', () => { throw new Error('Simulated room style save failure') })
    const failure = await error(await patch(input, owner.token), 500)
    assert.match(failure.error, /could not save/)
    assert.equal(save.mock.callCount(), 1)
    save.mock.restore()
    assert.deepEqual(await current(owner), before)
    const retry = await patch(input, owner.token)
    assert.equal(retry.status, 200)
    assert.deepEqual(await retry.json(), { household: { ...before, roomStyle: 'linen', version: before.version + 1 } })
  })
})

it('loads legacy JSON without rewriting it and persists presets, ledger, shopping and access across restarts', async () => {
  const filename = resolve('data', `test-room-style-${randomUUID()}.sqlite`)
  let store: Store | undefined = new Store(filename)
  let api: Awaited<ReturnType<typeof serve>> | undefined
  let database: DatabaseSync | undefined
  try {
    const owner = store.create('Persistent room', 'Ada', 'EUR', 35000, true)
    const original = withHistory(owner)
    store.save(original)
    const session = store.authenticate(owner.token)
    assert.ok(session)
    const recovery = store.rotateRecovery(session, { version: 0, revokeOthers: false })
    assert.ok(recovery && recovery !== 'conflict')
    const phone = store.recover(recovery.code, 'Phone')
    assert.ok(phone)
    store.close()
    store = undefined

    database = new DatabaseSync(filename)
    const legacy = JSON.stringify({ ...original, roomStyle: undefined })
    database.prepare('UPDATE households SET state = ? WHERE id = ?').run(legacy, original.id)
    const credentials = 'SELECT hash, household_id, member_id, id, label, created_at FROM sessions ORDER BY id'
    const recoveryCodes = 'SELECT household_id, member_id, hash, version, updated_at FROM recovery_codes'
    const originalCredentials = database.prepare(credentials).all()
    const originalRecovery = database.prepare(recoveryCodes).all()
    database.close()

    store = new Store(filename)
    assert.deepEqual(store.get(original.id), original)
    assert.deepEqual(store.byInvite(original.inviteCode), original)
    assert.deepEqual(store.authenticate(owner.token)?.household, original)
    database = new DatabaseSync(filename)
    assert.equal(database.prepare('SELECT state FROM households WHERE id = ?').get(original.id)?.state, legacy)
    database.close()
    api = await serve(store)
    const read = await api.call('/household', undefined, owner.token)
    assert.equal(read.status, 200)
    assert.deepEqual(await read.json(), { household: original, memberId: owner.memberId })

    let before = original
    for (const roomStyle of styles) {
      const changed: Response = await api.call('/household/room-style', {
        roomStyle, version: before.version,
        expenses: [], settlements: [], bills: [], shopping: { items: [], runs: [] }, colors: { wall: '#123456' },
      }, owner.token, 'PATCH')
      assert.equal(changed.status, 200)
      const expected = { ...before, roomStyle, version: before.version + 1 }
      assert.deepEqual(await changed.json(), { household: expected })
      await api.close()
      api = undefined
      store.close()
      store = new Store(filename)
      api = await serve(store)
      const restored = await api.call('/household', undefined, owner.token)
      assert.equal(restored.status, 200)
      assert.deepEqual(await restored.json(), { household: expected, memberId: owner.memberId })
      assert.deepEqual(store.authenticate(phone.token)?.household, expected)
      assert.deepEqual(store.byInvite(original.inviteCode), expected)
      assert.deepEqual(balances(expected), balances(original))
      assert.deepEqual(suggestedTransfers(expected), suggestedTransfers(original))
      before = expected
    }

    database = new DatabaseSync(filename)
    assert.deepEqual(database.prepare(credentials).all(), originalCredentials)
    assert.deepEqual(database.prepare(recoveryCodes).all(), originalRecovery)
    const persisted = database.prepare('SELECT state FROM households WHERE id = ?').get(original.id)
    assert.ok(persisted)
    assert.deepEqual(JSON.parse(String(persisted.state)), before)
    database.close()
    const recovered = store.recover(recovery.code, 'Recovered laptop')
    assert.ok(recovered)
    assert.equal(recovered.memberId, owner.memberId)
    assert.deepEqual(recovered.household, before)
  } finally {
    await api?.close()
    store?.close()
    if (database?.isOpen) database.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
      if (existsSync(path)) unlinkSync(path)
    }
  }
})
