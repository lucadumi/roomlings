import { parseArgs } from 'node:util'
import { PostgresDatabase, postgresFromEnvironment } from './database.ts'
import { migrateSqlite } from './migration.ts'
import { upgradePostgres } from './postgres-schema.ts'

const { values } = parseArgs({
  options: {
    source: { type: 'string' }, backup: { type: 'string' },
    upgrade: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false }, 'confirm-schema': { type: 'string' },
  },
})
if (values.upgrade) {
  if (values.source !== undefined || values.backup !== undefined) {
    throw new Error('--upgrade cannot be combined with --source or --backup. Back up Postgres separately; see docs/storage.md.')
  }
  const db = new PostgresDatabase(postgresFromEnvironment())
  try {
    const result = await upgradePostgres(db, { apply: values.apply, confirmSchema: values['confirm-schema'] })
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await db.close()
  }
} else {
  if (!values.source || !values.backup) throw new Error('Provide --source and a new --backup path, or use --upgrade for an existing Postgres schema. Without --apply, the target is not changed.')
  const result = await migrateSqlite({
    source: values.source, backup: values.backup, target: postgresFromEnvironment(),
    apply: values.apply, confirmSchema: values['confirm-schema'],
  })
  console.log(JSON.stringify(result, null, 2))
}
