import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createSupabaseProvider, providerFromEnvironment } from '../server/provider.ts'
import { ApiError } from '../server/errors.ts'

const config = { url: 'https://project.supabase.co', publishableKey: 'test-publishable-key', secretKey: 'test-server-only-secret', timeoutMs: 200 }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
})
const user = { id: randomUUID(), email: 'ada@example.com', email_confirmed_at: new Date().toISOString(), aud: 'authenticated' }
const verified = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'test-provider-access-token', refresh_token: 'test-provider-refresh-token',
  expires_in: 3600, token_type: 'bearer', user: { ...user, ...overrides },
})

describe('server-only Supabase verified-email adapter', () => {
  it('sends OTP codes with account creation enabled and verifies email OTP without exposing provider sessions', async () => {
    const calls: { path: string; body: unknown; headers: Headers }[] = []
    const provider = createSupabaseProvider(config, async (input, init) => {
      const path = new URL(String(input)).pathname
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null, headers: new Headers(init?.headers) })
      return json(path.endsWith('/verify') ? verified() : {})
    })
    await provider.sendCode('ada@example.com')
    const result = await provider.verifyCode('ada@example.com', '123456')
    await provider.sendCode('ben@example.com')
    assert.deepEqual(result, { providerId: user.id, email: 'ada@example.com' })
    assert.equal(calls[0].path, '/auth/v1/otp')
    assert.equal((calls[0].body as { create_user: boolean }).create_user, true)
    assert.equal((calls[0].body as { email: string }).email, 'ada@example.com')
    assert.equal(calls[1].path, '/auth/v1/verify')
    assert.equal((calls[1].body as { type: string }).type, 'email')
    assert.equal((calls[1].body as { token: string }).token, '123456')
    assert.equal(calls[2].headers.get('authorization'), 'Bearer test-publishable-key')
    assert.ok(!JSON.stringify(result).includes('provider-access'))
    assert.ok(!JSON.stringify(result).includes('provider-refresh'))
  })

  it('uses the server admin secret for deletion and treats only provider user-not-found as already deleted', async () => {
    let missing = false
    const provider = createSupabaseProvider(config, async (input, init) => {
      assert.equal(new URL(String(input)).pathname, `/auth/v1/admin/users/${user.id}`)
      assert.equal(init?.method, 'DELETE')
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-server-only-secret')
      return missing ? json({ code: 'user_not_found', msg: 'User not found' }, 404) : json({ user })
    })
    await provider.deleteUser(user.id)
    missing = true
    await provider.deleteUser(user.id)
    const invalid = createSupabaseProvider(config, async () => json({ code: 'unexpected_failure', msg: 'Private details' }, 404))
    await assert.rejects(invalid.deleteUser(user.id), (error: unknown) => error instanceof ApiError && error.status === 503 && !error.message.includes('Private details'))
  })

  it('rejects missing confirmations, mismatched emails, missing sessions, and invalid OTP codes', async () => {
    for (const body of [verified({ email_confirmed_at: null }), verified({ email: 'different@example.com' }), { user }]) {
      const provider = createSupabaseProvider(config, async () => json(body))
      await assert.rejects(provider.verifyCode('ada@example.com', '123456'), (error: unknown) => error instanceof ApiError && error.status === 401)
    }
    const invalid = createSupabaseProvider(config, async () => json({ code: 'otp_expired', msg: 'Token has expired' }, 403))
    await assert.rejects(invalid.verifyCode('ada@example.com', '123456'), (error: unknown) => error instanceof ApiError && error.status === 401)
  })

  it('surfaces delivery/deletion failures and rate limits without leaking provider errors', async () => {
    const failed = createSupabaseProvider(config, async () => json({ code: 'unexpected_failure', msg: 'Private SMTP configuration' }, 500))
    await assert.rejects(failed.sendCode('ada@example.com'), (error: unknown) => error instanceof ApiError && error.status === 503 && !error.message.includes('SMTP'))
    await assert.rejects(failed.deleteUser(user.id), (error: unknown) => error instanceof ApiError && error.status === 503)
    const limited = createSupabaseProvider(config, async () => json({ msg: 'Too many requests' }, 429))
    await assert.rejects(limited.sendCode('ada@example.com'), (error: unknown) => error instanceof ApiError && error.status === 429)
    await assert.rejects(limited.verifyCode('ada@example.com', '123456'), (error: unknown) => error instanceof ApiError && error.status === 429)
  })

  it('bounds unresponsive provider requests and requires complete HTTPS configuration', async () => {
    const stalled = createSupabaseProvider({ ...config, timeoutMs: 20 }, () => new Promise<Response>(() => {}))
    const start = Date.now()
    await assert.rejects(stalled.sendCode('ada@example.com'), (error: unknown) => error instanceof ApiError && error.status === 503)
    assert.ok(Date.now() - start < 1000)
    assert.equal(providerFromEnvironment({}), undefined)
    assert.throws(() => providerFromEnvironment({ SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: config.publishableKey }), /Partial account configuration/)
    assert.ok(providerFromEnvironment({ SUPABASE_URL: config.url, SUPABASE_PUBLISHABLE_KEY: config.publishableKey, SUPABASE_SECRET_KEY: config.secretKey }))
    assert.throws(() => createSupabaseProvider({ ...config, url: 'http://project.supabase.co' }))
  })

  it('refuses production startup rather than falling back to unauthenticated household creation', () => {
    const result = spawnSync(process.execPath, [join('server', 'index.ts'), '--production'], {
      encoding: 'utf8', timeout: 10_000,
      env: {
        ...process.env, NODE_ENV: 'test', APP_ORIGIN: '',
        SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SECRET_KEY: '',
      },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Production startup requires complete Supabase account configuration/)
  })
})
