import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { notificationFixture } from './notifications-fixture.ts'
import { analyticsRetention } from '../server/analytics-store.ts'

const path = (householdId: string) => `/account/households/${householdId}/analytics`

describe('retention analytics', () => {
  it('counts each member once a day while keeping how often they came back', async (t) => {
    const f = await notificationFixture(t, { push: false })
    const { owner, other, household } = await f.home()
    const opened = (occurredAt: string, localDate: string) => ({ events: [{ kind: 'app_opened', occurredAt, localDate }] })

    assert.deepEqual(await owner.request(path(household.id), opened('2026-09-20T09:00:00.000Z', '2026-09-20')),
      { status: 200, data: { recorded: 1 } })
    assert.deepEqual(await owner.request(path(household.id), opened('2026-09-20T21:00:00.000Z', '2026-09-20')),
      { status: 200, data: { recorded: 1 } })
    assert.deepEqual(await other.request(path(household.id), opened('2026-09-20T10:00:00.000Z', '2026-09-20')),
      { status: 200, data: { recorded: 1 } })

    assert.deepEqual(await f.store.analytics.report(household.id, 'app_opened', '2026-09-20'),
      { localDate: '2026-09-20', kind: 'app_opened', members: 2, occurrences: 3 })
    const rows = await f.db.prepare('SELECT COUNT(*) AS rows FROM analytics_events').get()
    assert.equal(Number(rows!.rows), 2)
  })

  it('answers how many members opened the app on day 7', async (t) => {
    const f = await notificationFixture(t, { push: false })
    const { owner, other, household } = await f.home()
    const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']
    for (const [index, localDate] of days.entries()) {
      f.setTime(`${localDate}T09:00:00.000Z`)
      await owner.request(path(household.id), { events: [{ kind: 'app_opened', occurredAt: `${localDate}T09:00:00.000Z`, localDate }] })
      if (index < 2) {
        await other.request(path(household.id), { events: [{ kind: 'app_opened', occurredAt: `${localDate}T09:30:00.000Z`, localDate }] })
      }
    }
    assert.equal((await f.store.analytics.report(household.id, 'app_opened', days[0])).members, 2)
    assert.equal((await f.store.analytics.report(household.id, 'app_opened', days[6])).members, 1)
  })

  it('records the invite loop and notification opens under their own kinds', async (t) => {
    const f = await notificationFixture(t, { push: false })
    const { owner, household } = await f.home()
    const kinds = ['notification_opened', 'invite_shared', 'invite_accepted'] as const
    for (const kind of kinds) {
      assert.equal((await owner.request(path(household.id),
        { events: [{ kind, occurredAt: '2026-09-20T09:00:00.000Z', localDate: '2026-09-20' }] })).status, 200)
    }
    for (const kind of kinds) {
      assert.equal((await f.store.analytics.report(household.id, kind, '2026-09-20')).members, 1)
    }
    assert.equal((await f.store.analytics.report(household.id, 'app_opened', '2026-09-20')).members, 0)
  })

  it('stores nothing beyond who, which kind and which day', async (t) => {
    const f = await notificationFixture(t, { push: false })
    const { owner, household, ownerId } = await f.home()
    await owner.request(path(household.id), {
      events: [{ kind: 'app_opened', occurredAt: '2026-09-20T09:00:00.000Z', localDate: '2026-09-20' }],
    })
    const row = await f.db.prepare('SELECT * FROM analytics_events').get()
    assert.deepEqual(Object.keys(row!).sort(), [
      'created_at', 'dedup_key', 'expires_at', 'household_id', 'id', 'kind', 'local_date', 'member_id', 'occurrences', 'updated_at',
    ])
    assert.equal(row!.household_id, household.id)
    assert.equal(row!.member_id, ownerId)
    assert.equal(row!.kind, 'app_opened')
  })

  it('rejects unknown kinds, stray fields and oversized batches without recording anything', async (t) => {
    const f = await notificationFixture(t, { push: false })
    const { owner, household } = await f.home()
    const event = { kind: 'app_opened', occurredAt: '2026-09-20T09:00:00.000Z', localDate: '2026-09-20' }
    const rejected = [
      { events: [{ ...event, kind: 'expense_recorded' }] },
      { events: [{ ...event, description: 'Private grocery details' }] },
      { events: [{ ...event, amount: 1234 }] },
      { events: [] },
      { events: Array.from({ length: 51 }, () => event) },
      { events: [{ kind: 'app_opened', occurredAt: '2026-09-20T09:00:00.000Z' }] },
    ]
    for (const body of rejected) {
      assert.equal((await owner.request(path(household.id), body)).status, 400)
    }
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS rows FROM analytics_events').get())!.rows), 0)
  })

  it('refuses days the member could not have been there for', async (t) => {
    const f = await notificationFixture(t, { push: false })
    const { owner, household } = await f.home()
    const stale = new Date(f.now() - analyticsRetention - 60_000).toISOString()
    const ahead = new Date(f.now() + 3 * 24 * 60 * 60_000).toISOString()
    const rejected = [
      { events: [{ kind: 'app_opened', occurredAt: stale, localDate: stale.slice(0, 10) }] },
      { events: [{ kind: 'app_opened', occurredAt: ahead, localDate: ahead.slice(0, 10) }] },
      { events: [{ kind: 'app_opened', occurredAt: '2026-09-20T09:00:00.000Z', localDate: '2026-09-14' }] },
    ]
    for (const body of rejected) {
      assert.equal((await owner.request(path(household.id), body)).status, 400)
    }
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS rows FROM analytics_events').get())!.rows), 0)
  })

  it('accepts a local date either side of the reported moment', async (t) => {
    const f = await notificationFixture(t, { push: false })
    const { owner, household } = await f.home()
    for (const localDate of ['2026-09-19', '2026-09-20', '2026-09-21']) {
      assert.equal((await owner.request(path(household.id),
        { events: [{ kind: 'app_opened', occurredAt: '2026-09-20T09:00:00.000Z', localDate }] })).status, 200)
    }
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS rows FROM analytics_events').get())!.rows), 3)
  })

  it('refuses households the caller is not an active member of, and unauthenticated callers', async (t) => {
    const f = await notificationFixture(t, { push: false })
    const { owner, household } = await f.home()
    const stranger = await f.signIn('cleo@example.com', 'Cleo')
    const body = { events: [{ kind: 'app_opened', occurredAt: '2026-09-20T09:00:00.000Z', localDate: '2026-09-20' }] }

    assert.equal((await stranger.request(path(household.id), body)).status, 403)
    assert.equal((await owner.request(path(randomUUID()), body)).status, 403)
    assert.equal((await f.call(path(household.id), { body })).status, 401)
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS rows FROM analytics_events').get())!.rows), 0)
  })

  it('drops events once they pass the retention window', async (t) => {
    const f = await notificationFixture(t, { push: false })
    const { owner, household } = await f.home()
    await owner.request(path(household.id), {
      events: [{ kind: 'app_opened', occurredAt: '2026-09-20T09:00:00.000Z', localDate: '2026-09-20' }],
    })
    await f.store.analytics.cleanup()
    assert.equal((await f.store.analytics.report(household.id, 'app_opened', '2026-09-20')).members, 1)

    f.advance(analyticsRetention + 60_000)
    await f.store.analytics.cleanup()
    assert.equal((await f.store.analytics.report(household.id, 'app_opened', '2026-09-20')).members, 0)
  })
})
