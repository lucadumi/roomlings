import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Store } from '../server/store.ts'
import { createApp } from '../server/app.ts'
import { accessStateSchema, recoveryCodePrefix, recoveryRotationSchema } from '../shared/access.ts'
import { householdSchema, localDate } from '../shared/domain.ts'
import type { Session } from '../shared/domain.ts'

describe('roommate recovery and browser access', () => {
  let store: Store
  let server: Server
  let origin: string
  beforeEach(async () => {
    store = new Store(':memory:')
    server = createApp(store).listen(0, '127.0.0.1')
    await once(server, 'listening')
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterEach(async () => {
    server.close()
    await once(server, 'close')
    store.close()
  })
  const call = (path: string, body?: unknown, token?: string, method?: string) => fetch(`${origin}/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const create = async (): Promise<Session> => {
    const response = await call('/households', { name: 'The recovery house', memberName: 'Ada', currency: 'EUR', budget: 45000 })
    assert.equal(response.status, 201)
    return response.json()
  }
  const access = async (token: string) => {
    const response = await call('/access', undefined, token)
    assert.equal(response.status, 200)
    return accessStateSchema.parse(await response.json())
  }
  const generate = async (token: string, version = 0, revokeOthers = false) => {
    const response = await call('/access/recovery', { version, revokeOthers }, token)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return recoveryRotationSchema.parse(await response.json())
  }
  const recover = async (code: string, label = 'Phone'): Promise<Session> => {
    const response = await call('/recover', { code, label })
    assert.equal(response.status, 201)
    return response.json()
  }

  it('restores the original roommate without changing bills, repayments or ledger versions', async () => {
    const owner = await create()
    const joined: Session = await (await call('/join', { inviteCode: owner.household.inviteCode, name: 'Ben' })).json()
    const members = joined.household.members.map((member) => member.id)
    const month = localDate().slice(0, 7)
    const bill = householdSchema.parse((await (await call('/bills', {
      name: 'Rent', amount: 90000, firstDueDate: `${month}-01`, participants: members, version: 1,
    }, owner.token)).json()).household).bills[0]
    assert.equal((await call(`/bills/${bill.id}/payments`, {
      month, amount: 90001, paidBy: owner.memberId, participants: members, date: localDate(), version: 2,
    }, owner.token)).status, 200)
    assert.equal((await call('/settlements', {
      from: joined.memberId, to: owner.memberId, amount: 1000, version: 3,
    }, owner.token)).status, 200)
    const before = (await (await call('/household', undefined, owner.token)).json()).household
    const initial = await access(owner.token)
    assert.equal(initial.recovery.enabled, false)
    assert.equal(initial.recovery.version, 0)
    const generated = await generate(owner.token)
    const restored = await recover(generated.code, 'Travel laptop')
    assert.equal(restored.memberId, owner.memberId)
    assert.equal(restored.household.id, owner.household.id)
    assert.deepEqual(restored.household, before)
    assert.notEqual(restored.token, owner.token)
    const devices = await access(restored.token)
    assert.equal(devices.devices.length, 2)
    assert.equal(devices.devices.find((device) => device.current)?.label, 'Travel laptop')
    assert.equal(JSON.stringify(devices).includes(generated.code), false)
    assert.equal(JSON.stringify(devices).includes(owner.token), false)
    assert.equal((await call('/household', undefined, owner.token)).status, 200)
    assert.deepEqual((await (await call('/household', undefined, owner.token)).json()).household, before)
  })

  it('rotates versioned recovery codes and optionally revokes other sessions atomically', async () => {
    const owner = await create()
    const original = await generate(owner.token)
    const phone = await recover(original.code)
    assert.equal((await call('/access/recovery', { version: 0, revokeOthers: true }, owner.token)).status, 409)
    assert.equal((await call('/household', undefined, phone.token)).status, 200)
    const replacement = await generate(owner.token, 1)
    assert.equal((await call('/recover', { code: original.code, label: 'Old code' })).status, 401)
    assert.equal((await call('/household', undefined, phone.token)).status, 200)
    const final = await generate(owner.token, 2, true)
    assert.equal(final.access.devices.length, 1)
    assert.equal(final.access.devices[0].current, true)
    assert.equal((await call('/household', undefined, phone.token)).status, 401)
    assert.equal((await call('/access/recovery', { version: 3, revokeOthers: true }, phone.token)).status, 401)
    assert.equal((await call('/recover', { code: replacement.code, label: 'Replaced code' })).status, 401)
    assert.equal((await recover(final.code)).memberId, owner.memberId)
    assert.equal((await call('/household', undefined, owner.token)).status, 200)
  })

  it('allows only one concurrent rotation of a recovery version', async () => {
    const owner = await create()
    const responses = await Promise.all([
      call('/access/recovery', { version: 0, revokeOthers: false }, owner.token),
      call('/access/recovery', { version: 0, revokeOthers: false }, owner.token),
    ])
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
    const winner = responses.find((response) => response.status === 200)
    assert.ok(winner)
    const result = recoveryRotationSchema.parse(await winner.json())
    assert.equal((await access(owner.token)).recovery.version, 1)
    assert.equal((await recover(result.code)).memberId, owner.memberId)
  })

  it('keeps device lists and revocation scoped to the signed-in roommate', async () => {
    const owner = await create()
    const generated = await generate(owner.token)
    const phone = await recover(generated.code)
    const joined: Session = await (await call('/join', { inviteCode: owner.household.inviteCode, name: 'Ben' })).json()
    const other = await create()
    const ownerAccess = await access(owner.token)
    const current = ownerAccess.devices.find((device) => device.current)
    const remote = ownerAccess.devices.find((device) => !device.current)
    assert.ok(current)
    assert.ok(remote)
    assert.equal((await access(joined.token)).devices.length, 1)
    assert.equal((await call(`/access/devices/${remote.id}`, undefined, joined.token, 'DELETE')).status, 404)
    assert.equal((await call(`/access/devices/${remote.id}`, undefined, other.token, 'DELETE')).status, 404)
    assert.equal((await call(`/access/devices/${current.id}`, undefined, owner.token, 'DELETE')).status, 409)
    const renamed = await call('/access/device', { label: 'Home laptop' }, owner.token, 'PATCH')
    assert.equal(renamed.status, 200)
    assert.equal(accessStateSchema.parse(await renamed.json()).devices.find((device) => device.current)?.label, 'Home laptop')
    assert.equal((await call(`/access/devices/${remote.id}`, undefined, owner.token, 'DELETE')).status, 200)
    assert.equal((await call('/household', undefined, phone.token)).status, 401)
    assert.equal((await access(owner.token)).devices.length, 1)
    assert.equal((await call('/household', undefined, joined.token)).status, 200)
    assert.equal((await call('/household', undefined, other.token)).status, 200)
  })

  it('validates access changes without exposing or consuming a valid recovery code', async () => {
    const owner = await create()
    assert.equal((await call('/access')).status, 401)
    assert.equal((await call('/access/recovery', { version: 0 })).status, 401)
    assert.equal((await call('/access/recovery', { version: -1 }, owner.token)).status, 400)
    assert.equal((await call('/access/device', { label: '' }, owner.token, 'PATCH')).status, 400)
    assert.equal((await call('/recover', { code: 'not-a-code', label: 'Phone' })).status, 400)
    const generated = await generate(owner.token)
    assert.equal((await call('/recover', { code: generated.code, label: '' })).status, 400)
    assert.equal((await recover(`  ${generated.code}  `)).memberId, owner.memberId)
    assert.equal((await recover(generated.code, 'Another browser')).memberId, owner.memberId)
  })

  it('rate-limits recovery attempts independently of ordinary kitchen requests', async () => {
    const code = `${recoveryCodePrefix}${randomBytes(32).toString('base64url')}`
    for (let attempt = 0; attempt < 20; attempt++) {
      assert.equal((await call('/recover', { code, label: 'A browser' })).status, 401)
    }
    const limited = await call('/recover', { code, label: 'A browser' })
    assert.equal(limited.status, 429)
    assert.match((await limited.json()).error, /Wait a minute/)
    assert.equal((await call('/health')).status, 200)
  })
})
