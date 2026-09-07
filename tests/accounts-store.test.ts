import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../server/store.ts'
import { activeMemberLimit, balances, householdSchema, memberColors, retainedMemberLimit } from '../shared/domain.ts'

describe('account persistence and migration', () => {
  it('releases active seats while retaining former members, balances, and bill schedules beyond twelve identities', () => {
    const store = new Store(':memory:')
    try {
      const owner = store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop')
      const created = store.accounts.createHousehold(owner.session, { name: 'Changing roommates', memberName: 'Ada', currency: 'EUR', budget: 10000 })
      const household = created.session!.household
      for (let index = 1; index < activeMemberLimit; index++) {
        household.members.push({ id: randomUUID(), name: `Original roommate ${index}`, color: memberColors[index % memberColors.length] })
      }
      const departing = household.members[1].id
      const originalParticipants = [created.session!.memberId, departing]
      household.expenses.push({
        id: randomUUID(), description: 'Original groceries', amount: 123, paidBy: created.session!.memberId,
        participants: originalParticipants, category: 'pantry', date: '2026-09-01', createdAt: new Date().toISOString(),
      })
      household.bills.push({
        id: randomUUID(), createdAt: new Date().toISOString(), startMonth: '2026-09', pauses: [],
        revisions: [{ fromMonth: '2026-09', name: 'Internet', amount: 3000, dueDay: 1, participants: originalParticipants }],
      })
      store.save(household)
      const before = structuredClone(household)
      const invitation = store.accounts.invite(owner.session, household.id, household.version, 7)
      const newcomer = store.accounts.signIn({ providerId: randomUUID(), email: 'new@example.com' }, 'New roommate', 'Phone')
      assert.throws(() => store.accounts.accept(newcomer.session, invitation.code, 'New roommate'), /12 active roommates/)
      const removed = store.accounts.remove(owner.session, household.id, departing, invitation.access.household.version)
      assert.equal(removed.members.filter((member) => member.active).length, 11)
      const joined = store.accounts.accept(newcomer.session, invitation.code, 'New roommate')
      assert.equal(joined.session!.household.members.length, 13)
      assert.equal(joined.session!.household.members.filter((member) => !member.inactive).length, activeMemberLimit)
      assert.equal(joined.session!.household.members.find((member) => member.id === departing)!.inactive, true)
      assert.deepEqual(balances(joined.session!.household).get(departing), balances(before).get(departing))
      assert.deepEqual(joined.session!.household.expenses, before.expenses)
      assert.deepEqual(joined.session!.household.bills, before.bills)
      assert.equal(balances(joined.session!.household).get(joined.session!.memberId), 0)
      const invalid = structuredClone(joined.session!.household)
      invalid.members.find((member) => member.id === departing)!.inactive = false
      assert.equal(householdSchema.safeParse(invalid).success, false)
    } finally {
      store.close()
    }
  })

  it('bounds retained history at 200 identities while allowing former members to reuse an available active seat', () => {
    const store = new Store(':memory:')
    try {
      const owner = store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop')
      const created = store.accounts.createHousehold(owner.session, { name: 'Long-lived kitchen', memberName: 'Ada', currency: 'EUR', budget: 10000 })
      const initial = created.session!.household
      const invitation = store.accounts.invite(owner.session, initial.id, initial.version, 7)
      const former = store.accounts.signIn({ providerId: randomUUID(), email: 'former@example.com' }, 'Former', 'Phone')
      const joined = store.accounts.accept(former.session, invitation.code, 'Former')
      const memberId = joined.session!.memberId
      store.accounts.leave(former.session, initial.id, joined.session!.household.version)
      const household = store.get(initial.id)!
      while (household.members.length < retainedMemberLimit) {
        household.members.push({
          id: randomUUID(), name: `Archived roommate ${household.members.length}`,
          color: memberColors[0], inactive: true,
        })
      }
      assert.equal(householdSchema.safeParse(household).success, true)
      store.save(household)
      const fresh = store.accounts.invite(owner.session, initial.id, household.version, 7)
      const newcomer = store.accounts.signIn({ providerId: randomUUID(), email: 'new@example.com' }, 'New', 'Tablet')
      assert.throws(() => store.accounts.accept(newcomer.session, fresh.code, 'New'), /200-identity history limit/)
      const full = store.get(initial.id)!
      for (const member of full.members.slice(2, activeMemberLimit + 1)) member.inactive = false
      store.save(full)
      assert.throws(() => store.accounts.accept(former.session, fresh.code, 'Former'), /12 active roommates/)
      full.members[2].inactive = true
      store.save(full)
      const rejoined = store.accounts.accept(former.session, fresh.code, 'Former')
      assert.equal(rejoined.session!.memberId, memberId)
      assert.equal(rejoined.session!.household.members.length, retainedMemberLimit)
      assert.equal(rejoined.session!.household.members.filter((member) => !member.inactive).length, activeMemberLimit)
      const invalid = structuredClone(rejoined.session!.household)
      invalid.members.push({ id: randomUUID(), name: 'One too many', color: memberColors[0], inactive: true })
      assert.equal(householdSchema.safeParse(invalid).success, false)
    } finally {
      store.close()
    }
  })

  it('migrates the original database without replacing legacy JSON, sessions, or proof ownership', () => {
    const directory = join(process.cwd(), `.accounts-migration-${randomUUID()}`)
    mkdirSync(directory)
    const filename = join(directory, 'kitchen.sqlite')
    const memory = new Store(':memory:')
    const created = memory.create('Old kitchen', 'Ada', 'EUR', 30000)
    memory.close()
    const legacy = { ...created.household } as Record<string, unknown>
    delete legacy.bills
    delete legacy.billingTimeZone
    delete legacy.shopping
    const serialized = JSON.stringify(legacy)
    const raw = new DatabaseSync(filename)
    raw.exec(`CREATE TABLE households (id TEXT PRIMARY KEY, invite TEXT UNIQUE NOT NULL, state TEXT NOT NULL);
      CREATE TABLE sessions (hash TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL);`)
    raw.prepare('INSERT INTO households VALUES (?, ?, ?)').run(created.household.id, created.household.inviteCode, serialized)
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    raw.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash, created.household.id, created.memberId)
    raw.close()
    let store: Store | undefined
    try {
      store = new Store(filename)
      assert.equal(store.authenticate(token)!.memberId, created.memberId)
      const inspect = new DatabaseSync(filename)
      assert.equal(inspect.prepare('SELECT state FROM households').get()!.state, serialized)
      inspect.close()
      const recovery = store.rotateRecovery(store.authenticate(token)!, { version: 0, revokeOthers: false })
      assert.ok(recovery && recovery !== 'conflict')
      const account = store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop')
      const linked = store.accounts.link(account.session, { recoveryCode: recovery.code })
      assert.equal(linked.memberships[0].role, 'owner')
      const invitation = store.accounts.invite(account.session, created.household.id, linked.session!.household.version, 7)
      store.close()
      store = new Store(filename)
      const restored = store.accounts.authenticate(account.token)!
      assert.equal(restored.id, account.session.id)
      assert.equal(store.accounts.state(restored).session!.memberId, created.memberId)
      assert.ok(store.authenticate(token))
      assert.ok(store.recover(recovery.code, 'Restored legacy browser'))
      assert.equal(store.accounts.access(restored, created.household.id).invitations[0].id, invitation.invitation.id)
      const records = new DatabaseSync(filename)
      const accountRow = records.prepare('SELECT * FROM account_sessions').get()!
      const inviteRow = records.prepare('SELECT * FROM account_invitations').get()!
      assert.notEqual(accountRow.hash, account.token)
      assert.equal(accountRow.hash, createHash('sha256').update(account.token).digest('hex'))
      assert.ok(!JSON.stringify(accountRow).includes(account.token))
      assert.ok(!JSON.stringify(inviteRow).includes(invitation.code))
      records.close()
      const another = store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ben', 'Phone')
      const accepted = store.accounts.accept(another.session, invitation.code, 'Ben')
      const again = store.accounts.accept(another.session, invitation.code, 'Ignored')
      assert.equal(again.session!.memberId, accepted.session!.memberId)
      assert.equal(again.session!.household.version, accepted.session!.household.version)
      store.close()
      store = new Store(filename)
      const owner = store.accounts.authenticate(account.token)!
      assert.equal(store.accounts.access(owner, created.household.id).invitations[0].uses, 1)
      assert.equal(store.accounts.state(owner).session!.household.members.length, 2)
    } finally {
      store?.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('persists a provider-deletion barrier across restarts and finalizes historical members without altering money', () => {
    const directory = join(process.cwd(), `.accounts-deletion-${randomUUID()}`)
    mkdirSync(directory)
    const filename = join(directory, 'kitchen.sqlite')
    let store = new Store(filename)
    try {
      const account = store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop')
      const created = store.accounts.createHousehold(account.session, { name: 'Our kitchen', memberName: 'Ada', currency: 'EUR', budget: 10000 })
      const household = created.session!.household
      household.expenses.push({
        id: randomUUID(), description: 'Retained text', paidBy: created.session!.memberId,
        participants: [created.session!.memberId], amount: 123, category: 'pantry', date: '2026-09-01', createdAt: new Date().toISOString(),
      })
      store.save(household)
      const before = balances(household)
      store.accounts.beginDeletion(account.session, 'ada@example.com')
      store.close()
      store = new Store(filename)
      const pending = store.accounts.authenticate(account.token)!
      assert.ok(pending.deleting)
      assert.throws(() => store.accounts.household(pending, household.id))
      assert.equal(store.accounts.pendingDeletions().length, 1)
      store.accounts.finishDeletion(pending.accountId)
      assert.equal(store.accounts.authenticate(account.token), null)
      assert.deepEqual(balances(store.get(household.id)!), before)
      assert.deepEqual(store.get(household.id)!.expenses, household.expenses)
      assert.equal(store.get(household.id)!.members[0].name, 'Former roommate 1')
      const inspect = new DatabaseSync(filename)
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM accounts').get()!.count, 0)
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM account_sessions').get()!.count, 0)
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM account_memberships').get()!.count, 0)
      inspect.close()
    } finally {
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rolls membership mutations back when saving the household fails', () => {
    const store = new Store(':memory:')
    try {
      const owner = store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop')
      const created = store.accounts.createHousehold(owner.session, { name: 'Our kitchen', memberName: 'Ada', currency: 'EUR', budget: 10000 })
      const household = created.session!.household
      const invite = store.accounts.invite(owner.session, household.id, household.version, 7)
      const member = store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ben', 'Phone')
      const joined = store.accounts.accept(member.session, invite.code, 'Ben')
      const legacy = store.session(joined.session!.household, joined.session!.memberId)
      const before = store.get(household.id)!
      const originalSave = store.save.bind(store)
      store.save = () => { throw new Error('Simulated persistence failure') }
      assert.throws(() => store.accounts.remove(owner.session, household.id, joined.session!.memberId, before.version))
      store.save = originalSave
      assert.ok(store.authenticate(legacy.token))
      assert.equal(store.accounts.state(member.session).memberships.length, 1)
      assert.deepEqual(store.get(household.id), before)
      assert.equal(store.accounts.access(owner.session, household.id).invitations[0].uses, 1)
    } finally {
      store.close()
    }
  })
})
