import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { householdSchema } from '../shared/domain.ts'
import type { Session } from '../shared/domain.ts'
import type { AccountKitchenSession, AccountMembership } from '../shared/accounts.ts'
import {
  errorMessage, forgetAccountKitchens, getAccountState, readAccessMode, readToken, rememberKitchen,
  request, RequestError, sameKitchenSession, savedKitchens,
  updateSavedKitchen,
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
    await assert.rejects(request('/account'), (error: unknown) =>
      error instanceof RequestError && error.status === 0 && error.message === 'Connection lost.')
    await assert.rejects(request('/account', { method: 'DELETE' }), (error: unknown) =>
      error instanceof RequestError && error.status === 0 && error.message === 'Connection lost. Unconfirmed request.')
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
        && error.message === 'Server unavailable. Unconfirmed request.')
      assert.equal(calls, 1)
      await assert.rejects(request('/household/room-access'), (error: unknown) =>
        error instanceof RequestError && error.status === status && error.code === 'SERVER_UNAVAILABLE'
        && error.message === 'Server unavailable.')
      assert.equal(calls, 2)
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
      error instanceof RequestError && error.status === 200 && error.message === 'Unreadable server response.')
    await assert.rejects(request('/expenses', { body: {} }), (error: unknown) =>
      error instanceof RequestError && error.status === 200 && error.message === 'Unreadable server response. Unconfirmed request.')
  })

  it('keeps malformed or blank error responses visible without claiming a write failed', async () => {
    for (const body of [{ error: '   ' }, { message: 'Unexpected shape' }, { error: '', code: 'ACCOUNT_DELETION_PENDING' }]) {
      mock.method(globalThis, 'fetch', async () => Response.json(body, { status: 503 }))
      await assert.rejects(request('/expenses', { body: {} }), (error: unknown) =>
        error instanceof RequestError && error.status === 503 && error.message === 'Unexpected response. Unconfirmed request.'
        && error.code === ('code' in body ? body.code : undefined))
    }
  })

  it('uses concise fallbacks for schema diagnostics without hiding useful request errors', () => {
    const result = householdSchema.safeParse({})
    assert.ok(!result.success)
    assert.equal(errorMessage(result.error, 'Save not confirmed. Try again.'), 'Save not confirmed. Try again.')
    assert.equal(errorMessage(new RequestError(409, 'Review the latest room.'), 'Could not save.'), 'Review the latest room.')
    assert.equal(errorMessage(new Error('  Choose an active payer.  '), 'Could not save.'), 'Choose an active payer.')
    assert.equal(errorMessage(new Error(''), 'Could not save.'), 'Could not save.')
    assert.equal(errorMessage(null, 'Could not save.'), 'Could not save.')
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

  it('retains expired shortcuts in both storage generations without revoking unrelated browser access', () => {
    const expired = legacySession()
    const other = legacySession()
    const records = [shortcut(expired), shortcut(other)]
    for (const key of ['roomlings.kitchens', 'coldshare.kitchens']) storage.setItem(key, JSON.stringify(records))
    storage.setItem('roomlings.session', other.token)
    storage.setItem('coldshare.session', expired.token)
    storage.setItem('roomlings.access-mode', 'account')
    const expected = [{ ...shortcut(expired), expired: true }, shortcut(other)]
    assert.deepEqual(updateSavedKitchen(expired.token, { expired: true }), expected)
    assert.deepEqual(JSON.parse(storage.getItem('coldshare.kitchens') ?? ''), expected)
    assert.equal(readToken(), other.token)
    assert.equal(storage.getItem('coldshare.session'), expired.token)
    assert.equal(readAccessMode(), 'account')
    assert.deepEqual(rememberKitchen(expired), [shortcut(expired), shortcut(other)])
    assert.equal(savedKitchens()[0].expired, undefined)
  })

  it('hides retired example shortcuts without guessing by name or rewriting saved records', () => {
    const retired = { ...shortcut(legacySession()), name: 'The Sunday House', demo: true }
    const personal = legacySession()
    personal.household.name = 'The Sunday House'
    const records = JSON.stringify([retired, shortcut(personal)])
    storage.setItem('coldshare.kitchens', records)
    assert.deepEqual(savedKitchens(), [shortcut(personal)])
    assert.equal(storage.getItem('coldshare.kitchens'), records)
    storage.setItem('roomlings.kitchens', records)
    assert.deepEqual(savedKitchens(), [shortcut(personal)])
    assert.equal(storage.getItem('roomlings.kitchens'), records)
    assert.deepEqual(rememberKitchen(personal), [shortcut(personal)])
    assert.deepEqual(JSON.parse(storage.getItem('roomlings.kitchens') ?? ''), [shortcut(personal), retired])
    assert.equal(storage.getItem('coldshare.kitchens'), records)
  })

  it('does not invent missing shortcuts or silently discard unreadable saved access', () => {
    const session = legacySession()
    storage.setItem('roomlings.kitchens', JSON.stringify([shortcut(session)]))
    const before = storage.getItem('roomlings.kitchens')
    assert.deepEqual(updateSavedKitchen('missing-browser-token', { expired: true }), [shortcut(session)])
    assert.equal(storage.getItem('roomlings.kitchens'), before)
    storage.setItem('coldshare.kitchens', 'unreadable saved access')
    assert.throws(() => updateSavedKitchen(session.token, { expired: true }))
    assert.equal(storage.getItem('roomlings.kitchens'), before)
    assert.equal(storage.getItem('coldshare.kitchens'), 'unreadable saved access')
  })

  it('surfaces storage failures rather than claiming shortcut changes were saved', () => {
    const session = legacySession()
    storage.setItem('coldshare.kitchens', JSON.stringify([shortcut(session)]))
    const before = storage.getItem('coldshare.kitchens')
    mock.method(storage, 'setItem', () => { throw new DOMException('Browser storage is full.', 'QuotaExceededError') })
    assert.throws(() => updateSavedKitchen(session.token, { expired: true }), /Browser storage is full/)
    assert.equal(storage.getItem('coldshare.kitchens'), before)
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

  it('ignores obsolete example-session storage while preserving real and Coldshare access', () => {
    const real = legacySession()
    storage.setItem('coldshare.session', real.token)
    storage.setItem('roomlings.sample-session', 'retired-browser-value')
    const calls = mock.method(globalThis, 'fetch', async () => { throw new Error('Access must not be fetched while reading shortcuts.') })
    assert.equal(readToken(), real.token)
    assert.deepEqual(rememberKitchen(real), [shortcut(real)])
    assert.equal(readToken(), real.token)
    assert.equal(storage.getItem('roomlings.sample-session'), 'retired-browser-value')
    assert.equal(storage.getItem('coldshare.session'), real.token)
    assert.equal(calls.mock.callCount(), 0)
  })
})
