import { describe, it } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { accountRoleSchema } from '../shared/accounts.ts'
import { roomAccessSchema, roomRoleChangeSchema } from '../shared/roomAccess.ts'
import type { DelegatedRoomRole } from '../shared/roomAccess.ts'
import { memberColors } from '../shared/domain.ts'
import type { Household } from '../shared/domain.ts'
import { ApiError } from '../server/errors.ts'
import { SQLiteDatabase } from '../server/database.ts'
import { Store } from '../server/store.ts'

async function fixture(t: TestContext) {
  const db = new SQLiteDatabase(':memory:')
  const store = new Store(db)
  t.after(() => store.close())
  const owner = await store.create('Shared home', 'Ada', 'EUR', 45000)
  const household = owner.household
  const ben = { id: randomUUID(), name: 'Ben', color: memberColors[1] }
  const cy = { id: randomUUID(), name: 'Cy', color: memberColors[2] }
  household.members.push(ben, cy)
  await store.save(household)
  const browser = await store.session(household, ben.id)
  const current = async () => (await store.get(household.id))!
  const change = async (actor: string, target: string, role: DelegatedRoomRole) => store.transaction(async () => {
    const next = await current()
    await store.accounts.setRoomRole(next, actor, target, role)
    next.version++
    await store.save(next)
    return next
  })
  return { db, store, owner, household, ben, cy, browser, current, change }
}

const status = (expected: number) => (error: unknown) => error instanceof ApiError && error.status === expected

describe('room permission contracts', () => {
  it('represents owner, delegated admin and member without accepting ownership mutations', () => {
    for (const role of ['owner', 'admin', 'member']) assert.equal(accountRoleSchema.parse(role), role)
    for (const role of ['admin', 'member']) assert.deepEqual(roomRoleChangeSchema.parse({ role, version: 0 }), { role, version: 0 })
    for (const input of [
      { role: 'owner', version: 0 }, { role: 'admin', version: -1 },
      { role: 'admin', version: 0, mutationId: randomUUID() },
      { role: 'admin', version: 0, mutationVersion: 0 },
      { role: 'admin', version: 0, mutationId: randomUUID(), mutationVersion: 1 },
    ]) assert.equal(roomRoleChangeSchema.safeParse(input).success, false)
    assert.equal(roomRoleChangeSchema.safeParse({ role: 'admin', version: 3, mutationId: randomUUID(), mutationVersion: 1 }).success, true)
  })

  it('requires one active authenticated identity and an unambiguous server role roster', () => {
    const householdId = randomUUID()
    const memberId = randomUUID()
    const member = { memberId, name: 'Ada', role: 'owner' as const, active: true }
    const access = { householdId, memberId, version: 0, role: 'owner', members: [member] }
    assert.equal(roomAccessSchema.safeParse(access).success, true)
    for (const invalid of [
      { ...access, role: 'admin' }, { ...access, memberId: randomUUID() },
      { ...access, members: [{ ...member, active: false }] },
      { ...access, members: [member, member] },
      { ...access, members: [member, { ...member, memberId: randomUUID() }] },
      { ...access, members: [member, { ...member, memberId: randomUUID(), role: 'admin', active: false }] },
    ]) assert.equal(roomAccessSchema.safeParse(invalid).success, false)
  })
})

describe('trusted room administration', () => {
  it('keeps browser-only kitchens unmanaged and ignores names, reordered arguments and supplied role fields', async (t) => {
    const f = await fixture(t)
    assert.equal(await f.store.accounts.roomRole(f.household, f.owner.memberId), 'owner')
    assert.equal(await f.store.accounts.roomRole(f.household, f.ben.id), 'member')
    assert.equal(await f.store.accounts.isManaged(f.household.id), false)
    const forged = {
      ...structuredClone(f.household), ownerMemberId: f.ben.id, role: 'owner',
      members: [{ ...f.ben, name: 'Ada', role: 'owner' }, ...f.household.members.filter((member) => member.id !== f.ben.id)],
    }
    assert.equal(await f.store.accounts.roomRole(forged, f.ben.id), 'member')
    await f.change(f.owner.memberId, f.ben.id, 'admin')
    assert.equal(await f.store.accounts.roomRole(forged, f.ben.id), 'admin')
    assert.equal(await f.store.accounts.isManaged(f.household.id), false)
    const saved = await f.current()
    assert.ok(!JSON.stringify(saved).includes('"role"'))
    assert.equal(saved.members.find((member) => member.id === f.ben.id)?.name, 'Ben')
    const other = await f.store.create('Different home', 'Ben', 'EUR', 10000)
    await assert.rejects(f.store.accounts.roomRole(other.household, f.ben.id), status(403))
    await assert.rejects(f.store.accounts.roomRole({ ...saved, id: randomUUID() }, f.ben.id), status(403))
  })

  it('lets admins grant and revoke peers, including themselves, but never alter the owner', async (t) => {
    const f = await fixture(t)
    await assert.rejects(f.change(f.ben.id, f.cy.id, 'admin'), status(403))
    await f.change(f.owner.memberId, f.ben.id, 'admin')
    await f.change(f.ben.id, f.cy.id, 'admin')
    assert.equal(await f.store.accounts.roomRole(f.household, f.cy.id), 'admin')
    for (const actor of [f.owner.memberId, f.ben.id, f.cy.id]) {
      for (const role of ['admin', 'member'] as const) await assert.rejects(f.change(actor, f.owner.memberId, role), status(409))
    }
    await assert.rejects(f.change(f.ben.id, f.cy.id, 'admin'), /already an admin/)
    await f.change(f.cy.id, f.ben.id, 'member')
    await assert.rejects(f.change(f.cy.id, f.ben.id, 'member'), /already a member/)
    await assert.rejects(f.change(f.ben.id, f.cy.id, 'member'), status(403))
    await f.change(f.cy.id, f.cy.id, 'member')
    assert.equal(await f.store.accounts.roomRole(f.household, f.owner.memberId), 'owner')
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM household_room_admins').get())?.count, 0)
  })

  it('captures the original creator before reordering and preserves ownership when a different roommate links first', async (t) => {
    const f = await fixture(t)
    const initialOwner = await f.db.prepare('SELECT member_id FROM household_room_owners WHERE household_id = ?').get(f.household.id)
    assert.equal(initialOwner?.member_id, f.owner.memberId)
    const rearranged = await f.current()
    rearranged.members.reverse()
    await f.store.save(rearranged)
    const ben = await f.store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ada', 'Phone')
    await f.change(f.owner.memberId, f.ben.id, 'admin')
    const linked = await f.store.accounts.link(ben.session, { token: f.browser.token })
    assert.equal(linked.session?.memberId, f.ben.id)
    assert.equal(linked.memberships[0].role, 'admin')
    assert.equal(await f.store.accounts.roomRole(rearranged, f.owner.memberId), 'owner')
    const benAccess = await f.store.accounts.access(ben.session, f.household.id)
    assert.equal(benAccess.members.find((member) => member.role === 'owner')?.memberId, f.owner.memberId)
    assert.equal(benAccess.role, 'admin')
    assert.deepEqual(benAccess.invitations, [])
    const owner = await f.store.accounts.signIn({ providerId: randomUUID(), email: 'owner@example.com' }, 'Ben', 'Laptop')
    const ownerLinked = await f.store.accounts.link(owner.session, { token: f.owner.token })
    assert.equal(ownerLinked.memberships[0].role, 'owner')
  })

  it('checks current active account membership even when a stale household or legacy token remains available', async (t) => {
    const f = await fixture(t)
    await f.change(f.owner.memberId, f.ben.id, 'admin')
    const account = await f.store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ben', 'Phone')
    await f.store.accounts.link(account.session, { token: f.browser.token })
    await f.db.prepare('UPDATE account_memberships SET active = 0 WHERE household_id = ? AND member_id = ?').run(f.household.id, f.ben.id)
    await assert.rejects(f.store.accounts.roomRole(f.household, f.ben.id), status(403))
    await assert.rejects(f.change(f.owner.memberId, f.ben.id, 'member'), status(404))
    const access = await f.store.accounts.roomAccess(f.household, f.owner.memberId)
    assert.deepEqual(access.members.find((member) => member.memberId === f.ben.id), {
      memberId: f.ben.id, name: 'Ben', role: 'member', active: false,
    })
    await f.db.prepare('UPDATE account_memberships SET active = 1 WHERE household_id = ? AND member_id = ?').run(f.household.id, f.ben.id)
    await f.db.prepare('UPDATE accounts SET deleting = 1 WHERE id = ?').run(account.session.accountId)
    await assert.rejects(f.store.accounts.roomRole(f.household, f.ben.id), status(403))
  })

  it('clears delegated rights when saved members become inactive or disappear, so reactivation never restores them', async (t) => {
    const f = await fixture(t)
    await f.change(f.owner.memberId, f.ben.id, 'admin')
    const inactive = await f.current()
    inactive.members.find((member) => member.id === f.ben.id)!.inactive = true
    await f.store.save(inactive)
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM household_room_admins').get())?.count, 0)
    await assert.rejects(f.store.accounts.roomRole(f.household, f.ben.id), status(403))
    inactive.members.find((member) => member.id === f.ben.id)!.inactive = false
    await f.store.save(inactive)
    assert.equal(await f.store.accounts.roomRole(f.household, f.ben.id), 'member')
    await f.change(f.owner.memberId, f.cy.id, 'admin')
    const removed = await f.current()
    removed.members = removed.members.filter((member) => member.id !== f.cy.id)
    await f.store.save(removed)
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM household_room_admins').get())?.count, 0)
  })

  for (const departure of ['leave', 'remove', 'delete'] as const) {
    it(`revokes delegated permissions and legacy proofs on ${departure}, without changing financial history`, async (t) => {
      const f = await fixture(t)
      const owner = await f.store.accounts.signIn({ providerId: randomUUID(), email: 'owner@example.com' }, 'Ada', 'Laptop')
      await f.store.accounts.link(owner.session, { token: f.owner.token })
      const ben = await f.store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ben', 'Phone')
      await f.store.accounts.link(ben.session, { token: f.browser.token })
      const ledger = await f.current()
      ledger.expenses.push({
        id: randomUUID(), description: 'Existing groceries', amount: 1001, paidBy: f.owner.memberId,
        participants: [f.owner.memberId, f.ben.id], category: 'pantry', date: '2026-09-01', createdAt: new Date().toISOString(),
      })
      await f.store.save(ledger)
      const browser = (await f.store.authenticate(f.browser.token))!
      const recovery = await f.store.rotateRecovery(browser, { version: 0, revokeOthers: false })
      assert.ok(recovery && recovery !== 'conflict')
      const before = await f.change(f.owner.memberId, f.ben.id, 'admin')
      if (departure === 'leave') await f.store.accounts.leave(ben.session, before.id, before.version)
      if (departure === 'remove') await f.store.accounts.remove(owner.session, before.id, f.ben.id, before.version)
      if (departure === 'delete') await f.store.accounts.beginDeletion(ben.session, 'ben@example.com')
      assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM household_room_admins').get())?.count, 0)
      await assert.rejects(f.store.accounts.roomRole(before, f.ben.id), status(403))
      assert.equal(await f.store.authenticate(f.browser.token), null)
      assert.equal(await f.store.recover(recovery.code, 'Old proof'), null)
      const after = await f.current()
      assert.deepEqual(after.expenses, before.expenses)
      assert.deepEqual(after.settlements, before.settlements)
      if (departure !== 'delete') {
        const invitation = await f.store.accounts.invite(owner.session, before.id, after.version, 7)
        const rejoined = await f.store.accounts.accept(ben.session, invitation.code, 'Ben')
        assert.equal(rejoined.session?.memberId, f.ben.id)
        assert.equal(rejoined.memberships[0].role, 'member')
        assert.equal(await f.store.accounts.roomRole(before, f.ben.id), 'member')
      } else {
        await f.store.accounts.finishDeletion(ben.session.accountId)
        assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM household_room_admins').get())?.count, 0)
      }
    })
  }

  it('transfers ownership without keeping a latent delegated role and never falls back from a closed managed owner', async (t) => {
    const f = await fixture(t)
    const owner = await f.store.accounts.signIn({ providerId: randomUUID(), email: 'owner@example.com' }, 'Ada', 'Laptop')
    await f.store.accounts.link(owner.session, { token: f.owner.token })
    const ben = await f.store.accounts.signIn({ providerId: randomUUID(), email: 'ben@example.com' }, 'Ben', 'Phone')
    await f.store.accounts.link(ben.session, { token: f.browser.token })
    const promoted = await f.change(f.owner.memberId, f.ben.id, 'admin')
    const transferred = await f.store.accounts.transfer(owner.session, promoted.id, f.ben.id, promoted.version)
    assert.equal(transferred.role, 'member')
    assert.equal(await f.store.accounts.roomRole(promoted, f.ben.id), 'owner')
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM household_room_admins').get())?.count, 0)
    await f.store.accounts.transfer(ben.session, promoted.id, f.owner.memberId, transferred.household.version)
    assert.equal(await f.store.accounts.roomRole(promoted, f.ben.id), 'member')
    await f.db.prepare('UPDATE household_accounts SET owner_member_id = NULL WHERE household_id = ?').run(promoted.id)
    assert.equal(await f.store.accounts.roomRole(promoted, f.owner.memberId), 'member')
    assert.equal((await f.store.accounts.roomAccess(promoted, f.ben.id)).members.some((member) => member.role === 'owner'), false)
  })

  it('rolls role changes back together with a rejected household save', async (t) => {
    const f = await fixture(t)
    const before: Household = await f.current()
    const failing = t.mock.method(f.store, 'save', async () => { throw new Error('Simulated permission save failure') })
    await assert.rejects(f.change(f.owner.memberId, f.ben.id, 'admin'), /Simulated permission save failure/)
    failing.mock.restore()
    assert.equal(await f.store.accounts.roomRole(before, f.ben.id), 'member')
    assert.deepEqual(await f.current(), before)
    await f.change(f.owner.memberId, f.ben.id, 'admin')
    assert.equal(await f.store.accounts.roomRole(before, f.ben.id), 'admin')
  })
})
