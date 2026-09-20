import { randomUUID } from 'node:crypto'
import { analyticsBatchSchema, analyticsDayCountSchema } from '../shared/analytics.ts'
import type { AnalyticsBatch, AnalyticsDayCount, AnalyticsEventKind } from '../shared/analytics.ts'
import type { AccountSession } from './accounts-store.ts'
import type { Database } from './database.ts'
import { transactional } from './database.ts'
import type { Store } from './store.ts'
import { ApiError } from './errors.ts'

export const analyticsRetention = 30 * 24 * 60 * 60_000
// A local date legitimately runs ahead of or behind UTC, and device clocks drift, so allow a
// day either side. Anything further is a client backfilling days it was not there for.
export const analyticsDateTolerance = 24 * 60 * 60_000
export const analyticsOccurrenceCeiling = 10_000

export class AnalyticsStore {
  private readonly db: Database
  private readonly store: Store
  private readonly now: () => number

  constructor(db: Database, store: Store, now: () => number = Date.now) {
    this.db = db
    this.store = store
    this.now = now
    this.record = transactional(db, this.record.bind(this))
    this.cleanup = transactional(db, this.cleanup.bind(this))
  }

  async record(session: AccountSession, householdId: string, batch: AnalyticsBatch): Promise<{ recorded: number }> {
    const { memberId } = await this.store.accounts.household(session, householdId)
    const checked = analyticsBatchSchema.parse(batch)
    const now = this.now()
    const stamp = new Date(now).toISOString()
    for (const event of checked.events) {
      const occurred = Date.parse(event.occurredAt)
      if (occurred <= now - analyticsRetention || occurred > now + analyticsDateTolerance) {
        throw new ApiError(400, 'Analytics events must fall inside the retention window.', 'ANALYTICS_EVENT_OUT_OF_RANGE')
      }
      const bucket = Date.parse(`${event.localDate}T00:00:00.000Z`)
      if (Math.abs(bucket - Date.parse(event.occurredAt.slice(0, 10) + 'T00:00:00.000Z')) > analyticsDateTolerance) {
        throw new ApiError(400, 'An analytics local date must match the moment it reports.', 'ANALYTICS_DATE_MISMATCH')
      }
      await this.db.prepare(`INSERT INTO analytics_events
        (id, dedup_key, household_id, member_id, kind, local_date, occurrences, created_at, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(dedup_key) DO UPDATE SET occurrences = analytics_events.occurrences + 1, updated_at = excluded.updated_at
        WHERE analytics_events.occurrences < ?`)
        .run(randomUUID(), `${householdId}:${memberId}:${event.kind}:${event.localDate}`, householdId, memberId,
          event.kind, event.localDate, stamp, stamp, new Date(now + analyticsRetention).toISOString(),
          analyticsOccurrenceCeiling)
    }
    return { recorded: checked.events.length }
  }

  // Answers "how many members did this on that day" without reporting which ones.
  async report(householdId: string, kind: AnalyticsEventKind, localDate: string): Promise<AnalyticsDayCount> {
    const row = await this.db.prepare(`SELECT COUNT(*) AS members, COALESCE(SUM(occurrences), 0) AS occurrences
      FROM analytics_events WHERE household_id = ? AND kind = ? AND local_date = ?`).get(householdId, kind, localDate)
    return analyticsDayCountSchema.parse({
      localDate, kind, members: Number(row?.members ?? 0), occurrences: Number(row?.occurrences ?? 0),
    })
  }

  async cleanup(): Promise<void> {
    await this.db.prepare('DELETE FROM analytics_events WHERE expires_at <= ?').run(new Date(this.now()).toISOString())
  }
}
