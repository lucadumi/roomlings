import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { householdSchema } from '../shared/domain.ts'
import type { Session } from '../shared/domain.ts'
import type { AccountKitchenSession, AccountMembership } from '../shared/accounts.ts'
import {
  forgetAccountKitchens, getAccountState, readAccessMode, readToken, rememberKitchen,
  request, RequestError, sameKitchenSession, savedKitchens,
} from '../src/api.ts'
import type { SavedKitchen } from '../src/api.ts'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

function legacySession(): Session {
  const memberId = randomUUID()
  return {
    token: randomBytes(32).toString('base64url'), memberId,
    household: householdSchema.parse({
      id: randomUUID(), name: 'A saved kitchen', currency: 'EUR', budget: 45000,
      inviteCode: randomBytes(12).toString('base64url'), demo: false, version: 0,
      members: [{ id: memberId, name: 'Ada', color: '#7d9070' }], expenses: [], settlements: [],
    }),
  }
}

function shortcut(session: Session): SavedKitchen {
  return {
    token: session.token, householdId: session.household.id, memberId: session.memberId,
    name: session.household.name, memberName: 'Ada',
  }
}

describe('account-aware client access', () => {
  let storage: MemoryStorage
  let previous: PropertyDescriptor | undefined
  beforeEach(() => {
    storage = new MemoryStorage()
    previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  })
  afterEach(() => {
    mock.restoreAll()
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })

  it('uses cookies, CSRF and an explicit household without a synthetic bearer token', async () => {
    const householdId = randomUUID()
    const csrfToken = randomBytes(32).toString('base64url')
    mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(url, '/api/expenses')
      assert.equal(init?.credentials, 'same-origin')
      assert.equal(init?.method, 'POST')
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('X-Roomlings-Request'), '1')
      assert.equal(headers.get('X-CSRF-Token'), csrfToken)
      assert.equal(headers.get('X-Roomlings-Household'), householdId)
      assert.equal(headers.get('Authorization'), null)
      assert.equal(headers.get('Content-Type'), 'application/json')
      return Response.json({ saved: true })
    })
    assert.deepEqual(await request('/expenses', { token: null, csrfToken, householdId, body: { version: 0 } }), { saved: true })
  })

  it('keeps explicit legacy browser authentication intact', async () => {
    const { token } = legacySession()
    mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('Authorization'), `Bearer ${token}`)
      assert.equal(headers.get('X-CSRF-Token'), null)
      return Response.json({ saved: true })
    })
    await request('/household', { token })
  })

  it('loads an honest unconfigured account state rather than inventing a login', async () => {
    const state = { configured: false, account: null, memberships: [], devices: [], csrfToken: null, session: null }
    mock.method(globalThis, 'fetch', async () => Response.json(state))
    assert.deepEqual(await getAccountState(), state)
    mock.method(globalThis, 'fetch', async () => Response.json({ configured: true }))
    await assert.rejects(getAccountState())
  })

  it('surfaces rejected and offline saves without reporting success', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Verify your email again.' }, { status: 401 }))
    await assert.rejects(request('/account', { method: 'DELETE', body: {} }), (error: unknown) =>
      error instanceof RequestError && error.status === 401 && error.message === 'Verify your email again.')
    mock.method(globalThis, 'fetch', async () => { throw new TypeError('Connection failed') })
    await assert.rejects(request('/account'), (error: unknown) => error instanceof RequestError && error.status === 0)
  })

  it('retains lifecycle error codes so pending deletion is not mistaken for a completed sign-out', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      error: 'Account deletion is queued.', code: 'ACCOUNT_DELETION_PENDING',
    }, { status: 503 }))
    await assert.rejects(request('/account', { method: 'DELETE', body: {} }), (error: unknown) =>
      error instanceof RequestError && error.status === 503 && error.code === 'ACCOUNT_DELETION_PENDING')
  })

  it('reports interrupted proxy responses clearly without retrying a possibly delivered request', async () => {
    for (const status of [500, 502, 503, 504]) {
      let calls = 0
      mock.method(globalThis, 'fetch', async () => {
        calls++
        return new Response(status === 500 ? '' : '<html>Gateway unavailable</html>', { status })
      })
      await assert.rejects(request('/account/code', { body: { email: 'example@example.com' } }), (error: unknown) =>
        error instanceof RequestError && error.status === status && error.code === 'SERVER_UNAVAILABLE'
        && error.message.includes('request was not confirmed'))
      assert.equal(calls, 1)
    }
  })

  it('keeps JSON server errors and malformed successful responses distinct from a failed proxy', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      error: 'Email delivery is temporarily unavailable.', code: 'AUTH_PROVIDER_UNAVAILABLE',
    }, { status: 503 }))
    await assert.rejects(request('/account/code', { body: {} }), (error: unknown) =>
      error instanceof RequestError && error.code === 'AUTH_PROVIDER_UNAVAILABLE'
      && error.message === 'Email delivery is temporarily unavailable.')
    mock.method(globalThis, 'fetch', async () => new Response('<html>Not JSON</html>'))
    await assert.rejects(request('/account'), (error: unknown) =>
      error instanceof RequestError && error.status === 200 && error.message.includes('unreadable response'))
  })

  it('does not put account session credentials or CSRF tokens in browser storage', () => {
    const legacy = legacySession()
    storage.setItem('coldshare.session', legacy.token)
    storage.setItem('coldshare.kitchens', JSON.stringify([shortcut(legacy)]))
    const accountSession: AccountKitchenSession = { ...legacy, token: null }
    assert.deepEqual(rememberKitchen(accountSession), [shortcut(legacy)])
    assert.equal(readAccessMode(), 'account')
    assert.equal(readToken(), legacy.token)
    assert.equal(storage.getItem('roomlings.session'), null)
    assert.equal(storage.getItem('coldshare.session'), legacy.token)
    assert.equal(storage.getItem('roomlings.kitchens'), null)
    assert.equal(storage.length, 3)
  })

  it('preserves Coldshare access and records explicit switches back to a saved browser identity', () => {
    const legacy = legacySession()
    storage.setItem('coldshare.session', legacy.token)
    storage.setItem('coldshare.kitchens', JSON.stringify([shortcut(legacy)]))
    assert.equal(readToken(), legacy.token)
    rememberKitchen({ ...legacy, token: null })
    assert.equal(readAccessMode(), 'account')
    rememberKitchen(legacy)
    assert.equal(readAccessMode(), 'browser')
    assert.equal(readToken(), legacy.token)
    assert.deepEqual(savedKitchens(), [shortcut(legacy)])
    assert.equal(storage.getItem('coldshare.session'), legacy.token)
  })

  it('removes only linked shortcuts after explicit account sign-out or membership removal', () => {
    const linked = legacySession()
    const unrelated = legacySession()
    const records = [shortcut(linked), shortcut(unrelated)]
    for (const key of ['roomlings.kitchens', 'coldshare.kitchens']) storage.setItem(key, JSON.stringify(records))
    for (const key of ['roomlings.session', 'coldshare.session']) storage.setItem(key, linked.token)
    storage.setItem('unrelated.preference', 'keep this')
    const memberships: AccountMembership[] = [{
      householdId: linked.household.id, householdName: linked.household.name,
      memberId: linked.memberId, currency: 'EUR', role: 'owner',
    }]
    assert.deepEqual(forgetAccountKitchens(memberships), [shortcut(unrelated)])
    assert.equal(readToken(), null)
    assert.equal(readAccessMode(), 'account')
    assert.deepEqual(JSON.parse(storage.getItem('coldshare.kitchens') ?? ''), [shortcut(unrelated)])
    assert.equal(storage.getItem('unrelated.preference'), 'keep this')
  })

  it('does not treat two different cookie-authenticated kitchens as the same session', () => {
    const first: AccountKitchenSession = { ...legacySession(), token: null }
    const second: AccountKitchenSession = { ...legacySession(), token: null }
    assert.equal(sameKitchenSession(first, { ...first }), true)
    assert.equal(sameKitchenSession(first, second), false)
    assert.equal(sameKitchenSession(first, { ...first, memberId: randomUUID() }), false)
    assert.equal(sameKitchenSession(first, { ...first, token: randomBytes(32).toString('base64url') }), false)
    assert.equal(sameKitchenSession(first, null), false)
    assert.equal(sameKitchenSession(null, null), false)
  })
})
