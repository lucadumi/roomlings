import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { accountStateSchema, householdAccessSchema } from '../shared/accounts.ts'
import type { AccountInvitationResult, AccountState, HouseholdAccess } from '../shared/accounts.ts'
import { activeMemberLimit, memberColors, retainedMemberLimit } from '../shared/domain.ts'
import type { Household } from '../shared/domain.ts'
import type { Store } from './store.ts'
import type { VerifiedAccount } from './provider.ts'
import { ApiError } from './errors.ts'

export const accountAbsoluteLifetime = 30 * 24 * 60 * 60_000
export const accountIdleLifetime = 7 * 24 * 60 * 60_000
export const deletionReauthLifetime = 10 * 60_000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const forbidden = () => new ApiError(403, 'You do not have active access to this kitchen.')
const conflict = () => new ApiError(409, 'A roommate just changed the kitchen. Refresh it and try again.')

export type AccountSession = {
  id: string; accountId: string; selectedHouseholdId: string | null
  createdAt: string; expiresAt: string; csrfToken: string; deleting: boolean
}

export class AccountStore {
  private db: DatabaseSync
  private store: Store
  private now: () => number

  constructor(db: DatabaseSync, store: Store, now: () => number = Date.now) {
    this.db = db
    this.store = store
    this.now = now
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, provider_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL,
        deleting INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS deleted_account_providers (
        hash TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS account_sessions (
        id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        label TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        selected_household_id TEXT REFERENCES households(id)
      );
      CREATE INDEX IF NOT EXISTS account_sessions_account ON account_sessions(account_id);
      CREATE TABLE IF NOT EXISTS household_accounts (
        household_id TEXT PRIMARY KEY REFERENCES households(id),
        owner_member_id TEXT
      );
      CREATE TABLE IF NOT EXISTS account_memberships (
        household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        active INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(household_id, member_id), UNIQUE(household_id, account_id)
      );
      CREATE TABLE IF NOT EXISTS account_invitations (
        id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
        hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        revoked_at TEXT, uses INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS account_invitation_uses (
        invitation_id TEXT NOT NULL REFERENCES account_invitations(id),
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        PRIMARY KEY(invitation_id, account_id)
      );
    `)
  }

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

  isManaged(householdId: string) {
    return !!this.db.prepare('SELECT 1 FROM household_accounts WHERE household_id = ?').get(householdId)
  }

  private purgeSessions() {
    this.db.prepare('DELETE FROM account_sessions WHERE expires_at <= ? OR last_used_at <= ?')
      .run(new Date(this.now()).toISOString(), new Date(this.now() - accountIdleLifetime).toISOString())
  }

  authenticate(token: string): AccountSession | null {
    this.purgeSessions()
    const row = this.db.prepare(`SELECT s.*, a.deleting FROM account_sessions s
      JOIN accounts a ON a.id = s.account_id WHERE s.hash = ?`).get(hash(token))
    if (!row) return null
    this.db.prepare('UPDATE account_sessions SET last_used_at = ? WHERE id = ?')
      .run(new Date(this.now()).toISOString(), row.id)
    return {
      id: String(row.id), accountId: String(row.account_id),
      selectedHouseholdId: row.selected_household_id === null ? null : String(row.selected_household_id),
      createdAt: String(row.created_at), expiresAt: String(row.expires_at),
      csrfToken: hash(`roomlings-csrf:${token}`), deleting: !!row.deleting,
    }
  }

  signIn(identity: VerifiedAccount, name: string, label: string) {
    return this.transaction(() => {
      this.purgeSessions()
      if (this.db.prepare('SELECT 1 FROM deleted_account_providers WHERE hash = ?').get(hash(identity.providerId))) {
        throw new ApiError(401, 'That account was deleted. Request a fresh email code to create a new account.', 'INVALID_EMAIL_CODE')
      }
      let row = this.db.prepare('SELECT id, deleting FROM accounts WHERE provider_id = ?').get(identity.providerId)
      if (row?.deleting) throw new ApiError(409, 'Account deletion is pending. Access stays disabled until it completes.', 'ACCOUNT_DELETION_PENDING')
      const now = new Date(this.now()).toISOString()
      if (!row) {
        const id = randomUUID()
        this.db.prepare('INSERT INTO accounts (id, provider_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, identity.providerId, identity.email, name, now)
        row = { id, deleting: 0 }
      } else {
        this.db.prepare('UPDATE accounts SET email = ? WHERE id = ?').run(identity.email, row.id)
      }
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM account_sessions WHERE account_id = ?').get(row.id)
      if (Number(count?.count) >= 50) throw new ApiError(409, 'This account has 50 saved browsers. Sign out an existing browser before adding another.')
      const token = randomBytes(32).toString('base64url')
      const selected = this.memberships(String(row.id))[0]?.householdId ?? null
      this.db.prepare(`INSERT INTO account_sessions
        (id, hash, account_id, label, created_at, last_used_at, expires_at, selected_household_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), hash(token), row.id, label, now, now, new Date(this.now() + accountAbsoluteLifetime).toISOString(), selected)
      const session = this.authenticate(token)!
      return { token, session }
    })
  }

  private memberships(accountId: string): AccountState['memberships'] {
    const rows = this.db.prepare(`SELECT m.household_id, m.member_id, h.owner_member_id FROM account_memberships m
      JOIN household_accounts h ON h.household_id = m.household_id WHERE m.account_id = ? AND m.active = 1`).all(accountId)
    return rows.flatMap((row) => {
      const household = this.store.get(String(row.household_id))
      if (!household?.members.some((member) => member.id === row.member_id && !member.inactive)) return []
      return [{
        householdId: household.id, householdName: household.name, memberId: String(row.member_id),
        currency: household.currency, role: row.owner_member_id === row.member_id ? 'owner' as const : 'member' as const,
      }]
    })
  }

  state(session: AccountSession): AccountState {
    const account = this.db.prepare('SELECT id, email, name, created_at FROM accounts WHERE id = ? AND deleting = 0').get(session.accountId)
    if (!account) throw new ApiError(409, 'Account deletion is pending. Access is disabled; retry deletion to finish.', 'ACCOUNT_DELETION_PENDING')
    this.purgeSessions()
    const memberships = this.memberships(session.accountId)
    const selected = memberships.find((membership) => membership.householdId === session.selectedHouseholdId)
    const devices = this.db.prepare('SELECT * FROM account_sessions WHERE account_id = ? ORDER BY last_used_at DESC, id')
      .all(session.accountId).map((row) => ({
        id: String(row.id), label: String(row.label), createdAt: String(row.created_at),
        lastUsedAt: String(row.last_used_at),
        expiresAt: new Date(Math.min(Date.parse(String(row.expires_at)), Date.parse(String(row.last_used_at)) + accountIdleLifetime)).toISOString(),
        current: row.id === session.id,
      }))
    return accountStateSchema.parse({
      configured: true,
      account: { id: account.id, email: account.email, name: account.name, createdAt: account.created_at },
      memberships, devices, csrfToken: session.csrfToken,
      session: selected ? { token: null, memberId: selected.memberId, household: this.store.get(selected.householdId) } : null,
    })
  }

  household(session: AccountSession, id: string | null = session.selectedHouseholdId) {
    if (session.deleting || !id) throw forbidden()
    const membership = this.db.prepare(`SELECT m.member_id, h.owner_member_id FROM account_memberships m
      JOIN household_accounts h ON h.household_id = m.household_id
      JOIN accounts a ON a.id = m.account_id
      WHERE m.account_id = ? AND m.household_id = ? AND m.active = 1 AND a.deleting = 0`).get(session.accountId, id)
    const household = membership ? this.store.get(id) : null
    if (!membership || !household?.members.some((member) => member.id === membership.member_id && !member.inactive)) throw forbidden()
    return { household, memberId: String(membership.member_id), sessionId: session.id, role: membership.owner_member_id === membership.member_id ? 'owner' as const : 'member' as const }
  }

  select(session: AccountSession, householdId: string) {
    this.household(session, householdId)
    this.db.prepare('UPDATE account_sessions SET selected_household_id = ? WHERE id = ?').run(householdId, session.id)
    session.selectedHouseholdId = householdId
    return this.state(session)
  }

  profile(session: AccountSession, name: string) {
    this.db.prepare('UPDATE accounts SET name = ? WHERE id = ? AND deleting = 0').run(name, session.accountId)
    return this.state(session)
  }

  renameDevice(session: AccountSession, label: string) {
    this.db.prepare('UPDATE account_sessions SET label = ? WHERE id = ? AND account_id = ?').run(label, session.id, session.accountId)
    return this.state(session)
  }

  logout(session: AccountSession, all: boolean) {
    this.transaction(() => {
      if (all) {
        this.db.prepare('DELETE FROM account_sessions WHERE account_id = ?').run(session.accountId)
        this.db.prepare(`DELETE FROM sessions WHERE EXISTS (SELECT 1 FROM account_memberships m
          WHERE m.account_id = ? AND m.household_id = sessions.household_id AND m.member_id = sessions.member_id)`).run(session.accountId)
      } else {
        this.db.prepare('DELETE FROM account_sessions WHERE id = ? AND account_id = ?').run(session.id, session.accountId)
      }
    })
  }

  revokeDevice(session: AccountSession, id: string) {
    const result = this.db.prepare('DELETE FROM account_sessions WHERE id = ? AND account_id = ?').run(id, session.accountId)
    if (!result.changes) throw new ApiError(404, 'That browser session was not found for your account.')
    return id === session.id ? null : this.state(session)
  }

  private owner(householdId: string) {
    const row = this.db.prepare('SELECT owner_member_id FROM household_accounts WHERE household_id = ?').get(householdId)
    return row?.owner_member_id === null || !row ? null : String(row.owner_member_id)
  }

  private changed(household: Household) {
    household.version++
    this.store.save(household)
  }

  private checkVersion(household: Household, version: number) {
    if (household.version !== version) throw conflict()
  }

  private requireOwner(session: AccountSession, householdId: string, version: number) {
    const access = this.household(session, householdId)
    if (access.role !== 'owner') throw new ApiError(403, 'Only the kitchen owner can manage invitations, roommates, or ownership.')
    this.checkVersion(access.household, version)
    return access
  }

  access(session: AccountSession, householdId: string): HouseholdAccess {
    const { household, memberId, role } = this.household(session, householdId)
    const linked = new Set(this.db.prepare(`SELECT m.member_id FROM account_memberships m JOIN accounts a ON a.id = m.account_id
      WHERE m.household_id = ? AND m.active = 1 AND a.deleting = 0`).all(householdId).map((row) => String(row.member_id)))
    const owner = this.owner(householdId)
    const invitations = role === 'owner' ? this.db.prepare('SELECT id, created_at, expires_at, revoked_at, uses FROM account_invitations WHERE household_id = ? ORDER BY created_at DESC, id')
      .all(householdId).map((row) => ({
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

  link(session: AccountSession, proof: { token?: string; recoveryCode?: string }) {
    return this.transaction(() => {
      const row = proof.token
        ? this.db.prepare('SELECT household_id, member_id FROM sessions WHERE hash = ?').get(hash(proof.token))
        : this.db.prepare('SELECT household_id, member_id FROM recovery_codes WHERE hash = ?').get(hash(proof.recoveryCode!))
      const household = row ? this.store.get(String(row.household_id)) : null
      const member = household?.members.find((member) => member.id === row?.member_id && !member.inactive)
      if (!household || !member) throw new ApiError(401, 'That browser access or recovery code is invalid or revoked.')
      if (household.demo) throw new ApiError(400, 'Practice kitchens cannot be linked to accounts. Create a real kitchen instead.')
      const existing = this.db.prepare('SELECT account_id FROM account_memberships WHERE household_id = ? AND member_id = ?').get(household.id, member.id)
      if (existing && existing.account_id !== session.accountId) throw new ApiError(409, 'This roommate identity is already linked to another account.')
      const other = this.db.prepare('SELECT member_id FROM account_memberships WHERE household_id = ? AND account_id = ?').get(household.id, session.accountId)
      if (other && other.member_id !== member.id) throw new ApiError(409, 'Your account already has a different roommate identity in this kitchen.')
      if (!existing) {
        this.db.prepare('INSERT OR IGNORE INTO household_accounts (household_id, owner_member_id) VALUES (?, ?)')
          .run(household.id, household.members[0].id)
        this.db.prepare('INSERT INTO account_memberships (household_id, member_id, account_id) VALUES (?, ?, ?)')
          .run(household.id, member.id, session.accountId)
        this.changed(household)
      }
      return this.select(session, household.id)
    })
  }

  createHousehold(session: AccountSession, input: { name: string; memberName: string; currency: Household['currency']; budget: number }) {
    return this.transaction(() => {
      if (this.memberships(session.accountId).length >= 50) throw new ApiError(409, 'This account already has 50 kitchens. Leave one before creating another.')
      const created = this.store.create(input.name, input.memberName, input.currency, input.budget)
      // Store.create is shared with the legacy path; do not retain or disclose its bearer credential.
      this.db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash(created.token))
      this.db.prepare('INSERT INTO household_accounts (household_id, owner_member_id) VALUES (?, ?)').run(created.household.id, created.memberId)
      this.db.prepare('INSERT INTO account_memberships (household_id, member_id, account_id) VALUES (?, ?, ?)')
        .run(created.household.id, created.memberId, session.accountId)
      return this.select(session, created.household.id)
    })
  }

  invite(session: AccountSession, householdId: string, version: number, expiresInDays: number): AccountInvitationResult {
    return this.transaction(() => {
      const { household } = this.requireOwner(session, householdId, version)
      const now = new Date(this.now()).toISOString()
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM account_invitations WHERE household_id = ? AND revoked_at IS NULL AND expires_at > ?').get(householdId, now)
      if (Number(count?.count) >= 50) throw new ApiError(409, 'Revoke an unused invitation before creating another.')
      const code = `roomlings-invite-${randomBytes(32).toString('base64url')}`
      const invitation = { id: randomUUID(), createdAt: now, expiresAt: new Date(this.now() + expiresInDays * 86_400_000).toISOString(), revokedAt: null, uses: 0 }
      this.db.prepare('INSERT INTO account_invitations (id, household_id, hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(invitation.id, householdId, hash(code), now, invitation.expiresAt)
      this.changed(household)
      return { code, invitation, access: this.access(session, householdId) }
    })
  }

  revokeInvitation(session: AccountSession, householdId: string, id: string, version: number) {
    return this.transaction(() => {
      const { household } = this.requireOwner(session, householdId, version)
      const invitation = this.db.prepare('SELECT revoked_at FROM account_invitations WHERE id = ? AND household_id = ?').get(id, householdId)
      if (!invitation) throw new ApiError(404, 'That invitation does not belong to this kitchen.')
      if (invitation.revoked_at === null) {
        this.db.prepare('UPDATE account_invitations SET revoked_at = ? WHERE id = ?').run(new Date(this.now()).toISOString(), id)
        this.changed(household)
      }
      return this.access(session, householdId)
    })
  }

  accept(session: AccountSession, code: string, memberName: string) {
    return this.transaction(() => {
      const invitation = this.db.prepare('SELECT * FROM account_invitations WHERE hash = ?').get(hash(code))
      if (!invitation || invitation.revoked_at !== null || Date.parse(String(invitation.expires_at)) <= this.now()) {
        throw new ApiError(410, 'That invitation is expired, revoked, or invalid. Ask the kitchen owner for a new one.')
      }
      const householdId = String(invitation.household_id)
      const household = this.store.get(householdId)
      if (!household || household.demo || !this.owner(householdId)) throw new ApiError(410, 'This kitchen is closed and cannot accept new roommates.')
      const existing = this.db.prepare('SELECT member_id, active FROM account_memberships WHERE household_id = ? AND account_id = ?').get(householdId, session.accountId)
      if (existing?.active) return this.select(session, householdId)
      const used = this.db.prepare('SELECT 1 FROM account_invitation_uses WHERE invitation_id = ? AND account_id = ?').get(invitation.id, session.accountId)
      if (used) throw new ApiError(410, 'This invitation cannot restore removed access. Ask the owner for a fresh invitation.')
      if (this.memberships(session.accountId).length >= 50) throw new ApiError(409, 'This account already has 50 kitchens. Leave one before joining another.')
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
        this.db.prepare('UPDATE account_memberships SET active = 1 WHERE household_id = ? AND account_id = ?').run(householdId, session.accountId)
      } else {
        household.members.push({ id: memberId, name: memberName, color: memberColors[household.members.length % memberColors.length] })
        this.db.prepare('INSERT INTO account_memberships (household_id, member_id, account_id) VALUES (?, ?, ?)').run(householdId, memberId, session.accountId)
      }
      this.db.prepare('INSERT INTO account_invitation_uses (invitation_id, account_id) VALUES (?, ?)').run(invitation.id, session.accountId)
      this.db.prepare('UPDATE account_invitations SET uses = uses + 1 WHERE id = ?').run(invitation.id)
      this.changed(household)
      return this.select(session, householdId)
    })
  }

  transfer(session: AccountSession, householdId: string, target: string, version: number) {
    return this.transaction(() => {
      const { household, memberId } = this.requireOwner(session, householdId, version)
      if (target === memberId) throw new ApiError(409, 'You already own this kitchen.')
      const linked = this.db.prepare(`SELECT 1 FROM account_memberships m JOIN accounts a ON a.id = m.account_id
        WHERE m.household_id = ? AND m.member_id = ? AND m.active = 1 AND a.deleting = 0`).get(householdId, target)
      if (!linked || !household.members.some((member) => member.id === target && !member.inactive)) {
        throw new ApiError(400, 'Choose an active roommate who has linked a verified account.')
      }
      this.db.prepare('UPDATE household_accounts SET owner_member_id = ? WHERE household_id = ?').run(target, householdId)
      this.changed(household)
      return this.access(session, householdId)
    })
  }

  private deactivate(household: Household, memberId: string, pseudonymize = false) {
    const member = household.members.find((member) => member.id === memberId)!
    member.inactive = true
    if (pseudonymize) member.name = `Former roommate ${household.members.indexOf(member) + 1}`
    this.db.prepare('UPDATE account_memberships SET active = 0 WHERE household_id = ? AND member_id = ?').run(household.id, memberId)
    // Consume existing links for this account; only a new owner-issued invitation can restore access.
    this.db.prepare(`INSERT OR IGNORE INTO account_invitation_uses (invitation_id, account_id)
      SELECT i.id, m.account_id FROM account_invitations i JOIN account_memberships m ON m.household_id = i.household_id
      WHERE m.household_id = ? AND m.member_id = ?`).run(household.id, memberId)
    this.db.prepare('DELETE FROM sessions WHERE household_id = ? AND member_id = ?').run(household.id, memberId)
    this.db.prepare('DELETE FROM recovery_codes WHERE household_id = ? AND member_id = ?').run(household.id, memberId)
    for (const item of household.shopping.items) {
      if (item.claimedBy !== memberId) continue
      item.claimedBy = null
      item.pickedUp = false
      item.version++
      item.updatedAt = new Date(this.now()).toISOString()
    }
    if (this.owner(household.id) === memberId) {
      this.db.prepare('UPDATE household_accounts SET owner_member_id = NULL WHERE household_id = ?').run(household.id)
      this.db.prepare('UPDATE account_invitations SET revoked_at = ? WHERE household_id = ? AND revoked_at IS NULL')
        .run(new Date(this.now()).toISOString(), household.id)
    }
    this.changed(household)
  }

  remove(session: AccountSession, householdId: string, target: string, version: number) {
    return this.transaction(() => {
      const { household, memberId } = this.requireOwner(session, householdId, version)
      if (target === memberId) throw new ApiError(409, 'Use Leave kitchen after transferring ownership instead of removing yourself.')
      if (!household.members.some((member) => member.id === target && !member.inactive)) throw new ApiError(404, 'That active roommate was not found.')
      this.deactivate(household, target)
      return this.access(session, householdId)
    })
  }

  private canLeave(household: Household, memberId: string) {
    if (this.owner(household.id) === memberId && household.members.some((member) => member.id !== memberId && !member.inactive)) {
      throw new ApiError(409, `Transfer ownership of "${household.name}" to an active account-linked roommate before leaving or deleting your account.`, 'OWNERSHIP_TRANSFER_REQUIRED')
    }
  }

  leave(session: AccountSession, householdId: string, version: number) {
    return this.transaction(() => {
      const { household, memberId } = this.household(session, householdId)
      this.checkVersion(household, version)
      this.canLeave(household, memberId)
      this.deactivate(household, memberId)
      return this.state(session)
    })
  }

  beginDeletion(session: AccountSession, confirmation: string) {
    return this.transaction(() => {
      const account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(session.accountId)
      if (!account) throw new ApiError(401, 'Sign in before deleting your account.')
      if (confirmation !== account.email) throw new ApiError(400, 'Enter your exact account email to confirm deletion.')
      if (account.deleting) return String(account.provider_id)
      if (this.now() - Date.parse(session.createdAt) > deletionReauthLifetime) {
        throw new ApiError(401, 'Sign in again with a fresh email code, then delete your account within 10 minutes.', 'REAUTHENTICATION_REQUIRED')
      }
      const memberships = this.db.prepare('SELECT household_id, member_id FROM account_memberships WHERE account_id = ?').all(session.accountId)
      for (const membership of memberships) this.canLeave(this.store.get(String(membership.household_id))!, String(membership.member_id))
      // Persist a deletion barrier before contacting the provider. Retries cannot regain kitchen access.
      this.db.prepare('UPDATE accounts SET deleting = 1 WHERE id = ?').run(session.accountId)
      this.db.prepare('DELETE FROM account_sessions WHERE account_id = ? AND id <> ?').run(session.accountId, session.id)
      for (const membership of memberships) this.deactivate(this.store.get(String(membership.household_id))!, String(membership.member_id))
      session.deleting = true
      return String(account.provider_id)
    })
  }

  pendingDeletions() {
    return this.db.prepare('SELECT id, provider_id FROM accounts WHERE deleting = 1')
      .all().map((row) => ({ id: String(row.id), providerId: String(row.provider_id) }))
  }

  finishDeletion(accountId: string) {
    this.transaction(() => {
      const account = this.db.prepare('SELECT deleting, provider_id FROM accounts WHERE id = ?').get(accountId)
      if (!account) return
      if (!account.deleting) throw new Error('Deletion must disable access before removing the provider identity.')
      const memberships = this.db.prepare('SELECT household_id, member_id FROM account_memberships WHERE account_id = ?').all(accountId)
      for (const membership of memberships) this.deactivate(this.store.get(String(membership.household_id))!, String(membership.member_id), true)
      // Reject verified requests that started before provider deletion but arrived after local finalization.
      this.db.prepare('INSERT OR IGNORE INTO deleted_account_providers (hash) VALUES (?)').run(hash(String(account.provider_id)))
      this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId)
    })
  }
}
