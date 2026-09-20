import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { PostgresDatabase, SQLiteDatabase, postgresFromEnvironment } from '../server/database.ts'
import { Store } from '../server/store.ts'
import { PushTokenCipher } from '../server/push-crypto.ts'
import { NotificationWorker } from '../server/notification-worker.ts'
import { notificationTables, tableColumns } from '../server/schema.ts'
import { pushClaimLifetime } from '../server/notifications-store.ts'
import { migrateSqlite } from '../server/migration.ts'
import { upgradePostgres } from '../server/postgres-schema.ts'
import { FakePushProvider, notificationFixture, testExpense } from './notifications-fixture.ts'
import { billingDate } from '../shared/domain.ts'

const cipher = new PushTokenCipher(Buffer.alloc(32, 7))

async function seed(store: Store) {
  const owner = await store.accounts.signIn({ providerId: 'ada@example.com', email: 'ada@example.com' }, 'Ada', 'Test phone')
  const created = await store.accounts.createHousehold(owner.session, { name: 'Persistent home', memberName: 'Ada', currency: 'EUR', budget: 45000 })
  const initial = created.session!.household
  const invite = await store.accounts.invite(owner.session, initial.id, initial.version, 7)
  const other = await store.accounts.signIn({ providerId: 'ben@example.com', email: 'ben@example.com' }, 'Ben', 'Test phone')
  const joined = await store.accounts.accept(other.session, invite.code, 'Ben')
  const household = joined.session!.household
  const installationId = randomUUID()
  await store.notifications.register(other.session, { installationId, token: 'aabbccdd', environment: 'sandbox' }, cipher)
  await store.notifications.settings(other.session, household.id, true, { chores: false, money: true })
  await store.transaction(async () => {
    household.expenses.push({
      id: randomUUID(), description: 'Private expense', amount: 1000, paidBy: created.session!.memberId,
      participants: household.members.map((member) => member.id), category: 'pantry',
      date: billingDate('UTC'), createdAt: new Date().toISOString(),
    })
    household.version++
    await store.save(household)
    await store.notifications.enqueueNewEntries(household, created.session!.memberId, { expenses: new Set(), settlements: new Set() })
  })
  return { owner, other, household, installationId }
}

it('persists settings and encrypted outbox across SQLite restarts and claims once across independent worker processes', async (t) => {
  const directory = join('test-results', `push-persistence-${randomUUID()}`)
  mkdirSync(directory, { recursive: true })
  const filename = join(directory, 'push.sqlite')
  let clock = Date.now()
  let db = new SQLiteDatabase(filename)
  let store = new Store(db, { now: () => clock })
  t.after(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }) })
  const { other, household } = await seed(store)
  const encrypted = await db.prepare('SELECT token_ciphertext, token_hash FROM push_devices').get()
  assert.ok(!JSON.stringify(encrypted).includes('aabbccdd'))
  await store.close()
  const program = `
    import { Store } from './server/store.ts'
    const store = new Store(${JSON.stringify(filename)})
    try { console.log(JSON.stringify(await store.notifications.claim())) } finally { await store.close() }
  `
  const run = promisify(execFile)
  const claimed = await Promise.all([1, 2].map(async () => {
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', program], { timeout: 15_000 })
    return JSON.parse(stdout.trim()) as { id: string; claimToken: string } | null
  }))
  assert.equal(claimed.filter(Boolean).length, 1)
  clock = Date.now() + pushClaimLifetime + 1000
  db = new SQLiteDatabase(filename)
  store = new Store(db, { now: () => clock })
  assert.deepEqual((await store.notifications.settings(other.session, household.id, true)).preferences, { chores: false, money: true })
  assert.deepEqual(await store.get(household.id), household)
  assert.deepEqual(await db.prepare('SELECT token_ciphertext, token_hash FROM push_devices').get(), encrypted)
  const provider = new FakePushProvider()
  const worker = new NotificationWorker(store, { provider, cipher, mode: 'inline' }, { now: () => clock })
  assert.equal((await worker.runOnce()).sent, 1)
  assert.equal(provider.requests[0].token, 'aabbccdd')
  assert.equal(provider.requests[0].id, claimed.find(Boolean)!.id)
  assert.equal((await worker.runOnce()).sent, 0)
})

it('adds SQLite notification tables without rewriting households or replacing existing sessions', async (t) => {
  const directory = join('test-results', `push-upgrade-${randomUUID()}`)
  mkdirSync(directory, { recursive: true })
  const filename = join(directory, 'push.sqlite')
  let db = new SQLiteDatabase(filename)
  let store = new Store(db)
  t.after(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }) })
  const { owner, household } = await seed(store)
  const before = await db.prepare('SELECT state FROM households WHERE id = ?').get(household.id)
  await db.exec([...notificationTables].reverse().map((table) => `DROP TABLE ${table};`).join('\n'))
  await store.close()
  db = new SQLiteDatabase(filename)
  store = new Store(db)
  assert.deepEqual(await db.prepare('SELECT state FROM households WHERE id = ?').get(household.id), before)
  assert.equal((await store.accounts.authenticate(owner.token))?.id, owner.session.id)
  for (const table of notificationTables) assert.equal(Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get())?.count), 0)
})

const postgres = !!process.env.TEST_DATABASE_URL
if (process.env.REQUIRE_POSTGRES_TESTS === 'true' && !postgres) throw new Error('PostgreSQL coverage requires TEST_DATABASE_URL.')
function postgresConfig(schema: string) {
  return postgresFromEnvironment({
    DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_SCHEMA: schema,
    DATABASE_TLS: process.env.TEST_DATABASE_TLS, DATABASE_SSL_ROOT_CERT: process.env.TEST_DATABASE_SSL_ROOT_CERT,
  })
}

it('claims once across independent PostgreSQL workers and upgrades version 3 atomically without changing prior data', { skip: !postgres }, async (t) => {
  const f = await notificationFixture(t)
  assert.ok(f.db instanceof PostgresDatabase)
  const { owner, other, household, ownerId } = await f.home()
  const original = await f.db.prepare('SELECT state FROM households WHERE id = ?').get(household.id)
  await f.db.transaction(async () => {
    await f.db.exec([...notificationTables].reverse().map((table) => `DROP TABLE ${table};`).join('\n'))
    await f.db.prepare('UPDATE schema_migrations SET version = 3').run()
  })
  const history = await f.db.prepare('SELECT * FROM schema_migrations').all()
  const planned = await upgradePostgres(f.db)
  assert.equal(planned.fromVersion, 3)
  assert.equal(planned.applied, false)
  assert.deepEqual(await f.db.prepare('SELECT * FROM schema_migrations').all(), history)
  await f.db.exec('ALTER TABLE schema_migrations ADD CONSTRAINT push_rollback_probe CHECK(version = 3)')
  await assert.rejects(upgradePostgres(f.db, { apply: true, confirmSchema: f.db.schema }), /push_rollback_probe/)
  assert.equal(await f.db.schemaVersion(), 3)
  await f.db.exec('ALTER TABLE schema_migrations DROP CONSTRAINT push_rollback_probe')
  assert.equal((await upgradePostgres(f.db, { apply: true, confirmSchema: f.db.schema })).applied, true)
  assert.deepEqual(await f.db.prepare('SELECT state FROM households WHERE id = ?').get(household.id), original)
  assert.equal((await f.store.accounts.authenticate(owner.token))?.id, owner.session.id)
  const privateTables = await f.db.prepare(`SELECT c.relname AS name, CASE WHEN c.relrowsecurity THEN 1 ELSE 0 END AS rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ? AND c.relkind = 'r'`).all(f.db.schema)
  for (const table of notificationTables) assert.equal(privateTables.find((row) => row.name === table)?.rls, 1)
  await f.register(other.session)
  assert.equal((await owner.request('/expenses', testExpense(household, ownerId))).status, 200)
  const second = new Store(new PostgresDatabase(postgresConfig(f.db.schema)), { now: f.now })
  try {
    const claims = await Promise.all([f.store.notifications.claim(), second.notifications.claim()])
    assert.equal(claims.filter(Boolean).length, 1)
  } finally { await second.close() }
})

it('imports protected tokens, preferences and pending notification dedup state from SQLite to PostgreSQL', { skip: !postgres }, async (t) => {
  const directory = join('test-results', `push-import-${randomUUID()}`)
  mkdirSync(directory, { recursive: true })
  const filename = join(directory, 'source.sqlite')
  const sourceDb = new SQLiteDatabase(filename)
  const source = new Store(sourceDb)
  const config = postgresConfig(`roomlings_test_${randomUUID().replaceAll('-', '')}`)
  const targetDb = new PostgresDatabase(config)
  const target = new Store(targetDb)
  t.after(async () => {
    try {
      await targetDb.exec(`DROP SCHEMA IF EXISTS "${targetDb.schema}" CASCADE`)
    } finally {
      await target.close()
      await source.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
  const { other, household } = await seed(source)
  const result = await migrateSqlite({ source: filename, backup: join(directory, 'backup.sqlite'), target: config, apply: true, confirmSchema: config.schema })
  assert.equal(result.applied, true)
  for (const table of notificationTables) {
    const columns = tableColumns[table].join(', ')
    assert.deepEqual(await targetDb.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${columns}`).all(),
      await sourceDb.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${columns}`).all())
  }
  assert.deepEqual((await target.notifications.settings(other.session, household.id, true)).preferences, { chores: false, money: true })
  const provider = new FakePushProvider()
  const worker = new NotificationWorker(target, { provider, cipher, mode: 'inline' })
  assert.equal((await worker.runOnce()).sent, 1)
  assert.equal(provider.requests[0].token, 'aabbccdd')
})
