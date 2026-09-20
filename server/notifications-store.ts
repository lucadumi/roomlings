import { createHash, randomUUID } from 'node:crypto'
import {
  notificationBodies, notificationPreferencesSchema, notificationSettingsSchema, notificationTargetSchema, pushDeviceSchema,
} from '../shared/notifications.ts'
import type { NotificationKind, NotificationPreferences, PushDevice, PushEnvironment } from '../shared/notifications.ts'
import type { Household } from '../shared/domain.ts'
import type { AccountSession } from './accounts-store.ts'
import { accountIdleLifetime } from './accounts-store.ts'
import type { Database, Row } from './database.ts'
import { transactional } from './database.ts'
import type { Store } from './store.ts'
import { ApiError } from './errors.ts'
import { assignedDueChores, dailyChoreWindow, summaryComponent } from './notification-schedule.ts'
import { pushTokenContext } from './push-crypto.ts'
import type { PushTokenCipher } from './push-crypto.ts'
import type { PushRequest, PushResult } from './apns.ts'

export const pushClaimLifetime = 60_000
export const pushAttemptLimit = 8
export const pushEventLifetime = 24 * 60 * 60_000
export const pushRetention = 30 * 24 * 60 * 60_000
export type NotificationClaim = { id: string; claimToken: string }
export type PreparedPush = { request: PushRequest; installationId: string; revision: string }
export type EntryIds = { expenses: ReadonlySet<string>; settlements: ReadonlySet<string> }

export class NotificationStore {
  private readonly db: Database
  private readonly store: Store
  private readonly now: () => number

  constructor(db: Database, store: Store, now: () => number = Date.now) {
    this.db = db
    this.store = store
    this.now = now
    this.settings = transactional(db, this.settings.bind(this))
    this.register = transactional(db, this.register.bind(this))
    this.removeDevice = transactional(db, this.removeDevice.bind(this))
    this.cancelMember = transactional(db, this.cancelMember.bind(this))
    this.enqueueNewEntries = transactional(db, this.enqueueNewEntries.bind(this))
    this.claim = transactional(db, this.claim.bind(this))
    this.prepare = transactional(db, this.prepare.bind(this))
    this.finish = transactional(db, this.finish.bind(this))
    this.failProtectedToken = transactional(db, this.failProtectedToken.bind(this))
    this.cleanup = transactional(db, this.cleanup.bind(this))
  }

  async settings(session: AccountSession, householdId: string, pushAvailable: boolean, preferences?: NotificationPreferences) {
    const { memberId } = await this.store.accounts.household(session, householdId)
    if (preferences) {
      const checked = notificationPreferencesSchema.parse(preferences)
      await this.db.prepare(`INSERT INTO notification_preferences (household_id, member_id, chores, money, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(household_id, member_id) DO UPDATE SET
        chores = excluded.chores, money = excluded.money, updated_at = excluded.updated_at`)
        .run(householdId, memberId, Number(checked.chores), Number(checked.money), new Date(this.now()).toISOString())
      if (!checked.chores) await this.cancelMember(householdId, memberId, 'chores')
      if (!checked.money) {
        await this.cancelMember(householdId, memberId, 'expense')
        await this.cancelMember(householdId, memberId, 'settlement')
      }
    }
    const row = await this.db.prepare('SELECT chores, money FROM notification_preferences WHERE household_id = ? AND member_id = ?')
      .get(householdId, memberId)
    return notificationSettingsSchema.parse({
      householdId, memberId, pushAvailable,
      preferences: { chores: row ? row.chores === 1 : true, money: row ? row.money === 1 : true },
    })
  }

  private async assertSession(session: AccountSession) {
    const state = await this.store.accounts.state(session)
    if (state.deletionPending) throw new ApiError(409, 'Account deletion is pending.', 'ACCOUNT_DELETION_PENDING')
  }

  async register(session: AccountSession, input: PushDevice, cipher: PushTokenCipher): Promise<void> {
    await this.assertSession(session)
    const checked = pushDeviceSchema.parse(input)
    const tokenHash = cipher.fingerprint(checked.token)
    const existing = await this.db.prepare('SELECT account_id, session_id FROM push_devices WHERE installation_id = ?').get(checked.installationId)
    if (existing && (existing.account_id !== session.accountId || existing.session_id !== session.id)) {
      await this.db.prepare('DELETE FROM push_devices WHERE installation_id = ?').run(checked.installationId)
    }
    await this.db.prepare(`DELETE FROM push_devices WHERE installation_id <> ?
      AND ((token_hash = ? AND environment = ?) OR session_id = ?)`)
      .run(checked.installationId, tokenHash, checked.environment, session.id)
    const revision = randomUUID()
    const context = pushTokenContext({
      installationId: checked.installationId, accountId: session.accountId,
      sessionId: session.id, environment: checked.environment, revision,
    })
    await this.db.prepare(`INSERT INTO push_devices
      (installation_id, account_id, session_id, environment, token_hash, token_ciphertext, revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(installation_id) DO UPDATE SET
      account_id = excluded.account_id, session_id = excluded.session_id, environment = excluded.environment,
      token_hash = excluded.token_hash, token_ciphertext = excluded.token_ciphertext,
      revision = excluded.revision, updated_at = excluded.updated_at`)
      .run(checked.installationId, session.accountId, session.id, checked.environment, tokenHash,
        cipher.encrypt(checked.token, context), revision, new Date(this.now()).toISOString())
  }

  async removeDevice(session: AccountSession, installationId: string): Promise<void> {
    await this.assertSession(session)
    await this.db.prepare('DELETE FROM push_devices WHERE installation_id = ? AND account_id = ?').run(installationId, session.accountId)
  }

  async cancelMember(householdId: string, memberId: string, kind?: NotificationKind): Promise<void> {
    await this.db.prepare(`UPDATE notification_deliveries SET status = 'skipped', finished_at = ?, claim_token = NULL, claim_until = NULL
      WHERE member_id = ? AND status IN ('pending', 'claimed') AND event_id IN
      (SELECT id FROM notification_events WHERE household_id = ?${kind ? ' AND kind = ?' : ''})`)
      .run(new Date(this.now()).toISOString(), memberId, householdId, ...(kind ? [kind] : []))
  }

  private async recipients(household: Household): Promise<Row[]> {
    const now = new Date(this.now()).toISOString()
    const idle = new Date(this.now() - accountIdleLifetime).toISOString()
    const rows = await this.db.prepare(`SELECT d.installation_id, m.member_id,
      COALESCE(p.chores, 1) AS chores, COALESCE(p.money, 1) AS money FROM account_memberships m
      JOIN accounts a ON a.id = m.account_id AND a.deleting = 0
      JOIN push_devices d ON d.account_id = m.account_id
      JOIN account_sessions s ON s.id = d.session_id AND s.account_id = d.account_id
      LEFT JOIN notification_preferences p ON p.household_id = m.household_id AND p.member_id = m.member_id
      WHERE m.household_id = ? AND m.active = 1 AND s.expires_at > ? AND s.last_used_at > ? AND d.updated_at > ?`)
      .all(household.id, now, idle, new Date(this.now() - pushRetention).toISOString())
    return rows.filter((row) => household.members.some((member) => member.id === row.member_id && !member.inactive))
  }

  private async event(input: {
    householdId: string; kind: NotificationKind; key: string; entityId?: string; date?: string; expiresAt: string
  }, recipients: Row[]): Promise<void> {
    const id = randomUUID()
    const now = new Date(this.now()).toISOString()
    const inserted = await this.db.prepare(`INSERT INTO notification_events
      (id, dedup_key, household_id, kind, entity_id, local_date, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedup_key) DO NOTHING`)
      .run(id, input.key, input.householdId, input.kind, input.entityId ?? null, input.date ?? null, now, input.expiresAt)
    if (!inserted.changes) return
    for (const recipient of recipients) {
      await this.db.prepare(`INSERT INTO notification_deliveries
        (id, event_id, installation_id, member_id, status, next_attempt_at) VALUES (?, ?, ?, ?, 'pending', ?)`)
        .run(randomUUID(), id, recipient.installation_id, recipient.member_id, now)
    }
  }

  async enqueueNewEntries(household: Household, actorId: string, before: EntryIds): Promise<void> {
    const expenses = household.expenses.filter((expense) => !before.expenses.has(expense.id))
    const settlements = household.settlements.filter((settlement) => !before.settlements.has(settlement.id))
    if (!expenses.length && !settlements.length) return
    const recipients = (await this.recipients(household)).filter((row) => row.member_id !== actorId && row.money === 1)
    for (const [kind, entries] of [['expense', expenses], ['settlement', settlements]] as const) {
      for (const entry of entries) {
        await this.event({
          householdId: household.id, kind, key: `${kind}:${household.id}:${entry.id}`, entityId: entry.id,
          expiresAt: new Date(this.now() + pushEventLifetime).toISOString(),
        }, recipients)
      }
    }
  }

  async scheduleChores(): Promise<void> {
    const households = await this.db.prepare(`SELECT DISTINCT m.household_id FROM account_memberships m
      JOIN accounts a ON a.id = m.account_id WHERE m.active = 1 AND a.deleting = 0 ORDER BY m.household_id`).all()
    for (const row of households) {
      await this.db.transaction(async () => {
        const household = await this.store.get(String(row.household_id))
        if (!household) return
        const window = dailyChoreWindow(household.billingTimeZone, new Date(this.now()))
        if (!window) return
        const members = await this.db.prepare(`SELECT m.member_id FROM account_memberships m JOIN accounts a ON a.id = m.account_id
          WHERE m.household_id = ? AND m.active = 1 AND a.deleting = 0`).all(household.id)
        const devices = await this.recipients(household)
        for (const member of members) {
          const memberId = String(member.member_id)
          if (!household.members.some((entry) => entry.id === memberId && !entry.inactive)) continue
          const due = assignedDueChores(household, memberId, window.date)
          await this.event({
            householdId: household.id, kind: 'chores', key: `chores:${household.id}:${memberId}:${window.date}`,
            date: window.date, expiresAt: window.expiresAt,
          }, due.length ? devices.filter((device) => device.member_id === memberId && device.chores === 1) : [])
        }
      })
    }
  }

  async claim(): Promise<NotificationClaim | null> {
    const now = new Date(this.now()).toISOString()
    const row = await this.db.prepare(`SELECT d.id FROM notification_deliveries d JOIN notification_events e ON e.id = d.event_id
      WHERE ((d.status = 'pending' AND d.next_attempt_at <= ?) OR (d.status = 'claimed' AND d.claim_until <= ?))
      AND d.attempts < ? AND e.expires_at > ? ORDER BY d.next_attempt_at, d.id LIMIT 1`)
      .get(now, now, pushAttemptLimit, now)
    if (!row) return null
    const claimToken = randomUUID()
    const claimed = await this.db.prepare(`UPDATE notification_deliveries SET status = 'claimed', claim_token = ?,
      claim_until = ?, attempts = attempts + 1 WHERE id = ? AND
      ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'claimed' AND claim_until <= ?))`)
      .run(claimToken, new Date(this.now() + pushClaimLifetime).toISOString(), row.id, now, now)
    return claimed.changes ? { id: String(row.id), claimToken } : null
  }

  private async terminal(claim: NotificationClaim, status: 'sent' | 'skipped' | 'failed', reason: string | null = null) {
    await this.db.prepare(`UPDATE notification_deliveries SET status = ?, finished_at = ?, last_error = ?,
      claim_token = NULL, claim_until = NULL WHERE id = ? AND status = 'claimed' AND claim_token = ? AND claim_until > ?`)
      .run(status, new Date(this.now()).toISOString(), reason, claim.id, claim.claimToken, new Date(this.now()).toISOString())
  }

  async prepare(claim: NotificationClaim, cipher: PushTokenCipher): Promise<PreparedPush | null> {
    const now = new Date(this.now()).toISOString()
    const row = await this.db.prepare(`SELECT d.member_id, d.installation_id, e.household_id, e.kind, e.entity_id, e.local_date,
      e.dedup_key, e.expires_at, p.account_id, p.session_id, p.environment, p.token_ciphertext, p.revision,
      COALESCE(n.chores, 1) AS chores, COALESCE(n.money, 1) AS money
      FROM notification_deliveries d JOIN notification_events e ON e.id = d.event_id
      JOIN push_devices p ON p.installation_id = d.installation_id
      JOIN account_sessions s ON s.id = p.session_id AND s.account_id = p.account_id
      JOIN accounts a ON a.id = p.account_id
      JOIN account_memberships m ON m.account_id = p.account_id AND m.household_id = e.household_id AND m.member_id = d.member_id
      LEFT JOIN notification_preferences n ON n.household_id = m.household_id AND n.member_id = m.member_id
      WHERE d.id = ? AND d.status = 'claimed' AND d.claim_token = ? AND d.claim_until > ?
      AND e.expires_at > ? AND s.expires_at > ? AND s.last_used_at > ?
      AND p.updated_at > ? AND m.active = 1 AND a.deleting = 0`)
      .get(claim.id, claim.claimToken, now, now, now, new Date(this.now() - accountIdleLifetime).toISOString(),
        new Date(this.now() - pushRetention).toISOString())
    const household = row ? await this.store.get(String(row.household_id)) : null
    if (!row || !household || !household.members.some((member) => member.id === row.member_id && !member.inactive)
      || (row.kind === 'chores' ? row.chores : row.money) !== 1) {
      await this.terminal(claim, 'skipped')
      return null
    }
    const kind = row.kind as NotificationKind
    let componentId: string | undefined
    if (kind === 'chores') {
      const window = dailyChoreWindow(household.billingTimeZone, new Date(this.now()))
      if (!window || window.date !== row.local_date || !assignedDueChores(household, String(row.member_id), window.date).length) {
        await this.terminal(claim, 'skipped')
        return null
      }
      componentId = summaryComponent(household, String(row.member_id), window.date)
    } else if (!(kind === 'expense' ? household.expenses : household.settlements).some((entry) => entry.id === row.entity_id)) {
      await this.terminal(claim, 'skipped')
      return null
    }
    const target = notificationTargetSchema.parse({
      version: 1, kind, householdId: household.id, ...(componentId ? { componentId } : {}),
      ...(kind === 'expense' ? { expenseId: row.entity_id } : kind === 'settlement' ? { settlementId: row.entity_id } : {}),
    })
    const device = {
      installationId: String(row.installation_id), accountId: String(row.account_id), sessionId: String(row.session_id),
      environment: String(row.environment) as PushEnvironment, revision: String(row.revision),
    }
    return {
      installationId: device.installationId, revision: device.revision,
      request: {
        id: claim.id, environment: device.environment, token: cipher.decrypt(String(row.token_ciphertext), pushTokenContext(device)),
        collapseId: createHash('sha256').update(`${row.dedup_key}:${row.member_id}`).digest('hex'),
        expiration: Math.floor(Date.parse(String(row.expires_at)) / 1000),
        payload: {
          aps: { alert: { title: 'Roomlings', body: notificationBodies[target.kind] },
            'thread-id': `roomlings:${household.id}:${kind === 'chores' ? 'chores' : 'money'}`, sound: 'default' },
          roomlings: target,
        },
      },
    }
  }

  async failProtectedToken(claim: NotificationClaim) { await this.terminal(claim, 'failed', 'protected-token') }

  async finish(claim: NotificationClaim, prepared: PreparedPush, result: PushResult): Promise<void> {
    const row = await this.db.prepare(`SELECT d.attempts, e.expires_at FROM notification_deliveries d
      JOIN notification_events e ON e.id = d.event_id WHERE d.id = ? AND d.status = 'claimed'
      AND d.claim_token = ? AND d.claim_until > ?`)
      .get(claim.id, claim.claimToken, new Date(this.now()).toISOString())
    if (!row) return
    if (result.status === 'invalid') {
      const removed = await this.db.prepare(`DELETE FROM push_devices WHERE installation_id = ? AND revision = ?${result.invalidatedAt !== undefined ? ' AND updated_at <= ?' : ''}`)
        .run(prepared.installationId, prepared.revision,
          ...(result.invalidatedAt !== undefined ? [new Date(result.invalidatedAt).toISOString()] : []))
      if (removed.changes) return
      const device = await this.db.prepare('SELECT revision FROM push_devices WHERE installation_id = ?').get(prepared.installationId)
      if (device && device.revision !== prepared.revision) result = { status: 'retry', reason: 'unavailable' }
      else { await this.terminal(claim, 'failed', 'invalid-token'); return }
    }
    if (result.status === 'sent') { await this.terminal(claim, 'sent'); return }
    if (result.status === 'failed') { await this.terminal(claim, 'failed', result.reason); return }
    const attempts = Number(row.attempts)
    const jitter = parseInt(createHash('sha256').update(`${claim.id}:${attempts}`).digest('hex').slice(0, 4), 16) % 1000
    const delay = Math.max(Math.min(1000 * 2 ** (attempts - 1), 15 * 60_000) + jitter, result.retryAfterMs ?? 0)
    const next = this.now() + delay
    if (attempts >= pushAttemptLimit || next >= Date.parse(String(row.expires_at))) {
      await this.terminal(claim, 'failed', result.reason)
      return
    }
    await this.db.prepare(`UPDATE notification_deliveries SET status = 'pending', next_attempt_at = ?,
      last_error = ?, claim_token = NULL, claim_until = NULL WHERE id = ? AND status = 'claimed' AND claim_token = ?`)
      .run(new Date(next).toISOString(), result.reason, claim.id, claim.claimToken)
  }

  async cleanup(): Promise<void> {
    const now = new Date(this.now()).toISOString()
    await this.db.prepare(`DELETE FROM push_devices WHERE updated_at <= ? OR NOT EXISTS
      (SELECT 1 FROM account_sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.id = push_devices.session_id AND s.account_id = push_devices.account_id
       AND a.deleting = 0 AND s.expires_at > ? AND s.last_used_at > ?)`)
      .run(new Date(this.now() - pushRetention).toISOString(), now, new Date(this.now() - accountIdleLifetime).toISOString())
    await this.db.prepare(`UPDATE notification_deliveries SET status = 'failed', finished_at = ?, last_error = 'expired',
      claim_token = NULL, claim_until = NULL WHERE status IN ('pending', 'claimed')
      AND (event_id IN (SELECT id FROM notification_events WHERE expires_at <= ?)
        OR (attempts >= ? AND (status = 'pending' OR claim_until <= ?)))`).run(now, now, pushAttemptLimit, now)
    await this.db.prepare('DELETE FROM notification_events WHERE expires_at <= ?')
      .run(new Date(this.now() - pushRetention).toISOString())
  }
}
