import { afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../server/store.ts'
import { SQLiteDatabase } from '../server/database.ts'
import { accountAbsoluteLifetime, accountReauthLifetime } from '../server/accounts-store.ts'
import { ApiError } from '../server/errors.ts'
import { accountRecoveryCodeSchema, accountRecoverySignInSchema } from '../shared/accounts.ts'
import { balances } from '../shared/domain.ts'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  mock.restoreAll()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture() {
  let now = Date.now()
  const db = new SQLiteDatabase(':memory:')
  const store = new Store(db, { now: () => now })
  cleanups.push(() => store.close())
  const identity = { providerId: randomUUID(), email: 'ada@example.com' }
  const owner = await store.accounts.signIn(identity, 'Ada', 'Original browser')
  return { db, store, identity, owner, now: () => now, advance(ms: number) { now += ms } }
}

function rejectedCode(error: unknown) {
  return error instanceof ApiError && error.status === 401 && error.code === 'INVALID_ACCOUNT_RECOVERY_CODE'
}

describe('single-use account recovery codes', () => {
  it('generates ten distinct codes, stores only their hashes and never returns secrets in status', async () => {
    const f = await fixture()
    assert.deepEqual(await f.store.accounts.recoveryState(f.owner.session), { version: 0, remaining: 0, updatedAt: null })
    const generated = await f.store.accounts.generateRecoveryCodes(f.owner.session, 0)
    assert.equal(generated.codes.length, 10)
    assert.equal(new Set(generated.codes).size, 10)
    for (const code of generated.codes) assert.equal(accountRecoveryCodeSchema.parse(code), code)
    const rows = await f.db.prepare('SELECT hash, account_id FROM account_recovery_codes').all()
    assert.deepEqual(rows.map((row) => row.hash).sort(), generated.codes.map(digest).sort())
    assert.ok(rows.every((row) => row.account_id === f.owner.session.accountId))
    const status = await f.store.accounts.recoveryState(f.owner.session)
    assert.deepEqual(status, { version: 1, remaining: 10, updatedAt: new Date(f.now()).toISOString() })
    const persisted = JSON.stringify([
      rows, await f.db.prepare('SELECT * FROM account_recovery_settings').all(), status,
      await f.store.accounts.state(f.owner.session),
    ])
    assert.ok(generated.codes.every((code) => !persisted.includes(code)))
    assert.equal(accountRecoveryCodeSchema.safeParse('12345678').success, false)
    assert.equal(accountRecoveryCodeSchema.safeParse(`roomlings-${'a'.repeat(43)}`).success, false)
    assert.equal(accountRecoverySignInSchema.safeParse({ email: 'ada@example.com', code: generated.codes[0], label: '' }).success, false)
  })

  it('restores the same account, memberships and ledger without replacing other sessions', async () => {
    const f = await fixture()
    const created = await f.store.accounts.createHousehold(f.owner.session, {
      name: 'The recovery household', memberName: 'Ada', currency: 'EUR', budget: 45000,
    })
    assert.ok(created.session)
    const household = created.session.household
    const roommate = { id: randomUUID(), name: 'Ben', color: '#7d9070' }
    household.members.push(roommate)
    household.expenses.push({
      id: randomUUID(), description: 'An original receipt', amount: 1201,
      paidBy: created.session.memberId, participants: [created.session.memberId, roommate.id],
      category: 'produce', date: '2026-09-01', createdAt: new Date(f.now()).toISOString(),
    })
    await f.store.save(household)
    const before = await f.store.accounts.state(f.owner.session)
    const generated = await f.store.accounts.generateRecoveryCodes(f.owner.session, 0)
    const recovered = await f.store.accounts.recoverAccount({
      email: ' ADA@EXAMPLE.COM ', code: ` ${generated.codes[0].toUpperCase()} `, label: 'Recovered phone',
    })
    assert.notEqual(recovered.token, f.owner.token)
    assert.equal(recovered.session.accountId, f.owner.session.accountId)
    assert.equal(recovered.session.expiresAt, new Date(f.now() + accountAbsoluteLifetime).toISOString())
    const after = await f.store.accounts.state(recovered.session)
    assert.deepEqual(after.account, before.account)
    assert.deepEqual(after.memberships, before.memberships)
    assert.deepEqual(after.session, before.session)
    assert.deepEqual(balances(after.session!.household), balances(household))
    assert.ok(await f.store.accounts.authenticate(f.owner.token))
    assert.equal((await f.store.accounts.recoveryState(recovered.session)).remaining, 9)
    await assert.rejects(f.store.accounts.recoverAccount({ email: f.identity.email, code: generated.codes[0], label: 'Reuse' }), rejectedCode)
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM account_sessions').get())?.count, 2)
  })

  it('requires both the right code and email and never claims another account with the same email', async () => {
    const f = await fixture()
    const other = await f.store.accounts.signIn({ providerId: randomUUID(), email: f.identity.email }, 'Different account', 'Other browser')
    const generated = await f.store.accounts.generateRecoveryCodes(other.session, 0)
    await assert.rejects(f.store.accounts.recoverAccount({ email: 'wrong@example.com', code: generated.codes[0], label: 'Wrong email' }), rejectedCode)
    assert.equal((await f.store.accounts.recoveryState(other.session)).remaining, 10)
    const recovered = await f.store.accounts.recoverAccount({ email: f.identity.email, code: generated.codes[0], label: 'Correct proof' })
    assert.equal(recovered.session.accountId, other.session.accountId)
    assert.notEqual(recovered.session.accountId, f.owner.session.accountId)
    assert.equal((await f.store.accounts.state(recovered.session)).account?.name, 'Different account')
  })

  it('allows a code to create only one session when redemption requests race', async () => {
    const f = await fixture()
    const generated = await f.store.accounts.generateRecoveryCodes(f.owner.session, 0)
    const input = { email: f.identity.email, code: generated.codes[0], label: 'Concurrent browser' }
    const attempts = await Promise.allSettled([
      f.store.accounts.recoverAccount(input), f.store.accounts.recoverAccount(input),
    ])
    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1)
    const rejected = attempts.find((attempt) => attempt.status === 'rejected')
    assert.ok(rejected?.status === 'rejected' && rejectedCode(rejected.reason))
    assert.equal((await f.store.accounts.recoveryState(f.owner.session)).remaining, 9)
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM account_sessions').get())?.count, 2)
  })

  it('replaces and revokes only the selected account codes with optimistic version checks', async () => {
    const f = await fixture()
    const other = await f.store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ben', 'Other browser')
    const unrelated = await f.store.accounts.generateRecoveryCodes(other.session, 0)
    const first = await f.store.accounts.generateRecoveryCodes(f.owner.session, 0)
    const replacements = await Promise.allSettled([
      f.store.accounts.generateRecoveryCodes(f.owner.session, first.recovery.version),
      f.store.accounts.generateRecoveryCodes(f.owner.session, first.recovery.version),
    ])
    const accepted = replacements.find((result) => result.status === 'fulfilled')
    assert.ok(accepted?.status === 'fulfilled')
    assert.equal(replacements.filter((result) => result.status === 'rejected').length, 1)
    assert.equal(accepted.value.recovery.version, 2)
    await assert.rejects(f.store.accounts.recoverAccount({ email: f.identity.email, code: first.codes[0], label: 'Replaced code' }), rejectedCode)
    await assert.rejects(f.store.accounts.revokeRecoveryCodes(f.owner.session, 1), (error: unknown) => error instanceof ApiError && error.status === 409)
    const revoked = await f.store.accounts.revokeRecoveryCodes(f.owner.session, 2)
    assert.equal(revoked.version, 3)
    assert.equal(revoked.remaining, 0)
    await assert.rejects(f.store.accounts.recoverAccount({ email: f.identity.email, code: accepted.value.codes[0], label: 'Revoked code' }), rejectedCode)
    assert.ok(await f.store.accounts.authenticate(f.owner.token))
    assert.equal((await f.store.accounts.recoveryState(other.session)).remaining, 10)
    assert.ok(await f.store.accounts.recoverAccount({ email: 'ben@example.com', code: unrelated.codes[0], label: 'Unaffected account' }))
  })

  it('requires recent authentication to change codes and permits recovery-code reauthentication', async () => {
    const f = await fixture()
    const generated = await f.store.accounts.generateRecoveryCodes(f.owner.session, 0)
    f.advance(accountReauthLifetime + 1)
    const recentRequired = (error: unknown) => error instanceof ApiError && error.code === 'REAUTHENTICATION_REQUIRED'
    await assert.rejects(f.store.accounts.generateRecoveryCodes(f.owner.session, 1), recentRequired)
    await assert.rejects(f.store.accounts.revokeRecoveryCodes(f.owner.session, 1), recentRequired)
    assert.equal((await f.store.accounts.recoveryState(f.owner.session)).remaining, 10)
    const fresh = await f.store.accounts.recoverAccount({ email: f.identity.email, code: generated.codes[0], label: 'Fresh proof' })
    assert.equal((await f.store.accounts.generateRecoveryCodes(fresh.session, 1)).recovery.remaining, 10)
    await f.store.accounts.logout(f.owner.session, false)
    await assert.rejects(f.store.accounts.recoveryState(f.owner.session), (error: unknown) =>
      error instanceof ApiError && error.code === 'ACCOUNT_SESSION_REQUIRED')
  })

  it('does not consume a code when the account has reached its saved-browser limit', async () => {
    const f = await fixture()
    const generated = await f.store.accounts.generateRecoveryCodes(f.owner.session, 0)
    let latest = f.owner
    for (let index = 0; index < 49; index++) latest = await f.store.accounts.signIn(f.identity, 'Unchanged name', `Browser ${index}`)
    await assert.rejects(f.store.accounts.recoverAccount({
      email: f.identity.email, code: generated.codes[0], label: 'Over the limit',
    }), (error: unknown) => error instanceof ApiError && error.status === 409)
    assert.equal((await f.store.accounts.recoveryState(f.owner.session)).remaining, 10)
    await f.store.accounts.logout(latest.session, false)
    assert.ok(await f.store.accounts.recoverAccount({ email: f.identity.email, code: generated.codes[0], label: 'Available slot' }))
    assert.equal((await f.store.accounts.recoveryState(f.owner.session)).remaining, 9)
  })

  it('rolls back both session creation and code consumption if persistence fails', async () => {
    const f = await fixture()
    const generated = await f.store.accounts.generateRecoveryCodes(f.owner.session, 0)
    const prepare = f.db.prepare.bind(f.db)
    const failure = mock.method(f.db, 'prepare', (sql: string) => {
      const statement = prepare(sql)
      return sql.startsWith('DELETE FROM account_recovery_codes WHERE hash')
        ? { ...statement, run: async () => { throw new Error('Simulated code-consumption failure') } } : statement
    })
    await assert.rejects(f.store.accounts.recoverAccount({
      email: f.identity.email, code: generated.codes[0], label: 'Not committed',
    }), /Simulated code-consumption failure/)
    failure.mock.restore()
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM account_sessions').get())?.count, 1)
    assert.equal((await f.store.accounts.recoveryState(f.owner.session)).remaining, 10)
    assert.ok(await f.store.accounts.recoverAccount({ email: f.identity.email, code: generated.codes[0], label: 'Retried safely' }))
  })

  it('does not restore removed household membership and disables codes when account deletion begins', async () => {
    const f = await fixture()
    const created = await f.store.accounts.createHousehold(f.owner.session, {
      name: 'The retained kitchen', memberName: 'Ada', currency: 'EUR', budget: 45000,
    })
    assert.ok(created.session)
    const invitation = await f.store.accounts.invite(f.owner.session, created.session.household.id, created.session.household.version, 7)
    const member = await f.store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ben', 'Member browser')
    const joined = await f.store.accounts.accept(member.session, invitation.code, 'Ben')
    assert.ok(joined.session)
    const codes = await f.store.accounts.generateRecoveryCodes(member.session, 0)
    await f.store.accounts.remove(f.owner.session, joined.session.household.id, joined.session.memberId, joined.session.household.version)
    const recovered = await f.store.accounts.recoverAccount({ email: 'ben@example.com', code: codes.codes[0], label: 'Still the same account' })
    const state = await f.store.accounts.state(recovered.session)
    assert.equal(state.account?.id, member.session.accountId)
    assert.deepEqual(state.memberships, [])
    assert.equal(state.session, null)
    assert.equal((await f.store.get(joined.session.household.id))?.members.find((person) => person.id === joined.session?.memberId)?.inactive, true)
    await f.store.accounts.beginDeletion(recovered.session, 'ben@example.com')
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM account_recovery_codes WHERE account_id = ?').get(member.session.accountId))?.count, 0)
    await assert.rejects(f.store.accounts.recoverAccount({ email: 'ben@example.com', code: codes.codes[1], label: 'Pending deletion' }), rejectedCode)
    await f.store.accounts.finishDeletion(member.session.accountId)
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM account_recovery_settings WHERE account_id = ?').get(member.session.accountId))?.count, 0)
    assert.ok(await f.store.get(joined.session.household.id))
  })
})

it('adds account recovery tables to an older SQLite database without rewriting existing accounts or kitchen JSON', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'roomlings-account-recovery-'))
  const filename = join(directory, 'kitchen.sqlite')
  let store = new Store(filename)
  try {
    const identity = { providerId: randomUUID(), email: 'ada@example.com' }
    const owner = await store.accounts.signIn(identity, 'Ada', 'Original browser')
    const created = await store.accounts.createHousehold(owner.session, { name: 'An existing home', memberName: 'Ada', currency: 'EUR', budget: 45000 })
    assert.ok(created.session)
    await store.close()
    const old = new DatabaseSync(filename)
    old.exec('DROP TABLE account_recovery_codes; DROP TABLE account_recovery_settings;')
    const householdJson = old.prepare('SELECT state FROM households').get()?.state
    const account = old.prepare('SELECT * FROM accounts').get()
    const session = old.prepare('SELECT * FROM account_sessions').get()
    old.close()
    store = new Store(filename)
    const upgraded = new DatabaseSync(filename)
    assert.equal(upgraded.prepare('SELECT state FROM households').get()?.state, householdJson)
    assert.deepEqual(upgraded.prepare('SELECT * FROM accounts').get(), account)
    assert.deepEqual(upgraded.prepare('SELECT * FROM account_sessions').get(), session)
    upgraded.close()
    const restored = await store.accounts.authenticate(owner.token)
    assert.ok(restored)
    const generated = await store.accounts.generateRecoveryCodes(restored, 0)
    await store.close()
    store = new Store(filename)
    const recovered = await store.accounts.recoverAccount({ email: identity.email, code: generated.codes[0], label: 'After restart' })
    assert.equal(recovered.session.accountId, restored.accountId)
    assert.equal((await store.accounts.state(recovered.session)).session?.memberId, created.session.memberId)
    await store.close()
    store = new Store(filename)
    await assert.rejects(store.accounts.recoverAccount({ email: identity.email, code: generated.codes[0], label: 'Already used' }), rejectedCode)
    const original = await store.accounts.authenticate(owner.token)
    assert.ok(original)
    assert.equal((await store.accounts.recoveryState(original)).remaining, 9)
  } finally {
    await store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
