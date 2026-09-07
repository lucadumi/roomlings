import { randomUUID } from 'node:crypto'
import { PostgresDatabase, postgresFromEnvironment } from '../server/database.ts'
import { initializePostgres, schemaExists } from '../server/postgres-schema.ts'
import { Store } from '../server/store.ts'

export async function databaseFixture() {
  if (!process.env.TEST_DATABASE_URL) {
    if (process.env.REQUIRE_POSTGRES_TESTS === 'true') throw new Error('PostgreSQL coverage requires TEST_DATABASE_URL.')
    const store = new Store(':memory:')
    return { store, close: () => store.close() }
  }
  const config = postgresFromEnvironment({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    DATABASE_SCHEMA: `roomlings_test_${randomUUID().replaceAll('-', '')}`,
    DATABASE_TLS: process.env.TEST_DATABASE_TLS,
    DATABASE_SSL_ROOT_CERT: process.env.TEST_DATABASE_SSL_ROOT_CERT,
  })
  const db = new PostgresDatabase(config)
  if (await schemaExists(db)) {
    await db.close()
    throw new Error('The generated test schema already exists.')
  }
  await initializePostgres(db)
  const store = new Store(db)
  return {
    store,
    close: async () => {
      if (!/^roomlings_test_[a-f0-9]{32}$/.test(db.schema)) throw new Error('Refusing to remove a non-test schema.')
      try {
        await db.transaction(async () => { await db.exec(`DROP SCHEMA "${db.schema}" CASCADE`) })
      } finally {
        await store.close()
      }
    },
  }
}
