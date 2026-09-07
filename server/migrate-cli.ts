import { parseArgs } from 'node:util'
import { postgresFromEnvironment } from './database.ts'
import { migrateSqlite } from './migration.ts'

const { values } = parseArgs({
  options: {
    source: { type: 'string' }, backup: { type: 'string' },
    apply: { type: 'boolean', default: false }, 'confirm-schema': { type: 'string' },
  },
})
if (!values.source || !values.backup) throw new Error('Provide --source and a new --backup path. Without --apply, the target is not changed.')
const result = await migrateSqlite({
  source: values.source, backup: values.backup, target: postgresFromEnvironment(),
  apply: values.apply, confirmSchema: values['confirm-schema'],
})
console.log(JSON.stringify(result, null, 2))
