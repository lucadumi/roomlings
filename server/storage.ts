import { join, resolve } from 'node:path'
import { PostgresDatabase, postgresFromEnvironment } from './database.ts'
import { Store } from './store.ts'

export async function openStore(env: NodeJS.ProcessEnv = process.env): Promise<Store> {
  const driver = env.DATABASE_DRIVER ?? 'sqlite'
  if (driver === 'sqlite') return new Store(join(resolve(env.DATA_DIR ?? './data'), 'kitchen.sqlite'))
  if (driver !== 'postgres') throw new Error('DATABASE_DRIVER must be sqlite or postgres.')
  const db = new PostgresDatabase(postgresFromEnvironment(env))
  try {
    await db.verifySchema()
    return new Store(db)
  } catch (error) {
    await db.close()
    throw error
  }
}
