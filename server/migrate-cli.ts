import { parseArgs } from 'node:util'
import { PostgresDatabase, postgresFromEnvironment } from './database.ts'
import { migrateSqlite } from './migration.ts'
import { createPostgres, upgradePostgres } from './postgres-schema.ts'

const { values } = parseArgs({
  options: {
    source: { type: 'string' }, backup: { type: 'string' },
    init: { type: 'boolean', default: false }, upgrade: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false }, 'confirm-schema': { type: 'string' },
  },
})
if (values.init && values.upgrade) throw new Error('Choose either --init for a new schema or --upgrade for an existing one.')
if (values.init || values.upgrade) {
  if (values.source !== undefined || values.backup !== undefined) {
    throw new Error(`--${values.init ? 'init' : 'upgrade'} cannot be combined with --source or --backup. Back up Postgres separately; see docs/storage.md.`)
  }
  const db = new PostgresDatabase(postgresFromEnvironment())
  try {
    const options = { apply: values.apply, confirmSchema: values['confirm-schema'] }
    const result = await (values.init ? createPostgres(db, options) : upgradePostgres(db, options))
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await db.close()
  }
} else {
  if (!values.source || !values.backup) throw new Error('Provide --source and a new --backup path, use --init for a new Postgres schema, or --upgrade for an existing one. Without --apply, the target is not changed.')
  const result = await migrateSqlite({
    source: values.source, backup: values.backup, target: postgresFromEnvironment(),
    apply: values.apply, confirmSchema: values['confirm-schema'],
  })
  console.log(JSON.stringify(result, null, 2))
}
