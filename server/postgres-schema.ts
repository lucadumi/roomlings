import { PostgresDatabase } from './database.ts'
import {
  accountRecoverySchema, accountRecoveryTables, applicationSchemaVersion, applicationTables,
  roomAccessSchema, roomAccessTables, sqliteSchema,
} from './schema.ts'
import { backfillRoomOwners } from './room-access-migration.ts'

export type PostgresUpgradeResult = { applied: boolean; schema: string; fromVersion: number; toVersion: number }

export async function schemaExists(db: PostgresDatabase): Promise<boolean> {
  return !!await db.prepare('SELECT 1 FROM pg_namespace WHERE nspname = ?').get(db.schema)
}

async function protectPrivateTables(db: PostgresDatabase, tables: readonly string[]): Promise<void> {
  const qualifiedTables = tables.map((table) => `"${db.schema}"."${table}"`).join(', ')
  for (const table of tables) {
    await db.exec(`ALTER TABLE "${db.schema}"."${table}" ENABLE ROW LEVEL SECURITY;`)
  }
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    if (role !== 'PUBLIC' && !await db.prepare('SELECT 1 FROM pg_roles WHERE rolname = ?').get(role)) continue
    const grantee = role === 'PUBLIC' ? role : `"${role}"`
    await db.exec(`REVOKE ALL ON SCHEMA "${db.schema}" FROM ${grantee};
      REVOKE ALL ON TABLE ${qualifiedTables} FROM ${grantee};
      ALTER DEFAULT PRIVILEGES IN SCHEMA "${db.schema}" REVOKE ALL ON TABLES FROM ${grantee};`)
  }
}

async function recordSchemaVersion(db: PostgresDatabase): Promise<void> {
  await db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
    .run(applicationSchemaVersion, new Date().toISOString())
}

export async function initializePostgres(db: PostgresDatabase): Promise<void> {
  await db.transaction(async () => {
    if (await schemaExists(db)) {
      await db.verifySchema()
      return
    }
    await db.exec(`CREATE SCHEMA "${db.schema}";`)
    await db.exec(sqliteSchema)
    await db.exec(`CREATE UNIQUE INDEX sessions_id ON sessions(id);
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`)
    await protectPrivateTables(db, [...applicationTables, 'schema_migrations'])
    await recordSchemaVersion(db)
  })
}

export async function upgradePostgres(db: PostgresDatabase, options: {
  apply?: boolean; confirmSchema?: string
} = {}): Promise<PostgresUpgradeResult> {
  if ((options.apply || options.confirmSchema !== undefined) && options.confirmSchema !== db.schema) {
    throw new Error('Explicitly confirm the exact target schema with --confirm-schema before applying the upgrade.')
  }
  return db.transaction(async () => {
    if (!await schemaExists(db)) {
      throw new Error(`Application schema "${db.schema}" does not exist. --upgrade only upgrades an existing application; see docs/storage.md for initialization.`)
    }
    const fromVersion = await db.schemaVersion()
    const result = { applied: false, schema: db.schema, fromVersion, toVersion: applicationSchemaVersion }
    if (fromVersion === applicationSchemaVersion) return result
    if (fromVersion !== 1 && fromVersion !== 2) {
      throw new Error(`Cannot upgrade unsupported application schema version ${fromVersion}; only versions 1 and 2 to ${applicationSchemaVersion} are supported. Use a compatible build and review docs/storage.md.`)
    }
    const objects = [
      ...(fromVersion === 1 ? [...accountRecoveryTables, 'account_recovery_codes_account'] : []),
      ...roomAccessTables, ...roomAccessTables.map((table) => `${table}_pkey`),
    ]
    const collision = await db.prepare(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ? AND c.relname IN (${objects.map(() => '?').join(', ')})`)
      .get(db.schema, ...objects)
    if (collision) {
      const feature = [...accountRecoveryTables, 'account_recovery_codes_account'].includes(String(collision.relname))
        ? 'account recovery' : 'room access'
      throw new Error(`A version ${fromVersion} schema already contains ${feature} objects. Review its migration history before upgrading; no changes were made.`)
    }
    if (!options.apply) return result
    if (fromVersion === 1) {
      await db.exec(accountRecoverySchema)
      await protectPrivateTables(db, accountRecoveryTables)
    }
    await db.exec(roomAccessSchema)
    await backfillRoomOwners(db)
    await protectPrivateTables(db, roomAccessTables)
    await recordSchemaVersion(db)
    return { ...result, applied: true }
  })
}
