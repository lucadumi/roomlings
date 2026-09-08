import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { createApp } from '../server/app.ts'
import { Store } from '../server/store.ts'
import { householdSchema, localDate, mutationReceiptLimit } from '../shared/domain.ts'
import type { Session } from '../shared/domain.ts'
import { databaseFixture } from './database-fixture.ts'

describe('durable household mutation receipts', () => {
  let database: Awaited<ReturnType<typeof databaseFixture>>
  let server: Server
  let origin: string
  let session: Session

  beforeEach(async () => {
    database = await databaseFixture()
    session = await database.store.create('A reliable household', 'Ada', 'EUR', 45000)
    session.household.members.push({ id: randomUUID(), name: 'Ben', color: '#7d9070' })
    await database.store.save(session.household)
    server = createApp(database.store).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('The isolated API did not open a port.')
    origin = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    mock.restoreAll()
    const closed = once(server, 'close')
    server.close()
    await closed
    await database.close()
  })

  const call = (path: string, body: Record<string, unknown>, token = session.token, method = 'POST') => fetch(`${origin}/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const expense = () => ({
    description: 'A paid receipt', amount: 1001, paidBy: session.memberId,
    participants: session.household.members.map((member) => member.id), category: 'pantry', date: localDate(),
  })
  const mutation = (version = 0) => ({ mutationId: randomUUID(), mutationVersion: version, version })

  for (const kind of ['expenses', 'bills', 'chores', 'shopping/items', 'settlements'] as const) {
    it(`retries ${kind} once even when the household version has advanced`, async () => {
      let version = 0
      let body: Record<string, unknown>
      if (kind === 'expenses') body = expense()
      else if (kind === 'bills') body = {
        name: 'Internet', amount: 3000, firstDueDate: localDate(), participants: [session.memberId],
      }
      else if (kind === 'chores') body = {
        title: 'Wash the dishes', roomId: 'kitchen', area: 'sink', dueDate: localDate(),
        repeatDays: 7, rotation: [session.memberId], turn: 0,
      }
      else if (kind === 'shopping/items') body = { name: 'Milk', quantity: '1 carton', notes: '' }
      else {
        const other = session.household.members[1]
        const saved = await call('/expenses', { ...expense(), amount: 1000, participants: [other.id], version })
        assert.equal(saved.status, 200)
        version = 1
        body = { from: other.id, to: session.memberId, amount: 1000 }
      }
      const input = { ...body, ...mutation(version) }
      const first = await call(`/${kind}`, input)
      assert.equal(first.status, 200)
      const household = householdSchema.parse((await first.json()).household)
      const response = await call(`/${kind}`, { ...input, version: household.version })
      assert.equal(response.status, 200)
      const replay = await response.json()
      assert.equal(replay.replayed, true)
      assert.deepEqual(householdSchema.parse(replay.household), household)
    })
  }

  it('serializes duplicate in-flight requests into one saved change', async () => {
    const input = { ...expense(), ...mutation() }
    const responses = await Promise.all([call('/expenses', input), call('/expenses', input)])
    assert.deepEqual(responses.map((response) => response.status), [200, 200])
    const results = await Promise.all(responses.map((response) => response.json()))
    assert.equal(results.filter((result) => result.replayed === true).length, 1)
    const household = await database.store.get(session.household.id)
    assert.equal(household?.expenses.length, 1)
    assert.equal(household?.version, 1)
    assert.equal(household?.mutationReceipts?.length, 1)
  })

  it('does not accept another roommate or another operation for a saved identifier', async () => {
    const input = { ...expense(), ...mutation() }
    assert.equal((await call('/expenses', input)).status, 200)
    const household = await database.store.get(session.household.id)
    assert.ok(household)
    const other = await database.store.session(household, household.members[1].id)
    const wrongMember = await call('/expenses', { ...input, version: 1 }, other.token)
    assert.equal(wrongMember.status, 409)
    assert.equal((await wrongMember.json()).code, 'MUTATION_ID_CONFLICT')
    const wrongAction = await call('/shopping/items', { ...input, version: 1, name: 'Milk' })
    assert.equal(wrongAction.status, 409)
    assert.equal((await wrongAction.json()).code, 'MUTATION_PAYLOAD_CHANGED')
    assert.equal((await database.store.get(household.id))?.version, 1)
  })

  it('treats JSON key ordering as the same payload', async () => {
    const input = { ...expense(), ...mutation() }
    assert.equal((await call('/expenses', input)).status, 200)
    const reordered = Object.fromEntries(Object.entries(input).reverse())
    const response = await call('/expenses', reordered)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).replayed, true)
  })

  it('rolls back mutation receipts together with failed saves', async () => {
    const input = { ...expense(), ...mutation() }
    const save = mock.method(database.store, 'save', async () => { throw new Error('Simulated mutation persistence failure') })
    assert.equal((await call('/expenses', input)).status, 500)
    save.mock.restore()
    const unchanged = await database.store.get(session.household.id)
    assert.equal(unchanged?.version, 0)
    assert.equal(unchanged?.expenses.length, 0)
    assert.equal(unchanged?.mutationReceipts, undefined)
    assert.equal((await call('/expenses', input)).status, 200)
    assert.equal((await database.store.get(session.household.id))?.expenses.length, 1)
  })

  it('bounds receipt history without allowing an expired retry to become a new change', async () => {
    session.household.version = mutationReceiptLimit + 1
    session.household.mutationReceipts = Array.from({ length: mutationReceiptLimit }, (_, index) => ({
      id: randomUUID(), memberId: session.memberId, version: index + 2, fingerprint: 'a'.repeat(64),
    }))
    await database.store.save(session.household)
    const stale = await call('/expenses', { ...expense(), ...mutation(), version: session.household.version })
    assert.equal(stale.status, 409)
    assert.equal((await stale.json()).code, 'MUTATION_TOO_OLD')
    const input = { ...expense(), ...mutation(session.household.version) }
    const saved = await call('/expenses', input)
    assert.equal(saved.status, 200)
    const household = householdSchema.parse((await saved.json()).household)
    assert.equal(household.mutationReceipts?.length, mutationReceiptLimit)
    assert.equal(household.mutationReceipts?.[0].version, 3)
    assert.equal(household.mutationReceipts?.at(-1)?.id, input.mutationId)
    assert.equal(household.expenses.length, 1)
  })

  it('rejects incomplete or invalid mutation metadata before changing the ledger', async () => {
    for (const metadata of [
      { mutationId: 'not-an-id', mutationVersion: 0 },
      { mutationId: randomUUID() },
      { mutationVersion: 0 },
      { mutationId: randomUUID(), mutationVersion: 1 },
    ]) {
      assert.equal((await call('/expenses', { ...expense(), version: 0, ...metadata })).status, 400)
    }
    const household = await database.store.get(session.household.id)
    assert.equal(household?.version, 0)
    assert.equal(household?.expenses.length, 0)
  })

  it('keeps replay protection after reopening the SQLite file and API', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'roomlings-mutation-replay-'))
    const filename = join(directory, 'household.sqlite')
    let diskStore: Store | undefined
    let diskServer: Server | undefined
    const open = async () => {
      diskStore = new Store(filename)
      diskServer = createApp(diskStore).listen(0, '127.0.0.1')
      await once(diskServer, 'listening')
      const address = diskServer.address()
      if (!address || typeof address === 'string') throw new Error('The persisted API did not open a port.')
      return `http://127.0.0.1:${address.port}`
    }
    const close = async () => {
      if (diskServer?.listening) {
        const closed = once(diskServer, 'close')
        diskServer.close()
        await closed
      }
      await diskStore?.close()
      diskServer = undefined
      diskStore = undefined
    }
    try {
      let diskOrigin = await open()
      assert.ok(diskStore)
      const saved = await diskStore.create('Persistent confirmations', 'Ada', 'EUR', 45000)
      const input = {
        ...expense(), paidBy: saved.memberId, participants: [saved.memberId], ...mutation(),
      }
      const send = () => fetch(`${diskOrigin}/api/expenses`, {
        method: 'POST', headers: { Authorization: `Bearer ${saved.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const first = await send()
      assert.equal(first.status, 200)
      const original = householdSchema.parse((await first.json()).household)
      await close()
      diskOrigin = await open()
      const replay = await send()
      assert.equal(replay.status, 200)
      const result = await replay.json()
      assert.equal(result.replayed, true)
      assert.deepEqual(householdSchema.parse(result.household), original)
    } finally {
      await close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
