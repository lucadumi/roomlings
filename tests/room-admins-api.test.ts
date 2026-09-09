import { describe, it } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { accountStateSchema, householdAccessSchema } from '../shared/accounts.ts'
import { householdSchema, memberColors } from '../shared/domain.ts'
import type { Session } from '../shared/domain.ts'
import { roomAccessSchema } from '../shared/roomAccess.ts'
import { createApp } from '../server/app.ts'
import { SQLiteDatabase } from '../server/database.ts'
import { Store } from '../server/store.ts'

type Actor = { token: string } | { cookie: string; csrf: string }
const householdResult = z.object({ household: householdSchema, replayed: z.boolean().optional() })

async function fixture(t: TestContext) {
  const db = new SQLiteDatabase(':memory:')
  const store = new Store(db)
  const provider = {
    async sendCode() {},
    async verifyCode(email: string) { return { providerId: randomUUID(), email } },
    async deleteUser() {},
  }
  const server = createApp(store, { provider, appOrigin: 'http://localhost:5173' }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  t.after(async () => {
    const closed = once(server, 'close')
    server.close()
    await closed
    await store.close()
  })
  const owner = await store.create('Shared admin home', 'Ada', 'EUR', 30000)
  const ben = { id: randomUUID(), name: 'Ben', color: memberColors[1] }
  const cy = { id: randomUUID(), name: 'Cy', color: memberColors[2] }
  owner.household.members.push(ben, cy)
  await store.save(owner.household)
  const roommate = await store.session(owner.household, ben.id)
  const third = await store.session(owner.household, cy.id)
  const current = async () => (await store.get(owner.household.id))!
  const call = async (path: string, body?: unknown, actor: Actor | null = owner, method = body === undefined ? 'GET' : 'PATCH',
    headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json', 'X-Roomlings-Request': '1', Origin: 'http://localhost:5173',
        ...(actor && 'token' in actor ? { Authorization: `Bearer ${actor.token}` } : {}),
        ...(actor && 'cookie' in actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data: unknown = await response.json()
    return { status: response.status, data }
  }
  const change = async (target: string, role: string, actor: Actor | null = owner, overrides: Record<string, unknown> = {}) =>
    call(`/household/room-access/${target}`, { role, version: (await current()).version, ...overrides }, actor)
  const access = async (actor: Actor = owner) => {
    const result = await call('/household/room-access', undefined, actor)
    assert.equal(result.status, 200, JSON.stringify(result.data))
    return roomAccessSchema.parse(result.data)
  }
  const account = async (legacy: Session, email: string) => {
    const signedIn = await store.accounts.signIn({ providerId: randomUUID(), email }, 'Same profile name', 'Test browser')
    await store.accounts.link(signedIn.session, { token: legacy.token })
    return { cookie: `roomlings_session=${signedIn.token}`, csrf: signedIn.session.csrfToken }
  }
  return { db, store, owner, roommate, third, current, call, change, access, account }
}

describe('household room-access HTTP permissions', () => {
  it('returns the same versioned role roster to authenticated browser and account identities without granting ownership by name', async (t) => {
    const f = await fixture(t)
    assert.equal((await f.call('/household/room-access', undefined, null)).status, 401)
    const owner = await f.access()
    assert.equal(owner.role, 'owner')
    assert.equal(owner.householdId, f.owner.household.id)
    assert.equal(owner.memberId, f.owner.memberId)
    assert.equal(owner.version, (await f.current()).version)
    assert.equal((await f.access(f.roommate)).role, 'member')
    const memberAccount = await f.account(f.roommate, 'member@example.com')
    assert.equal((await f.access()).role, 'owner')
    assert.equal((await f.access(memberAccount)).role, 'member')
    assert.equal((await f.change(f.roommate.memberId, 'admin')).status, 200)
    const legacy = await f.access(f.roommate)
    assert.deepEqual(await f.access(memberAccount), legacy)
    assert.equal(legacy.role, 'admin')
    const state = await f.call('/account', undefined, memberAccount)
    assert.equal(accountStateSchema.parse(state.data).memberships[0].role, 'admin')
    const accountAccess = await f.call(`/account/households/${owner.householdId}`, undefined, memberAccount)
    const savedAccess = householdAccessSchema.parse(accountAccess.data)
    assert.equal(savedAccess.role, 'admin')
    assert.equal(savedAccess.members.find((member) => member.memberId === f.roommate.memberId)?.role, 'admin')
    assert.deepEqual(savedAccess.invitations, [])
    assert.ok(!JSON.stringify(legacy).includes(f.roommate.token))
    assert.ok(!JSON.stringify(legacy).includes('cookie'))
  })

  it('allows owners and delegated admins to manage active peers but rejects members and owner changes at the API', async (t) => {
    const f = await fixture(t)
    assert.equal((await f.change(f.third.memberId, 'admin', f.roommate)).status, 403)
    assert.equal((await f.change(f.roommate.memberId, 'admin')).status, 200)
    assert.equal((await f.change(f.third.memberId, 'admin', f.roommate)).status, 200)
    assert.equal((await f.access(f.third)).role, 'admin')
    for (const actor of [f.owner, f.roommate, f.third]) {
      for (const role of ['admin', 'member']) assert.equal((await f.change(f.owner.memberId, role, actor)).status, 409)
    }
    assert.equal((await f.change(f.roommate.memberId, 'member', f.third)).status, 200)
    assert.equal((await f.change(f.third.memberId, 'member', f.roommate)).status, 403)
    assert.equal((await f.change(f.third.memberId, 'member', f.third)).status, 200)
    const access = await f.access()
    assert.deepEqual(access.members.map((member) => member.role), ['owner', 'member', 'member'])
  })

  it('does not give admins owner-only invitation, member-removal or ownership-transfer powers', async (t) => {
    const f = await fixture(t)
    const owner = await f.account(f.owner, 'owner@example.com')
    const admin = await f.account(f.roommate, 'admin@example.com')
    assert.equal((await f.change(f.roommate.memberId, 'admin', owner)).status, 200)
    const household = await f.current()
    const invite = await f.call(`/account/households/${household.id}/invitations`, { version: household.version }, owner, 'POST')
    assert.equal(invite.status, 201)
    const invitationId = z.object({ invitation: z.object({ id: z.string() }) }).parse(invite.data).invitation.id
    const before = await f.current()
    for (const [path, method, extra] of [
      [`/account/households/${household.id}/invitations`, 'POST', {}],
      [`/account/households/${household.id}/invitations/${invitationId}`, 'DELETE', {}],
      [`/account/households/${household.id}/members/${f.third.memberId}`, 'DELETE', {}],
      [`/account/households/${household.id}/owner`, 'POST', { memberId: f.roommate.memberId }],
    ] as const) {
      const result = await f.call(path, { version: before.version, ...extra }, admin, method)
      assert.equal(result.status, 403, JSON.stringify(result.data))
    }
    assert.deepEqual(await f.current(), before)
    assert.equal((await f.change(f.third.memberId, 'admin', admin)).status, 200)
  })

  it('rejects inactive and cross-household targets, inactive actors, no-op roles and malformed requests without partial changes', async (t) => {
    const f = await fixture(t)
    const other = await f.store.create('Other home', 'Ben', 'EUR', 10000)
    const household = await f.current()
    household.members.find((member) => member.id === f.third.memberId)!.inactive = true
    await f.store.save(household)
    const before = await f.current()
    for (const [target, role, expected] of [
      [f.roommate.memberId, 'member', 409], [f.roommate.memberId, 'owner', 400],
      [f.roommate.memberId, 'administrator', 400], [f.third.memberId, 'admin', 404],
      [other.memberId, 'admin', 404], ['invalid-id', 'admin', 400],
    ] as const) assert.equal((await f.change(target, role)).status, expected)
    assert.equal((await f.change(f.roommate.memberId, 'admin', f.third)).status, 401)
    assert.equal((await f.change(f.roommate.memberId, 'admin', other)).status, 404)
    assert.equal((await f.change(f.roommate.memberId, 'admin', f.roommate, {
      ownerMemberId: f.roommate.memberId, householdId: other.household.id, admin: true,
    })).status, 403)
    for (const override of [
      { version: -1 }, { version: '0' }, { mutationId: randomUUID() }, { mutationVersion: before.version },
      { mutationId: randomUUID(), mutationVersion: before.version + 1 },
    ]) assert.equal((await f.change(f.roommate.memberId, 'admin', f.owner, override)).status, 400)
    assert.deepEqual(await f.current(), before)
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM household_room_admins').get())?.count, 0)
  })

  it('applies existing cookie/CSRF and explicit-household protections to delegation', async (t) => {
    const f = await fixture(t)
    const owner = await f.account(f.owner, 'owner@example.com')
    const before = await f.current()
    const path = `/household/room-access/${f.roommate.memberId}`
    const body = { role: 'admin', version: before.version }
    const rejectedHeaders: Record<string, string>[] = [
      { 'X-CSRF-Token': '' }, { 'X-Roomlings-Request': '' }, { Origin: 'https://outside.invalid' },
    ]
    for (const headers of rejectedHeaders) assert.equal((await f.call(path, body, owner, 'PATCH', headers)).status, 403)
    assert.equal((await f.call(path, body, owner, 'PATCH', { Authorization: 'Bearer forged-browser-access' })).status, 401)
    const other = await f.store.create('Independent home', 'Ada', 'EUR', 10000)
    assert.equal((await f.call(path, body, owner, 'PATCH', { 'X-Roomlings-Household': other.household.id })).status, 403)
    assert.deepEqual(await f.current(), before)
    assert.equal((await f.change(f.roommate.memberId, 'admin', owner)).status, 200)
  })

  it('serializes simultaneous/stale updates and immediately enforces a revoked actor role', async (t) => {
    const f = await fixture(t)
    const version = (await f.current()).version
    const responses = await Promise.all([f.roommate.memberId, f.third.memberId].map((id) =>
      f.call(`/household/room-access/${id}`, { role: 'admin', version })))
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
    const roster = await f.access()
    assert.equal(roster.version, version + 1)
    assert.equal(roster.members.filter((member) => member.role === 'admin').length, 1)
    const adminId = roster.members.find((member) => member.role === 'admin')!.memberId
    const admin = adminId === f.roommate.memberId ? f.roommate : f.third
    const peer = adminId === f.roommate.memberId ? f.third : f.roommate
    assert.equal((await f.change(adminId, 'member')).status, 200)
    assert.equal((await f.change(peer.memberId, 'admin', admin)).status, 403)
    assert.equal((await f.call(`/household/room-access/${peer.memberId}`, { role: 'admin', version })).status, 409)
    assert.equal((await f.access(peer)).role, 'member')
  })

  it('replays committed role changes once without restoring a later revocation or allowing altered payloads', async (t) => {
    const f = await fixture(t)
    const version = (await f.current()).version
    const body = { role: 'admin', version, mutationId: randomUUID(), mutationVersion: version }
    const path = `/household/room-access/${f.roommate.memberId}`
    const results = await Promise.all([f.call(path, body), f.call(path, body)])
    assert.deepEqual(results.map((result) => result.status), [200, 200])
    assert.equal(results.filter((result) => householdResult.parse(result.data).replayed).length, 1)
    assert.equal((await f.current()).version, version + 1)
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM household_room_admins').get())?.count, 1)
    assert.equal((await f.call(path, { ...body, role: 'member' })).status, 409)
    assert.equal((await f.call(path, body, f.third)).status, 409)
    assert.equal((await f.change(f.roommate.memberId, 'member')).status, 200)
    const beforeReplay = await f.current()
    const replay = await f.call(path, body)
    assert.equal(replay.status, 200)
    assert.equal(householdResult.parse(replay.data).replayed, true)
    assert.deepEqual(await f.current(), beforeReplay)
    assert.equal((await f.access(f.roommate)).role, 'member')
  })

  it('rolls back grants, revocations and mutation receipts when persistence fails, and permits a safe retry', async (t) => {
    const f = await fixture(t)
    for (const role of ['admin', 'member'] as const) {
      const before = await f.current()
      const beforeRole = role === 'admin' ? 'member' : 'admin'
      const body = { role, version: before.version, mutationId: randomUUID(), mutationVersion: before.version }
      const path = `/household/room-access/${f.roommate.memberId}`
      const failing = t.mock.method(f.store, 'save', async () => { throw new Error('Simulated role persistence failure') })
      assert.equal((await f.call(path, body)).status, 500)
      failing.mock.restore()
      assert.deepEqual(await f.current(), before)
      assert.equal((await f.access(f.roommate)).role, beforeRole)
      const saved = await f.call(path, body)
      assert.equal(saved.status, 200)
      assert.equal(householdResult.parse(saved.data).household.version, before.version + 1)
      assert.equal((await f.access(f.roommate)).role, role)
    }
  })
})
