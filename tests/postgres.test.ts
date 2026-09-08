import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { once } from 'node:events'
import { PostgresDatabase, SQLiteDatabase, postgresFromEnvironment, postgresPoolConfig, postgresSql } from '../server/database.ts'
import type { Database, Row } from '../server/database.ts'
import { initializePostgres, schemaExists, upgradePostgres } from '../server/postgres-schema.ts'
import { migrateSqlite } from '../server/migration.ts'
import { accountRecoveryTables, applicationSchemaVersion, applicationTables, tableColumns } from '../server/schema.ts'
import { Store } from '../server/store.ts'
import { createApp } from '../server/app.ts'
import { ApiError } from '../server/errors.ts'
import { balances, localDate } from '../shared/domain.ts'

it('translates shared query parameters without rewriting quoted text or comments', () => {
  assert.equal(postgresSql("SELECT '?', \"?\", $$?$$, $tag$?$tag$, ? -- ?\n/* ? */ WHERE id = ?"),
    "SELECT '?', \"?\", $$?$$, $tag$?$tag$, $1 -- ?\n/* ? */ WHERE id = $2")
  assert.throws(() => postgresPoolConfig({ url: 'postgres://user:pass@remote.example/db', schema: 'roomlings', tls: 'disable' }))
})

const enabled = !!process.env.TEST_DATABASE_URL
if (process.env.REQUIRE_POSTGRES_TESTS === 'true' && !enabled) throw new Error('PostgreSQL coverage requires TEST_DATABASE_URL.')

function configuration() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL tests require an explicit TEST_DATABASE_URL.')
  return postgresFromEnvironment({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    DATABASE_SCHEMA: `roomlings_test_${randomUUID().replaceAll('-', '')}`,
    DATABASE_TLS: process.env.TEST_DATABASE_TLS,
    DATABASE_SSL_ROOT_CERT: process.env.TEST_DATABASE_SSL_ROOT_CERT,
  })
}

async function removeTestSchema(db: PostgresDatabase) {
  if (!/^roomlings_test_[a-f0-9]{32}$/.test(db.schema)) throw new Error('Refusing to remove a non-test schema.')
  await db.transaction(async () => { await db.exec(`DROP SCHEMA IF EXISTS "${db.schema}" CASCADE`) })
}

const recoveryTables = new Set<string>(accountRecoveryTables)
const originalTables = applicationTables.filter((table) => !recoveryTables.has(table))

async function initializeVersionOne(db: PostgresDatabase) {
  if (!/^roomlings_test_[a-f0-9]{32}$/.test(db.schema)) throw new Error('A version 1 fixture needs a disposable test schema.')
  await initializePostgres(db)
  await db.transaction(async () => {
    await db.exec('DROP TABLE account_recovery_codes; DROP TABLE account_recovery_settings;')
    await db.prepare('UPDATE schema_migrations SET version = 1 WHERE version = ?').run(applicationSchemaVersion)
  })
}

async function applicationRows(db: Database, tables: readonly (keyof typeof tableColumns)[] = applicationTables) {
  return db.transaction(async () => {
    const result: Record<string, Row[]> = {}
    for (const table of tables) {
      const columns = tableColumns[table].join(', ')
      result[table] = await db.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${columns}`).all()
    }
    return result
  })
}

async function schemaObjects(db: PostgresDatabase) {
  return db.prepare(`SELECT c.oid::text AS id, c.relname AS name, c.relkind AS kind, c.relacl::text AS privileges,
    CASE WHEN c.relrowsecurity THEN 1 ELSE 0 END AS rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ? ORDER BY c.relname`).all(db.schema)
}

async function assertPrivateTables(db: PostgresDatabase, tables: readonly string[]) {
  const objects = await schemaObjects(db)
  for (const table of tables) assert.equal(objects.find((object) => object.name === table)?.rls, 1, table)
  const publicSchemas = await db.prepare(`SELECT COUNT(*) AS count FROM pg_namespace n,
    LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) p
    WHERE n.nspname = ? AND p.grantee = 0`).get(db.schema)
  assert.equal(Number(publicSchemas?.count), 0)
  const publicTables = await db.prepare(`SELECT COUNT(*) AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
    LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) p
    WHERE n.nspname = ? AND c.relkind = 'r' AND p.grantee = 0`).get(db.schema)
  assert.equal(Number(publicTables?.count), 0)
  const publicDefaults = await db.prepare(`SELECT COUNT(*) AS count FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace,
    LATERAL aclexplode(d.defaclacl) p
    WHERE n.nspname = ? AND d.defaclobjtype = 'r'
      AND (p.grantee = 0 OR p.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))`).get(db.schema)
  assert.equal(Number(publicDefaults?.count), 0)
  for (const role of ['anon', 'authenticated']) {
    if (!await db.prepare('SELECT 1 FROM pg_roles WHERE rolname = ?').get(role)) continue
    const permission = await db.prepare("SELECT CASE WHEN has_schema_privilege(?, ?, 'USAGE,CREATE') THEN 1 ELSE 0 END AS allowed").get(role, db.schema)
    assert.equal(permission?.allowed, 0)
    for (const table of tables) {
      const tablePermission = await db.prepare(`SELECT CASE WHEN has_table_privilege(?, ?,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN 1 ELSE 0 END AS allowed`).get(role, `${db.schema}.${table}`)
      assert.equal(tablePermission?.allowed, 0, `${role}.${table}`)
    }
  }
}

describe('real PostgreSQL storage', { skip: !enabled }, () => {
  it('serializes account kitchen creation receipts across independent connections without restoring closed membership', async () => {
    const config = configuration()
    const firstDb = new PostgresDatabase(config)
    const secondDb = new PostgresDatabase(config)
    const first = new Store(firstDb)
    const second = new Store(secondDb)
    try {
      await initializePostgres(firstDb)
      await secondDb.verifySchema()
      const owner = await first.accounts.signIn({ providerId: randomUUID(), email: 'creation@example.com' }, 'Ada', 'Original browser')
      const input = { requestId: randomUUID(), name: 'One kitchen', memberName: 'Ada', currency: 'EUR' as const, budget: 45000 }
      const created = await Promise.all([
        first.accounts.createHousehold({ ...owner.session }, input),
        second.accounts.createHousehold({ ...owner.session }, input),
      ])
      assert.equal(created[0].session?.household.id, created[1].session?.household.id)
      assert.equal(Number((await firstDb.prepare('SELECT COUNT(*) AS count FROM households').get())?.count), 1)
      assert.equal(Number((await secondDb.prepare('SELECT COUNT(*) AS count FROM account_memberships').get())?.count), 1)
      const household = created[0].session!.household
      household.name = 'Updated once'
      household.version++
      await first.save(household)
      const replay = await second.accounts.createHousehold(owner.session, input)
      assert.equal(replay.session?.household.id, household.id)
      assert.equal(replay.session?.household.name, household.name)
      await first.accounts.leave(owner.session, household.id, household.version)
      await assert.rejects(second.accounts.createHousehold(owner.session, input),
        (error: unknown) => error instanceof ApiError && error.status === 403)
      const separate = await second.accounts.createHousehold(owner.session, { ...input, requestId: randomUUID() })
      assert.notEqual(separate.session?.household.id, household.id)
    } finally {
      try {
        if (await schemaExists(firstDb)) await removeTestSchema(firstDb)
      } finally {
        await Promise.all([first.close(), second.close()])
      }
    }
  })

  it('preserves accounts, legacy recovery and transaction rollback with private tables', async () => {
    const db = new PostgresDatabase(configuration())
    assert.equal(await schemaExists(db), false)
    await initializePostgres(db)
    assert.equal(await db.schemaVersion(), applicationSchemaVersion)
    const store = new Store(db)
    try {
      const legacy = await store.create('Postgres kitchen', 'Ada', 'EUR', 30000)
      const member = { id: randomUUID(), name: 'Ben', color: '#71846b' }
      legacy.household.members.push(member)
      legacy.household.expenses.push({
        id: randomUUID(), description: 'Saved shared groceries', amount: 1001,
        paidBy: legacy.memberId, participants: [legacy.memberId, member.id], category: 'pantry',
        date: localDate(), createdAt: new Date().toISOString(),
      })
      await store.save(legacy.household)
      const before = balances(legacy.household)
      const access = await store.authenticate(legacy.token)
      assert.ok(access)
      const recovery = await store.rotateRecovery(access, { version: 0, revokeOthers: false })
      assert.ok(recovery && recovery !== 'conflict')
      assert.equal((await store.recover(recovery.code, 'Another browser'))?.memberId, legacy.memberId)
      const account = await store.accounts.signIn({ providerId: randomUUID(), email: 'test@example.com' }, 'Ada', 'PG browser')
      const linked = await store.accounts.link(account.session, { token: legacy.token })
      assert.equal(linked.session?.memberId, legacy.memberId)
      assert.deepEqual(balances(linked.session!.household), before)
      await assert.rejects(store.transaction(async () => {
        const household = await store.get(legacy.household.id)
        assert.ok(household)
        household.name = 'Must roll back'
        await store.save(household)
        throw new Error('Rollback probe')
      }), /Rollback probe/)
      assert.equal((await store.get(legacy.household.id))?.name, 'Postgres kitchen')
      await assertPrivateTables(db, [...applicationTables, 'schema_migrations'])
    } finally {
      await removeTestSchema(db)
      await store.close()
    }
  })

  it('upgrades a populated version 1 schema additively only after confirmation and leaves current schemas unchanged', async () => {
    const db = new PostgresDatabase(configuration())
    const store = new Store(db)
    try {
      await initializeVersionOne(db)
      const legacy = await store.create('Existing kitchen', 'Ada', 'EUR', 45000)
      const access = await store.authenticate(legacy.token)
      assert.ok(access)
      const legacyRecovery = await store.rotateRecovery(access, { version: 0, revokeOthers: false })
      assert.ok(legacyRecovery && legacyRecovery !== 'conflict')
      const owner = await store.accounts.signIn({ providerId: randomUUID(), email: 'upgrade@example.com' }, 'Ada', 'Existing browser')
      const linked = await store.accounts.link(owner.session, { token: legacy.token })
      assert.ok(linked.session)
      const invitation = await store.accounts.invite(owner.session, legacy.household.id, linked.session.household.version, 7)
      const member = await store.accounts.signIn({ providerId: randomUUID(), email: 'upgrade-member@example.com' }, 'Ben', 'Another existing browser')
      const joined = await store.accounts.accept(member.session, invitation.code, 'Ben')
      assert.ok(joined.session)
      const household = joined.session.household
      household.expenses.push({
        id: randomUUID(), description: 'Unchanged shared groceries', amount: 1001,
        paidBy: legacy.memberId, participants: [legacy.memberId, joined.session.memberId], category: 'pantry',
        date: localDate(), createdAt: new Date().toISOString(),
      })
      await store.save(household)
      await db.prepare('INSERT INTO deleted_account_providers (hash) VALUES (?)')
        .run(createHash('sha256').update(randomUUID()).digest('hex'))
      const beforeRows = await applicationRows(db, originalTables)
      for (const table of originalTables) assert.ok(beforeRows[table].length > 0, table)
      const beforeObjects = await schemaObjects(db)
      const beforeHistory = await db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all()
      await assert.rejects(db.verifySchema(), /--upgrade/)
      await assert.rejects(initializePostgres(db), /--upgrade/)
      for (const options of [{ apply: true }, { apply: true, confirmSchema: `${db.schema}_wrong` }, { confirmSchema: `${db.schema} ` }]) {
        await assert.rejects(upgradePostgres(db, options), /confirm the exact target schema/)
      }
      await db.transaction(async () => {
        for (const options of [{}, { confirmSchema: db.schema }]) {
          assert.deepEqual(await upgradePostgres(db, options), {
            applied: false, schema: db.schema, fromVersion: 1, toVersion: applicationSchemaVersion,
          })
        }
        const transaction = await db.prepare('SELECT pg_current_xact_id_if_assigned()::text AS id').get()
        assert.equal(transaction?.id, null, 'A dry run must not assign a write transaction ID.')
      })
      assert.deepEqual(await applicationRows(db, originalTables), beforeRows)
      assert.deepEqual(await schemaObjects(db), beforeObjects)
      assert.deepEqual(await db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all(), beforeHistory)

      assert.deepEqual(await upgradePostgres(db, { apply: true, confirmSchema: db.schema }), {
        applied: true, schema: db.schema, fromVersion: 1, toVersion: applicationSchemaVersion,
      })
      await db.verifySchema()
      assert.deepEqual(await applicationRows(db, originalTables), beforeRows)
      const afterObjects = await schemaObjects(db)
      const previousNames = new Set(beforeObjects.map((object) => object.name))
      assert.deepEqual(afterObjects.filter((object) => previousNames.has(object.name)), beforeObjects)
      assert.deepEqual(afterObjects.filter((object) => !previousNames.has(object.name)).map((object) => object.name).sort(),
        [...accountRecoveryTables, 'account_recovery_settings_pkey', 'account_recovery_codes_pkey', 'account_recovery_codes_account'].sort())
      assert.deepEqual(await applicationRows(db, accountRecoveryTables), { account_recovery_settings: [], account_recovery_codes: [] })
      const upgradedHistory = await db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all()
      assert.equal(upgradedHistory.length, 2)
      assert.deepEqual(upgradedHistory[0], beforeHistory[0])
      assert.equal(upgradedHistory[1].version, applicationSchemaVersion)
      assert.ok(Number.isFinite(Date.parse(String(upgradedHistory[1].applied_at))))
      await assertPrivateTables(db, [...applicationTables, 'schema_migrations'])
      assert.equal((await store.authenticate(legacy.token))?.memberId, legacy.memberId)
      const restored = await store.accounts.authenticate(owner.token)
      assert.ok(restored)
      assert.equal(restored.id, owner.session.id)
      assert.equal(restored.accountId, owner.session.accountId)
      const restoredState = await store.accounts.state(restored)
      assert.equal(restoredState.session?.memberId, legacy.memberId)
      assert.deepEqual(restoredState.session?.household, household)
      assert.deepEqual(balances(restoredState.session!.household), balances(household))
      const generated = await store.accounts.generateRecoveryCodes(restored, 0)
      assert.equal(generated.codes.length, 10)
      const currentRows = await applicationRows(db)
      await db.transaction(async () => {
        for (const options of [{}, { apply: true, confirmSchema: db.schema }]) {
          assert.deepEqual(await upgradePostgres(db, options), {
            applied: false, schema: db.schema, fromVersion: applicationSchemaVersion, toVersion: applicationSchemaVersion,
          })
        }
        await initializePostgres(db)
        await db.verifySchema()
        assert.equal((await db.prepare('SELECT pg_current_xact_id_if_assigned()::text AS id').get())?.id, null)
      })
      assert.deepEqual(await applicationRows(db), currentRows)
      assert.deepEqual(await db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all(), upgradedHistory)
      assert.deepEqual(await store.accounts.recoveryState(restored), generated.recovery)
    } finally {
      if (await schemaExists(db)) await removeTestSchema(db)
      await store.close()
    }
  })

  it('rolls back the recovery tables and protections when recording the upgrade fails', async () => {
    const db = new PostgresDatabase(configuration())
    const store = new Store(db)
    try {
      await initializeVersionOne(db)
      await store.create('Rollback kitchen', 'Ada', 'EUR', 45000)
      await store.accounts.signIn({ providerId: randomUUID(), email: 'rollback@example.com' }, 'Ada', 'Retained browser')
      await db.exec('ALTER TABLE schema_migrations ADD CONSTRAINT upgrade_rollback_probe CHECK (version = 1)')
      const beforeRows = await applicationRows(db, originalTables)
      const beforeObjects = await schemaObjects(db)
      const beforeHistory = await db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all()
      await assert.rejects(upgradePostgres(db, { apply: true, confirmSchema: db.schema }), /upgrade_rollback_probe/)
      assert.deepEqual(await applicationRows(db, originalTables), beforeRows)
      assert.deepEqual(await schemaObjects(db), beforeObjects)
      assert.deepEqual(await db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all(), beforeHistory)
      assert.equal(await db.schemaVersion(), 1)
      await assertPrivateTables(db, [...originalTables, 'schema_migrations'])
      await db.exec('ALTER TABLE schema_migrations DROP CONSTRAINT upgrade_rollback_probe')
      assert.equal((await upgradePostgres(db, { apply: true, confirmSchema: db.schema })).applied, true)
      await db.verifySchema()
    } finally {
      if (await schemaExists(db)) await removeTestSchema(db)
      await store.close()
    }
  })

  it('rejects absent, unversioned, unsupported and conflicting schemas without upgrading them', async () => {
    const db = new PostgresDatabase(configuration())
    const confirmed = { apply: true, confirmSchema: db.schema }
    try {
      await assert.rejects(upgradePostgres(db), /does not exist/)
      await assert.rejects(upgradePostgres(db, confirmed), /does not exist/)
      await assert.rejects(db.verifySchema(), /not initialized/)
      assert.equal(await schemaExists(db), false)
      await db.exec(`CREATE SCHEMA "${db.schema}"`)
      await assert.rejects(upgradePostgres(db), /not initialized/)
      await assert.rejects(upgradePostgres(db, confirmed), /not initialized/)
      assert.deepEqual(await schemaObjects(db), [])
      await removeTestSchema(db)
      await initializeVersionOne(db)
      const beforeObjects = await schemaObjects(db)
      for (const version of [0, applicationSchemaVersion + 1]) {
        await db.prepare('UPDATE schema_migrations SET version = ?').run(version)
        const beforeHistory = await db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all()
        await assert.rejects(db.verifySchema(), /unsupported schema version|only supports version/)
        await assert.rejects(upgradePostgres(db), /unsupported/)
        await assert.rejects(upgradePostgres(db, confirmed), /unsupported/)
        assert.deepEqual(await schemaObjects(db), beforeObjects)
        assert.deepEqual(await db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all(), beforeHistory)
      }
      await db.prepare('UPDATE schema_migrations SET version = 1').run()
      await db.exec('CREATE INDEX account_recovery_codes_account ON accounts(email)')
      const collidingObjects = await schemaObjects(db)
      await assert.rejects(upgradePostgres(db), /already contains account recovery objects/)
      await assert.rejects(upgradePostgres(db, confirmed), /already contains account recovery objects/)
      assert.deepEqual(await schemaObjects(db), collidingObjects)
      assert.equal(await db.schemaVersion(), 1)
    } finally {
      if (await schemaExists(db)) await removeTestSchema(db)
      await db.close()
    }
  })

  it('serializes conflicting ledger changes across independent server connections', async () => {
    const config = configuration()
    const firstDb = new PostgresDatabase(config)
    await initializePostgres(firstDb)
    const secondDb = new PostgresDatabase(config)
    const first = new Store(firstDb)
    const second = new Store(secondDb)
    const servers = [createApp(first).listen(0, '127.0.0.1'), createApp(second).listen(0, '127.0.0.1')]
    try {
      await Promise.all(servers.map((server) => once(server, 'listening')))
      const session = await first.create('Concurrent kitchen', 'Ada', 'EUR', 30000)
      const responses = await Promise.all(servers.map(async (server, index) => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('The isolated API did not open a TCP port.')
        return fetch(`http://127.0.0.1:${address.port}/api/expenses`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({
            version: 0, description: `Concurrent receipt ${index}`, amount: 100,
            paidBy: session.memberId, participants: [session.memberId], category: 'pantry', date: localDate(),
          }),
        })
      }))
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
      const saved = await first.get(session.household.id)
      assert.equal(saved?.expenses.length, 1)
      assert.equal(saved?.version, 1)
    } finally {
      for (const server of servers) {
        const closed = once(server, 'close')
        server.close()
        await closed
      }
      await removeTestSchema(firstDb)
      await Promise.all([first.close(), second.close()])
    }
  })

  it('consumes a recovery code only once across independent PostgreSQL connections', async () => {
    const config = configuration()
    const firstDb = new PostgresDatabase(config)
    const secondDb = new PostgresDatabase(config)
    const first = new Store(firstDb)
    const second = new Store(secondDb)
    try {
      await initializePostgres(firstDb)
      await secondDb.verifySchema()
      const identity = { providerId: randomUUID(), email: 'concurrent-recovery@example.com' }
      const owner = await first.accounts.signIn(identity, 'Ada', 'Original browser')
      const created = await first.accounts.createHousehold(owner.session, {
        name: 'Concurrent recovery kitchen', memberName: 'Ada', currency: 'EUR', budget: 45000,
      })
      assert.ok(created.session)
      const household = created.session.household
      const member = { id: randomUUID(), name: 'Ben', color: '#71846b' }
      household.members.push(member)
      household.expenses.push({
        id: randomUUID(), description: 'Retained shared groceries', amount: 1001,
        paidBy: created.session.memberId, participants: [created.session.memberId, member.id], category: 'pantry',
        date: localDate(), createdAt: new Date().toISOString(),
      })
      await first.save(household)
      const generated = await first.accounts.generateRecoveryCodes(owner.session, 0)
      const retainedTables = applicationTables.filter((table) => !['account_sessions', 'account_recovery_codes'].includes(table))
      const retainedRows = await applicationRows(firstDb, retainedTables)
      const input = { email: identity.email, code: generated.codes[0], label: 'Recovered browser' }
      const attempts = await Promise.allSettled([
        first.accounts.recoverAccount({ ...input, label: 'First connection' }),
        second.accounts.recoverAccount({ ...input, label: 'Second connection' }),
      ])
      assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1)
      assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1)
      const accepted = attempts.find((attempt) => attempt.status === 'fulfilled')
      const rejected = attempts.find((attempt) => attempt.status === 'rejected')
      assert.ok(accepted?.status === 'fulfilled')
      assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof ApiError)
      assert.equal(rejected.reason.status, 401)
      assert.equal(rejected.reason.code, 'INVALID_ACCOUNT_RECOVERY_CODE')
      assert.equal(accepted.value.session.accountId, owner.session.accountId)
      assert.notEqual(accepted.value.token, owner.token)
      for (const store of [first, second]) {
        const original = await store.accounts.authenticate(owner.token)
        const recovered = await store.accounts.authenticate(accepted.value.token)
        assert.ok(original && recovered)
        assert.equal(original.id, owner.session.id)
        assert.equal(recovered.id, accepted.value.session.id)
        assert.equal(recovered.accountId, owner.session.accountId)
        const state = await store.accounts.state(recovered)
        assert.equal(state.session?.memberId, created.session.memberId)
        assert.deepEqual(state.session?.household, household)
        assert.deepEqual(balances(state.session!.household), balances(household))
        await assert.rejects(store.accounts.recoverAccount(input), (error: unknown) =>
          error instanceof ApiError && error.code === 'INVALID_ACCOUNT_RECOVERY_CODE')
        assert.deepEqual(await store.accounts.recoveryState(original), { ...generated.recovery, remaining: 9 })
      }
      const sessions = await secondDb.prepare('SELECT COUNT(*) AS count FROM account_sessions WHERE account_id = ?').get(owner.session.accountId)
      assert.equal(Number(sessions?.count), 2)
      const remaining = await secondDb.prepare('SELECT hash FROM account_recovery_codes WHERE account_id = ? ORDER BY hash').all(owner.session.accountId)
      assert.deepEqual(remaining.map((row) => row.hash),
        generated.codes.slice(1).map((code) => createHash('sha256').update(code).digest('hex')).sort())
      assert.deepEqual(await applicationRows(secondDb, retainedTables), retainedRows)
    } finally {
      try {
        if (await schemaExists(firstDb)) await removeTestSchema(firstDb)
      } finally {
        await Promise.all([first.close(), second.close()])
      }
    }
  })

  it('copies a consistent SQLite snapshot without changing identities or overwriting a target', async () => {
    const directory = join('data', `postgres-migration-${randomUUID()}`)
    mkdirSync(directory, { recursive: true })
    const filename = join(directory, 'source.sqlite')
    const sourceDb = new SQLiteDatabase(filename)
    const source = new Store(sourceDb)
    const target = configuration()
    const db = new PostgresDatabase(target)
    try {
      const session = await source.create('Migrated kitchen', 'Ada', 'EUR', 45000)
      const account = await source.accounts.signIn({ providerId: randomUUID(), email: 'migration@example.com' }, 'Ada', 'Original browser')
      const linked = await source.accounts.link(account.session, { token: session.token })
      const before = linked.session!.household
      const replaced = await source.accounts.generateRecoveryCodes(account.session, 0)
      const recoveryCodes = await source.accounts.generateRecoveryCodes(account.session, replaced.recovery.version)
      await source.accounts.recoverAccount({ email: 'migration@example.com', code: recoveryCodes.codes[0], label: 'Used before migration' })
      const recovery = await source.accounts.recoveryState(account.session)
      assert.equal(recovery.version, 2)
      assert.equal(recovery.remaining, 9)
      const beforeRows = await applicationRows(sourceDb)
      const dry = await migrateSqlite({ source: filename, backup: join(directory, 'dry.sqlite'), target, apply: false })
      assert.equal(dry.applied, false)
      assert.equal(dry.counts.account_recovery_settings, 1)
      assert.equal(dry.counts.account_recovery_codes, 9)
      assert.equal(await schemaExists(db), false)
      const applied = await migrateSqlite({
        source: filename, backup: join(directory, 'backup.sqlite'), target, apply: true, confirmSchema: target.schema,
      })
      assert.equal(applied.applied, true)
      assert.equal(await db.schemaVersion(), applicationSchemaVersion)
      assert.deepEqual(applied.counts, dry.counts)
      assert.deepEqual(await applicationRows(db), beforeRows)
      assert.deepEqual(beforeRows.account_recovery_codes.map((row) => row.hash).sort(),
        recoveryCodes.codes.slice(1).map((code) => createHash('sha256').update(code).digest('hex')).sort())
      const migrated = new Store(db)
      assert.deepEqual(await migrated.get(before.id), before)
      assert.equal((await migrated.authenticate(session.token))?.memberId, session.memberId)
      const accountSession = await migrated.accounts.authenticate(account.token)
      assert.ok(accountSession)
      assert.equal((await migrated.accounts.state(accountSession)).account?.id, account.session.accountId)
      assert.deepEqual(await migrated.accounts.recoveryState(accountSession), recovery)
      const recovered = await migrated.accounts.recoverAccount({
        email: 'migration@example.com', code: recoveryCodes.codes[1], label: 'Recovered after migration',
      })
      assert.equal(recovered.session.accountId, account.session.accountId)
      const recoveredState = await migrated.accounts.state(recovered.session)
      assert.equal(recoveredState.session?.memberId, session.memberId)
      assert.deepEqual(recoveredState.session?.household, before)
      const rejectedCode = (error: unknown) => error instanceof ApiError && error.code === 'INVALID_ACCOUNT_RECOVERY_CODE'
      for (const code of [recoveryCodes.codes[0], recoveryCodes.codes[1], replaced.codes[0]]) {
        await assert.rejects(migrated.accounts.recoverAccount({ email: 'migration@example.com', code, label: 'Cannot reuse' }), rejectedCode)
      }
      assert.equal(Number((await db.prepare('SELECT COUNT(*) AS count FROM account_sessions').get())?.count), 3)
      assert.deepEqual(await migrated.accounts.recoveryState(accountSession), { ...recovery, remaining: 8 })
      await assertPrivateTables(db, accountRecoveryTables)
      await assert.rejects(migrateSqlite({
        source: filename, backup: join(directory, 'second.sqlite'), target, apply: true, confirmSchema: target.schema,
      }), /not empty/)
      assert.deepEqual(await migrated.get(before.id), before)
    } finally {
      if (await schemaExists(db)) await removeTestSchema(db)
      await db.close()
      await source.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
