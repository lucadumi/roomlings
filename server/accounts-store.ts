import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Database } from './database.ts'
import { transactional } from './database.ts'
import {
  accountRecoveryCodeCount, accountRecoveryCodePrefix, accountRecoveryResultSchema, accountRecoverySignInSchema,
  accountRecoveryStateSchema, accountStateSchema, householdAccessSchema,
} from '../shared/accounts.ts'
import type {
  AccountInvitationResult, AccountRecoveryResult, AccountRecoverySignIn, AccountRecoveryState, AccountState, HouseholdAccess,
} from '../shared/accounts.ts'
import { activeMemberLimit, householdSchema, memberColors, retainedMemberLimit } from '../shared/domain.ts'
import type { Household } from '../shared/domain.ts'
import type { Store } from './store.ts'
import type { VerifiedAccount } from './provider.ts'
import { ApiError } from './errors.ts'

export const accountAbsoluteLifetime = 30 * 24 * 60 * 60_000
export const accountIdleLifetime = 7 * 24 * 60 * 60_000
export const accountReauthLifetime = 10 * 60_000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const forbidden = () => new ApiError(403, 'You do not have active access to this kitchen.')
const conflict = () => new ApiError(409, 'A roommate just changed the kitchen. Refresh it and try again.')

export type AccountSession = {
  id: string; accountId: string; selectedHouseholdId: string | null
  createdAt: string; expiresAt: string; csrfToken: string; deleting: boolean
}

export class AccountStore {
  private db: Database
  private store: Store
  private now: () => number

  constructor(db: Database, store: Store, now: () => number = Date.now) {
    this.db = db
    this.store = store
    this.now = now
    const guarded = <A extends unknown[], R>(operation: (session: AccountSession, ...args: A) => Promise<R>, allowDeleting = false) =>
      transactional(db, async (session: AccountSession, ...args: A): Promise<R> => {
        await this.assertSession(session, allowDeleting)
        return operation(session, ...args)
      })
    this.isManaged = transactional(db, this.isManaged.bind(this))
    this.authenticate = transactional(db, this.authenticate.bind(this))
    this.signIn = transactional(db, this.signIn.bind(this))
    this.recoverAccount = transactional(db, this.recoverAccount.bind(this))
    this.pendingDeletions = transactional(db, this.pendingDeletions.bind(this))
    this.finishDeletion = transactional(db, this.finishDeletion.bind(this))
    this.state = guarded(this.state.bind(this))
    this.household = guarded(this.household.bind(this))
    this.select = guarded(this.select.bind(this))
    this.profile = guarded(this.profile.bind(this))
    this.renameDevice = guarded(this.renameDevice.bind(this))
    this.recoveryState = guarded(this.recoveryState.bind(this))
    this.generateRecoveryCodes = guarded(this.generateRecoveryCodes.bind(this))
    this.revokeRecoveryCodes = guarded(this.revokeRecoveryCodes.bind(this))
    this.logout = guarded(this.logout.bind(this), true)
    this.revokeDevice = guarded(this.revokeDevice.bind(this))
    this.access = guarded(this.access.bind(this))
    this.link = guarded(this.link.bind(this))
    this.createHousehold = guarded(this.createHousehold.bind(this))
    this.invite = guarded(this.invite.bind(this))
    this.revokeInvitation = guarded(this.revokeInvitation.bind(this))
    this.accept = guarded(this.accept.bind(this))
    this.transfer = guarded(this.transfer.bind(this))
    this.remove = guarded(this.remove.bind(this))
    this.leave = guarded(this.leave.bind(this))
    this.beginDeletion = guarded(this.beginDeletion.bind(this), true)
  }

  private async assertSession(session: AccountSession, allowDeleting: boolean) {
    await this.purgeSessions()
    const current = await this.db.prepare(`SELECT a.deleting FROM account_sessions s
      JOIN accounts a ON a.id = s.account_id WHERE s.id = ? AND s.account_id = ?`).get(session.id, session.accountId)
    if (!current) throw new ApiError(401, 'Sign in to your account to continue.', 'ACCOUNT_SESSION_REQUIRED')
    if (current.deleting && !allowDeleting) {
      throw new ApiError(409, 'Account deletion is pending. Access remains disabled.', 'ACCOUNT_DELETION_PENDING')
    }
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    return (await this.db.transaction(operation))
  }

  async isManaged(householdId: string) {
    return !!(await this.db.prepare('SELECT 1 FROM household_accounts WHERE household_id = ?').get(householdId))
  }

  private async purgeSessions() {
    await this.db.prepare('DELETE FROM account_sessions WHERE expires_at <= ? OR last_used_at <= ?')
      .run(new Date(this.now()).toISOString(), new Date(this.now() - accountIdleLifetime).toISOString())
  }

  async authenticate(token: string): Promise<AccountSession | null> {
    await this.purgeSessions()
    const row = (await this.db.prepare(`SELECT s.*, a.deleting FROM account_sessions s
      JOIN accounts a ON a.id = s.account_id WHERE s.hash = ?`).get(hash(token)))
    if (!row) return null
    await this.db.prepare('UPDATE account_sessions SET last_used_at = ? WHERE id = ?')
      .run(new Date(this.now()).toISOString(), row.id)
    return {
      id: String(row.id), accountId: String(row.account_id),
      selectedHouseholdId: row.selected_household_id === null ? null : String(row.selected_household_id),
      createdAt: String(row.created_at), expiresAt: String(row.expires_at),
      csrfToken: hash(`roomlings-csrf:${token}`), deleting: !!row.deleting,
    }
  }

  async signIn(identity: VerifiedAccount, name: string, label: string) {
    return (await this.transaction(async () => {
      await this.purgeSessions()
      if ((await this.db.prepare('SELECT 1 FROM deleted_account_providers WHERE hash = ?').get(hash(identity.providerId)))) {
        throw new ApiError(401, 'That account was deleted. Request a fresh email code to create a new account.', 'INVALID_EMAIL_CODE')
      }
      let row = (await this.db.prepare('SELECT id, deleting FROM accounts WHERE provider_id = ?').get(identity.providerId))
      if (row?.deleting) throw new ApiError(409, 'Account deletion is pending. Access stays disabled until it completes.', 'ACCOUNT_DELETION_PENDING')
      const now = new Date(this.now()).toISOString()
      if (!row) {
        const id = randomUUID()
        await this.db.prepare('INSERT INTO accounts (id, provider_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, identity.providerId, identity.email, name, now)
        row = { id, deleting: 0 }
      } else {
        await this.db.prepare('UPDATE accounts SET email = ? WHERE id = ?').run(identity.email, row.id)
      }
      return this.issueSession(String(row.id), label)
    }))
  }

  private async issueSession(accountId: string, label: string) {
    const count = await this.db.prepare('SELECT COUNT(*) AS count FROM account_sessions WHERE account_id = ?').get(accountId)
    if (Number(count?.count) >= 50) throw new ApiError(409, 'This account has 50 saved browsers. Sign out an existing browser before adding another.')
    const token = randomBytes(32).toString('base64url')
    const now = new Date(this.now()).toISOString()
    const selected = (await this.memberships(accountId))[0]?.householdId ?? null
    await this.db.prepare(`INSERT INTO account_sessions
      (id, hash, account_id, label, created_at, last_used_at, expires_at, selected_household_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), hash(token), accountId, label, now, now, new Date(this.now() + accountAbsoluteLifetime).toISOString(), selected)
    const session = await this.authenticate(token)
    if (!session) throw new Error('The new account session could not be restored.')
    return { token, session }
  }

  private requireRecentSignIn(session: AccountSession, action: string) {
    if (this.now() - Date.parse(session.createdAt) > accountReauthLifetime) {
      throw new ApiError(401, `Sign in again, then ${action} within 10 minutes.`, 'REAUTHENTICATION_REQUIRED')
    }
  }

  async recoveryState(session: AccountSession): Promise<AccountRecoveryState> {
    const settings = await this.db.prepare('SELECT version, updated_at FROM account_recovery_settings WHERE account_id = ?').get(session.accountId)
    const codes = await this.db.prepare('SELECT COUNT(*) AS count FROM account_recovery_codes WHERE account_id = ?').get(session.accountId)
    return accountRecoveryStateSchema.parse({
      version: settings ? Number(settings.version) : 0,
      remaining: Number(codes?.count ?? 0),
      updatedAt: settings ? String(settings.updated_at) : null,
    })
  }

  private async replaceRecoveryCodes(session: AccountSession, version: number, codes: string[]) {
    this.requireRecentSignIn(session, 'change your recovery codes')
    const current = await this.recoveryState(session)
    if (current.version !== version) {
      throw new ApiError(409, 'Your recovery codes changed in another browser. Refresh their status and try again.')
    }
    if (!codes.length && !current.remaining) throw new ApiError(409, 'There are no unused account recovery codes to revoke.')
    await this.db.prepare(`INSERT INTO account_recovery_settings (account_id, version, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`)
      .run(session.accountId, current.version + 1, new Date(this.now()).toISOString())
    await this.db.prepare('DELETE FROM account_recovery_codes WHERE account_id = ?').run(session.accountId)
    for (const code of codes) {
      await this.db.prepare('INSERT INTO account_recovery_codes (hash, account_id) VALUES (?, ?)').run(hash(code), session.accountId)
    }
    return this.recoveryState(session)
  }

  async generateRecoveryCodes(session: AccountSession, version: number): Promise<AccountRecoveryResult> {
    return this.transaction(async () => {
      const codes = Array.from({ length: accountRecoveryCodeCount }, () => {
        const secret = randomBytes(16).toString('hex')
        return accountRecoveryCodePrefix + Array.from({ length: 8 }, (_, index) => secret.slice(index * 4, index * 4 + 4)).join('-')
      })
      return accountRecoveryResultSchema.parse({ codes, recovery: await this.replaceRecoveryCodes(session, version, codes) })
    })
  }

  async revokeRecoveryCodes(session: AccountSession, version: number): Promise<AccountRecoveryState> {
    return this.transaction(() => this.replaceRecoveryCodes(session, version, []))
  }

  async recoverAccount(input: AccountRecoverySignIn) {
    const { code, email, label } = accountRecoverySignInSchema.parse(input)
    return this.transaction(async () => {
      await this.purgeSessions()
      const codeHash = hash(code)
      const row = await this.db.prepare(`SELECT c.account_id FROM account_recovery_codes c
        JOIN accounts a ON a.id = c.account_id WHERE c.hash = ? AND a.email = ? AND a.deleting = 0`).get(codeHash, email)
      const invalid = () => new ApiError(401, 'That account recovery code is invalid, already used or revoked.', 'INVALID_ACCOUNT_RECOVERY_CODE')
      if (!row) throw invalid()
      const accountId = String(row.account_id)
      const issued = await this.issueSession(accountId, label)
      const consumed = await this.db.prepare('DELETE FROM account_recovery_codes WHERE hash = ? AND account_id = ?').run(codeHash, accountId)
      if (consumed.changes !== 1) throw invalid()
      return issued
    })
  }

  private async memberships(accountId: string): Promise<AccountState['memberships']> {
    const rows = (await this.db.prepare(`SELECT m.household_id, m.member_id, h.owner_member_id, k.state FROM account_memberships m
      JOIN household_accounts h ON h.household_id = m.household_id
      JOIN households k ON k.id = m.household_id WHERE m.account_id = ? AND m.active = 1`).all(accountId))
    return rows.flatMap((row) => {
      const household = householdSchema.parse(JSON.parse(String(row.state)))
      if (!household?.members.some((member) => member.id === row.member_id && !member.inactive)) return []
      return [{
        householdId: household.id, householdName: household.name, memberId: String(row.member_id),
        currency: household.currency, role: row.owner_member_id === row.member_id ? 'owner' as const : 'member' as const,
      }]
    })
  }

  async state(session: AccountSession): Promise<AccountState> {
    const account = (await this.db.prepare('SELECT id, email, name, created_at FROM accounts WHERE id = ? AND deleting = 0').get(session.accountId))
    if (!account) throw new ApiError(409, 'Account deletion is pending. Access is disabled; retry deletion to finish.', 'ACCOUNT_DELETION_PENDING')
    await this.purgeSessions()
    const memberships = (await this.memberships(session.accountId))
    const rows = await this.db.prepare('SELECT * FROM account_sessions WHERE account_id = ? ORDER BY last_used_at DESC, id').all(session.accountId)
    const current = rows.find((row) => row.id === session.id)
    if (!current) throw new ApiError(401, 'Sign in to your account to continue.', 'ACCOUNT_SESSION_REQUIRED')
    const selected = memberships.find((membership) => membership.householdId === current.selected_household_id)
    const devices = rows.map((row) => ({
        id: String(row.id), label: String(row.label), createdAt: String(row.created_at),
        lastUsedAt: String(row.last_used_at),
        expiresAt: new Date(Math.min(Date.parse(String(row.expires_at)), Date.parse(String(row.last_used_at)) + accountIdleLifetime)).toISOString(),
        current: row.id === session.id,
      }))
    return accountStateSchema.parse({
      configured: true,
      account: { id: account.id, email: account.email, name: account.name, createdAt: account.created_at },
      memberships, devices, csrfToken: session.csrfToken,
      session: selected ? { token: null, memberId: selected.memberId, household: (await this.store.get(selected.householdId)) } : null,
    })
  }

  async household(session: AccountSession, id: string | null = session.selectedHouseholdId) {
    if (session.deleting || !id) throw forbidden()
    const membership = (await this.db.prepare(`SELECT m.member_id, h.owner_member_id FROM account_memberships m
      JOIN household_accounts h ON h.household_id = m.household_id
      JOIN accounts a ON a.id = m.account_id
      WHERE m.account_id = ? AND m.household_id = ? AND m.active = 1 AND a.deleting = 0`).get(session.accountId, id))
    const household = membership ? (await this.store.get(id)) : null
    if (!membership || !household?.members.some((member) => member.id === membership.member_id && !member.inactive)) throw forbidden()
    return { household, memberId: String(membership.member_id), sessionId: session.id, role: membership.owner_member_id === membership.member_id ? 'owner' as const : 'member' as const }
  }

  async select(session: AccountSession, householdId: string) {
    await this.household(session, householdId)
    await this.db.prepare('UPDATE account_sessions SET selected_household_id = ? WHERE id = ?').run(householdId, session.id)
    session.selectedHouseholdId = householdId
    return (await this.state(session))
  }

  async profile(session: AccountSession, name: string) {
    await this.db.prepare('UPDATE accounts SET name = ? WHERE id = ? AND deleting = 0').run(name, session.accountId)
    return (await this.state(session))
  }

  async renameDevice(session: AccountSession, label: string) {
    await this.db.prepare('UPDATE account_sessions SET label = ? WHERE id = ? AND account_id = ?').run(label, session.id, session.accountId)
    return (await this.state(session))
  }

  async logout(session: AccountSession, all: boolean) {
    await this.transaction(async () => {
      if (all) {
        await this.db.prepare('DELETE FROM account_sessions WHERE account_id = ?').run(session.accountId)
        await this.db.prepare(`DELETE FROM sessions WHERE EXISTS (SELECT 1 FROM account_memberships m
          WHERE m.account_id = ? AND m.household_id = sessions.household_id AND m.member_id = sessions.member_id)`).run(session.accountId)
      } else {
        await this.db.prepare('DELETE FROM account_sessions WHERE id = ? AND account_id = ?').run(session.id, session.accountId)
      }
    })
  }
  async revokeDevice(session: AccountSession, id: string) {
    const result = (await this.db.prepare('DELETE FROM account_sessions WHERE id = ? AND account_id = ?').run(id, session.accountId))
    if (!result.changes) throw new ApiError(404, 'That browser session was not found for your account.')
    return id === session.id ? null : (await this.state(session))
  }

  private async owner(householdId: string) {
    const row = (await this.db.prepare('SELECT owner_member_id FROM household_accounts WHERE household_id = ?').get(householdId))
    return row?.owner_member_id === null || !row ? null : String(row.owner_member_id)
  }

  private async changed(household: Household) {
    household.version++
    await this.store.save(household)
  }

  private async checkVersion(household: Household, version: number) {
    if (household.version !== version) throw conflict()
  }

  private async requireOwner(session: AccountSession, householdId: string, version: number) {
    const access = (await this.household(session, householdId))
    if (access.role !== 'owner') throw new ApiError(403, 'Only the kitchen owner can manage invitations, roommates, or ownership.')
    await this.checkVersion(access.household, version)
    return access
  }

  async access(session: AccountSession, householdId: string): Promise<HouseholdAccess> {
    const { household, memberId, role } = (await this.household(session, householdId))
    const linked = new Set((await this.db.prepare(`SELECT m.member_id FROM account_memberships m JOIN accounts a ON a.id = m.account_id
      WHERE m.household_id = ? AND m.active = 1 AND a.deleting = 0`).all(householdId)).map((row) => String(row.member_id)))
    const owner = (await this.owner(householdId))
    const invitations = role === 'owner' ? (await this.db.prepare('SELECT id, created_at, expires_at, revoked_at, uses FROM account_invitations WHERE household_id = ? ORDER BY created_at DESC, id')
      .all(householdId)).map((row) => ({
        id: String(row.id), createdAt: String(row.created_at), expiresAt: String(row.expires_at),
        revokedAt: row.revoked_at === null ? null : String(row.revoked_at), uses: Number(row.uses),
      })) : []
    return householdAccessSchema.parse({
      household, memberId, role, invitations,
      members: household.members.map((member) => ({
        memberId: member.id, name: member.name, role: member.id === owner ? 'owner' : 'member',
        linked: linked.has(member.id), active: !member.inactive,
      })),
    })
  }

  async link(session: AccountSession, proof: { token?: string; recoveryCode?: string }) {
    return (await this.transaction(async () => {
      const row = proof.token
        ? (await this.db.prepare('SELECT household_id, member_id FROM sessions WHERE hash = ?').get(hash(proof.token)))
        : (await this.db.prepare('SELECT household_id, member_id FROM recovery_codes WHERE hash = ?').get(hash(proof.recoveryCode!)))
      const household = row ? (await this.store.get(String(row.household_id))) : null
      const member = household?.members.find((member) => member.id === row?.member_id && !member.inactive)
      if (!household || !member) throw new ApiError(401, 'That browser access or recovery code is invalid or revoked.',
        proof.token ? 'BROWSER_ACCESS_EXPIRED' : 'INVALID_RECOVERY_CODE')
      if (household.demo) throw new ApiError(400, 'Practice kitchens cannot be linked to accounts. Create a real kitchen instead.', 'SAMPLE_KITCHEN')
      const existing = (await this.db.prepare('SELECT account_id FROM account_memberships WHERE household_id = ? AND member_id = ?').get(household.id, member.id))
      if (existing && existing.account_id !== session.accountId) throw new ApiError(409, 'This roommate identity is already linked to another account.')
      const other = (await this.db.prepare('SELECT member_id FROM account_memberships WHERE household_id = ? AND account_id = ?').get(household.id, session.accountId))
      if (other && other.member_id !== member.id) throw new ApiError(409, 'Your account already has a different roommate identity in this kitchen.')
      if (!existing) {
        await this.db.prepare('INSERT INTO household_accounts (household_id, owner_member_id) VALUES (?, ?) ON CONFLICT(household_id) DO NOTHING')
          .run(household.id, household.members[0].id)
        await this.db.prepare('INSERT INTO account_memberships (household_id, member_id, account_id) VALUES (?, ?, ?)')
          .run(household.id, member.id, session.accountId)
        await this.changed(household)
      }
      return (await this.select(session, household.id))
    }))
  }

  async createHousehold(session: AccountSession, input: { name: string; memberName: string; currency: Household['currency']; budget: number }) {
    return (await this.transaction(async () => {
      if ((await this.memberships(session.accountId)).length >= 50) throw new ApiError(409, 'This account already has 50 kitchens. Leave one before creating another.')
      const created = (await this.store.create(input.name, input.memberName, input.currency, input.budget))
      // Store.create is shared with the legacy path; do not retain or disclose its bearer credential.
      await this.db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash(created.token))
      await this.db.prepare('INSERT INTO household_accounts (household_id, owner_member_id) VALUES (?, ?)').run(created.household.id, created.memberId)
      await this.db.prepare('INSERT INTO account_memberships (household_id, member_id, account_id) VALUES (?, ?, ?)')
        .run(created.household.id, created.memberId, session.accountId)
      return (await this.select(session, created.household.id))
    }))
  }

  async invite(session: AccountSession, householdId: string, version: number, expiresInDays: number): Promise<AccountInvitationResult> {
    return (await this.transaction(async () => {
      const { household } = (await this.requireOwner(session, householdId, version))
      const now = new Date(this.now()).toISOString()
      const count = (await this.db.prepare('SELECT COUNT(*) AS count FROM account_invitations WHERE household_id = ? AND revoked_at IS NULL AND expires_at > ?').get(householdId, now))
      if (Number(count?.count) >= 50) throw new ApiError(409, 'Revoke an unused invitation before creating another.')
      const code = `roomlings-invite-${randomBytes(32).toString('base64url')}`
      const invitation = { id: randomUUID(), createdAt: now, expiresAt: new Date(this.now() + expiresInDays * 86_400_000).toISOString(), revokedAt: null, uses: 0 }
      await this.db.prepare('INSERT INTO account_invitations (id, household_id, hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(invitation.id, householdId, hash(code), now, invitation.expiresAt)
      await this.changed(household)
      return { code, invitation, access: (await this.access(session, householdId)) }
    }))
  }

  async revokeInvitation(session: AccountSession, householdId: string, id: string, version: number) {
    return (await this.transaction(async () => {
      const { household } = (await this.requireOwner(session, householdId, version))
      const invitation = (await this.db.prepare('SELECT revoked_at FROM account_invitations WHERE id = ? AND household_id = ?').get(id, householdId))
      if (!invitation) throw new ApiError(404, 'That invitation does not belong to this kitchen.')
      if (invitation.revoked_at === null) {
        await this.db.prepare('UPDATE account_invitations SET revoked_at = ? WHERE id = ?').run(new Date(this.now()).toISOString(), id)
        await this.changed(household)
      }
      return (await this.access(session, householdId))
    }))
  }

  async accept(session: AccountSession, code: string, memberName: string) {
    return (await this.transaction(async () => {
      const invitation = (await this.db.prepare('SELECT * FROM account_invitations WHERE hash = ?').get(hash(code)))
      if (!invitation || invitation.revoked_at !== null || Date.parse(String(invitation.expires_at)) <= this.now()) {
        throw new ApiError(410, 'That invitation is expired, revoked, or invalid. Ask the kitchen owner for a new one.')
      }
      const householdId = String(invitation.household_id)
      const household = (await this.store.get(householdId))
      if (!household || household.demo || !(await this.owner(householdId))) throw new ApiError(410, 'This kitchen is closed and cannot accept new roommates.')
      const existing = (await this.db.prepare('SELECT member_id, active FROM account_memberships WHERE household_id = ? AND account_id = ?').get(householdId, session.accountId))
      if (existing?.active) return (await this.select(session, householdId))
      const used = (await this.db.prepare('SELECT 1 FROM account_invitation_uses WHERE invitation_id = ? AND account_id = ?').get(invitation.id, session.accountId))
      if (used) throw new ApiError(410, 'This invitation cannot restore removed access. Ask the owner for a fresh invitation.')
      if ((await this.memberships(session.accountId)).length >= 50) throw new ApiError(409, 'This account already has 50 kitchens. Leave one before joining another.')
      if (household.members.filter((member) => !member.inactive).length >= activeMemberLimit) {
        throw new ApiError(409, 'This kitchen already has 12 active roommates. An existing roommate must leave before another can join.')
      }
      if (!existing && household.members.length >= retainedMemberLimit) {
        throw new ApiError(409, 'This kitchen has reached its 200-identity history limit. Export the ledger and create a new kitchen to add a new roommate.')
      }
      if (household.members.some((member) => member.id !== existing?.member_id && member.name.toLocaleLowerCase() === memberName.toLocaleLowerCase())) {
        throw new ApiError(409, 'A roommate already uses that name. Choose a different name to keep the ledger clear.')
      }
      const memberId = existing ? String(existing.member_id) : randomUUID()
      if (existing) {
        const member = household.members.find((member) => member.id === memberId)!
        member.inactive = false
        member.name = memberName
        await this.db.prepare('UPDATE account_memberships SET active = 1 WHERE household_id = ? AND account_id = ?').run(householdId, session.accountId)
      } else {
        household.members.push({ id: memberId, name: memberName, color: memberColors[household.members.length % memberColors.length] })
        await this.db.prepare('INSERT INTO account_memberships (household_id, member_id, account_id) VALUES (?, ?, ?)').run(householdId, memberId, session.accountId)
      }
      await this.db.prepare('INSERT INTO account_invitation_uses (invitation_id, account_id) VALUES (?, ?)').run(invitation.id, session.accountId)
      await this.db.prepare('UPDATE account_invitations SET uses = uses + 1 WHERE id = ?').run(invitation.id)
      await this.changed(household)
      return (await this.select(session, householdId))
    }))
  }

  async transfer(session: AccountSession, householdId: string, target: string, version: number) {
    return (await this.transaction(async () => {
      const { household, memberId } = (await this.requireOwner(session, householdId, version))
      if (target === memberId) throw new ApiError(409, 'You already own this kitchen.')
      const linked = (await this.db.prepare(`SELECT 1 FROM account_memberships m JOIN accounts a ON a.id = m.account_id
        WHERE m.household_id = ? AND m.member_id = ? AND m.active = 1 AND a.deleting = 0`).get(householdId, target))
      if (!linked || !household.members.some((member) => member.id === target && !member.inactive)) {
        throw new ApiError(400, 'Choose an active roommate who has linked a verified account.')
      }
      await this.db.prepare('UPDATE household_accounts SET owner_member_id = ? WHERE household_id = ?').run(target, householdId)
      await this.changed(household)
      return (await this.access(session, householdId))
    }))
  }

  private async deactivate(household: Household, memberId: string, pseudonymize = false) {
    const member = household.members.find((member) => member.id === memberId)!
    member.inactive = true
    if (pseudonymize) member.name = `Former roommate ${household.members.indexOf(member) + 1}`
    await this.db.prepare('UPDATE account_memberships SET active = 0 WHERE household_id = ? AND member_id = ?').run(household.id, memberId)
    // Consume existing links for this account; only a new owner-issued invitation can restore access.
    await this.db.prepare(`INSERT INTO account_invitation_uses (invitation_id, account_id)
      SELECT i.id, m.account_id FROM account_invitations i JOIN account_memberships m ON m.household_id = i.household_id
      WHERE m.household_id = ? AND m.member_id = ? ON CONFLICT(invitation_id, account_id) DO NOTHING`).run(household.id, memberId)
    await this.db.prepare('DELETE FROM sessions WHERE household_id = ? AND member_id = ?').run(household.id, memberId)
    await this.db.prepare('DELETE FROM recovery_codes WHERE household_id = ? AND member_id = ?').run(household.id, memberId)
    for (const item of household.shopping.items) {
      if (item.claimedBy !== memberId) continue
      item.claimedBy = null
      item.pickedUp = false
      item.version++
      item.updatedAt = new Date(this.now()).toISOString()
    }
    if ((await this.owner(household.id)) === memberId) {
      await this.db.prepare('UPDATE household_accounts SET owner_member_id = NULL WHERE household_id = ?').run(household.id)
      await this.db.prepare('UPDATE account_invitations SET revoked_at = ? WHERE household_id = ? AND revoked_at IS NULL')
        .run(new Date(this.now()).toISOString(), household.id)
    }
    await this.changed(household)
  }

  async remove(session: AccountSession, householdId: string, target: string, version: number) {
    return (await this.transaction(async () => {
      const { household, memberId } = (await this.requireOwner(session, householdId, version))
      if (target === memberId) throw new ApiError(409, 'Use Leave kitchen after transferring ownership instead of removing yourself.')
      if (!household.members.some((member) => member.id === target && !member.inactive)) throw new ApiError(404, 'That active roommate was not found.')
      await this.deactivate(household, target)
      return (await this.access(session, householdId))
    }))
  }

  private async canLeave(household: Household, memberId: string) {
    if ((await this.owner(household.id)) === memberId && household.members.some((member) => member.id !== memberId && !member.inactive)) {
      throw new ApiError(409, `Transfer ownership of "${household.name}" to an active account-linked roommate before leaving or deleting your account.`, 'OWNERSHIP_TRANSFER_REQUIRED')
    }
  }

  async leave(session: AccountSession, householdId: string, version: number) {
    return (await this.transaction(async () => {
      const { household, memberId } = (await this.household(session, householdId))
      await this.checkVersion(household, version)
      await this.canLeave(household, memberId)
      await this.deactivate(household, memberId)
      return (await this.state(session))
    }))
  }

  async beginDeletion(session: AccountSession, confirmation: string) {
    return (await this.transaction(async () => {
      const account = (await this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(session.accountId))
      if (!account) throw new ApiError(401, 'Sign in before deleting your account.')
      if (confirmation !== account.email) throw new ApiError(400, 'Enter your exact account email to confirm deletion.')
      if (account.deleting) return String(account.provider_id)
      this.requireRecentSignIn(session, 'delete your account')
      const memberships = (await this.db.prepare('SELECT household_id, member_id FROM account_memberships WHERE account_id = ?').all(session.accountId))
      for (const membership of memberships) await this.canLeave((await this.store.get(String(membership.household_id)))!, String(membership.member_id))
      // Persist a deletion barrier before contacting the provider. Retries cannot regain kitchen access.
      await this.db.prepare('UPDATE accounts SET deleting = 1 WHERE id = ?').run(session.accountId)
      await this.db.prepare('DELETE FROM account_recovery_codes WHERE account_id = ?').run(session.accountId)
      await this.db.prepare('DELETE FROM account_sessions WHERE account_id = ? AND id <> ?').run(session.accountId, session.id)
      for (const membership of memberships) await this.deactivate((await this.store.get(String(membership.household_id)))!, String(membership.member_id))
      session.deleting = true
      return String(account.provider_id)
    }))
  }

  async pendingDeletions() {
    return (await this.db.prepare('SELECT id, provider_id FROM accounts WHERE deleting = 1')
      .all()).map((row) => ({ id: String(row.id), providerId: String(row.provider_id) }))
  }

  async finishDeletion(accountId: string) {
    await this.transaction(async () => {
      const account = (await this.db.prepare('SELECT deleting, provider_id FROM accounts WHERE id = ?').get(accountId))
      if (!account) return
      if (!account.deleting) throw new Error('Deletion must disable access before removing the provider identity.')
      const memberships = (await this.db.prepare('SELECT household_id, member_id FROM account_memberships WHERE account_id = ?').all(accountId))
      for (const membership of memberships) await this.deactivate((await this.store.get(String(membership.household_id)))!, String(membership.member_id), true)
      // Reject verified requests that started before provider deletion but arrived after local finalization.
      await this.db.prepare('INSERT INTO deleted_account_providers (hash) VALUES (?) ON CONFLICT(hash) DO NOTHING').run(hash(String(account.provider_id)))
      await this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId)
    })
  }
}
