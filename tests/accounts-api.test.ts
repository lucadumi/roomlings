import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/app.ts'
import { Store } from '../server/store.ts'
import { ApiError } from '../server/errors.ts'
import { retryAccountDeletions } from '../server/accounts-api.ts'
import type { AccountProvider } from '../server/provider.ts'
import { accountIdleLifetime, accountAbsoluteLifetime } from '../server/accounts-store.ts'
import { accountInvitationResultSchema, accountStateSchema, householdAccessSchema } from '../shared/accounts.ts'
import type { AccountState } from '../shared/accounts.ts'
import { balances, memberColors } from '../shared/domain.ts'
import type { Household, Session } from '../shared/domain.ts'

class TestProvider implements AccountProvider {
  ids = new Map<string, string>()
  sent: string[] = []
  deleted: string[] = []
  failSend = false
  failDelete = false
  mismatch = false
  async sendCode(email: string) {
    if (this.failSend) throw new Error('private provider detail')
    this.sent.push(email)
  }
  async verifyCode(email: string, code: string) {
    if (code !== '123456') throw new ApiError(401, 'Invalid code')
    if (!this.ids.has(email)) this.ids.set(email, randomUUID())
    return { providerId: this.ids.get(email)!, email: this.mismatch ? 'wrong@example.com' : email }
  }
  async deleteUser(providerId: string) {
    this.deleted.push(providerId)
    if (this.failDelete) throw new Error('private provider detail')
    for (const [email, id] of this.ids) if (id === providerId) this.ids.delete(email)
  }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture(configured = true, appOrigin = 'http://localhost:5173') {
  let time = Date.now()
  const store = new Store(':memory:', { now: () => time })
  const provider = new TestProvider()
  const server = createApp(store, { provider: configured ? provider : undefined, appOrigin, allowLocalDevelopment: true }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  cleanups.push(async () => { server.close(); await once(server, 'close'); await store.close() })
  const call = async (path: string, body?: unknown, options: {
    method?: string; cookie?: string; csrf?: string; token?: string; householdId?: string
    headers?: Record<string, string | undefined>
  } = {}) => {
    const headers: Record<string, string | undefined> = {
      'Content-Type': 'application/json', 'X-Roomlings-Request': '1', Origin: appOrigin,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.householdId ? { 'X-Roomlings-Household': options.householdId } : {}),
      ...options.headers,
    }
    const response = await fetch(`${origin}/api${path}`, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { response, status: response.status, data: await response.json() }
  }
  const browser = () => {
    let cookie = ''
    let csrf = ''
    const request = async (path: string, body?: unknown, options: Parameters<typeof call>[2] = {}) => {
      const result = await call(path, body, { cookie, csrf, ...options })
      const setCookie = result.response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      if (result.data.csrfToken) csrf = result.data.csrfToken
      if (result.data.account === null) csrf = ''
      return result
    }
    return {
      request,
      get cookie() { return cookie },
      get csrf() { return csrf },
      async signIn(email: string, name = 'Roommate') {
        const result = await request('/account/verify', { email, code: '123456', name, label: 'Test browser' })
        assert.equal(result.status, 200, JSON.stringify(result.data))
        return accountStateSchema.parse(result.data)
      },
      async state() {
        const result = await request('/account')
        assert.equal(result.status, 200, JSON.stringify(result.data))
        return accountStateSchema.parse(result.data)
      },
      async create(name = 'Our kitchen', memberName = 'Ada') {
        const result = await request('/account/households', { name, memberName, currency: 'EUR', budget: 30000 })
        assert.equal(result.status, 201, JSON.stringify(result.data))
        return accountStateSchema.parse(result.data)
      },
      async invite(household: Household, expiresInDays = 7) {
        const result = await request(`/account/households/${household.id}/invitations`, { version: household.version, expiresInDays })
        assert.equal(result.status, 201, JSON.stringify(result.data))
        return accountInvitationResultSchema.parse(result.data)
      },
    }
  }
  return { store, provider, call, browser, advance(ms: number) { time += ms } }
}

async function secondLegacy(store: Store, first: Session, name = 'Ben') {
  const household = (await store.get(first.household.id))!
  const memberId = randomUUID()
  household.members.push({ id: memberId, name, color: memberColors[1] })
  household.version++
  await store.save(household)
  return (await store.session(household, memberId))
}

describe('verified account HTTP lifecycle', () => {
  it('keeps unconfigured/private legacy creation and demo access working while public auth fails clearly', async () => {
    const f = await fixture(false)
    const state = await f.call('/account')
    assert.deepEqual(accountStateSchema.parse(state.data), { configured: false, account: null, memberships: [], devices: [], csrfToken: null, session: null })
    assert.equal((await f.call('/account/code', { email: 'ada@example.com' })).status, 503)
    assert.equal((await f.call('/account/verify', { email: 'ada@example.com', code: '123456', name: 'Ada' })).status, 503)
    const legacy = await f.call('/households', { name: 'Private kitchen', memberName: 'Ada', currency: 'EUR', budget: 10000 })
    assert.equal(legacy.status, 201)
    assert.equal((await f.call('/household', undefined, { token: legacy.data.token })).status, 200)
    assert.equal((await f.call('/demo', {})).status, 201)
  })

  it('normalizes verified emails, uses opaque HttpOnly cookies, and never overwrites a returning profile', async () => {
    const f = await fixture()
    const sent = await f.call('/account/code', { email: '  Ada@Example.COM ' })
    assert.deepEqual(sent.data, { sent: true })
    assert.deepEqual(f.provider.sent, ['ada@example.com'])
    const browser = f.browser()
    const first = await browser.request('/account/verify', { email: 'Ada@example.com', code: '123456', name: 'Ada', label: 'Work browser' })
    const state = accountStateSchema.parse(first.data)
    const cookie = first.response.headers.get('set-cookie')!
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Lax/)
    assert.match(cookie, /Max-Age=2592000/)
    assert.doesNotMatch(cookie, /; Secure/)
    assert.equal(state.account?.email, 'ada@example.com')
    assert.equal(state.devices[0].label, 'Work browser')
    assert.equal(state.session, null)
    assert.ok(!JSON.stringify(first.data).includes(browser.cookie.split('=')[1]))
    const changed = await browser.request('/account', { name: 'Ada Lovelace' }, { method: 'PATCH' })
    assert.equal(changed.data.account.name, 'Ada Lovelace')
    const returning = await f.browser().signIn('ada@example.com', 'Ignored name')
    assert.equal(returning.account?.id, state.account?.id)
    assert.equal(returning.account?.name, 'Ada Lovelace')
    assert.equal(returning.devices.length, 2)
    assert.equal((await browser.request('/account/device', { label: 'Laptop' }, { method: 'PATCH' })).data.devices.find((device: { current: boolean }) => device.current).label, 'Laptop')
    const secure = await fixture(true, 'https://roomlings.example')
    const login = await secure.browser().request('/account/verify', { email: 'a@example.com', code: '123456', name: 'A' })
    assert.match(login.response.headers.get('set-cookie')!, /; Secure/)
  })

  it('blocks login CSRF, cookie mutations without CSRF, cross-origin requests, and forged bearer fallback', async () => {
    const f = await fixture()
    const input = { email: 'ada@example.com', code: '123456', name: 'Ada' }
    assert.equal((await f.call('/account/verify', input, { headers: { Origin: 'https://attacker.example' } })).status, 403)
    assert.equal((await f.call('/account/verify', input, { headers: { 'X-Roomlings-Request': undefined } })).status, 403)
    assert.equal((await f.call('/account/verify', input, { headers: { Origin: 'null' } })).status, 403)
    const browser = f.browser()
    await browser.signIn('ada@example.com')
    const house = (await browser.create()).session!
    assert.equal((await browser.request('/account', { name: 'Forged' }, { method: 'PATCH', csrf: '' })).status, 403)
    assert.equal((await browser.request('/account', { name: 'Forged' }, { method: 'PATCH', csrf: 'é'.repeat(64) })).status, 403)
    assert.equal((await browser.request('/account', { name: 'Forged' }, { method: 'PATCH', headers: { Origin: 'https://attacker.example' } })).status, 403)
    assert.equal((await browser.request('/household', undefined, { token: 'not-a-valid-legacy-token' })).status, 401)
    const legacy = (await f.store.create('Legacy', 'Ada', 'EUR', 10000))
    const legacyRead = await browser.request('/household', undefined, { token: legacy.token })
    assert.equal(legacyRead.data.household.id, legacy.household.id)
    const accountRead = await browser.request('/account', undefined, { token: legacy.token })
    assert.equal(accountRead.data.session.household.id, house.household.id)
    const change = { version: house.household.version, name: 'Updated', currency: 'EUR', budget: 20000 }
    assert.equal((await browser.request('/household', change, { method: 'PATCH', csrf: '' })).status, 403)
    assert.equal((await browser.request('/household', change, { method: 'PATCH' })).status, 200)
    assert.equal((await f.call('/account', undefined, { token: legacy.token })).data.account, null)
    assert.equal((await f.call('/account/link', { token: legacy.token }, { token: legacy.token })).status, 401)
  })

  it('allows the explicitly configured localhost preview origins without permitting arbitrary origins', async () => {
    const f = await fixture()
    assert.equal((await f.call('/account/code', { email: 'ada@example.com' }, { headers: { Origin: 'http://127.0.0.1:5173' } })).status, 200)
    assert.equal((await f.call('/account/code', { email: 'ada@example.com' }, { headers: { Origin: 'http://localhost:5174' } })).status, 403)
    assert.equal((await f.call('/account/code', { email: 'ada@example.com' }, { headers: { Origin: 'http://localhost.evil.example:5173' } })).status, 403)
  })

  it('reports provider failures truthfully and bounds email code requests and verification attempts', async () => {
    const f = await fixture()
    f.provider.failSend = true
    const failure = await f.call('/account/code', { email: 'ada@example.com' })
    assert.equal(failure.status, 503)
    assert.equal(failure.data.sent, undefined)
    assert.ok(!JSON.stringify(failure.data).includes('private provider detail'))
    f.provider.failSend = false
    for (let index = 0; index < 4; index++) assert.equal((await f.call('/account/code', { email: 'ada@example.com' })).status, 200)
    assert.equal((await f.call('/account/code', { email: 'ADA@example.com' })).status, 429)
    for (let index = 0; index < 10; index++) assert.equal((await f.call('/account/verify', { email: 'b@example.com', code: '999999', name: 'B' })).status, 401)
    assert.equal((await f.call('/account/verify', { email: 'b@example.com', code: '123456', name: 'B' })).status, 429)
    f.provider.mismatch = true
    const mismatch = await f.call('/account/verify', { email: 'c@example.com', code: '123456', name: 'C' })
    assert.equal(mismatch.status, 401)
    assert.equal(mismatch.response.headers.get('set-cookie'), null)
  })

  it('expires idle and absolute sessions, clears expired cookies, and supports current/all-device logout', async () => {
    const f = await fixture()
    const browser = f.browser()
    await browser.signIn('ada@example.com')
    f.advance(accountIdleLifetime)
    const expired = await browser.request('/account')
    assert.equal(expired.data.account, null)
    assert.match(expired.response.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/)
    await browser.signIn('ada@example.com')
    for (let elapsed = 0; elapsed < accountAbsoluteLifetime; elapsed += 6 * 86_400_000) {
      assert.ok((await browser.state()).account)
      f.advance(6 * 86_400_000)
    }
    assert.equal((await browser.state()).account, null)
    const a = await browser.signIn('ada@example.com')
    const other = f.browser()
    await other.signIn('ada@example.com')
    const stranger = f.browser()
    const strangersState = await stranger.signIn('stranger@example.com')
    assert.equal((await browser.request(`/account/devices/${strangersState.devices[0].id}`, undefined, { method: 'DELETE' })).status, 404)
    const ownOther = (await browser.state()).devices.find((device) => !device.current)!
    assert.equal((await browser.request(`/account/devices/${ownOther.id}`, undefined, { method: 'DELETE' })).status, 200)
    assert.equal((await other.state()).account, null)
    assert.equal((await browser.request(`/account/devices/${a.devices.find((device) => device.current)!.id}`, undefined, { method: 'DELETE' })).data.account, null)
    await browser.signIn('ada@example.com')
    await other.signIn('ada@example.com')
    assert.equal((await browser.request('/account/logout', { all: false })).data.account, null)
    assert.ok((await other.state()).account)
    await browser.signIn('ada@example.com')
    assert.equal((await browser.request('/account/logout', { all: true })).data.account, null)
    assert.equal((await other.state()).account, null)
    assert.ok((await stranger.state()).account)
  })

  it('requires account creation/joining publicly, keeps demos public, and isolates explicit household headers', async () => {
    const f = await fixture()
    assert.equal((await f.call('/households', { name: 'Public', memberName: 'Ada', currency: 'EUR', budget: 30000 })).status, 401)
    assert.equal((await f.call('/join', { inviteCode: 'old-invite', name: 'Ada' })).status, 401)
    assert.equal((await f.call('/demo', {})).status, 201)
    const browser = f.browser()
    await browser.signIn('ada@example.com')
    const first = (await browser.create('First')).session!
    const second = (await browser.create('Second')).session!
    assert.equal((await browser.request('/household')).data.household.id, second.household.id)
    const change = { name: 'First changed', currency: 'EUR', budget: 45000, version: first.household.version }
    const result = await browser.request('/household', change, { method: 'PATCH', householdId: first.household.id })
    assert.equal(result.data.household.id, first.household.id)
    assert.equal((await f.store.get(second.household.id))!.name, 'Second')
    assert.equal((await browser.request('/household', change, { method: 'PATCH', householdId: randomUUID() })).status, 403)
    assert.equal((await browser.request(`/account/households/${randomUUID()}/select`, {})).status, 403)
    const selected = await browser.request(`/account/households/${first.household.id}/select`, {})
    assert.equal(selected.data.session.household.id, first.household.id)
    assert.equal(selected.data.session.token, null)
    const stranger = f.browser()
    await stranger.signIn('stranger@example.com')
    assert.equal((await stranger.request(`/account/households/${first.household.id}`)).status, 403)
    assert.equal((await stranger.request('/household', undefined, { householdId: first.household.id })).status, 403)
  })
})

describe('account invitations and membership lifecycle', () => {
  it('does not count retained inactive identities toward legacy invitation seats', async () => {
    const f = await fixture(false)
    const created = (await f.store.create('Legacy history', 'Ada', 'EUR', 10000))
    const household = created.household
    for (let index = 0; index < 12; index++) {
      household.members.push({ id: randomUUID(), name: `Former ${index}`, color: memberColors[0], inactive: true })
    }
    await f.store.save(household)
    const joined = await f.call('/join', { inviteCode: household.inviteCode, name: 'Ben' })
    assert.equal(joined.status, 201)
    assert.equal(joined.data.household.members.length, 14)
    assert.equal(joined.data.household.members.filter((member: { inactive?: boolean }) => !member.inactive).length, 2)
  })

  it('preserves legacy identities and recovery/browser sessions, with original creator ownership and proof-only linking', async () => {
    const f = await fixture()
    const first = (await f.store.create('Legacy kitchen', 'Ada', 'EUR', 30000))
    const second = (await secondLegacy(f.store, first))
    const extra = (await f.store.session((await f.store.get(first.household.id))!, first.memberId))
    const proof = (await f.store.rotateRecovery((await f.store.authenticate(first.token))!, { version: 0, revokeOthers: false }))
    assert.ok(proof && proof !== 'conflict')
    const ben = f.browser()
    await ben.signIn('ben@example.com', 'Ada')
    assert.equal((await ben.state()).memberships.length, 0)
    const adopted = await ben.request('/account/link', { token: second.token })
    assert.equal(adopted.data.memberships[0].role, 'member')
    assert.equal(adopted.data.session.memberId, second.memberId)
    const ownerAccess = await ben.request(`/account/households/${first.household.id}`)
    assert.equal(ownerAccess.data.members.find((member: { memberId: string }) => member.memberId === first.memberId).role, 'owner')
    assert.equal(ownerAccess.data.members.find((member: { memberId: string }) => member.memberId === first.memberId).linked, false)
    assert.equal((await ben.request(`/account/households/${first.household.id}/invitations`, { version: adopted.data.session.household.version })).status, 403)
    const ada = f.browser()
    await ada.signIn('ada@example.com', 'Ada')
    const linked = await ada.request('/account/link', { recoveryCode: proof.code })
    assert.equal(linked.data.session.memberId, first.memberId)
    assert.equal(linked.data.memberships[0].role, 'owner')
    const repeated = await ada.request('/account/link', { token: first.token })
    assert.equal(repeated.data.session.household.version, linked.data.session.household.version)
    assert.equal(repeated.data.session.household.members.length, 2)
    assert.ok((await f.store.authenticate(first.token)))
    assert.ok((await f.store.authenticate(extra.token)))
    assert.ok((await f.store.recover(proof.code, 'Recovered')))
    assert.equal((await ben.request('/account/link', { token: first.token })).status, 409)
    const third = (await secondLegacy(f.store, first, 'Charlie'))
    assert.equal((await ada.request('/account/link', { token: third.token })).status, 409)
    const demo = (await f.store.create('Practice', 'You', 'EUR', 30000, true))
    const sample = await ada.request('/account/link', { token: demo.token })
    assert.equal(sample.status, 400)
    assert.equal(sample.data.code, 'SAMPLE_KITCHEN')
    const invalidBrowser = await ada.request('/account/link', { token: 'invalid-proof-123456789' })
    assert.equal(invalidBrowser.status, 401)
    assert.equal(invalidBrowser.data.code, 'BROWSER_ACCESS_EXPIRED')
    const invalidRecovery = await ada.request('/account/link', { recoveryCode: `roomlings-${'A'.repeat(43)}` })
    assert.equal(invalidRecovery.status, 401)
    assert.equal(invalidRecovery.data.code, 'INVALID_RECOVERY_CODE')
    assert.equal((await ada.request('/invite/rotate', { version: (await f.store.get(first.household.id))!.version }, { token: first.token })).status, 403)
    await ada.request('/account/logout', { all: true })
    assert.equal((await f.store.authenticate(first.token)), null)
    assert.equal((await f.store.authenticate(extra.token)), null)
    assert.ok((await f.store.authenticate(second.token)))
    assert.ok((await f.store.recover(proof.code, 'Explicit recovery after global logout')))
  })

  it('never restores another provider identity by matching email or profile name', async () => {
    const f = await fixture()
    const ada = f.browser()
    await ada.signIn('ada@example.com', 'Ada')
    const original = await ada.create()
    f.provider.ids.set('ada@example.com', randomUUID())
    const impersonator = f.browser()
    const state = await impersonator.signIn('ada@example.com', 'Ada')
    assert.notEqual(state.account!.id, original.account!.id)
    assert.equal(state.memberships.length, 0)
    assert.equal((await impersonator.request(`/account/households/${original.session!.household.id}`)).status, 403)
  })

  it('creates hashed expiring invitations, authorizes owners, rejects conflicts, and accepts idempotently', async () => {
    const f = await fixture()
    const owner = f.browser()
    await owner.signIn('owner@example.com')
    const household = (await owner.create()).session!.household
    const invite = await owner.invite(household)
    assert.match(invite.code, /^roomlings-invite-[A-Za-z0-9_-]{43}$/)
    const listed = await owner.request(`/account/households/${household.id}`)
    assert.ok(!JSON.stringify(listed.data).includes(invite.code))
    assert.ok(!JSON.stringify(listed.data).includes('"hash"'))
    assert.equal((await owner.request(`/account/households/${household.id}/invitations`, { version: 0 })).status, 409)
    const ben = f.browser()
    await ben.signIn('ben@example.com')
    const first = await ben.request('/account/invitations/accept', { code: invite.code, memberName: 'Ben' })
    assert.equal(first.status, 200)
    const second = await ben.request('/account/invitations/accept', { code: invite.code, memberName: 'Ignored repeat' })
    assert.equal(second.data.session.memberId, first.data.session.memberId)
    assert.equal(second.data.session.household.version, first.data.session.household.version)
    assert.equal(second.data.memberships.length, 1)
    const access = householdAccessSchema.parse((await owner.request(`/account/households/${household.id}`)).data)
    assert.equal(access.invitations[0].uses, 1)
    assert.equal((await ben.request(`/account/households/${household.id}`)).data.invitations.length, 0)
    assert.equal((await ben.request(`/account/households/${household.id}/invitations`, { version: access.household.version })).status, 403)
    assert.equal((await ben.request(`/account/households/${household.id}/invitations/${invite.invitation.id}`, { version: access.household.version }, { method: 'DELETE' })).status, 403)
    const different = (await owner.create('Different')).session!.household
    assert.equal((await owner.request(`/account/households/${different.id}/invitations/${invite.invitation.id}`, { version: different.version }, { method: 'DELETE' })).status, 404)
    const revoked = await owner.request(`/account/households/${household.id}/invitations/${invite.invitation.id}`, { version: access.household.version }, { method: 'DELETE' })
    assert.equal(revoked.status, 200)
    assert.ok(revoked.data.invitations[0].revokedAt)
    const stranger = f.browser()
    await stranger.signIn('stranger@example.com')
    assert.equal((await stranger.request('/account/invitations/accept', { code: invite.code, memberName: 'Stranger' })).status, 410)
    const expiring = await owner.invite(revoked.data.household, 1)
    f.advance(86_400_000)
    assert.equal((await stranger.request('/account/invitations/accept', { code: expiring.code, memberName: 'Stranger' })).status, 410)
    assert.equal((await ben.state()).memberships.length, 1)
  })

  it('serializes concurrent invitation changes and accepts the same proof only once', async () => {
    const f = await fixture()
    const owner = f.browser()
    await owner.signIn('owner@example.com')
    const household = (await owner.create()).session!.household
    const results = await Promise.all([
      owner.request(`/account/households/${household.id}/invitations`, { version: household.version }),
      owner.request(`/account/households/${household.id}/invitations`, { version: household.version }),
    ])
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409])
    const code = results.find((result) => result.status === 201)!.data.code
    const member = f.browser()
    await member.signIn('member@example.com')
    const accepted = await Promise.all([
      member.request('/account/invitations/accept', { code, memberName: 'Ben' }),
      member.request('/account/invitations/accept', { code, memberName: 'Ben' }),
    ])
    assert.deepEqual(accepted.map((result) => result.status), [200, 200])
    assert.equal(accepted[0].data.session.memberId, accepted[1].data.session.memberId)
    assert.equal((await f.store.get(household.id))!.members.length, 2)
    assert.equal((await owner.request(`/account/households/${household.id}`)).data.invitations[0].uses, 1)
  })

  it('lets every active member edit ledger, transfers ownership, removes access without changing balances, and releases shopping claims', async () => {
    const f = await fixture()
    const owner = f.browser()
    await owner.signIn('owner@example.com')
    const first = (await owner.create()).session!
    const invite = await owner.invite(first.household)
    const ben = f.browser()
    await ben.signIn('ben@example.com')
    const joined: AccountState = (await ben.request('/account/invitations/accept', { code: invite.code, memberName: 'Ben' })).data
    const memberId = joined.session!.memberId
    const householdId = first.household.id
    const bearer = (await f.store.session((await f.store.get(householdId))!, memberId))
    const recovery = (await f.store.rotateRecovery((await f.store.authenticate(bearer.token))!, { version: 0, revokeOthers: false }))
    assert.ok(recovery && recovery !== 'conflict')
    const paid = await ben.request('/expenses', {
      version: joined.session!.household.version, description: 'Ben groceries', amount: 2001,
      paidBy: first.memberId, participants: [first.memberId, memberId], category: 'pantry', date: '2026-09-01',
    })
    assert.equal(paid.status, 200)
    const shopping = await ben.request('/shopping/items', { version: paid.data.household.version, name: 'Milk', quantity: '1', notes: '' })
    const item = shopping.data.household.shopping.items[0]
    const claimed = await ben.request(`/shopping/items/${item.id}/claim`, { version: shopping.data.household.version, itemVersion: item.version, claimed: true })
    const before = claimed.data.household as Household
    assert.equal((await ben.request(`/account/households/${householdId}/members/${first.memberId}`, { version: before.version }, { method: 'DELETE' })).status, 403)
    assert.equal((await owner.request(`/account/households/${householdId}/membership`, { version: before.version }, { method: 'DELETE' })).data.code, 'OWNERSHIP_TRANSFER_REQUIRED')
    assert.equal((await owner.request(`/account/households/${householdId}/owner`, { version: before.version, memberId: randomUUID() })).status, 400)
    const transferred = await owner.request(`/account/households/${householdId}/owner`, { version: before.version, memberId })
    assert.equal(transferred.data.role, 'member')
    const returned = await ben.request(`/account/households/${householdId}/owner`, { version: transferred.data.household.version, memberId: first.memberId })
    assert.equal(returned.status, 200)
    assert.equal((await owner.request(`/account/households/${householdId}/members/${memberId}`, { version: before.version }, { method: 'DELETE' })).status, 409)
    const removed = await owner.request(`/account/households/${householdId}/members/${memberId}`, { version: returned.data.household.version }, { method: 'DELETE' })
    assert.equal(removed.status, 200)
    const after = removed.data.household as Household
    assert.deepEqual(balances(after), balances(before))
    assert.deepEqual(after.expenses, before.expenses)
    assert.deepEqual(after.settlements, before.settlements)
    assert.equal(after.members.find((member) => member.id === memberId)!.inactive, true)
    assert.equal(after.shopping.items[0].claimedBy, null)
    assert.equal(after.shopping.items[0].version, before.shopping.items[0].version + 1)
    assert.equal((await f.store.authenticate(bearer.token)), null)
    assert.equal((await f.store.recover(recovery.code, 'Removed')), null)
    assert.equal((await ben.state()).memberships.length, 0)
    assert.equal((await ben.request('/household', undefined, { householdId })).status, 403)
    assert.equal((await ben.request('/account/link', { token: bearer.token })).status, 401)
    assert.equal((await ben.request('/account/invitations/accept', { code: invite.code, memberName: 'Ben' })).status, 410)
    const invalidExpense = await owner.request('/expenses', {
      version: after.version, description: 'Inactive participant', amount: 100,
      paidBy: first.memberId, participants: [memberId], category: 'pantry', date: '2026-09-01',
    })
    assert.equal(invalidExpense.status, 400)
    const fresh = await owner.invite(after)
    const rejoined = await ben.request('/account/invitations/accept', { code: fresh.code, memberName: 'Ben' })
    assert.equal(rejoined.data.session.memberId, memberId)
    assert.deepEqual(balances(rejoined.data.session.household), balances(before))
  })

  it('requires a newly issued invitation after removal, including when another old link was never redeemed', async () => {
    const f = await fixture()
    const owner = f.browser()
    await owner.signIn('owner@example.com')
    const created = (await owner.create()).session!
    const first = await owner.invite(created.household)
    const unused = await owner.invite(first.access.household)
    const member = f.browser()
    await member.signIn('member@example.com')
    const joined = accountStateSchema.parse((await member.request('/account/invitations/accept', { code: first.code, memberName: 'Ben' })).data)
    const memberId = joined.session!.memberId
    const removed = await owner.request(`/account/households/${created.household.id}/members/${memberId}`, {
      version: joined.session!.household.version,
    }, { method: 'DELETE' })
    assert.equal(removed.status, 200)
    assert.equal((await member.request('/account/invitations/accept', { code: unused.code, memberName: 'Ben' })).status, 410)
    const fresh = await owner.invite(householdAccessSchema.parse(removed.data).household)
    const returned = await member.request('/account/invitations/accept', { code: fresh.code, memberName: 'Ben' })
    assert.equal(returned.status, 200)
    assert.equal(accountStateSchema.parse(returned.data).session!.memberId, memberId)
  })

  it('lets nonowners leave, blocks managed legacy invites even when auth later becomes unconfigured, and closes sole-owner kitchens', async () => {
    const f = await fixture(false)
    const first = (await f.store.create('Legacy kitchen', 'Ada', 'EUR', 30000))
    const signedIn = (await f.store.accounts.signIn({ providerId: randomUUID(), email: 'ada@example.com' }, 'Ada', 'Test')).session
    await f.store.accounts.link(signedIn, { token: first.token })
    assert.equal((await f.call('/join', { inviteCode: first.household.inviteCode, name: 'Bypass' })).status, 403)
    assert.equal((await f.call('/invite/rotate', { version: (await f.store.get(first.household.id))!.version }, { token: first.token })).status, 403)
    const g = await fixture()
    const owner = g.browser()
    await owner.signIn('owner@example.com')
    const initial = (await owner.create()).session!
    const invite = await owner.invite(initial.household)
    const member = g.browser()
    await member.signIn('member@example.com')
    const joined = (await member.request('/account/invitations/accept', { code: invite.code, memberName: 'Ben' })).data
    const leaving = await member.request(`/account/households/${initial.household.id}/membership`, { version: joined.session.household.version }, { method: 'DELETE' })
    assert.equal(leaving.status, 200)
    assert.equal(leaving.data.memberships.length, 0)
    const latest = (await g.store.get(initial.household.id))!
    const closed = await owner.request(`/account/households/${initial.household.id}/membership`, { version: latest.version }, { method: 'DELETE' })
    assert.equal(closed.status, 200)
    assert.equal(closed.data.session, null)
    assert.ok((await g.store.get(initial.household.id))!.members.every((member) => member.inactive))
    assert.equal((await member.request('/account/invitations/accept', { code: invite.code, memberName: 'Ben' })).status, 410)
  })
})

describe('account deletion and durable retry', () => {
  it('retains shared outstanding debts and historical bill schedules when a nonowner deletes their account', async () => {
    const f = await fixture()
    const owner = f.browser()
    await owner.signIn('owner@example.com')
    const initial = (await owner.create()).session!
    const invite = await owner.invite(initial.household)
    const ben = f.browser()
    await ben.signIn('ben@example.com')
    const joined = (await ben.request('/account/invitations/accept', { code: invite.code, memberName: 'Ben' })).data
    const memberId = joined.session.memberId
    const bill = await ben.request('/bills', {
      version: joined.session.household.version, name: 'Shared internet', amount: 3001,
      firstDueDate: '2026-09-01', timeZone: 'UTC', participants: [initial.memberId, memberId],
    })
    assert.equal(bill.status, 200)
    const payment = await ben.request(`/bills/${bill.data.household.bills[0].id}/payments`, {
      version: bill.data.household.version, month: '2026-09', amount: 3001, paidBy: memberId,
      participants: [initial.memberId, memberId], date: '2026-09-01',
    })
    assert.equal(payment.status, 200)
    const before = payment.data.household as Household
    const deleted = await ben.request('/account', { confirmation: 'ben@example.com' }, { method: 'DELETE' })
    assert.equal(deleted.status, 200)
    const retained = (await f.store.get(initial.household.id))!
    assert.deepEqual(retained.bills, before.bills)
    assert.deepEqual(retained.expenses, before.expenses)
    assert.deepEqual(retained.settlements, before.settlements)
    assert.deepEqual(balances(retained), balances(before))
    assert.equal(retained.members.find((member) => member.id === memberId)!.name, 'Former roommate 2')
    const ownerState = await owner.state()
    assert.equal(ownerState.memberships[0].role, 'owner')
    assert.equal((await owner.request('/household')).status, 200)
  })

  it('cannot resurrect a deleted provider identity with a verification response already in flight', async () => {
    const f = await fixture()
    const browser = f.browser()
    await browser.signIn('ada@example.com')
    const providerId = f.provider.ids.get('ada@example.com')!
    let release!: (identity: { providerId: string; email: string }) => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => { started = resolve })
    f.provider.verifyCode = async () => {
      started()
      return new Promise((resolve) => { release = resolve })
    }
    const pending = f.call('/account/verify', { email: 'ada@example.com', code: '123456', name: 'Ada' })
    await waiting
    assert.equal((await browser.request('/account', { confirmation: 'ada@example.com' }, { method: 'DELETE' })).status, 200)
    release({ providerId, email: 'ada@example.com' })
    const result = await pending
    assert.equal(result.status, 401)
    assert.equal(result.response.headers.get('set-cookie'), null)
    assert.equal((await browser.state()).account, null)
  })

  it('checks exact confirmation, recent sign-in, and ownership before contacting the provider', async () => {
    const f = await fixture()
    const owner = f.browser()
    await owner.signIn('owner@example.com')
    assert.equal((await owner.request('/account', { confirmation: ' Owner@example.com ' }, { method: 'DELETE' })).status, 400)
    assert.equal(f.provider.deleted.length, 0)
    f.advance(10 * 60_000 + 1)
    const stale = await owner.request('/account', { confirmation: 'owner@example.com' }, { method: 'DELETE' })
    assert.equal(stale.status, 401)
    assert.equal(stale.data.code, 'REAUTHENTICATION_REQUIRED')
    assert.equal(f.provider.deleted.length, 0)
    await owner.signIn('owner@example.com')
    const household = (await owner.create()).session!.household
    const invite = await owner.invite(household)
    const ben = f.browser()
    await ben.signIn('ben@example.com')
    await ben.request('/account/invitations/accept', { code: invite.code, memberName: 'Ben' })
    const blocked = await owner.request('/account', { confirmation: 'owner@example.com' }, { method: 'DELETE' })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.data.code, 'OWNERSHIP_TRANSFER_REQUIRED')
    assert.equal(f.provider.deleted.length, 0)
    assert.ok((await owner.state()).account)
  })

  it('deletes a sole owner with retained pseudonymous ledger references and no remaining credentials', async () => {
    const f = await fixture()
    const legacy = (await f.store.create('Retained ledger', 'Ada', 'EUR', 10000))
    const household = (await f.store.get(legacy.household.id))!
    household.expenses.push({
      id: randomUUID(), description: 'Ada bought groceries', amount: 101, paidBy: legacy.memberId,
      participants: [legacy.memberId], category: 'pantry', date: '2026-09-01', createdAt: new Date().toISOString(),
    })
    await f.store.save(household)
    const proof = (await f.store.rotateRecovery((await f.store.authenticate(legacy.token))!, { version: 0, revokeOthers: false }))
    assert.ok(proof && proof !== 'conflict')
    const browser = f.browser()
    await browser.signIn('ada@example.com', 'Ada')
    await browser.request('/account/link', { token: legacy.token })
    const other = f.browser()
    await other.signIn('ada@example.com')
    const before = (await f.store.get(household.id))!
    const deleted = await browser.request('/account', { confirmation: 'ada@example.com' }, { method: 'DELETE' })
    assert.equal(deleted.status, 200)
    assert.equal(deleted.data.account, null)
    assert.equal(f.provider.deleted.length, 1)
    assert.equal((await other.state()).account, null)
    assert.equal((await f.store.authenticate(legacy.token)), null)
    assert.equal((await f.store.recover(proof.code, 'Deleted account')), null)
    const after = (await f.store.get(household.id))!
    assert.equal(after.members[0].name, 'Former roommate 1')
    assert.equal(after.members[0].inactive, true)
    assert.deepEqual(after.expenses, before.expenses)
    assert.deepEqual(balances(after), balances(before))
    assert.equal(after.expenses[0].description, 'Ada bought groceries')
    assert.equal((await f.store.accounts.pendingDeletions()).length, 0)
    const recreated = await browser.signIn('ada@example.com')
    assert.equal(recreated.memberships.length, 0)
  })

  it('disables access before provider deletion, reports failures, permits deletion-only retry, and completes queued deletions', async () => {
    const f = await fixture()
    const browser = f.browser()
    await browser.signIn('ada@example.com')
    const first = (await browser.create()).session!
    const other = f.browser()
    await other.signIn('ada@example.com')
    const legacy = (await f.store.session(first.household, first.memberId))
    f.provider.failDelete = true
    const result = await browser.request('/account', { confirmation: 'ada@example.com' }, { method: 'DELETE' })
    assert.equal(result.status, 503)
    assert.equal(result.data.code, 'ACCOUNT_DELETION_PENDING')
    assert.equal((await f.store.authenticate(legacy.token)), null)
    assert.equal((await other.state()).account, null)
    assert.equal((await browser.request('/household')).status, 409)
    assert.equal((await browser.request('/account', { name: 'Not allowed' }, { method: 'PATCH' })).status, 409)
    assert.equal((await browser.request('/account')).status, 409)
    assert.equal((await browser.request('/account/verify', { email: 'ada@example.com', code: '123456', name: 'Ada' })).status, 409)
    assert.equal((await f.store.accounts.pendingDeletions()).length, 1)
    f.provider.failDelete = false
    const retried = await browser.request('/account', { confirmation: 'ada@example.com' }, { method: 'DELETE' })
    assert.equal(retried.status, 200)
    assert.equal((await f.store.accounts.pendingDeletions()).length, 0)
    assert.equal((await f.store.get(first.household.id))!.members[0].name, 'Former roommate 1')
    const second = f.browser()
    await second.signIn('ben@example.com')
    await second.create('Second', 'Ben')
    f.provider.failDelete = true
    await second.request('/account', { confirmation: 'ben@example.com' }, { method: 'DELETE' })
    f.provider.failDelete = false
    await retryAccountDeletions(f.store, f.provider)
    assert.equal((await f.store.accounts.pendingDeletions()).length, 0)
    assert.equal((await second.state()).account, null)
  })
})
