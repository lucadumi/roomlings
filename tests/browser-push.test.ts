import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import webpush from 'web-push'
import { apnsAvailable, pushFromEnvironment } from '../server/apns.ts'
import { NotificationWorker } from '../server/notification-worker.ts'
import { BrowserPushProvider, browserPushFromEnvironment, browserPushResult } from '../server/web-push.ts'
import type { BrowserSubscription } from '../server/web-push.ts'
import { notificationFixture, testExpense } from './notifications-fixture.ts'

const keys = { ...webpush.generateVAPIDKeys(), subject: 'mailto:alerts@example.com' }
const subscription = (): BrowserSubscription => ({
  endpoint: `https://push.example.com/send/${randomUUID()}`,
  keys: { p256dh: `B${'a'.repeat(86)}`, auth: 'abcdefghijklmnopqrstuv' },
})

describe('browser push configuration and results', () => {
  it('maps push service responses onto the shared retry rules', () => {
    assert.deepEqual(browserPushResult(201), { status: 'sent' })
    assert.deepEqual(browserPushResult(410), { status: 'invalid' })
    assert.deepEqual(browserPushResult(404), { status: 'invalid' })
    assert.deepEqual(browserPushResult(429, '30'), { status: 'retry', reason: 'rate-limited', retryAfterMs: 30_000 })
    assert.deepEqual(browserPushResult(503), { status: 'retry', reason: 'unavailable' })
    assert.deepEqual(browserPushResult(403), { status: 'failed', reason: 'provider-auth' })
    assert.deepEqual(browserPushResult(413), { status: 'failed', reason: 'rejected' })
  })

  it('runs browser-only push without Apple credentials and validates its keys', () => {
    const env = {
      WEB_PUSH_PUBLIC_KEY: keys.publicKey, WEB_PUSH_PRIVATE_KEY: keys.privateKey, WEB_PUSH_SUBJECT: keys.subject,
      PUSH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    }
    const push = pushFromEnvironment(env)!
    assert.ok(push.browser)
    assert.equal(push.browser.publicKey, keys.publicKey)
    assert.equal(apnsAvailable(push), false)
    assert.equal(pushFromEnvironment({}), undefined)
    assert.throws(() => browserPushFromEnvironment({ ...env, WEB_PUSH_PRIVATE_KEY: 'short' }), /generate-vapid-keys/)
    assert.throws(() => browserPushFromEnvironment({ ...env, WEB_PUSH_SUBJECT: 'http://insecure.example' }), /mailto/)
    assert.throws(() => pushFromEnvironment({ ...env, PUSH_TOKEN_ENCRYPTION_KEY: '' }), /PUSH_TOKEN_ENCRYPTION_KEY/)
  })
})

describe('browser push delivery', () => {
  it('delivers generic money alerts to a browser and forgets an expired subscription', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household, ownerId } = await f.home()
    const sent: { subscription: BrowserSubscription; payload: string; options: webpush.RequestOptions }[] = []
    let status = 201
    const browser = new BrowserPushProvider(keys, {
      now: f.now,
      sender: async (target, payload, options) => {
        sent.push({ subscription: target, payload, options })
        return { statusCode: status }
      },
    })
    const worker = new NotificationWorker(f.store, { ...f.push, browser }, { now: f.now })
    const installationId = randomUUID()
    const target = subscription()
    await f.store.notifications.registerBrowser(other.session, installationId, target, f.cipher)
    assert.equal((await owner.request('/expenses', testExpense(household, ownerId))).status, 200)
    assert.equal((await worker.runOnce({ schedule: false })).sent, 1)
    assert.equal(f.provider.requests.length, 0)
    assert.deepEqual(sent[0].subscription, target)
    const payload = JSON.parse(sent[0].payload)
    assert.equal(payload.title, 'Roomlings')
    assert.equal(payload.body, 'A new expense was recorded.')
    assert.equal(payload.target.kind, 'expense')
    assert.ok(!sent[0].payload.includes('Private'))
    assert.equal(sent[0].options.topic?.length, 32)
    assert.ok(Number(sent[0].options.TTL) > 0)
    const stored = await f.db.prepare('SELECT token_ciphertext FROM push_devices WHERE installation_id = ?').get(installationId)
    assert.ok(!String(stored?.token_ciphertext).includes('push.example.com'))

    status = 410
    const latest = (await f.store.get(household.id))!
    assert.equal((await owner.request('/expenses', testExpense(latest, ownerId))).status, 200)
    assert.equal((await worker.runOnce({ schedule: false })).failed, 1)
    assert.equal(await f.db.prepare('SELECT 1 FROM push_devices WHERE installation_id = ?').get(installationId), undefined)
    assert.equal(await f.db.prepare('SELECT 1 FROM browser_push_devices WHERE installation_id = ?').get(installationId), undefined)
  })

  it('shares preferences with native settings and registers only when browser push is configured', async (t) => {
    const f = await notificationFixture(t)
    const { other, household } = await f.home()
    const path = `/account/households/${household.id}/browser-notifications`
    assert.deepEqual((await other.request(path)).data, { preferences: { chores: true, money: true }, available: false, publicKey: null })
    const saved = await other.request(path, { chores: true, money: false }, 'PUT')
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.data.preferences, { chores: true, money: false })
    assert.deepEqual((await other.request(`/account/households/${household.id}/notifications`)).data.preferences, { chores: true, money: false })
    const registration = { installationId: randomUUID(), subscription: subscription() }
    const unavailable = await other.request('/account/browser-push', registration, 'PUT')
    assert.equal(unavailable.status, 503)
    assert.equal(unavailable.data.code, 'PUSH_NOT_CONFIGURED')
    const invalid = await other.request('/account/browser-push', { ...registration, subscription: { ...registration.subscription, endpoint: 'http://push.example.com/x' } }, 'PUT')
    assert.equal(invalid.status, 400)
    assert.equal((await f.call(path, { native: false })).status, 401)
  })
})
