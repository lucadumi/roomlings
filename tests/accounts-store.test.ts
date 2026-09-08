import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../server/store.ts'
import { SQLiteDatabase } from '../server/database.ts'
import { activeMemberLimit, balances, householdSchema, memberColors, retainedMemberLimit } from '../shared/domain.ts'

describe('account persistence and migration', () => {
  it('persists account creation receipts through household saves and fresh account sessions after restart', async () => {
    const directory = join(process.cwd(), `.accounts-creation-${randomUUID()}`)
    mkdirSync(directory)
    const filename = join(directory, 'kitchen.sqlite')
    let store = new Store(filename)
    try {
      const identity = { providerId: randomUUID(), email: 'ada@example.com' }
      const owner = await store.accounts.signIn(identity, 'Ada', 'Laptop')
      const input = { requestId: randomUUID(), name: 'Our kitchen', memberName: 'Ada', currency: 'EUR' as const, budget: 10000 }
      const first = await store.accounts.createHousehold(owner.session, input)
      const household = first.session!.household
      household.name = 'Updated kitchen'
      household.version++
      const clientState = {
        ...household,
        accountCreationReceipt: { requestId: randomUUID(), memberId: first.session!.memberId, payloadHash: '0'.repeat(64) },
      }
      await store.save(clientState)
      const invitation = await store.accounts.invite(owner.session, household.id, household.version, 7)
      await store.close()
      store = new Store(filename)
      const fresh = await store.accounts.signIn(identity, 'Ada', 'Different browser')
      const replay = await store.accounts.createHousehold(fresh.session, input)
      assert.equal(replay.memberships.length, 1)
      assert.equal(replay.session?.household.id, household.id)
      assert.equal(replay.session?.memberId, first.session?.memberId)
      assert.equal(replay.session?.household.name, household.name)
      assert.equal(replay.session?.household.version, invitation.access.household.version)
      assert.ok(!JSON.stringify(replay).includes('accountCreationReceipt'))
      const inspect = new DatabaseSync(filename, { readOnly: true })
      try {
        const saved = JSON.parse(String(inspect.prepare('SELECT state FROM households WHERE id = ?').get(household.id)?.state))
        assert.equal(saved.accountCreationReceipt.requestId, input.requestId)
        assert.equal(saved.accountCreationReceipt.memberId, first.session?.memberId)
        assert.match(saved.accountCreationReceipt.payloadHash, /^[a-f0-9]{64}$/)
      } finally {
        inspect.close()
      }
    } finally {
      await store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rolls back account creation receipts with an undeliverable account state and permits a safe retry', async (t) => {
    const db = new SQLiteDatabase(':memory:')
    const store = new Store(db)
    try {
      const owner = await store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop')
      const input = { requestId: randomUUID(), name: 'Our kitchen', memberName: 'Ada', currency: 'EUR' as const, budget: 10000 }
      const failure = t.mock.method(store.accounts, 'state', async () => { throw new Error('Simulated creation response failure') })
      await assert.rejects(store.accounts.createHousehold(owner.session, input), /Simulated creation response failure/)
      failure.mock.restore()
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM households').get())?.count, 0)
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM account_memberships').get())?.count, 0)
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM sessions').get())?.count, 0)
      const first = await store.accounts.createHousehold(owner.session, input)
      const replay = await store.accounts.createHousehold(owner.session, input)
      assert.equal(replay.session?.household.id, first.session?.household.id)
      assert.equal(replay.memberships.length, 1)
    } finally {
      await store.close()
    }
  })

  it('reopens a successful creation at the account kitchen limit without recreating a closed kitchen', async () => {
    const store = new Store(':memory:')
    try {
      const owner = await store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop')
      const input = { requestId: randomUUID(), name: 'Our kitchen', memberName: 'Ada', currency: 'EUR' as const, budget: 10000 }
      const first = await store.accounts.createHousehold(owner.session, input)
      for (let index = 1; index < 50; index++) {
        await store.accounts.createHousehold(owner.session, { ...input, requestId: randomUUID(), name: `Kitchen ${index}` })
      }
      const replay = await store.accounts.createHousehold(owner.session, input)
      assert.equal(replay.memberships.length, 50)
      assert.equal(replay.session?.household.id, first.session?.household.id)
      await store.accounts.leave(owner.session, first.session!.household.id, first.session!.household.version)
      await assert.rejects(store.accounts.createHousehold(owner.session, input), /active access/)
      assert.equal((await store.accounts.state(owner.session)).memberships.length, 49)
      const separate = await store.accounts.createHousehold(owner.session, { ...input, requestId: randomUUID() })
      assert.notEqual(separate.session?.household.id, first.session?.household.id)
      assert.equal(separate.memberships.length, 50)
    } finally {
      await store.close()
    }
  })

  it('applies the kitchen limit to browser linking without preventing an existing link from reopening', async () => {
    const store = new Store(':memory:')
    try {
      const account = await store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop')
      const linked = await store.create('Linked kitchen', 'Ada', 'EUR', 10000)
      await store.accounts.link(account.session, { token: linked.token })
      for (let index = 1; index < 50; index++) {
        await store.accounts.createHousehold(account.session, {
          name: `Kitchen ${index}`, memberName: 'Ada', currency: 'EUR', budget: 10000,
        })
      }
      const overflow = await store.create('Another browser kitchen', 'Ada', 'EUR', 10000)
      const browser = await store.authenticate(overflow.token)
      assert.ok(browser)
      const recovery = await store.rotateRecovery(browser, { version: 0, revokeOthers: false })
      assert.ok(recovery && recovery !== 'conflict')
      for (const proof of [{ token: overflow.token }, { recoveryCode: recovery.code }]) {
        await assert.rejects(store.accounts.link(account.session, proof), /50 kitchens/)
        assert.equal(await store.accounts.isManaged(overflow.household.id), false)
        assert.deepEqual(await store.get(overflow.household.id), overflow.household)
      }
      const reopened = await store.accounts.link(account.session, { token: linked.token })
      assert.equal(reopened.memberships.length, 50)
      assert.equal(reopened.session?.memberId, linked.memberId)
      await store.accounts.leave(account.session, linked.household.id, reopened.session!.household.version)
      const accepted = await store.accounts.link(account.session, { recoveryCode: recovery.code })
      assert.equal(accepted.memberships.length, 50)
      assert.equal(accepted.session?.memberId, overflow.memberId)
    } finally {
      await store.close()
    }
  })

  it('releases active seats while retaining former members, balances, and bill schedules beyond twelve identities', async () => {
    const store = new Store(':memory:')
    try {
      const owner = (await store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop'))
      const created = (await store.accounts.createHousehold(owner.session, { name: 'Changing roommates', memberName: 'Ada', currency: 'EUR', budget: 10000 }))
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
      await store.save(household)
      const before = structuredClone(household)
      const invitation = (await store.accounts.invite(owner.session, household.id, household.version, 7))
      const newcomer = (await store.accounts.signIn({ providerId: randomUUID(), email: 'new@example.com' }, 'New roommate', 'Phone'))
      await assert.rejects(async () => (await store.accounts.accept(newcomer.session, invitation.code, 'New roommate')), /12 active roommates/)
      const removed = (await store.accounts.remove(owner.session, household.id, departing, invitation.access.household.version))
      assert.equal(removed.members.filter((member) => member.active).length, 11)
      const joined = (await store.accounts.accept(newcomer.session, invitation.code, 'New roommate'))
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
      await store.close()
    }
  })

  it('bounds retained history at 200 identities while allowing former members to reuse an available active seat', async () => {
    const store = new Store(':memory:')
    try {
      const owner = (await store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop'))
      const created = (await store.accounts.createHousehold(owner.session, { name: 'Long-lived kitchen', memberName: 'Ada', currency: 'EUR', budget: 10000 }))
      const initial = created.session!.household
      const invitation = (await store.accounts.invite(owner.session, initial.id, initial.version, 7))
      const former = (await store.accounts.signIn({ providerId: randomUUID(), email: 'former@example.com' }, 'Former', 'Phone'))
      const joined = (await store.accounts.accept(former.session, invitation.code, 'Former'))
      const memberId = joined.session!.memberId
      await store.accounts.leave(former.session, initial.id, joined.session!.household.version)
      const household = (await store.get(initial.id))!
      while (household.members.length < retainedMemberLimit) {
        household.members.push({
          id: randomUUID(), name: `Archived roommate ${household.members.length}`,
          color: memberColors[0], inactive: true,
        })
      }
      assert.equal(householdSchema.safeParse(household).success, true)
      await store.save(household)
      const fresh = (await store.accounts.invite(owner.session, initial.id, household.version, 7))
      const newcomer = (await store.accounts.signIn({ providerId: randomUUID(), email: 'new@example.com' }, 'New', 'Tablet'))
      await assert.rejects(async () => (await store.accounts.accept(newcomer.session, fresh.code, 'New')), /200-identity history limit/)
      const full = (await store.get(initial.id))!
      for (const member of full.members.slice(2, activeMemberLimit + 1)) member.inactive = false
      await store.save(full)
      await assert.rejects(async () => (await store.accounts.accept(former.session, fresh.code, 'Former')), /12 active roommates/)
      full.members[2].inactive = true
      await store.save(full)
      const rejoined = (await store.accounts.accept(former.session, fresh.code, 'Former'))
      assert.equal(rejoined.session!.memberId, memberId)
      assert.equal(rejoined.session!.household.members.length, retainedMemberLimit)
      assert.equal(rejoined.session!.household.members.filter((member) => !member.inactive).length, activeMemberLimit)
      const invalid = structuredClone(rejoined.session!.household)
      invalid.members.push({ id: randomUUID(), name: 'One too many', color: memberColors[0], inactive: true })
      assert.equal(householdSchema.safeParse(invalid).success, false)
    } finally {
      await store.close()
    }
  })

  it('migrates the original database without replacing legacy JSON, sessions, or proof ownership', async () => {
    const directory = join(process.cwd(), `.accounts-migration-${randomUUID()}`)
    mkdirSync(directory)
    const filename = join(directory, 'kitchen.sqlite')
    const memory = new Store(':memory:')
    const created = (await memory.create('Old kitchen', 'Ada', 'EUR', 30000))
    await memory.close()
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
      assert.equal((await store.authenticate(token))!.memberId, created.memberId)
      const inspect = new DatabaseSync(filename)
      assert.equal(inspect.prepare('SELECT state FROM households').get()!.state, serialized)
      inspect.close()
      const recovery = (await store.rotateRecovery((await store.authenticate(token))!, { version: 0, revokeOthers: false }))
      assert.ok(recovery && recovery !== 'conflict')
      const account = (await store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop'))
      const linked = (await store.accounts.link(account.session, { recoveryCode: recovery.code }))
      assert.equal(linked.memberships[0].role, 'owner')
      const invitation = (await store.accounts.invite(account.session, created.household.id, linked.session!.household.version, 7))
      await store.close()
      store = new Store(filename)
      const restored = (await store.accounts.authenticate(account.token))!
      assert.equal(restored.id, account.session.id)
      assert.equal((await store.accounts.state(restored)).session!.memberId, created.memberId)
      assert.ok((await store.authenticate(token)))
      assert.ok((await store.recover(recovery.code, 'Restored legacy browser')))
      assert.equal((await store.accounts.access(restored, created.household.id)).invitations[0].id, invitation.invitation.id)
      const records = new DatabaseSync(filename)
      const accountRow = records.prepare('SELECT * FROM account_sessions').get()!
      const inviteRow = records.prepare('SELECT * FROM account_invitations').get()!
      assert.notEqual(accountRow.hash, account.token)
      assert.equal(accountRow.hash, createHash('sha256').update(account.token).digest('hex'))
      assert.ok(!JSON.stringify(accountRow).includes(account.token))
      assert.ok(!JSON.stringify(inviteRow).includes(invitation.code))
      records.close()
      const another = (await store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ben', 'Phone'))
      const accepted = (await store.accounts.accept(another.session, invitation.code, 'Ben'))
      const again = (await store.accounts.accept(another.session, invitation.code, 'Ignored'))
      assert.equal(again.session!.memberId, accepted.session!.memberId)
      assert.equal(again.session!.household.version, accepted.session!.household.version)
      await store.close()
      store = new Store(filename)
      const owner = (await store.accounts.authenticate(account.token))!
      assert.equal((await store.accounts.access(owner, created.household.id)).invitations[0].uses, 1)
      assert.equal((await store.accounts.state(owner)).session!.household.members.length, 2)
    } finally {
      await store?.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('persists a provider-deletion barrier across restarts and finalizes historical members without altering money', async () => {
    const directory = join(process.cwd(), `.accounts-deletion-${randomUUID()}`)
    mkdirSync(directory)
    const filename = join(directory, 'kitchen.sqlite')
    let store = new Store(filename)
    try {
      const account = (await store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop'))
      const created = (await store.accounts.createHousehold(account.session, { name: 'Our kitchen', memberName: 'Ada', currency: 'EUR', budget: 10000 }))
      const household = created.session!.household
      household.expenses.push({
        id: randomUUID(), description: 'Retained text', paidBy: created.session!.memberId,
        participants: [created.session!.memberId], amount: 123, category: 'pantry', date: '2026-09-01', createdAt: new Date().toISOString(),
      })
      await store.save(household)
      const before = balances(household)
      await store.accounts.beginDeletion(account.session, 'ada@example.com')
      await store.close()
      store = new Store(filename)
      const pending = (await store.accounts.authenticate(account.token))!
      assert.ok(pending.deleting)
      await assert.rejects(async () => (await store.accounts.household(pending, household.id)))
      assert.equal((await store.accounts.pendingDeletions()).length, 1)
      await store.accounts.finishDeletion(pending.accountId)
      assert.equal((await store.accounts.authenticate(account.token)), null)
      assert.deepEqual(balances((await store.get(household.id))!), before)
      assert.deepEqual((await store.get(household.id))!.expenses, household.expenses)
      assert.equal((await store.get(household.id))!.members[0].name, 'Former roommate 1')
      const inspect = new DatabaseSync(filename)
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM accounts').get()!.count, 0)
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM account_sessions').get()!.count, 0)
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM account_memberships').get()!.count, 0)
      inspect.close()
    } finally {
      await store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rolls membership mutations back when saving the household fails', async () => {
    const store = new Store(':memory:')
    try {
      const owner = (await store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Laptop'))
      const created = (await store.accounts.createHousehold(owner.session, { name: 'Our kitchen', memberName: 'Ada', currency: 'EUR', budget: 10000 }))
      const household = created.session!.household
      const invite = (await store.accounts.invite(owner.session, household.id, household.version, 7))
      const member = (await store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ben', 'Phone'))
      const joined = (await store.accounts.accept(member.session, invite.code, 'Ben'))
      const legacy = (await store.session(joined.session!.household, joined.session!.memberId))
      const before = (await store.get(household.id))!
      const originalSave = store.save.bind(store)
      store.save = () => { throw new Error('Simulated persistence failure') }
      await assert.rejects(async () => (await store.accounts.remove(owner.session, household.id, joined.session!.memberId, before.version)))
      store.save = originalSave
      assert.ok((await store.authenticate(legacy.token)))
      assert.equal((await store.accounts.state(member.session)).memberships.length, 1)
      assert.deepEqual((await store.get(household.id)), before)
      assert.equal((await store.accounts.access(owner.session, household.id)).invitations[0].uses, 1)
    } finally {
      await store.close()
    }
  })
})
