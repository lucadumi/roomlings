import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import { createApp } from '../server/app.ts'
import { PushTokenCipher } from '../server/push-crypto.ts'
import { NotificationWorker } from '../server/notification-worker.ts'
import type { PushProvider, PushRequest, PushResult } from '../server/apns.ts'
import type { AccountProvider } from '../server/provider.ts'
import type { AccountSession } from '../server/accounts-store.ts'
import { nativeClientHeader } from '../shared/accounts.ts'
import type { Chore, Household } from '../shared/domain.ts'
import { billingDate, choreSchema } from '../shared/domain.ts'
import type { PushEnvironment } from '../shared/notifications.ts'
import { databaseFixture } from './database-fixture.ts'

export class FakePushProvider implements PushProvider {
  requests: PushRequest[] = []
  environments = new Set<PushEnvironment>(['sandbox', 'production'])
  result: PushResult = { status: 'sent' }
  handle?: (request: PushRequest) => Promise<PushResult>
  closed = false
  supports(environment: PushEnvironment) { return this.environments.has(environment) }
  async send(request: PushRequest) {
    this.requests.push(request)
    return this.handle ? this.handle(request) : this.result
  }
  close() { this.closed = true }
}

export async function notificationFixture(t: TestContext, options: { push?: boolean; now?: string } = {}) {
  let time = Date.parse(options.now ?? '2026-09-20T08:59:00.000Z')
  const now = () => time
  const fixture = await databaseFixture({ now })
  const { store, db } = fixture
  const provider = new FakePushProvider()
  const cipher = new PushTokenCipher(Buffer.alloc(32, 7))
  const push = { provider, cipher, mode: 'inline' as const }
  const logs: string[] = []
  const worker = new NotificationWorker(store, push, { now, log: (message) => logs.push(message) })
  const accounts: AccountProvider = {
    async sendCode() {},
    async verifyCode(email) { return { email, providerId: email } },
    async deleteUser() {},
  }
  const server = createApp(store, { provider: accounts, push: options.push === false ? undefined : push }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  t.after(async () => {
    await worker.stop()
    const closed = once(server, 'close')
    server.close()
    await closed
    await fixture.close()
  })
  const call = async (path: string, options: { method?: string; token?: string; body?: unknown; native?: boolean; headers?: Record<string, string> } = {}) => {
    const response = await fetch(`${origin}/api${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { ...(options.native === false ? {} : { [nativeClientHeader]: 'ios' }), 'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    return { status: response.status, data: await response.json() }
  }
  const signIn = async (email: string, name = 'Roommate') => {
    const issued = await store.accounts.signIn({ providerId: email, email }, name, 'Test iOS app')
    return { ...issued, request: (path: string, body?: unknown, method?: string) => call(path, { body, method, token: issued.token }) }
  }
  const register = async (session: AccountSession, token = randomBytes(37).toString('hex'), installationId = randomUUID(), environment: PushEnvironment = 'sandbox') => {
    await store.notifications.register(session, { token, installationId, environment }, cipher)
    return installationId
  }
  return {
    store, db, provider, cipher, push, worker, logs, now, call, signIn, register,
    advance(ms: number) { time += ms },
    setTime(iso: string) { time = Date.parse(iso) },
    async home() {
      const owner = await signIn('ada@example.com', 'Ada')
      const created = await store.accounts.createHousehold(owner.session, { name: 'Test home', memberName: 'Ada', currency: 'EUR', budget: 45000 })
      const first = created.session!.household
      const invited = await store.accounts.invite(owner.session, first.id, first.version, 7)
      const other = await signIn('ben@example.com', 'Ben')
      const joined = await store.accounts.accept(other.session, invited.code, 'Ben')
      const household = joined.session!.household
      return { owner, other, household, ownerId: created.session!.memberId, otherId: joined.session!.memberId }
    },
  }
}

export function testChore(household: Household, memberId: string, now: number, overrides: Partial<Chore> = {}): Chore {
  return choreSchema.parse({
    id: randomUUID(), title: 'Private chore text', notes: 'Private instructions', roomId: null, area: null,
    dueDate: billingDate(household.billingTimeZone, new Date(now)), repeatDays: null, rotation: [memberId], turn: 0,
    createdBy: memberId, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    version: 0, occurrence: 0, archived: false, ...overrides,
  })
}

export function testExpense(household: Household, actorId: string) {
  return {
    description: 'Private grocery details', amount: 1234, paidBy: actorId,
    participants: household.members.map((member) => member.id), category: 'pantry', date: '2026-09-20',
    version: household.version, mutationId: randomUUID(), mutationVersion: household.version,
  }
}
