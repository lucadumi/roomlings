import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { PoolClient, PoolConfig } from 'pg'
import { z } from 'zod'
import { sqliteSchema } from './schema.ts'

export type Value = string | number | null
export type Row = Record<string, Value>
export interface Statement {
  get(...values: Value[]): Promise<Row | undefined>
  all(...values: Value[]): Promise<Row[]>
  run(...values: Value[]): Promise<{ changes: number }>
}
export interface Database {
  readonly driver: 'sqlite' | 'postgres'
  prepare(sql: string): Statement
  exec(sql: string): Promise<void>
  transaction<T>(operation: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]))
function rows(values: unknown[]): Row[] { return values.map((value) => rowSchema.parse(value)) }

export function postgresSql(sql: string): string {
  let result = ''
  let parameter = 0
  for (let index = 0; index < sql.length;) {
    const quote = sql[index]
    if (quote === "'" || quote === '"') {
      const start = index++
      while (index < sql.length) {
        if (sql[index++] !== quote) continue
        if (sql[index] === quote) { index++; continue }
        break
      }
      result += sql.slice(start, index)
    } else if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index)
      result += sql.slice(index, end < 0 ? sql.length : end)
      index = end < 0 ? sql.length : end
    } else if (sql.startsWith('/*', index)) {
      const start = index
      let depth = 1
      index += 2
      while (index < sql.length && depth) {
        if (sql.startsWith('/*', index)) { depth++; index += 2 }
        else if (sql.startsWith('*/', index)) { depth--; index += 2 }
        else index++
      }
      result += sql.slice(start, index)
    } else if (quote === '$' && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(index))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index))![0]
      const end = sql.indexOf(tag, index + tag.length)
      const next = end < 0 ? sql.length : end + tag.length
      result += sql.slice(index, next)
      index = next
    } else {
      result += quote === '?' ? `$${++parameter}` : quote
      index++
    }
  }
  return result
}

export function transactional<A extends unknown[], R>(db: Database, operation: (...args: A) => Promise<R>) {
  return (...args: A): Promise<R> => db.transaction(() => operation(...args))
}

export class SQLiteDatabase implements Database {
  readonly driver = 'sqlite'
  private readonly db: DatabaseSync
  private readonly context = new AsyncLocalStorage<{ active: boolean }>()
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename)
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;')
      this.db.exec(sqliteSchema)
      const columns = new Set(this.db.prepare('PRAGMA table_info(sessions)').all().map((row) => row.name))
      if (!columns.has('id')) this.db.exec('ALTER TABLE sessions ADD COLUMN id TEXT')
      if (!columns.has('label')) this.db.exec("ALTER TABLE sessions ADD COLUMN label TEXT NOT NULL DEFAULT 'Saved browser'")
      if (!columns.has('created_at')) this.db.exec('ALTER TABLE sessions ADD COLUMN created_at TEXT')
      if (!columns.has('last_used_at')) this.db.exec('ALTER TABLE sessions ADD COLUMN last_used_at TEXT')
      for (const row of this.db.prepare('SELECT hash FROM sessions WHERE id IS NULL').all()) {
        this.db.prepare('UPDATE sessions SET id = ? WHERE hash = ?').run(randomUUID(), row.hash)
      }
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sessions_id ON sessions(id); COMMIT;')
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  prepare(sql: string): Statement {
    return {
      get: (...values) => this.transaction(async () => {
        const value = this.db.prepare(sql).get(...values)
        return value === undefined ? undefined : rowSchema.parse(value)
      }),
      all: (...values) => this.transaction(async () => rows(this.db.prepare(sql).all(...values))),
      run: (...values) => this.transaction(async () => ({ changes: Number(this.db.prepare(sql).run(...values).changes) })),
    }
  }

  async exec(sql: string): Promise<void> {
    await this.transaction(async () => { this.db.exec(sql) })
  }

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const context = this.context.getStore()
    if (context) {
      if (!context.active) throw new Error('A database operation escaped its transaction.')
      return operation()
    }
    if (this.closed) throw new Error('Database is closed.')
    const run = this.queue.then(async () => {
      const scope = { active: true }
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const result = await this.context.run(scope, operation)
        this.db.exec('COMMIT')
        return result
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      } finally {
        scope.active = false
      }
    })
    // The caller receives the rejection; the queue must still accept the next operation.
    this.queue = run.catch(() => {})
    return run
  }

  async close() {
    this.closed = true
    await this.queue
    this.db.close()
  }
}

export function schemaName(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value) || ['public', 'auth', 'storage', 'extensions', 'information_schema'].includes(value) || value.startsWith('pg_')) {
    throw new Error('DATABASE_SCHEMA must be a dedicated lowercase application schema.')
  }
  return value
}

export type PostgresConfig = { url: string; schema: string; tls?: 'verify-full' | 'disable'; ca?: string }
export function postgresPoolConfig(config: PostgresConfig): PoolConfig {
  let url: URL
  try { url = new URL(config.url) } catch { throw new Error('DATABASE_URL must be a PostgreSQL connection URL.') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.hostname || url.pathname.length < 2 || url.search || url.hash) {
    throw new Error('DATABASE_URL needs an explicit host, user and database, with no query parameters or fragment.')
  }
  if (config.tls === 'disable' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Unencrypted PostgreSQL is allowed only on an explicit loopback test/development connection.')
  }
  return {
    connectionString: config.url,
    ssl: config.tls === 'disable' ? false : { rejectUnauthorized: true, ...(config.ca ? { ca: config.ca } : {}) },
    max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000,
    statement_timeout: 30_000, idle_in_transaction_session_timeout: 30_000,
    application_name: 'roomlings',
  }
}

export function postgresFromEnvironment(env: NodeJS.ProcessEnv = process.env): PostgresConfig {
  if (!env.DATABASE_URL?.trim()) throw new Error('DATABASE_DRIVER=postgres requires DATABASE_URL; SQLite fallback is disabled.')
  if (env.DATABASE_TLS && !['verify-full', 'disable'].includes(env.DATABASE_TLS)) throw new Error('DATABASE_TLS must be verify-full or disable.')
  return {
    url: env.DATABASE_URL.trim(), schema: schemaName(env.DATABASE_SCHEMA?.trim() || 'roomlings'),
    tls: env.DATABASE_TLS === 'disable' ? 'disable' : 'verify-full',
    ca: env.DATABASE_SSL_ROOT_CERT ? readFileSync(env.DATABASE_SSL_ROOT_CERT, 'utf8') : undefined,
  }
}

export class PostgresDatabase implements Database {
  readonly driver = 'postgres'
  private readonly pool: pg.Pool
  readonly schema: string
  private readonly context = new AsyncLocalStorage<{ client: PoolClient; active: boolean }>()

  constructor(config: PostgresConfig) {
    this.schema = schemaName(config.schema)
    this.pool = new pg.Pool(postgresPoolConfig(config))
    // Never log the connection string, server detail, or query parameters.
    this.pool.on('error', () => console.error('An idle PostgreSQL connection failed.'))
  }

  async verifySchema() {
    await this.transaction(async () => {
      const row = await this.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
      if (Number(row?.version) !== 1) throw new Error('Apply the supported application schema migration before starting Roomlings.')
    })
  }

  prepare(sql: string): Statement {
    const query = postgresSql(sql)
    const execute = (values: Value[]) => this.transaction(async () => {
      const context = this.context.getStore()
      if (!context?.active) throw new Error('A query needs a live pinned transaction.')
      return context.client.query<Row>(query, values)
    })
    return {
      get: async (...values) => {
        const value = (await execute(values)).rows[0]
        return value === undefined ? undefined : rowSchema.parse(value)
      },
      all: async (...values) => rows((await execute(values)).rows),
      run: async (...values) => ({ changes: (await execute(values)).rowCount ?? 0 }),
    }
  }

  async exec(sql: string): Promise<void> {
    await this.transaction(async () => {
      const context = this.context.getStore()
      if (!context?.active) throw new Error('A schema change needs a pinned transaction.')
      await context.client.query(sql)
    })
  }

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const context = this.context.getStore()
    if (context) {
      if (!context.active) throw new Error('A database operation escaped its transaction.')
      return operation()
    }
    const client = await this.pool.connect()
    const scope = { client, active: true }
    let broken = false
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL search_path TO "${this.schema}", pg_catalog`)
      // One schema-wide writer boundary preserves cross-household deletion/account invariants.
      // Every repository operation takes it, including reads that refresh session timestamps.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended(current_database() || $1, 0))', [`:${this.schema}`])
      const result = await this.context.run(scope, operation)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try { await client.query('ROLLBACK') } catch { broken = true }
      throw error
    } finally {
      scope.active = false
      client.release(broken)
    }
  }

  async close() { await this.pool.end() }
}
