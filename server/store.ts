import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { householdSchema, localDate, memberColors, nameSchema } from '../shared/domain.ts'
import type { Household, Session } from '../shared/domain.ts'
import { accessStateSchema, recoveryCodePrefix, recoveryCodeSchema } from '../shared/access.ts'
import type { AccessState, RecoveryRotation, RecoveryRotationInput } from '../shared/access.ts'
import { AccountStore } from './accounts-store.ts'

export type AuthenticatedSession = { household: Household; memberId: string; sessionId: string }

export class Store {
  private db: DatabaseSync
  readonly accounts: AccountStore

  constructor(filename: string, options: { now?: () => number } = {}) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename)
    try {
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY, invite TEXT UNIQUE NOT NULL, state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          hash TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL
        );
      `)
      this.migrateAccess()
      this.accounts = new AccountStore(this.db, this, options.now)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close() { this.db.close() }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private migrateAccess() {
    this.transaction(() => {
      const columns = new Set(this.db.prepare('PRAGMA table_info(sessions)').all().map((column) => String(column.name)))
      if (!columns.has('id')) this.db.exec('ALTER TABLE sessions ADD COLUMN id TEXT')
      if (!columns.has('label')) this.db.exec("ALTER TABLE sessions ADD COLUMN label TEXT NOT NULL DEFAULT 'Saved browser'")
      if (!columns.has('created_at')) this.db.exec('ALTER TABLE sessions ADD COLUMN created_at TEXT')
      if (!columns.has('last_used_at')) this.db.exec('ALTER TABLE sessions ADD COLUMN last_used_at TEXT')
      const identify = this.db.prepare('UPDATE sessions SET id = ? WHERE hash = ? AND id IS NULL')
      // Retain legacy token hashes so existing browsers remain signed in.
      for (const row of this.db.prepare('SELECT hash FROM sessions WHERE id IS NULL').all()) {
        identify.run(randomUUID(), row.hash)
      }
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS sessions_id ON sessions(id);
        CREATE INDEX IF NOT EXISTS sessions_member ON sessions(household_id, member_id);
        CREATE TABLE IF NOT EXISTS recovery_codes (
          household_id TEXT NOT NULL REFERENCES households(id),
          member_id TEXT NOT NULL,
          hash TEXT NOT NULL UNIQUE,
          version INTEGER NOT NULL CHECK(version > 0),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (household_id, member_id)
        );
      `)
    })
  }

  get(id: string): Household | null {
    const row = this.db.prepare('SELECT state FROM households WHERE id = ?').get(id)
    return row ? householdSchema.parse(JSON.parse(String(row.state))) : null
  }

  byInvite(invite: string): Household | null {
    const row = this.db.prepare('SELECT state FROM households WHERE invite = ?').get(invite)
    return row ? householdSchema.parse(JSON.parse(String(row.state))) : null
  }

  save(household: Household) {
    const checked = householdSchema.parse(household)
    this.db.prepare('INSERT INTO households (id, invite, state) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET invite = excluded.invite, state = excluded.state')
      .run(checked.id, checked.inviteCode, JSON.stringify(checked))
  }

  private tokenHash(token: string) { return createHash('sha256').update(token).digest('hex') }

  authenticate(token: string): AuthenticatedSession | null {
    const hash = this.tokenHash(token)
    const row = this.db.prepare('SELECT id, household_id, member_id FROM sessions WHERE hash = ?').get(hash)
    if (!row) return null
    const household = this.get(String(row.household_id))
    const memberId = String(row.member_id)
    if (!household?.members.some((member) => member.id === memberId && !member.inactive)) return null
    const now = new Date()
    this.db.prepare('UPDATE sessions SET last_used_at = ? WHERE hash = ? AND (last_used_at IS NULL OR last_used_at < ?)')
      .run(now.toISOString(), hash, new Date(now.getTime() - 60_000).toISOString())
    return { household, memberId, sessionId: String(row.id) }
  }

  session(household: Household, memberId: string, label = 'Saved browser'): Session {
    if (!household.members.some((member) => member.id === memberId && !member.inactive)) throw new Error('A browser session needs an active roommate.')
    const checkedLabel = nameSchema.parse(label)
    const token = randomBytes(32).toString('base64url')
    const now = new Date().toISOString()
    this.db.prepare('INSERT INTO sessions (hash, household_id, member_id, id, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(this.tokenHash(token), household.id, memberId, randomUUID(), checkedLabel, now, now)
    return { token, memberId, household }
  }

  accessState(session: AuthenticatedSession): AccessState | null {
    const rows = this.db.prepare('SELECT id, label, created_at, last_used_at FROM sessions WHERE household_id = ? AND member_id = ?')
      .all(session.household.id, session.memberId)
    const devices = rows.map((row) => ({
      id: String(row.id), label: String(row.label),
      createdAt: row.created_at === null ? null : String(row.created_at),
      lastUsedAt: row.last_used_at === null ? null : String(row.last_used_at),
      current: row.id === session.sessionId,
    })).sort((a, b) => Number(b.current) - Number(a.current)
      || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.id.localeCompare(b.id))
    if (!devices.some((device) => device.current)) return null
    const recovery = this.db.prepare('SELECT version, updated_at FROM recovery_codes WHERE household_id = ? AND member_id = ?')
      .get(session.household.id, session.memberId)
    return accessStateSchema.parse({
      devices,
      recovery: { enabled: !!recovery, version: recovery ? Number(recovery.version) : 0, updatedAt: recovery ? String(recovery.updated_at) : null },
    })
  }

  renameCurrentDevice(session: AuthenticatedSession, label: string): AccessState | null {
    const result = this.db.prepare('UPDATE sessions SET label = ? WHERE id = ? AND household_id = ? AND member_id = ?')
      .run(nameSchema.parse(label), session.sessionId, session.household.id, session.memberId)
    return result.changes ? this.accessState(session) : null
  }

  rotateRecovery(session: AuthenticatedSession, input: RecoveryRotationInput): RecoveryRotation | 'conflict' | null {
    return this.transaction(() => {
      const current = this.accessState(session)
      if (!current) return null
      if (current.recovery.version !== input.version) return 'conflict'
      const code = `${recoveryCodePrefix}${randomBytes(32).toString('base64url')}`
      this.db.prepare(`INSERT INTO recovery_codes (household_id, member_id, hash, version, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(household_id, member_id) DO UPDATE SET hash = excluded.hash, version = excluded.version, updated_at = excluded.updated_at`)
        .run(session.household.id, session.memberId, this.tokenHash(code), input.version + 1, new Date().toISOString())
      if (input.revokeOthers) {
        this.db.prepare('DELETE FROM sessions WHERE household_id = ? AND member_id = ? AND id <> ?')
          .run(session.household.id, session.memberId, session.sessionId)
      }
      const access = this.accessState(session)
      if (!access) throw new Error('The current browser disappeared during recovery setup.')
      return { code, access }
    })
  }

  recover(code: string, label: string): Session | null {
    const hash = this.tokenHash(recoveryCodeSchema.parse(code))
    const checkedLabel = nameSchema.parse(label)
    return this.transaction(() => {
      const recovery = this.db.prepare('SELECT household_id, member_id FROM recovery_codes WHERE hash = ?').get(hash)
      if (!recovery) return null
      const household = this.get(String(recovery.household_id))
      const memberId = String(recovery.member_id)
      if (!household?.members.some((member) => member.id === memberId && !member.inactive)) return null
      return this.session(household, memberId, checkedLabel)
    })
  }

  revokeDevice(session: AuthenticatedSession, id: string): AccessState | 'current' | 'missing' | null {
    return this.transaction(() => {
      if (!this.accessState(session)) return null
      if (id === session.sessionId) return 'current'
      const result = this.db.prepare('DELETE FROM sessions WHERE id = ? AND household_id = ? AND member_id = ?')
        .run(id, session.household.id, session.memberId)
      return result.changes ? this.accessState(session) : 'missing'
    })
  }

  create(name: string, memberName: string, currency: Household['currency'], budget: number, demo = false): Session {
    const memberId = randomUUID()
    const household: Household = {
      id: randomUUID(), name, currency, budget, roomStyle: 'original', demo, version: 0,
      inviteCode: randomBytes(12).toString('base64url'),
      members: [{ id: memberId, name: memberName, color: memberColors[0] }],
      expenses: [], settlements: [], bills: [], billingTimeZone: 'UTC',
      shopping: { items: [], runs: [] },
    }
    if (demo) {
      household.members.push(...['Jules', 'Sam', 'Alex'].map((name, index) => ({
        id: randomUUID(), name, color: memberColors[index + 1],
      })))
      const entries = [
        { description: 'The big weekly shop', amount: 8632, paidBy: 0, category: 'pantry', days: 0 },
        { description: 'Farmers market finds', amount: 2840, paidBy: 1, category: 'produce', days: 1 },
        { description: 'Milk, eggs & a little cheese', amount: 1875, paidBy: 2, category: 'dairy', days: 2 },
        { description: 'Coffee for the whole house', amount: 2490, paidBy: 0, category: 'drinks', days: 3 },
        { description: 'Pasta night essentials', amount: 3620, paidBy: 3, category: 'pantry', days: 4 },
        { description: 'Something green', amount: 1260, paidBy: 1, category: 'produce', days: 5 },
      ] as const
      household.expenses = entries.map((entry) => {
        const date = new Date()
        date.setDate(Math.max(1, date.getDate() - entry.days))
        return {
          id: randomUUID(), description: entry.description, amount: entry.amount,
          paidBy: household.members[entry.paidBy].id,
          participants: household.members.map((member) => member.id),
          category: entry.category, date: localDate(date), createdAt: new Date().toISOString(),
        }
      })
    }
    this.save(household)
    return this.session(household, memberId)
  }
}
