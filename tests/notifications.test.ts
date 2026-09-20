import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, createServer, sensitiveHeaders } from 'node:http2'
import type { ServerHttp2Stream } from 'node:http2'
import { once } from 'node:events'
import {
  notificationPreferencesSchema, notificationTargetSchema, pushDeviceSchema,
} from '../shared/notifications.ts'
import { ApnsProvider, apnsHeaders, apnsJwt, apnsResult, apnsTopic, pushFromEnvironment } from '../server/apns.ts'
import type { PushRequest } from '../server/apns.ts'
import { PushTokenCipher, PushTokenProtectionError } from '../server/push-crypto.ts'
import { dailyChoreWindow, assignedDueChores, summaryComponent } from '../server/notification-schedule.ts'
import { componentChoreArea, getRoomComponents } from '../shared/roomComponents.ts'
import { notificationFixture, testChore } from './notifications-fixture.ts'

describe('native push wire validation and protection', () => {
  it('accepts variable even hex tokens and rejects malformed or extra input fields', () => {
    const input = { installationId: randomUUID(), token: 'AF', environment: 'sandbox' }
    for (const length of [2, 64, 74, 1024]) {
      assert.equal(pushDeviceSchema.parse({ ...input, token: 'AB'.repeat(length / 2) }).token.length, length)
    }
    assert.equal(pushDeviceSchema.parse(input).token, 'af')
    for (const change of [
      { token: '' }, { token: 'A' }, { token: 'abc' }, { token: 'ag' }, { token: 'aa '.repeat(3) },
      { token: 'aa'.repeat(513) }, { installationId: 'not-an-id' }, { environment: 'development' }, { accountId: randomUUID() },
    ]) assert.equal(pushDeviceSchema.safeParse({ ...input, ...change }).success, false)
    assert.deepEqual(notificationPreferencesSchema.parse({ chores: true, money: false }), { chores: true, money: false })
    for (const input of [{ chores: true }, { chores: 'true', money: true }, { chores: true, money: true, version: 0 }]) {
      assert.equal(notificationPreferencesSchema.safeParse(input).success, false)
    }
    const target = { version: 1, kind: 'expense', householdId: randomUUID(), expenseId: randomUUID() }
    assert.ok(notificationTargetSchema.safeParse(target).success)
    for (const change of [
      { expenseId: undefined }, { version: 2 }, { componentId: 'https://example.com' },
      { url: 'https://example.com' }, { description: 'Private text' }, { settlementId: randomUUID() },
    ]) assert.equal(notificationTargetSchema.safeParse({ ...target, ...change }).success, false)
  })

  it('encrypts with fresh IVs, keyed lookup hashes and authenticated registration context', () => {
    const cipher = new PushTokenCipher(Buffer.alloc(32, 1))
    const other = new PushTokenCipher(Buffer.alloc(32, 2))
    const token = 'abab'.repeat(32)
    const sealed = cipher.encrypt(token, 'account/session/installation/revision')
    assert.ok(!sealed.includes(token))
    assert.notEqual(sealed, cipher.encrypt(token, 'account/session/installation/revision'))
    assert.equal(cipher.decrypt(sealed, 'account/session/installation/revision'), token)
    assert.notEqual(cipher.fingerprint(token), other.fingerprint(token))
    for (const operation of [
      () => cipher.decrypt(sealed, 'different-account'),
      () => other.decrypt(sealed, 'account/session/installation/revision'),
      () => cipher.decrypt(sealed.slice(0, -4) + 'abcd', 'account/session/installation/revision'),
      () => cipher.decrypt('v2.bad', 'account/session/installation/revision'),
    ]) assert.throws(operation, PushTokenProtectionError)
  })
})

describe('APNs protocol without network access', () => {
  it('signs ES256 provider JWTs and sets alert, expiration and stable dedup headers', () => {
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const now = Date.parse('2026-09-20T09:00:00Z')
    const jwt = apnsJwt({ key: keys.privateKey, keyId: 'ABCDEFGHIJ', teamId: 'KLMNOPQRST' }, now)
    const [header, claims, signature] = jwt.split('.')
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'ES256', kid: 'ABCDEFGHIJ' })
    assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), { iss: 'KLMNOPQRST', iat: now / 1000 })
    assert.equal(Buffer.from(signature, 'base64url').length, 64)
    assert.ok(verify('sha256', Buffer.from(`${header}.${claims}`), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')))
    const id = randomUUID()
    const headers = apnsHeaders({
      id, token: 'aa', environment: 'sandbox', collapseId: 'b'.repeat(64), expiration: now / 1000 + 3600,
      payload: { aps: { alert: { title: 'Roomlings', body: 'You have chores due today.' }, 'thread-id': 'roomlings', sound: 'default' },
        roomlings: { version: 1, kind: 'chores', householdId: randomUUID() } },
    }, jwt)
    assert.equal(headers[':method'], 'POST')
    assert.equal(headers[':path'], '/3/device/aa')
    assert.equal(headers['apns-push-type'], 'alert')
    assert.equal(headers['apns-topic'], apnsTopic)
    assert.equal(headers['apns-id'], id)
    assert.equal(headers['apns-expiration'], String(now / 1000 + 3600))
    assert.deepEqual(Reflect.get(headers, sensitiveHeaders), [':path', 'authorization'])
  })

  it('distinguishes invalid registrations, transient limits and rejected provider credentials without retaining raw errors', () => {
    const now = Date.parse('2026-09-20T09:00:00Z')
    assert.deepEqual(apnsResult(200, '', undefined, now), { status: 'sent' })
    assert.deepEqual(apnsResult(410, JSON.stringify({ timestamp: now - 1000, reason: 'Unregistered' }), undefined, now),
      { status: 'invalid', invalidatedAt: now - 1000 })
    for (const reason of ['BadDeviceToken', 'DeviceTokenNotForTopic']) {
      assert.deepEqual(apnsResult(400, JSON.stringify({ reason }), undefined, now), { status: 'invalid' })
    }
    assert.deepEqual(apnsResult(429, '{"private":"upstream"}', '60', now), { status: 'retry', reason: 'rate-limited', retryAfterMs: 60_000 })
    assert.deepEqual(apnsResult(503, 'not json', new Date(now + 10_000).toUTCString(), now), { status: 'retry', reason: 'unavailable', retryAfterMs: 10_000 })
    assert.deepEqual(apnsResult(500, '', undefined, now), { status: 'retry', reason: 'unavailable' })
    assert.deepEqual(apnsResult(403, '{"reason":"private provider detail"}', undefined, now), { status: 'failed', reason: 'provider-auth' })
    assert.deepEqual(apnsResult(400, '{"reason":"BadTopic"}', undefined, now), { status: 'failed', reason: 'rejected' })
    assert.deepEqual(apnsResult(410, '{"timestamp":"bad"}', undefined, now), { status: 'invalid' })
    assert.deepEqual(apnsResult(410, '{"timestamp":9000000000000000}', undefined, now), { status: 'invalid' })
  })

  it('delivers over injected loopback HTTP/2, reuses connections and refreshes JWTs only after 50 minutes', async (t) => {
    let now = Date.parse('2026-09-20T09:00:00Z')
    let connections = 0
    const received: { authorization: string; payload: unknown; path: string }[] = []
    const server = createServer()
    server.on('stream', (stream: ServerHttp2Stream, headers) => {
      let body = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => { body += chunk })
      stream.on('end', () => {
        received.push({ authorization: String(headers.authorization), payload: JSON.parse(body), path: String(headers[':path']) })
        if (received.length === 4) {
          stream.respond({ ':status': 429, 'retry-after': '10' })
          stream.end('{"reason":"TooManyRequests","private":"never retain this"}')
        } else { stream.respond({ ':status': 200 }); stream.end() }
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
    const provider = new ApnsProvider({ sandbox: { key, keyId: 'ABCDEFGHIJ', teamId: 'KLMNOPQRST' } }, () => now, (endpoint) => {
      assert.equal(endpoint, 'https://api.sandbox.push.apple.com')
      connections++
      return connect(`http://127.0.0.1:${address.port}`)
    })
    t.after(async () => {
      provider.close()
      const closed = once(server, 'close')
      server.close()
      await closed
    })
    const request: PushRequest = {
      id: randomUUID(), environment: 'sandbox', token: 'ab'.repeat(37), collapseId: 'c'.repeat(64), expiration: now / 1000 + 3600,
      payload: { aps: { alert: { title: 'Roomlings', body: 'You have chores due today.' }, 'thread-id': 'roomlings', sound: 'default' },
        roomlings: { version: 1, kind: 'chores', householdId: randomUUID() } },
    }
    assert.deepEqual(await provider.send(request), { status: 'sent' })
    now += 21 * 60_000
    assert.deepEqual(await provider.send(request), { status: 'sent' })
    assert.equal(received[0].authorization, received[1].authorization)
    now += 29 * 60_000
    assert.deepEqual(await provider.send(request), { status: 'sent' })
    assert.notEqual(received[0].authorization, received[2].authorization)
    assert.equal(connections, 1)
    assert.deepEqual(received[0].payload, request.payload)
    assert.equal(received[0].path, `/3/device/${request.token}`)
    assert.deepEqual(await provider.send(request), { status: 'retry', reason: 'rate-limited', retryAfterMs: 10_000 })
    assert.deepEqual(await provider.send({ ...request, environment: 'production' }), { status: 'failed', reason: 'provider-auth' })
    assert.equal(connections, 1)
  })

  it('requires complete protected-token and environment-scoped P-256 configuration', (t) => {
    assert.equal(pushFromEnvironment({}), undefined)
    assert.equal(pushFromEnvironment({ PUSH_WORKER_MODE: 'disabled' }), undefined)
    assert.throws(() => pushFromEnvironment({ PUSH_WORKER_MODE: 'wrong' }), /PUSH_WORKER_MODE/)
    assert.throws(() => pushFromEnvironment({ APNS_TEAM_ID: 'ABCDEFGHIJ' }), /ENCRYPTION_KEY/)
    const directory = join('test-results', `push-config-${randomUUID()}`)
    mkdirSync(directory, { recursive: true })
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'pem', type: 'pkcs8' })
    const path = join(directory, 'test-key.p8')
    writeFileSync(path, key, { mode: 0o600 })
    const env = {
      APNS_TEAM_ID: 'ABCDEFGHIJ', PUSH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      APNS_SANDBOX_KEY_ID: 'KLMNOPQRST', APNS_SANDBOX_KEY_PATH: path, PUSH_WORKER_MODE: 'external',
    }
    const configured = pushFromEnvironment(env)!
    assert.equal(configured.mode, 'external')
    assert.equal(configured.provider.supports('sandbox'), true)
    assert.equal(configured.provider.supports('production'), false)
    configured.provider.close()
    assert.throws(() => pushFromEnvironment({ ...env, APNS_TOPIC: 'another.app' }), /com.roomlings.app/)
    assert.throws(() => pushFromEnvironment({ ...env, APNS_PRODUCTION_KEY_ID: 'KLMNOPQRST' }), /file path/)
    assert.throws(() => pushFromEnvironment({ ...env, APNS_SANDBOX_KEY_PATH: `${directory}/missing.p8` }), /could not be loaded/)
  })
})

describe('household-local daily scheduling', () => {
  it('fires at local 09:00 across offsets and both DST transitions, with a bounded catch-up window', () => {
    for (const [zone, instant, date] of [
      ['UTC', '2026-09-20T09:00:00Z', '2026-09-20'],
      ['Europe/Rome', '2026-03-29T07:00:00Z', '2026-03-29'],
      ['Europe/Rome', '2026-10-25T08:00:00Z', '2026-10-25'],
      ['America/New_York', '2026-03-08T13:00:00Z', '2026-03-08'],
      ['America/New_York', '2026-11-01T14:00:00Z', '2026-11-01'],
      ['Pacific/Kiritimati', '2026-09-19T19:00:00Z', '2026-09-20'],
      ['Asia/Kathmandu', '2026-09-20T03:15:00Z', '2026-09-20'],
      ['Australia/Lord_Howe', '2026-10-04T22:00:00Z', '2026-10-05'],
    ]) {
      const now = new Date(instant)
      const expiry = new Date(now.getTime() + 3_600_000).toISOString()
      assert.equal(dailyChoreWindow(zone, new Date(now.getTime() - 1)), null, zone)
      assert.deepEqual(dailyChoreWindow(zone, now), { date, expiresAt: expiry }, zone)
      assert.deepEqual(dailyChoreWindow(zone, new Date(now.getTime() + 3_599_999)), { date, expiresAt: expiry }, zone)
      assert.equal(dailyChoreWindow(zone, new Date(expiry)), null, zone)
    }
  })

  it('reuses authoritative assignment/status and ignores archived, paused, completed and upcoming chores', async (t) => {
    const f = await notificationFixture(t)
    const { household, ownerId, otherId } = await f.home()
    const component = getRoomComponents(household).find((entry) => entry.kind === 'sink')!
    assert.ok(component)
    household.chores.items = [
      testChore(household, ownerId, f.now(), {
        componentId: component.id, roomId: component.roomId, area: componentChoreArea(component),
        rotation: [otherId, ownerId],
      }),
      testChore(household, ownerId, f.now(), { dueDate: '2026-09-19', archived: true }),
      testChore(household, ownerId, f.now(), { dueDate: '2026-09-21' }),
      testChore(household, ownerId, f.now(), { dueDate: null }),
    ]
    household.members.find((member) => member.id === otherId)!.inactive = true
    const before = JSON.stringify(household)
    assert.equal(assignedDueChores(household, ownerId, '2026-09-20').length, 1)
    assert.equal(summaryComponent(household, ownerId, '2026-09-20'), component.id)
    assert.equal(JSON.stringify(household), before)
    household.chores.items.push(testChore(household, ownerId, f.now(), { dueDate: '2026-09-19' }))
    assert.equal(assignedDueChores(household, ownerId, '2026-09-20').length, 2)
    assert.equal(summaryComponent(household, ownerId, '2026-09-20'), undefined)
    household.roomComponents = getRoomComponents(household).map((entry) => entry.id === component.id ? { ...entry, installed: false } : entry)
    assert.equal(assignedDueChores(household, ownerId, '2026-09-20').length, 1)
  })
})
