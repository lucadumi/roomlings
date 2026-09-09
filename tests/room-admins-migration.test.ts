import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { memberColors } from '../shared/domain.ts'
import { SQLiteDatabase } from '../server/database.ts'
import { Store } from '../server/store.ts'
import { applicationTables, roomAccessTables, tableColumns } from '../server/schema.ts'

describe('room permission persistence and legacy migration', () => {
  it('registers all trusted permission columns in the shared import/export table list', () => {
    for (const table of roomAccessTables) {
      assert.ok(applicationTables.includes(table))
      assert.deepEqual(tableColumns[table], ['household_id', 'member_id'])
      assert.ok(applicationTables.indexOf('households') < applicationTables.indexOf(table))
    }
  })

  it('backfills a legacy creator without rewriting JSON or browser proofs, and never activates retired rows', async () => {
    const directory = `.room-admin-legacy-${randomUUID()}`
    mkdirSync(directory)
    const filename = join(directory, 'kitchen.sqlite')
    const memory = new Store(':memory:')
    const created = await memory.create('Existing legacy home', 'Original creator', 'EUR', 30000)
    await memory.close()
    const member = { id: randomUUID(), name: 'Another roommate', color: memberColors[1] }
    const legacy = { ...created.household, demo: false, members: [...created.household.members, member] } as Record<string, unknown>
    delete legacy.bills
    delete legacy.shopping
    delete legacy.chores
    delete legacy.billingTimeZone
    delete legacy.roomComponents
    const bytes = JSON.stringify(legacy, null, 2)
    const retiredId = randomUUID()
    const retired = JSON.stringify({ ...legacy, id: retiredId, inviteCode: 'old-retired-invite', demo: true })
    const hash = createHash('sha256').update(created.token).digest('hex')
    const raw = new DatabaseSync(filename)
    raw.exec(`CREATE TABLE households (id TEXT PRIMARY KEY, invite TEXT UNIQUE NOT NULL, state TEXT NOT NULL);
      CREATE TABLE sessions (hash TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL);`)
    raw.prepare('INSERT INTO households VALUES (?, ?, ?)').run(created.household.id, created.household.inviteCode, bytes)
    raw.prepare('INSERT INTO households VALUES (?, ?, ?)').run(retiredId, 'old-retired-invite', retired)
    raw.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash, created.household.id, created.memberId)
    raw.close()
    const db = new SQLiteDatabase(filename)
    const store = new Store(db)
    try {
      const owner = await db.prepare('SELECT * FROM household_room_owners').all()
      assert.deepEqual(owner, [{ household_id: created.household.id, member_id: created.memberId }])
      assert.deepEqual(await db.prepare('SELECT * FROM household_room_admins').all(), [])
      assert.equal((await db.prepare('SELECT state FROM households WHERE id = ?').get(created.household.id))?.state, bytes)
      assert.equal((await db.prepare('SELECT state FROM households WHERE id = ?').get(retiredId))?.state, retired)
      assert.equal((await db.prepare('SELECT hash FROM sessions').get())?.hash, hash)
      const restored = await store.authenticate(created.token)
      assert.ok(restored)
      assert.equal(await store.accounts.roomRole(restored.household, restored.memberId), 'owner')
      assert.equal(await store.accounts.roomRole(restored.household, member.id), 'member')
      assert.equal(await store.accounts.isManaged(created.household.id), false)
      assert.equal(await store.get(retiredId), null)
      await assert.rejects(store.accounts.roomRole({ ...restored.household, id: retiredId }, created.memberId), /active access/)
      const reordered = restored.household
      reordered.members.reverse()
      await store.save(reordered)
      assert.equal(await store.accounts.roomRole(reordered, created.memberId), 'owner')
      assert.deepEqual(await db.prepare('SELECT * FROM household_room_owners').all(), owner)
    } finally {
      await store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('retains delegated rights, their revocation and original creator across restarts without storing roles in public JSON', async () => {
    const directory = `.room-admin-restart-${randomUUID()}`
    mkdirSync(directory)
    const filename = join(directory, 'kitchen.sqlite')
    let db = new SQLiteDatabase(filename)
    let store = new Store(db)
    try {
      const created = await store.create('Persistent permissions', 'Ada', 'EUR', 10000)
      const member = { id: randomUUID(), name: 'Ben', color: memberColors[1] }
      created.household.members.push(member)
      await store.save(created.household)
      const browser = await store.session(created.household, member.id)
      await store.transaction(async () => {
        await store.accounts.setRoomRole(created.household, created.memberId, member.id, 'admin')
        created.household.version++
        await store.save(created.household)
      })
      const state = (await db.prepare('SELECT state FROM households WHERE id = ?').get(created.household.id))?.state
      assert.ok(!String(state).includes('"role"'))
      await store.close()
      db = new SQLiteDatabase(filename)
      store = new Store(db)
      assert.equal((await db.prepare('SELECT state FROM households WHERE id = ?').get(created.household.id))?.state, state)
      assert.equal((await store.authenticate(browser.token))?.memberId, member.id)
      assert.equal(await store.accounts.roomRole(created.household, created.memberId), 'owner')
      assert.equal(await store.accounts.roomRole(created.household, member.id), 'admin')
      await store.transaction(async () => {
        await store.accounts.setRoomRole(created.household, created.memberId, member.id, 'member')
        created.household.version++
        await store.save(created.household)
      })
      await store.close()
      db = new SQLiteDatabase(filename)
      store = new Store(db)
      assert.equal(await store.accounts.roomRole(created.household, member.id), 'member')
      assert.deepEqual(await db.prepare('SELECT * FROM household_room_admins').all(), [])
      assert.equal((await store.authenticate(created.token))?.memberId, created.memberId)
    } finally {
      await store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('upgrades account-era SQLite without resetting transferred ownership, recovery codes or sessions', async () => {
    const directory = `.room-admin-account-upgrade-${randomUUID()}`
    mkdirSync(directory)
    const filename = join(directory, 'kitchen.sqlite')
    let db = new SQLiteDatabase(filename)
    let store = new Store(db)
    try {
      const original = await store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop')
      const created = await store.accounts.createHousehold(original.session, { name: 'Upgraded home', memberName: 'Ada', currency: 'EUR', budget: 10000 })
      const household = created.session!.household
      const invitation = await store.accounts.invite(original.session, household.id, household.version, 7)
      const successor = await store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ben', 'Phone')
      const accepted = await store.accounts.accept(successor.session, invitation.code, 'Ben')
      const transferred = await store.accounts.transfer(original.session, household.id, accepted.session!.memberId, accepted.session!.household.version)
      const recovery = await store.accounts.generateRecoveryCodes(original.session, 0)
      const state = (await db.prepare('SELECT state FROM households WHERE id = ?').get(household.id))?.state
      const sessions = await db.prepare('SELECT hash FROM account_sessions ORDER BY hash').all()
      const hashes = await db.prepare('SELECT hash FROM account_recovery_codes ORDER BY hash').all()
      await db.exec('DROP TABLE household_room_admins; DROP TABLE household_room_owners;')
      await store.close()
      db = new SQLiteDatabase(filename)
      store = new Store(db)
      assert.equal((await db.prepare('SELECT state FROM households WHERE id = ?').get(household.id))?.state, state)
      assert.deepEqual(await db.prepare('SELECT hash FROM account_sessions ORDER BY hash').all(), sessions)
      assert.deepEqual(await db.prepare('SELECT hash FROM account_recovery_codes ORDER BY hash').all(), hashes)
      assert.equal((await db.prepare('SELECT member_id FROM household_room_owners WHERE household_id = ?').get(household.id))?.member_id, created.session!.memberId)
      assert.equal(await store.accounts.roomRole(transferred.household, created.session!.memberId), 'member')
      assert.equal(await store.accounts.roomRole(transferred.household, accepted.session!.memberId), 'owner')
      assert.deepEqual(await store.accounts.recoveryState(original.session), recovery.recovery)
      assert.ok(await store.accounts.authenticate(original.token))
      assert.ok(await store.accounts.authenticate(successor.token))
    } finally {
      await store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rolls back newly added SQLite objects when legacy ownership cannot be safely established', () => {
    const directory = `.room-admin-invalid-upgrade-${randomUUID()}`
    mkdirSync(directory)
    const filename = join(directory, 'kitchen.sqlite')
    const raw = new DatabaseSync(filename)
    raw.exec('CREATE TABLE households (id TEXT PRIMARY KEY, invite TEXT UNIQUE NOT NULL, state TEXT NOT NULL);')
    raw.prepare('INSERT INTO households VALUES (?, ?, ?)').run(randomUUID(), 'invalid-existing-state', JSON.stringify({ members: [] }))
    raw.close()
    try {
      assert.throws(() => new SQLiteDatabase(filename))
      const inspect = new DatabaseSync(filename, { readOnly: true })
      try {
        assert.equal(inspect.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('household_room_owners', 'household_room_admins')").get()?.count, 0)
        assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM households').get()?.count, 1)
      } finally { inspect.close() }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
