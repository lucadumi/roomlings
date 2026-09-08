import { createClient } from '@supabase/supabase-js'
import { ApiError } from './errors.ts'

export type VerifiedAccount = { providerId: string; email: string }
export interface AccountProvider {
  sendCode(email: string): Promise<void>
  verifyCode(email: string, code: string): Promise<VerifiedAccount>
  deleteUser(providerId: string): Promise<void>
}

export type SupabaseConfig = { url: string; publishableKey: string; secretKey: string; timeoutMs?: number }

export function createSupabaseProvider(config: SupabaseConfig, fetcher: typeof fetch = fetch): AccountProvider {
  const url = new URL(config.url)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('SUPABASE_URL must be an HTTPS Supabase project URL.')
  }
  const timeoutMs = config.timeoutMs ?? 10_000
  const timedFetch: typeof fetch = async (input, init) => {
    const signal = AbortSignal.timeout(timeoutMs)
    return fetcher(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal })
  }
  // A client is private to each operation: provider sessions never become shared mutable state.
  const client = (admin = false) => createClient(config.url, admin ? config.secretKey : config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  })
  const unavailable = () => new ApiError(503, 'Email sign-in is temporarily unavailable. Please try again.', 'AUTH_PROVIDER_UNAVAILABLE')
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(unavailable()), timeoutMs)
        }),
      ])
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw unavailable()
    } finally {
      clearTimeout(timeout)
    }
  }
  return {
    async sendCode(email) {
      await bounded(async () => {
        const { error } = await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
        if (error?.status === 429) throw new ApiError(429, 'Please wait before requesting another email code.')
        if (error) throw unavailable()
      })
    },
    async verifyCode(email, code) {
      return bounded(async () => {
        const { data, error } = await client().auth.verifyOtp({ email, token: code, type: 'email' })
        if (error?.status === 429) throw new ApiError(429, 'Too many sign-in attempts. Wait and request a fresh code.')
        const rejectedProof = ['otp_expired', 'invalid_credentials', 'user_not_found'].includes(error?.code ?? '')
        if (error && (error.status === undefined || error.status >= 500 || error.status === 0
          || (!rejectedProof && [401, 404].includes(error.status))
          || ['email_provider_disabled', 'otp_disabled', 'provider_disabled', 'bad_jwt', 'no_authorization'].includes(error.code ?? ''))) {
          throw unavailable()
        }
        const user = data.user
        if (error || !data.session || !user?.id || !user.email_confirmed_at || user.email?.trim().toLowerCase() !== email) {
          throw new ApiError(401, 'That email code is invalid or expired. Request a fresh code.', 'INVALID_EMAIL_CODE')
        }
        return { providerId: user.id, email }
      })
    },
    async deleteUser(providerId) {
      await bounded(async () => {
        const { error } = await client(true).auth.admin.deleteUser(providerId)
        if (error && error.code !== 'user_not_found') throw unavailable()
      })
    },
  }
}

export function providerFromEnvironment(env: NodeJS.ProcessEnv = process.env): AccountProvider | undefined {
  const url = env.SUPABASE_URL?.trim()
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim()
  const secretKey = env.SUPABASE_SECRET_KEY?.trim()
  if (!url && !publishableKey && !secretKey) return undefined
  if (!url || !publishableKey || !secretKey) {
    throw new Error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY together. Partial account configuration is not allowed.')
  }
  return createSupabaseProvider({ url, publishableKey, secretKey })
}
