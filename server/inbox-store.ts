import { inboxStateSchema, mergeInboxRead } from '../shared/inbox.ts'
import type { InboxRead, InboxState } from '../shared/inbox.ts'
import type { Database } from './database.ts'
import { transactional } from './database.ts'

// Read state is personal and outside the household JSON, so reading never conflicts with ledger edits.
export class InboxStore {
  private readonly db: Database
  private readonly now: () => number

  constructor(db: Database, now: () => number = Date.now) {
    this.db = db
    this.now = now
    this.state = transactional(db, this.state.bind(this))
    this.read = transactional(db, this.read.bind(this))
  }

  async state(householdId: string, memberId: string): Promise<InboxState> {
    const row = await this.db.prepare('SELECT read_through, read_ids FROM inbox_reads WHERE household_id = ? AND member_id = ?')
      .get(householdId, memberId)
    return inboxStateSchema.parse(row
      ? { readThrough: row.read_through === null ? null : String(row.read_through), readIds: JSON.parse(String(row.read_ids)) }
      : { readThrough: null, readIds: [] })
  }

  async read(householdId: string, memberId: string, input: InboxRead): Promise<InboxState> {
    const next = mergeInboxRead(await this.state(householdId, memberId), input)
    await this.db.prepare(`INSERT INTO inbox_reads (household_id, member_id, read_through, read_ids, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(household_id, member_id) DO UPDATE SET
      read_through = excluded.read_through, read_ids = excluded.read_ids, updated_at = excluded.updated_at`)
      .run(householdId, memberId, next.readThrough, JSON.stringify(next.readIds), new Date(this.now()).toISOString())
    return next
  }
}
