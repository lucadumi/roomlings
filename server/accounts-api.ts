import { createHash, timingSafeEqual } from 'node:crypto'
import type { Express, Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import {
  acceptAccountInvitationSchema, accountVersionSchema, createAccountInvitationSchema,
  deleteAccountSchema, linkAccountSchema, sendAccountCodeSchema, transferOwnershipSchema, verifyAccountCodeSchema,
} from '../shared/accounts.ts'
import { centsSchema, currencies, nameSchema } from '../shared/domain.ts'
import type { AccountState } from '../shared/accounts.ts'
import type { AccountSession } from './accounts-store.ts'
import { accountAbsoluteLifetime } from './accounts-store.ts'
import type { AccountProvider } from './provider.ts'
import type { Store } from './store.ts'
import { ApiError } from './errors.ts'

export type AccountOptions = {
  provider?: AccountProvider
  appOrigin?: string
  allowLocalDevelopment?: boolean
}
export const accountCookieName = 'roomlings_session'
const isMutation = (req: Request) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
const unavailable = () => new ApiError(503, 'Account sign-in is not configured. The server owner must configure Supabase verified-email codes.', 'AUTH_NOT_CONFIGURED')
const noSession = () => new ApiError(401, 'Sign in with your email code to continue.', 'ACCOUNT_SESSION_REQUIRED')

function limit(maximum: number, duration: number, key: (req: Request) => string): RequestHandler {
  const attempts = new Map<string, { count: number; expires: number }>()
  return (req, _res, next) => {
    const now = Date.now()
    for (const [value, attempt] of attempts) if (attempt.expires <= now) attempts.delete(value)
    const value = createHash('sha256').update(key(req)).digest('hex')
    const attempt = attempts.get(value) ?? { count: 0, expires: now + duration }
    attempt.count++
    attempts.set(value, attempt)
    if (attempt.count > maximum) return next(new ApiError(429, 'Too many sign-in attempts. Wait a few minutes and try again.'))
    next()
  }
}

export function installAccounts(app: Express, store: Store, options: AccountOptions) {
  const provider = options.provider
  const origin = new URL(options.appOrigin ?? 'http://localhost:5173')
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))) {
    throw new Error('APP_ORIGIN must be an HTTPS origin, or HTTP on loopback for local preview.')
  }
  const allowedOrigins = new Set([origin.origin])
  if (options.allowLocalDevelopment && loopback) {
    allowedOrigins.add('http://localhost:5173')
    allowedOrigins.add('http://127.0.0.1:5173')
  }
  const cookieOptions = { httpOnly: true, secure: origin.protocol === 'https:', sameSite: 'lax' as const, path: '/api' }
  const clearCookie = (res: Response) => res.clearCookie(accountCookieName, cookieOptions)
  const signedOut = (): AccountState => ({
    configured: !!provider, account: null, memberships: [], devices: [], csrfToken: null, session: null,
  })
  const browserRequest = (req: Request) => {
    const requestOrigin = req.get('origin')
    if (req.get('X-Roomlings-Request') !== '1'
      || (requestOrigin !== undefined && !allowedOrigins.has(requestOrigin))
      || (req.get('sec-fetch-site') === 'cross-site' && !requestOrigin)) {
      throw new ApiError(403, 'This account action must come from the Roomlings app.', 'CSRF_REJECTED')
    }
  }
  const current = (req: Request, res: Response) => {
    const cookies = (req.headers.cookie ?? '').split(';').map((entry) => entry.trim())
      .filter((entry) => entry.startsWith(`${accountCookieName}=`))
    if (!cookies.length) return null
    const token = cookies.length === 1 ? cookies[0].slice(accountCookieName.length + 1) : ''
    const session = /^[A-Za-z0-9_-]{43}$/.test(token) ? store.accounts.authenticate(token) : null
    if (!session) clearCookie(res)
    return session
  }
  const csrf = (req: Request, session: AccountSession) => {
    browserRequest(req)
    const supplied = req.get('X-CSRF-Token') ?? ''
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrfToken))) {
      throw new ApiError(403, 'This browser safety token has expired. Refresh the page and try again.', 'CSRF_REJECTED')
    }
  }
  const authenticated = (req: Request, res: Response, allowDeleting = false) => {
    const session = current(req, res)
    if (!session) throw noSession()
    if (isMutation(req)) csrf(req, session)
    if (session.deleting && !allowDeleting) {
      throw new ApiError(409, 'Account deletion is pending. Kitchen access is disabled; retry deletion to finish.', 'ACCOUNT_DELETION_PENDING')
    }
    return session
  }
  const invokeProvider = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation() } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(503, 'The email account provider is unavailable. Please try again.', 'AUTH_PROVIDER_UNAVAILABLE')
    }
  }
  const configured: RequestHandler = (req, _res, next) => {
    if (!provider) return next(unavailable())
    if (isMutation(req)) browserRequest(req)
    next()
  }
  app.get('/api/account', (req, res) => {
    const session = current(req, res)
    res.json(session ? { ...store.accounts.state(session), configured: !!provider } : signedOut())
  })
  app.use('/api/account', configured)
  const ip = (req: Request) => req.ip ?? 'local'
  const email = (req: Request) => sendAccountCodeSchema.parse(req.body).email
  app.post('/api/account/code',
    limit(20, 15 * 60_000, ip), limit(5, 15 * 60_000, email), async (req, res) => {
      const input = sendAccountCodeSchema.parse(req.body)
      await invokeProvider(() => provider!.sendCode(input.email))
      res.json({ sent: true })
    })
  app.post('/api/account/verify',
    limit(30, 10 * 60_000, ip), limit(10, 10 * 60_000, email), async (req, res) => {
      const input = verifyAccountCodeSchema.parse(req.body)
      const identity = await invokeProvider(() => provider!.verifyCode(input.email, input.code))
      if (!identity.providerId || identity.email !== input.email) throw new ApiError(401, 'The verified email did not match the requested account.')
      const { token, session } = store.accounts.signIn(identity, input.name, input.label)
      res.cookie(accountCookieName, token, { ...cookieOptions, maxAge: accountAbsoluteLifetime })
      res.json(store.accounts.state(session))
    })
  app.patch('/api/account', (req, res) => {
    const session = authenticated(req, res)
    const { name } = z.object({ name: nameSchema }).parse(req.body)
    res.json(store.accounts.profile(session, name))
  })
  app.patch('/api/account/device', (req, res) => {
    const session = authenticated(req, res)
    const { label } = z.object({ label: nameSchema }).parse(req.body)
    res.json(store.accounts.renameDevice(session, label))
  })
  app.post('/api/account/logout', (req, res) => {
    const session = authenticated(req, res, true)
    const { all } = z.object({ all: z.boolean() }).parse(req.body)
    store.accounts.logout(session, all)
    clearCookie(res)
    res.json(signedOut())
  })
  app.delete('/api/account/devices/:id', (req, res) => {
    const session = authenticated(req, res)
    const state = store.accounts.revokeDevice(session, z.string().uuid().parse(req.params.id))
    if (!state) clearCookie(res)
    res.json(state ?? signedOut())
  })
  app.post('/api/account/link', (req, res) => {
    res.json(store.accounts.link(authenticated(req, res), linkAccountSchema.parse(req.body)))
  })
  app.post('/api/account/households', (req, res) => {
    const session = authenticated(req, res)
    const input = z.object({ name: nameSchema, memberName: nameSchema, currency: z.enum(currencies), budget: centsSchema }).parse(req.body)
    res.status(201).json(store.accounts.createHousehold(session, input))
  })
  app.post('/api/account/households/:id/select', (req, res) => {
    res.json(store.accounts.select(authenticated(req, res), z.string().uuid().parse(req.params.id)))
  })
  app.get('/api/account/households/:id', (req, res) => {
    res.json(store.accounts.access(authenticated(req, res), z.string().uuid().parse(req.params.id)))
  })
  app.post('/api/account/households/:id/invitations', (req, res) => {
    const session = authenticated(req, res)
    const input = createAccountInvitationSchema.parse(req.body)
    res.status(201).json(store.accounts.invite(session, z.string().uuid().parse(req.params.id), input.version, input.expiresInDays))
  })
  app.delete('/api/account/households/:id/invitations/:inviteId', (req, res) => {
    const session = authenticated(req, res)
    const { version } = accountVersionSchema.parse(req.body)
    res.json(store.accounts.revokeInvitation(session, z.string().uuid().parse(req.params.id), z.string().uuid().parse(req.params.inviteId), version))
  })
  app.post('/api/account/invitations/accept', (req, res) => {
    const session = authenticated(req, res)
    const input = acceptAccountInvitationSchema.parse(req.body)
    res.json(store.accounts.accept(session, input.code, input.memberName))
  })
  app.post('/api/account/households/:id/owner', (req, res) => {
    const session = authenticated(req, res)
    const input = transferOwnershipSchema.parse(req.body)
    res.json(store.accounts.transfer(session, z.string().uuid().parse(req.params.id), input.memberId, input.version))
  })
  app.delete('/api/account/households/:id/members/:memberId', (req, res) => {
    const session = authenticated(req, res)
    const { version } = accountVersionSchema.parse(req.body)
    res.json(store.accounts.remove(session, z.string().uuid().parse(req.params.id), z.string().uuid().parse(req.params.memberId), version))
  })
  app.delete('/api/account/households/:id/membership', (req, res) => {
    const session = authenticated(req, res)
    const { version } = accountVersionSchema.parse(req.body)
    res.json(store.accounts.leave(session, z.string().uuid().parse(req.params.id), version))
  })
  app.delete('/api/account', async (req, res) => {
    const session = authenticated(req, res, true)
    const input = deleteAccountSchema.parse(req.body)
    // Unlike sign-in normalization, destructive confirmation must exactly match the stored email.
    if (req.body.confirmation !== input.confirmation) throw new ApiError(400, 'Enter your exact normalized account email to confirm deletion.')
    const providerId = store.accounts.beginDeletion(session, input.confirmation)
    try {
      await invokeProvider(() => provider!.deleteUser(providerId))
      store.accounts.finishDeletion(session.accountId)
    } catch {
      throw new ApiError(503, 'Your kitchen access is disabled. Account deletion is queued for retry; retry this action to finish sooner.', 'ACCOUNT_DELETION_PENDING')
    }
    clearCookie(res)
    res.json(signedOut())
  })
  return {
    configured: !!provider,
    authenticated,
    kitchen(req: Request, res: Response) {
      const session = authenticated(req, res)
      const header = req.get('X-Roomlings-Household')
      const householdId = header === undefined ? session.selectedHouseholdId : z.string().uuid().parse(header)
      return store.accounts.household(session, householdId)
    },
  }
}

export async function retryAccountDeletions(store: Store, provider: AccountProvider) {
  for (const account of store.accounts.pendingDeletions()) {
    try {
      await provider.deleteUser(account.providerId)
      store.accounts.finishDeletion(account.id)
    } catch {
      // The durable deletion barrier remains in place until the next retry.
      console.error('An account deletion is pending; the provider or database is temporarily unavailable.')
    }
  }
}
