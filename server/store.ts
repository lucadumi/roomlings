import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { householdSchema, localDate, memberColors, nameSchema } from '../shared/domain.ts'
import type { Household, Session } from '../shared/domain.ts'
import { accessStateSchema, recoveryCodePrefix, recoveryCodeSchema } from '../shared/access.ts'
import type { AccessState, RecoveryRotation, RecoveryRotationInput } from '../shared/access.ts'
import { AccountStore } from './accounts-store.ts'
import { SQLiteDatabase, transactional } from './database.ts'
import type { Database } from './database.ts'

export type AuthenticatedSession = { household: Household; memberId: string; sessionId: string }

export class Store {
  private db: Database
  readonly accounts: AccountStore
  get driver() { return this.db.driver }

  constructor(database: string | Database, options: { now?: () => number } = {}) {
    this.db = typeof database === 'string' ? new SQLiteDatabase(database) : database
    this.accounts = new AccountStore(this.db, this, options.now)
    this.get = transactional(this.db, this.get.bind(this))
    this.byInvite = transactional(this.db, this.byInvite.bind(this))
    this.save = transactional(this.db, this.save.bind(this))
    this.authenticate = transactional(this.db, this.authenticate.bind(this))
    this.session = transactional(this.db, this.session.bind(this))
    this.accessState = transactional(this.db, this.accessState.bind(this))
    this.renameCurrentDevice = transactional(this.db, this.renameCurrentDevice.bind(this))
    this.rotateRecovery = transactional(this.db, this.rotateRecovery.bind(this))
    this.recover = transactional(this.db, this.recover.bind(this))
    this.revokeDevice = transactional(this.db, this.revokeDevice.bind(this))
    this.create = transactional(this.db, this.create.bind(this))
  }

  async close() { await this.db.close() }

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    return (await this.db.transaction(operation))
  }

  async get(id: string): Promise<Household | null> {
    const row = (await this.db.prepare('SELECT state FROM households WHERE id = ?').get(id))
    return row ? householdSchema.parse(JSON.parse(String(row.state))) : null
  }

  async byInvite(invite: string): Promise<Household | null> {
    const row = (await this.db.prepare('SELECT state FROM households WHERE invite = ?').get(invite))
    return row ? householdSchema.parse(JSON.parse(String(row.state))) : null
  }

  async save(household: Household) {
    const checked = householdSchema.parse(household)
    await this.db.prepare('INSERT INTO households (id, invite, state) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET invite = excluded.invite, state = excluded.state')
      .run(checked.id, checked.inviteCode, JSON.stringify(checked))
  }

  private tokenHash(token: string) { return createHash('sha256').update(token).digest('hex') }

  async authenticate(token: string): Promise<AuthenticatedSession | null> {
    const hash = this.tokenHash(token)
    const row = (await this.db.prepare('SELECT id, household_id, member_id FROM sessions WHERE hash = ?').get(hash))
    if (!row) return null
    const household = (await this.get(String(row.household_id)))
    const memberId = String(row.member_id)
    if (!household?.members.some((member) => member.id === memberId && !member.inactive)) return null
    const now = new Date()
    await this.db.prepare('UPDATE sessions SET last_used_at = ? WHERE hash = ? AND (last_used_at IS NULL OR last_used_at < ?)')
      .run(now.toISOString(), hash, new Date(now.getTime() - 60_000).toISOString())
    return { household, memberId, sessionId: String(row.id) }
  }

  async session(household: Household, memberId: string, label = 'Saved browser'): Promise<Session> {
    if (!household.members.some((member) => member.id === memberId && !member.inactive)) throw new Error('A browser session needs an active roommate.')
    const checkedLabel = nameSchema.parse(label)
    const token = randomBytes(32).toString('base64url')
    const now = new Date().toISOString()
    await this.db.prepare('INSERT INTO sessions (hash, household_id, member_id, id, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(this.tokenHash(token), household.id, memberId, randomUUID(), checkedLabel, now, now)
    return { token, memberId, household }
  }

  async accessState(session: AuthenticatedSession): Promise<AccessState | null> {
    const rows = (await this.db.prepare('SELECT id, label, created_at, last_used_at FROM sessions WHERE household_id = ? AND member_id = ?')
      .all(session.household.id, session.memberId))
    const devices = rows.map((row) => ({
      id: String(row.id), label: String(row.label),
      createdAt: row.created_at === null ? null : String(row.created_at),
      lastUsedAt: row.last_used_at === null ? null : String(row.last_used_at),
      current: row.id === session.sessionId,
    })).sort((a, b) => Number(b.current) - Number(a.current)
      || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.id.localeCompare(b.id))
    if (!devices.some((device) => device.current)) return null
    const recovery = (await this.db.prepare('SELECT version, updated_at FROM recovery_codes WHERE household_id = ? AND member_id = ?')
      .get(session.household.id, session.memberId))
    return accessStateSchema.parse({
      devices,
      recovery: { enabled: !!recovery, version: recovery ? Number(recovery.version) : 0, updatedAt: recovery ? String(recovery.updated_at) : null },
    })
  }

  async renameCurrentDevice(session: AuthenticatedSession, label: string): Promise<AccessState | null> {
    const result = (await this.db.prepare('UPDATE sessions SET label = ? WHERE id = ? AND household_id = ? AND member_id = ?')
      .run(nameSchema.parse(label), session.sessionId, session.household.id, session.memberId))
    return result.changes ? (await this.accessState(session)) : null
  }

  async rotateRecovery(session: AuthenticatedSession, input: RecoveryRotationInput): Promise<RecoveryRotation | 'conflict' | null> {
    return (await this.transaction(async () => {
      const current = (await this.accessState(session))
      if (!current) return null
      if (current.recovery.version !== input.version) return 'conflict'
      const code = `${recoveryCodePrefix}${randomBytes(32).toString('base64url')}`
      await this.db.prepare(`INSERT INTO recovery_codes (household_id, member_id, hash, version, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(household_id, member_id) DO UPDATE SET hash = excluded.hash, version = excluded.version, updated_at = excluded.updated_at`)
        .run(session.household.id, session.memberId, this.tokenHash(code), input.version + 1, new Date().toISOString())
      if (input.revokeOthers) {
        await this.db.prepare('DELETE FROM sessions WHERE household_id = ? AND member_id = ? AND id <> ?')
          .run(session.household.id, session.memberId, session.sessionId)
      }
      const access = (await this.accessState(session))
      if (!access) throw new Error('The current browser disappeared during recovery setup.')
      return { code, access }
    }))
  }

  async recover(code: string, label: string): Promise<Session | null> {
    const hash = this.tokenHash(recoveryCodeSchema.parse(code))
    const checkedLabel = nameSchema.parse(label)
    return (await this.transaction(async () => {
      const recovery = (await this.db.prepare('SELECT household_id, member_id FROM recovery_codes WHERE hash = ?').get(hash))
      if (!recovery) return null
      const household = (await this.get(String(recovery.household_id)))
      const memberId = String(recovery.member_id)
      if (!household?.members.some((member) => member.id === memberId && !member.inactive)) return null
      return (await this.session(household, memberId, checkedLabel))
    }))
  }

  async revokeDevice(session: AuthenticatedSession, id: string): Promise<AccessState | 'current' | 'missing' | null> {
    return (await this.transaction(async () => {
      if (!(await this.accessState(session))) return null
      if (id === session.sessionId) return 'current'
      const result = (await this.db.prepare('DELETE FROM sessions WHERE id = ? AND household_id = ? AND member_id = ?')
        .run(id, session.household.id, session.memberId))
      return result.changes ? (await this.accessState(session)) : 'missing'
    }))
  }

  async create(name: string, memberName: string, currency: Household['currency'], budget: number, demo = false): Promise<Session> {
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
    await this.save(household)
    return (await this.session(household, memberId))
  }
}
