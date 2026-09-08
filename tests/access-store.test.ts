import { it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../server/store.ts'

it('migrates legacy sessions without replacing their token, identity or household data', async () => {
  const filename = resolve('data', `test-access-migration-${randomUUID()}.sqlite`)
  mkdirSync(resolve('data'), { recursive: true })
  const householdId = randomUUID()
  const memberId = randomUUID()
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const legacy = JSON.stringify({
    id: householdId, name: 'Legacy home', currency: 'EUR', budget: 45000, inviteCode: 'legacy-invitation',
    demo: false, version: 7, members: [{ id: memberId, name: 'Ada', color: '#789359' }],
    expenses: [], settlements: [],
  })
  let database = new DatabaseSync(filename)
  let store: Store | undefined
  try {
    database.exec(`
      CREATE TABLE households (id TEXT PRIMARY KEY, invite TEXT UNIQUE NOT NULL, state TEXT NOT NULL);
      CREATE TABLE sessions (hash TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL);
    `)
    database.prepare('INSERT INTO households (id, invite, state) VALUES (?, ?, ?)').run(householdId, 'legacy-invitation', legacy)
    database.prepare('INSERT INTO sessions (hash, household_id, member_id) VALUES (?, ?, ?)').run(tokenHash, householdId, memberId)
    database.close()
    store = new Store(filename)
    const original = (await store.authenticate(token))
    assert.ok(original)
    assert.equal(original.memberId, memberId)
    assert.equal(original.household.id, householdId)
    assert.equal('demo' in original.household, false)
    const state = (await store.accessState(original))
    assert.ok(state)
    assert.equal(state.devices[0].label, 'Saved browser')
    assert.equal(state.devices[0].createdAt, null)
    const sessionId = state.devices[0].id
    const generated = (await store.rotateRecovery(original, { version: 0, revokeOthers: false }))
    assert.ok(generated && generated !== 'conflict')
    const code = generated.code
    await store.close()
    store = undefined

    database = new DatabaseSync(filename)
    assert.equal(database.prepare('SELECT state FROM households WHERE id = ?').get(householdId)?.state, legacy)
    assert.equal(database.prepare('SELECT hash FROM sessions WHERE id = ?').get(sessionId)?.hash, tokenHash)
    const recovery = database.prepare('SELECT hash FROM recovery_codes WHERE household_id = ? AND member_id = ?').get(householdId, memberId)
    assert.equal(recovery?.hash, createHash('sha256').update(code).digest('hex'))
    assert.notEqual(recovery?.hash, code)
    database.close()

    store = new Store(filename)
    assert.equal((await store.authenticate(token))?.sessionId, sessionId)
    const restored = (await store.recover(code, 'New laptop'))
    assert.ok(restored)
    assert.equal(restored.memberId, memberId)
    assert.equal(restored.household.version, 7)
    assert.equal(restored.household.members.length, 1)
    const current = (await store.authenticate(token))
    assert.ok(current)
    const activeStore = store
    database = new DatabaseSync(filename)
    database.exec("CREATE TRIGGER block_test_revocation BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'Test revocation failure'); END")
    await assert.rejects(async () => (await activeStore.rotateRecovery(current, { version: 1, revokeOthers: true })), /Test revocation failure/)
    assert.equal((await store.accessState(current))?.recovery.version, 1)
    assert.ok((await store.authenticate(restored.token)))
    database.exec('DROP TRIGGER block_test_revocation')
    database.close()
    assert.equal((await store.recover(code, 'The original code still works'))?.memberId, memberId)
  } finally {
    await store?.close()
    if (database.isOpen) database.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
      if (existsSync(path)) unlinkSync(path)
    }
  }
})
