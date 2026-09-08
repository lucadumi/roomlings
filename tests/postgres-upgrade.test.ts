import { describe, it } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PostgresDatabase } from '../server/database.ts'
import type { Row, Statement, Value } from '../server/database.ts'
import { initializePostgres, upgradePostgres } from '../server/postgres-schema.ts'
import { accountRecoverySchema, accountRecoveryTables, applicationSchemaVersion, sqliteSchema } from '../server/schema.ts'

const schema = 'roomlings_test_00000000000000000000000000000000'
const url = 'postgresql://migration_test@127.0.0.1:1/roomlings_test'

function fixture(t: TestContext, input: {
  exists?: boolean; initialized?: boolean; version?: number | null; collision?: boolean
} = {}) {
  const db = new PostgresDatabase({ url, schema, tls: 'disable' })
  t.after(() => db.close())
  const reads: string[] = []
  const writes: { sql: string; values: Value[]; depth: number }[] = []
  let depth = 0
  let transactions = 0
  let version = input.version === undefined ? 1 : input.version
  t.mock.method(db, 'transaction', async <T>(operation: () => Promise<T>): Promise<T> => {
    depth++
    transactions++
    try { return await operation() } finally { depth-- }
  })
  t.mock.method(db, 'exec', async (sql: string) => { writes.push({ sql, values: [], depth }) })
  t.mock.method(db, 'prepare', (sql: string): Statement => ({
    get: async (): Promise<Row | undefined> => {
      reads.push(sql)
      if (sql.startsWith('SELECT 1 FROM pg_namespace')) return input.exists === false ? undefined : { exists: 1 }
      if (sql.includes("c.relname = 'schema_migrations'")) {
        return input.exists === false || input.initialized === false ? undefined : { exists: 1 }
      }
      if (sql.startsWith('SELECT MAX(version)')) return { version }
      if (sql.includes('c.relname IN')) return input.collision ? { relname: accountRecoveryTables[0] } : undefined
      if (sql.startsWith('SELECT 1 FROM pg_roles')) return { exists: 1 }
      throw new Error(`Unexpected upgrade test query: ${sql}`)
    },
    all: async () => { throw new Error(`Unexpected upgrade test query: ${sql}`) },
    run: async (...values) => {
      if (!sql.startsWith('INSERT INTO schema_migrations')) throw new Error(`Unexpected upgrade test write: ${sql}`)
      writes.push({ sql, values, depth })
      version = Number(values[0])
      return { changes: 1 }
    },
  }))
  return { db, reads, writes, transactions: () => transactions }
}

describe('PostgreSQL upgrade safety without a database connection', () => {
  it('initializes new schemas at the current application version', async (t) => {
    const f = fixture(t, { exists: false })
    await initializePostgres(f.db)
    assert.equal(f.writes[0].sql, `CREATE SCHEMA "${schema}";`)
    assert.equal(f.writes[1].sql, sqliteSchema)
    for (const table of accountRecoveryTables) {
      assert.ok(f.writes.some((write) => write.sql === `ALTER TABLE "${schema}"."${table}" ENABLE ROW LEVEL SECURITY;`))
    }
    assert.match(f.writes.at(-1)!.sql, /^INSERT INTO schema_migrations/)
    assert.equal(f.writes.at(-1)!.values[0], applicationSchemaVersion)
    assert.ok(f.writes.every((write) => write.depth > 0))
  })

  it('defaults to a read-only plan even when a valid confirmation is supplied', async (t) => {
    const f = fixture(t)
    for (const options of [{}, { apply: false }, { confirmSchema: schema }]) {
      assert.deepEqual(await upgradePostgres(f.db, options), {
        applied: false, schema, fromVersion: 1, toVersion: applicationSchemaVersion,
      })
    }
    assert.ok(f.reads.some((sql) => sql.startsWith('SELECT MAX(version)')))
    assert.deepEqual(f.writes, [])
  })

  it('requires exact confirmation before any database operation', async (t) => {
    const f = fixture(t)
    for (const options of [
      { apply: true }, { apply: true, confirmSchema: '' }, { apply: true, confirmSchema: `${schema} ` },
      { apply: true, confirmSchema: 'another_schema' }, { confirmSchema: 'another_schema' },
    ]) {
      await assert.rejects(upgradePostgres(f.db, options), /confirm the exact target schema/)
    }
    assert.equal(f.transactions(), 0)
    assert.deepEqual(f.reads, [])
    assert.deepEqual(f.writes, [])
  })

  it('rejects absent, unversioned, unsupported and colliding schemas without writes', async (t) => {
    for (const input of [
      { exists: false }, { initialized: false }, { version: null }, { version: 0 },
      { version: applicationSchemaVersion + 1 }, { collision: true },
    ]) {
      const f = fixture(t, input)
      for (const options of [{}, { apply: true, confirmSchema: schema }]) {
        await assert.rejects(upgradePostgres(f.db, options), /does not exist|not initialized|unsupported|already contains/)
      }
      assert.deepEqual(f.writes, [])
    }
  })

  it('runs only shared recovery DDL and private protections before recording the version', async (t) => {
    const f = fixture(t)
    assert.deepEqual(await upgradePostgres(f.db, { apply: true, confirmSchema: schema }), {
      applied: true, schema, fromVersion: 1, toVersion: applicationSchemaVersion,
    })
    assert.equal(f.writes[0].sql, accountRecoverySchema)
    assert.deepEqual(f.writes.slice(1, 3).map((write) => write.sql),
      accountRecoveryTables.map((table) => `ALTER TABLE "${schema}"."${table}" ENABLE ROW LEVEL SECURITY;`))
    const qualifiedTables = accountRecoveryTables.map((table) => `"${schema}"."${table}"`).join(', ')
    for (const [index, role] of ['PUBLIC', '"anon"', '"authenticated"'].entries()) {
      const sql = f.writes[index + 3].sql
      assert.ok(sql.includes(`REVOKE ALL ON SCHEMA "${schema}" FROM ${role};`))
      assert.ok(sql.includes(`REVOKE ALL ON TABLE ${qualifiedTables} FROM ${role};`))
      assert.ok(sql.includes(`ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" REVOKE ALL ON TABLES FROM ${role};`))
    }
    assert.equal(f.writes.length, 7)
    const recorded = f.writes.at(-1)!
    assert.match(recorded.sql, /^INSERT INTO schema_migrations/)
    assert.equal(recorded.values[0], applicationSchemaVersion)
    assert.ok(Number.isFinite(Date.parse(String(recorded.values[1]))))
    assert.ok(f.writes.every((write) => write.depth > 0))
    assert.equal(await f.db.schemaVersion(), applicationSchemaVersion)
  })

  it('reports no change for an already-current schema, including a confirmed apply', async (t) => {
    const f = fixture(t, { version: applicationSchemaVersion })
    for (const options of [{}, { apply: true, confirmSchema: schema }]) {
      assert.deepEqual(await upgradePostgres(f.db, options), {
        applied: false, schema, fromVersion: applicationSchemaVersion, toVersion: applicationSchemaVersion,
      })
    }
    await initializePostgres(f.db)
    assert.deepEqual(f.writes, [])
  })

  it('keeps startup read-only and gives version-specific guidance', async (t) => {
    const current = fixture(t, { version: applicationSchemaVersion })
    await current.db.verifySchema()
    assert.deepEqual(current.writes, [])
    for (const [version, message] of [
      [1, /npm run database:migrate -- --upgrade/],
      [applicationSchemaVersion + 1, /compatible application build/],
      [0, /unsupported schema version/],
    ] as const) {
      const f = fixture(t, { version })
      await assert.rejects(f.db.verifySchema(), message)
      await assert.rejects(initializePostgres(f.db), message)
      assert.deepEqual(f.writes, [])
    }
    const absent = fixture(t, { exists: false })
    await assert.rejects(absent.db.verifySchema(), /startup never creates tables/)
    assert.deepEqual(absent.writes, [])
  })
})

describe('database migration CLI validation', () => {
  const cli = fileURLToPath(new URL('../server/migrate-cli.ts', import.meta.url))
  function rejects(args: string[], message: RegExp, env: NodeJS.ProcessEnv = {}) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env, timeout: 10_000 })
    assert.equal(result.error, undefined)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, message)
  }

  it('rejects SQLite source and backup flags in upgrade mode before reading configuration', () => {
    for (const args of [
      ['--source', 'data/unused-source.sqlite'], ['--backup', 'data/unused-backup.sqlite'],
      ['--source', ''], ['--backup', ''],
      ['--source', 'data/unused-source.sqlite', '--backup', 'data/unused-backup.sqlite', '--apply'],
    ]) rejects(['--upgrade', ...args], /--upgrade cannot be combined with --source or --backup/)
  })

  it('retains required source and backup validation outside upgrade mode', () => {
    rejects([], /Provide --source and a new --backup path/)
    rejects(['--source', 'data/unused-source.sqlite'], /Provide --source and a new --backup path/)
  })

  it('rejects missing and incorrect upgrade confirmation without opening a connection', () => {
    const env = { DATABASE_URL: url, DATABASE_SCHEMA: schema, DATABASE_TLS: 'disable' }
    for (const args of [
      ['--apply'], ['--apply', '--confirm-schema', 'another_schema'],
      ['--apply', '--confirm-schema', `${schema} `], ['--confirm-schema', 'another_schema'],
    ]) rejects(['--upgrade', ...args], /confirm the exact target schema/, env)
  })
})
