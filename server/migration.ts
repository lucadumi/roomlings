import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { balances, householdSchema } from '../shared/domain.ts'
import { PostgresDatabase, SQLiteDatabase } from './database.ts'
import type { PostgresConfig, Row, Value } from './database.ts'
import { initializePostgres, schemaExists } from './postgres-schema.ts'
import { applicationTables, tableColumns } from './schema.ts'

export type MigrationResult = { applied: boolean; backup: string; schema: string; counts: Record<string, number> }

function fingerprint(records: Row[], columns: readonly string[]): string {
  const lines = records.map((record) => JSON.stringify(columns.map((column) => record[column]))).sort()
  const digest = createHash('sha256')
  for (const line of lines) digest.update(line).update('\n')
  return digest.digest('hex')
}

export async function createSnapshot(source: string, destination: string): Promise<void> {
  if (resolve(source) === resolve(destination)) throw new Error('The backup must be separate from the live SQLite database.')
  mkdirSync(dirname(resolve(destination)), { recursive: true })
  closeSync(openSync(destination, 'wx'))
  const db = new DatabaseSync(source, { readOnly: true })
  try { await backup(db, destination) } finally { db.close() }
}

export async function migrateSqlite(input: {
  source: string; backup: string; target: PostgresConfig; apply: boolean; confirmSchema?: string
}): Promise<MigrationResult> {
  if (input.apply && input.confirmSchema !== input.target.schema) throw new Error('Explicitly confirm the target schema before applying the migration.')
  await createSnapshot(input.source, input.backup)
  const source = new SQLiteDatabase(input.backup)
  const target = new PostgresDatabase(input.target)
  try {
    const data = new Map<string, Row[]>()
    const counts: Record<string, number> = {}
    for (const table of applicationTables) {
      const records = await source.prepare(`SELECT ${tableColumns[table].join(', ')} FROM ${table}`).all()
      data.set(table, records)
      counts[table] = records.length
    }
    for (const record of data.get('households') ?? []) {
      balances(householdSchema.parse(JSON.parse(String(record.state))))
    }
    const violations = await source.prepare('PRAGMA foreign_key_check').all()
    if (violations.length) throw new Error('The SQLite snapshot has inconsistent foreign-key references.')
    await target.transaction(async () => {
      const exists = await schemaExists(target)
      if (exists) {
        await target.verifySchema()
        for (const table of applicationTables) {
          const row = await target.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
          if (Number(row?.count) !== 0) throw new Error('The target application schema is not empty; refusing to overwrite it.')
        }
      }
      if (!input.apply) return
      await initializePostgres(target)
      for (const table of applicationTables) {
        const records = data.get(table) ?? []
        const columns = tableColumns[table]
        for (let offset = 0; offset < records.length; offset += 100) {
          const batch = records.slice(offset, offset + 100)
          const values: Value[] = batch.flatMap((record) => columns.map((column) => record[column]))
          const placeholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
          await target.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`).run(...values)
        }
        const imported = await target.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all()
        if (fingerprint(imported, columns) !== fingerprint(records, columns)) throw new Error(`Migration parity failed for ${table}; the import was rolled back.`)
      }
    })
    return { applied: input.apply, backup: resolve(input.backup), schema: input.target.schema, counts }
  } finally {
    await source.close()
    await target.close()
  }
}
