import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { PostgresDatabase, postgresFromEnvironment, postgresPoolConfig, postgresSql } from '../server/database.ts'
import { initializePostgres, schemaExists } from '../server/postgres-schema.ts'
import { migrateSqlite } from '../server/migration.ts'
import { Store } from '../server/store.ts'
import { createApp } from '../server/app.ts'
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

describe('real PostgreSQL storage', { skip: !enabled }, () => {
  it('preserves accounts, legacy recovery and transaction rollback with private tables', async () => {
    const db = new PostgresDatabase(configuration())
    assert.equal(await schemaExists(db), false)
    await initializePostgres(db)
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
      const unsecured = await db.prepare(`SELECT COUNT(*) AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ? AND c.relkind = 'r' AND NOT c.relrowsecurity`).get(db.schema)
      assert.equal(Number(unsecured?.count), 0)
      for (const role of ['anon', 'authenticated']) {
        if (!await db.prepare('SELECT 1 FROM pg_roles WHERE rolname = ?').get(role)) continue
        const permission = await db.prepare("SELECT CASE WHEN has_schema_privilege(?, ?, 'USAGE') THEN 1 ELSE 0 END AS allowed").get(role, db.schema)
        assert.equal(permission?.allowed, 0)
      }
    } finally {
      await removeTestSchema(db)
      await store.close()
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

  it('copies a consistent SQLite snapshot without changing identities or overwriting a target', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'roomlings-pg-migration-'))
    const filename = join(directory, 'source.sqlite')
    const source = new Store(filename)
    const target = configuration()
    const db = new PostgresDatabase(target)
    try {
      const session = await source.create('Migrated kitchen', 'Ada', 'EUR', 45000)
      const account = await source.accounts.signIn({ providerId: randomUUID(), email: 'migration@example.com' }, 'Ada', 'Original browser')
      const linked = await source.accounts.link(account.session, { token: session.token })
      const before = linked.session!.household
      const dry = await migrateSqlite({ source: filename, backup: join(directory, 'dry.sqlite'), target, apply: false })
      assert.equal(dry.applied, false)
      assert.equal(await schemaExists(db), false)
      const applied = await migrateSqlite({
        source: filename, backup: join(directory, 'backup.sqlite'), target, apply: true, confirmSchema: target.schema,
      })
      assert.equal(applied.applied, true)
      const migrated = new Store(db)
      assert.deepEqual(await migrated.get(before.id), before)
      assert.equal((await migrated.authenticate(session.token))?.memberId, session.memberId)
      const accountSession = await migrated.accounts.authenticate(account.token)
      assert.ok(accountSession)
      assert.equal((await migrated.accounts.state(accountSession)).account?.id, account.session.accountId)
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
