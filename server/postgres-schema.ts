import { PostgresDatabase } from './database.ts'
import { applicationTables, sqliteSchema } from './schema.ts'

export async function schemaExists(db: PostgresDatabase): Promise<boolean> {
  return !!await db.prepare('SELECT 1 FROM pg_namespace WHERE nspname = ?').get(db.schema)
}

export async function initializePostgres(db: PostgresDatabase): Promise<void> {
  await db.transaction(async () => {
    if (await schemaExists(db)) {
      await db.verifySchema()
      return
    }
    await db.exec(`CREATE SCHEMA "${db.schema}"; REVOKE ALL ON SCHEMA "${db.schema}" FROM PUBLIC;`)
    await db.exec(sqliteSchema)
    await db.exec(`CREATE UNIQUE INDEX sessions_id ON sessions(id);
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      REVOKE ALL ON ALL TABLES IN SCHEMA "${db.schema}" FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES IN SCHEMA "${db.schema}" REVOKE ALL ON TABLES FROM PUBLIC;`)
    for (const table of [...applicationTables, 'schema_migrations']) {
      await db.exec(`ALTER TABLE "${db.schema}"."${table}" ENABLE ROW LEVEL SECURITY;`)
    }
    for (const role of ['anon', 'authenticated']) {
      if (!await db.prepare('SELECT 1 FROM pg_roles WHERE rolname = ?').get(role)) continue
      await db.exec(`REVOKE ALL ON SCHEMA "${db.schema}" FROM "${role}";
        REVOKE ALL ON ALL TABLES IN SCHEMA "${db.schema}" FROM "${role}";
        ALTER DEFAULT PRIVILEGES IN SCHEMA "${db.schema}" REVOKE ALL ON TABLES FROM "${role}";`)
    }
    await db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString())
  })
}
