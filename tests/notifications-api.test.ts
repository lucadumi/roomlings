import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { accountIdleLifetime } from '../server/accounts-store.ts'
import { notificationSettingsSchema } from '../shared/notifications.ts'
import { notificationFixture, testExpense } from './notifications-fixture.ts'

describe('native notification account endpoints', () => {
  it('persists separate member preferences without APNs or household version changes and never pretends to register', async (t) => {
    const f = await notificationFixture(t, { push: false })
    const { owner, household, ownerId } = await f.home()
    const path = `/account/households/${household.id}/notifications`
    const initial = await owner.request(path)
    assert.equal(initial.status, 200)
    assert.deepEqual(notificationSettingsSchema.parse(initial.data), {
      householdId: household.id, memberId: ownerId, preferences: { chores: true, money: true }, pushAvailable: false,
    })
    const changed = await owner.request(path, { chores: false, money: true }, 'PUT')
    assert.deepEqual(changed.data.preferences, { chores: false, money: true })
    assert.equal(changed.data.pushAvailable, false)
    assert.equal((await f.store.get(household.id))?.version, household.version)
    for (const body of [{ chores: true }, { chores: 'false', money: true }, { chores: true, money: false, version: 4 }]) {
      assert.equal((await owner.request(path, body, 'PUT')).status, 400)
    }
    const installationId = randomUUID()
    const registered = await owner.request('/account/push-devices', { installationId, token: 'ab', environment: 'sandbox' }, 'PUT')
    assert.equal(registered.status, 503)
    assert.equal(registered.data.code, 'PUSH_NOT_CONFIGURED')
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM push_devices').get())?.count), 0)
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual((await owner.request(`/account/push-devices/${installationId}`, undefined, 'DELETE')).data, { removed: true })
    }
    assert.equal((await owner.request('/expenses', testExpense(household, ownerId))).status, 200)
  })

  it('requires native bearer authentication, validates household access and rejects browser transport', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household } = await f.home()
    const path = `/account/households/${household.id}/notifications`
    const installationId = randomUUID()
    const registration = { installationId, token: 'ab', environment: 'sandbox' }
    for (const request of [
      () => f.call(path),
      () => f.call(path, { method: 'PUT', body: { chores: true, money: true } }),
      () => f.call('/account/push-devices', { method: 'PUT', body: registration }),
      () => f.call(`/account/push-devices/${installationId}`, { method: 'DELETE' }),
    ]) assert.equal((await request()).status, 401)
    assert.equal((await f.call(path, { native: false, token: owner.token })).status, 403)
    assert.equal((await f.call('/account/push-devices', {
      native: false, method: 'PUT', token: owner.token, body: registration, headers: { 'X-Roomlings-Request': '1' },
    })).data.code, 'NATIVE_CLIENT_REQUIRED')
    for (const headers of [{ Origin: 'https://browser.example' }, { 'Sec-Fetch-Site': 'same-origin' }] as Record<string, string>[]) {
      const response = await f.call('/account/push-devices', { method: 'PUT', token: owner.token, body: registration, headers })
      assert.equal(response.status, 403)
      assert.equal(response.data.code, 'NATIVE_CLIENT_REQUIRED')
    }
    const legacy = await f.store.create('Legacy', 'Separate', 'EUR', 2000)
    assert.equal((await f.call('/account/push-devices', { method: 'PUT', token: legacy.token, body: registration })).status, 401)
    const outsider = await f.signIn('outside@example.com')
    assert.equal((await outsider.request(path)).status, 403)
    assert.equal((await outsider.request(path, { chores: false, money: false }, 'PUT')).status, 403)
    assert.equal((await owner.request('/account/households/not-a-uuid/notifications')).status, 400)
    assert.equal((await owner.request(`/account/households/${randomUUID()}/notifications`)).status, 403)
    await f.store.accounts.leave(other.session, household.id, household.version)
    assert.equal((await other.request(path)).status, 403)
    assert.equal((await other.request(path, { chores: true, money: true }, 'PUT')).status, 403)
  })

  it('keeps preferences across reinstall, logout and membership rejoin without restoring queued deliveries', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household, otherId } = await f.home()
    const path = `/account/households/${household.id}/notifications`
    await other.request(path, { chores: false, money: false }, 'PUT')
    await f.register(other.session)
    await other.request('/account/logout', { all: false })
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM push_devices').get())?.count), 0)
    const installedAgain = await f.signIn('ben@example.com')
    assert.deepEqual((await installedAgain.request(path)).data.preferences, { chores: false, money: false })
    await f.register(installedAgain.session)
    await f.store.accounts.leave(installedAgain.session, household.id, household.version)
    const current = (await f.store.get(household.id))!
    const invitation = await f.store.accounts.invite(owner.session, current.id, current.version, 7)
    const restored = await f.store.accounts.accept(installedAgain.session, invitation.code, 'Ben')
    assert.equal(restored.session?.memberId, otherId)
    assert.deepEqual((await installedAgain.request(path)).data.preferences, { chores: false, money: false })
    assert.equal((await owner.request(path)).data.preferences.chores, true)
  })

  it('registers bounded variable token lengths, reports environment readiness and restricts idempotent deletion to the account', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household } = await f.home()
    assert.equal((await owner.request(`/account/households/${household.id}/notifications`)).data.pushAvailable, true)
    const installationId = randomUUID()
    const body = { installationId, token: 'AB'.repeat(37), environment: 'sandbox' }
    assert.deepEqual((await owner.request('/account/push-devices', body, 'PUT')).data, { registered: true })
    const stored = await f.db.prepare('SELECT * FROM push_devices WHERE installation_id = ?').get(installationId)
    assert.ok(stored)
    assert.equal(stored.account_id, owner.session.accountId)
    assert.equal(stored.session_id, owner.session.id)
    assert.ok(!JSON.stringify(stored).toLowerCase().includes(body.token.toLowerCase()))
    assert.deepEqual((await other.request(`/account/push-devices/${installationId}`, undefined, 'DELETE')).data, { removed: true })
    assert.ok(await f.db.prepare('SELECT 1 FROM push_devices WHERE installation_id = ?').get(installationId))
    for (const token of ['', 'a', 'aaa', 'ax', ' aa', 'ab'.repeat(513)]) {
      assert.equal((await owner.request('/account/push-devices', { ...body, token }, 'PUT')).status, 400)
    }
    assert.equal((await owner.request('/account/push-devices', { ...body, accountId: other.session.accountId }, 'PUT')).status, 400)
    for (const token of ['ab', 'ab'.repeat(512)]) {
      assert.equal((await owner.request('/account/push-devices', { ...body, token }, 'PUT')).status, 200)
    }
    f.provider.environments.delete('production')
    const missingEnvironment = await owner.request('/account/push-devices', { ...body, environment: 'production' }, 'PUT')
    assert.equal(missingEnvironment.status, 503)
    assert.equal(missingEnvironment.data.code, 'PUSH_NOT_CONFIGURED')
    for (let index = 0; index < 2; index++) {
      assert.deepEqual((await owner.request(`/account/push-devices/${installationId}`, undefined, 'DELETE')).data, { removed: true })
    }
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM push_devices').get())?.count), 0)
  })

  it('revokes registrations on current/all logout, device revocation, session expiry and deletion barriers', async (t) => {
    const f = await notificationFixture(t)
    const { other } = await f.home()
    const replacement = await f.signIn('ben@example.com')
    await f.register(other.session)
    await f.register(replacement.session)
    await f.store.accounts.revokeDevice(replacement.session, other.session.id)
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM push_devices').get())?.count), 1)
    await f.store.accounts.logout(replacement.session, true)
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM push_devices').get())?.count), 0)
    const idle = await f.signIn('ben@example.com')
    await f.register(idle.session)
    f.advance(accountIdleLifetime + 1)
    await f.store.notifications.cleanup()
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM push_devices').get())?.count), 0)
    assert.equal((await idle.request('/account/push-devices', { installationId: randomUUID(), token: 'ab', environment: 'sandbox' }, 'PUT')).status, 401)
    const deleting = await f.signIn('ben@example.com')
    await f.register(deleting.session)
    await f.store.accounts.beginDeletion(deleting.session, 'ben@example.com')
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM push_devices').get())?.count), 0)
    assert.equal((await deleting.request('/account/push-devices', { installationId: randomUUID(), token: 'ab', environment: 'sandbox' }, 'PUT')).status, 409)
    await f.store.accounts.finishDeletion(deleting.session.accountId)
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM notification_preferences').get())?.count), 0)
  })
})
