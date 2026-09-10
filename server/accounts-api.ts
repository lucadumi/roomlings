import { createHash, timingSafeEqual } from 'node:crypto'
import type { Express, Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import {
  acceptAccountInvitationSchema, accountRecoverySignInSchema, accountVersionSchema, createAccountInvitationSchema,
  createAccountHouseholdSchema, deleteAccountSchema, linkAccountSchema, sendAccountCodeSchema, transferOwnershipSchema, verifyAccountCodeSchema,
} from '../shared/accounts.ts'
import { nameSchema } from '../shared/domain.ts'
import type { AccountState } from '../shared/accounts.ts'
import type { AccountSession } from './accounts-store.ts'
import { accountAbsoluteLifetime } from './accounts-store.ts'
import type { AccountProvider } from './provider.ts'
import type { Store } from './store.ts'
import { ApiError, apiMessages } from './errors.ts'

export type AccountOptions = {
  provider?: AccountProvider
  appOrigin?: string
  allowLocalDevelopment?: boolean
}
export const accountCookieName = 'roomlings_session'
const isMutation = (req: Request) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
const unavailable = () => new ApiError(503, 'Sign-in is not configured. Contact the server owner.', 'AUTH_NOT_CONFIGURED')
const noSession = () => new ApiError(401, 'Sign in to your account to continue.', 'ACCOUNT_SESSION_REQUIRED')

function limit(maximum: number, duration: number, key: (req: Request) => string): RequestHandler {
  const attempts = new Map<string, { count: number; expires: number }>()
  return (req, _res, next) => {
    const now = Date.now()
    for (const [value, attempt] of attempts) if (attempt.expires <= now) attempts.delete(value)
    const value = createHash('sha256').update(key(req)).digest('hex')
    const attempt = attempts.get(value) ?? { count: 0, expires: now + duration }
    attempt.count++
    attempts.set(value, attempt)
    if (attempt.count > maximum) return next(new ApiError(429, apiMessages.tooManyAttempts))
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
  const respondSignedIn = async (req: Request, res: Response, issue: () => Promise<{ token: string; session: AccountSession }>) => {
    const { issued, state } = await store.transaction(async () => {
      const previous = await current(req, res, false)
      // A failed sign-in rolls this browser's session revocation back with the new session.
      if (previous) await store.accounts.logout(previous, false)
      const issued = await issue()
      const initial = await store.accounts.state(issued.session)
      const householdId = previous?.selectedHouseholdId
      const state = previous?.accountId === issued.session.accountId && householdId
        && householdId !== issued.session.selectedHouseholdId
        && initial.memberships.some((membership) => membership.householdId === householdId)
        ? await store.accounts.select(issued.session, householdId) : initial
      return { issued, state }
    })
    res.cookie(accountCookieName, issued.token, { ...cookieOptions, maxAge: accountAbsoluteLifetime })
    res.json(state)
  }
  const browserRequest = (req: Request) => {
    const requestOrigin = req.get('origin')
    if (req.get('X-Roomlings-Request') !== '1'
      || (requestOrigin !== undefined && !allowedOrigins.has(requestOrigin))
      || (req.get('sec-fetch-site') === 'cross-site' && !requestOrigin)) {
      throw new ApiError(403, 'This account action must come from the Roomlings app.', 'CSRF_REJECTED')
    }
  }
  const current = async (req: Request, res: Response, clearInvalid = true) => {
    const cookies = (req.headers.cookie ?? '').split(';').map((entry) => entry.trim())
      .filter((entry) => entry.startsWith(`${accountCookieName}=`))
    if (!cookies.length) return null
    const token = cookies.length === 1 ? cookies[0].slice(accountCookieName.length + 1) : ''
    const session = /^[A-Za-z0-9_-]{43}$/.test(token) ? (await store.accounts.authenticate(token)) : null
    if (!session && clearInvalid) clearCookie(res)
    return session
  }
  const csrf = (req: Request, session: AccountSession) => {
    browserRequest(req)
    const supplied = req.get('X-CSRF-Token') ?? ''
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrfToken))) {
      throw new ApiError(403, 'This browser safety token has expired. Refresh the page and try again.', 'CSRF_REJECTED')
    }
  }
  const authenticated = async (req: Request, res: Response, allowDeleting = false) => {
    const session = (await current(req, res))
    if (!session) throw noSession()
    if (isMutation(req)) csrf(req, session)
    if (session.deleting && !allowDeleting) {
      throw new ApiError(409, apiMessages.deletionPending, 'ACCOUNT_DELETION_PENDING')
    }
    return session
  }
  const invokeProvider = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation() } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(503, apiMessages.signInUnavailable, 'AUTH_PROVIDER_UNAVAILABLE')
    }
  }
  const configured: RequestHandler = (req, _res, next) => {
    if (!provider) return next(unavailable())
    if (isMutation(req)) browserRequest(req)
    next()
  }
  app.get('/api/account', async (req, res) => {
    const state = await store.transaction(async () => {
      const session = await current(req, res)
      return session ? { ...await store.accounts.state(session), configured: !!provider } : signedOut()
    })
    res.json(state)
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
      if (!identity.providerId || identity.email !== input.email) throw new ApiError(401, 'Email verification did not match this account.')
      await respondSignedIn(req, res, () => store.accounts.signIn(identity, input.name, input.label))
    })
  app.post('/api/account/recover',
    limit(30, 10 * 60_000, ip), limit(10, 10 * 60_000, email), async (req, res) => {
      const input = accountRecoverySignInSchema.parse(req.body)
      await respondSignedIn(req, res, () => store.accounts.recoverAccount(input))
    })
  app.get('/api/account/recovery', async (req, res) => {
    res.json(await store.accounts.recoveryState(await authenticated(req, res)))
  })
  app.post('/api/account/recovery', async (req, res) => {
    const session = await authenticated(req, res)
    const { version } = accountVersionSchema.parse(req.body)
    res.json(await store.accounts.generateRecoveryCodes(session, version))
  })
  app.delete('/api/account/recovery', async (req, res) => {
    const session = await authenticated(req, res)
    const { version } = accountVersionSchema.parse(req.body)
    res.json(await store.accounts.revokeRecoveryCodes(session, version))
  })
  app.patch('/api/account', async (req, res) => {
    const session = (await authenticated(req, res))
    const { name } = z.object({ name: nameSchema }).parse(req.body)
    res.json((await store.accounts.profile(session, name)))
  })
  app.patch('/api/account/device', async (req, res) => {
    const session = (await authenticated(req, res))
    const { label } = z.object({ label: nameSchema }).parse(req.body)
    res.json((await store.accounts.renameDevice(session, label)))
  })
  app.post('/api/account/logout', async (req, res) => {
    const session = (await authenticated(req, res, true))
    const { all } = z.object({ all: z.boolean() }).parse(req.body)
    await store.accounts.logout(session, all)
    clearCookie(res)
    res.json(signedOut())
  })
  app.delete('/api/account/devices/:id', async (req, res) => {
    const session = (await authenticated(req, res))
    const state = (await store.accounts.revokeDevice(session, z.string().uuid().parse(req.params.id)))
    if (!state) clearCookie(res)
    res.json(state ?? signedOut())
  })
  app.post('/api/account/link', async (req, res) => {
    res.json((await store.accounts.link((await authenticated(req, res)), linkAccountSchema.parse(req.body))))
  })
  app.post('/api/account/households', async (req, res) => {
    const session = (await authenticated(req, res))
    const input = createAccountHouseholdSchema.parse(req.body)
    res.status(201).json((await store.accounts.createHousehold(session, input)))
  })
  app.post('/api/account/households/:id/select', async (req, res) => {
    res.json((await store.accounts.select((await authenticated(req, res)), z.string().uuid().parse(req.params.id))))
  })
  app.get('/api/account/households/:id', async (req, res) => {
    res.json((await store.accounts.access((await authenticated(req, res)), z.string().uuid().parse(req.params.id))))
  })
  app.post('/api/account/households/:id/invitations', async (req, res) => {
    const session = (await authenticated(req, res))
    const input = createAccountInvitationSchema.parse(req.body)
    res.status(201).json((await store.accounts.invite(session, z.string().uuid().parse(req.params.id), input.version, input.expiresInDays)))
  })
  app.delete('/api/account/households/:id/invitations/:inviteId', async (req, res) => {
    const session = (await authenticated(req, res))
    const { version } = accountVersionSchema.parse(req.body)
    res.json((await store.accounts.revokeInvitation(session, z.string().uuid().parse(req.params.id), z.string().uuid().parse(req.params.inviteId), version)))
  })
  app.post('/api/account/invitations/accept', async (req, res) => {
    const session = (await authenticated(req, res))
    const input = acceptAccountInvitationSchema.parse(req.body)
    res.json((await store.accounts.accept(session, input.code, input.memberName)))
  })
  app.post('/api/account/households/:id/owner', async (req, res) => {
    const session = (await authenticated(req, res))
    const input = transferOwnershipSchema.parse(req.body)
    res.json((await store.accounts.transfer(session, z.string().uuid().parse(req.params.id), input.memberId, input.version)))
  })
  app.delete('/api/account/households/:id/members/:memberId', async (req, res) => {
    const session = (await authenticated(req, res))
    const { version } = accountVersionSchema.parse(req.body)
    res.json((await store.accounts.remove(session, z.string().uuid().parse(req.params.id), z.string().uuid().parse(req.params.memberId), version)))
  })
  app.delete('/api/account/households/:id/membership', async (req, res) => {
    const session = (await authenticated(req, res))
    const { version } = accountVersionSchema.parse(req.body)
    res.json((await store.accounts.leave(session, z.string().uuid().parse(req.params.id), version)))
  })
  app.delete('/api/account', async (req, res) => {
    const session = (await authenticated(req, res, true))
    const input = deleteAccountSchema.parse(req.body)
    // Unlike sign-in normalization, destructive confirmation must exactly match the stored email.
    if (req.body.confirmation !== input.confirmation) throw new ApiError(400, 'Enter your exact normalized account email to confirm deletion.')
    const providerId = (await store.accounts.beginDeletion(session, input.confirmation))
    try {
      await invokeProvider(() => provider!.deleteUser(providerId))
      await store.accounts.finishDeletion(session.accountId)
    } catch {
      throw new ApiError(503, `${apiMessages.deletionPending} Retry deletion to finish sooner.`, 'ACCOUNT_DELETION_PENDING')
    }
    clearCookie(res)
    res.json(signedOut())
  })
  return {
    configured: !!provider,
    authenticated,
    async kitchen(req: Request, res: Response) {
      const session = (await authenticated(req, res))
      const header = req.get('X-Roomlings-Household')
      const householdId = header === undefined ? session.selectedHouseholdId : z.string().uuid().parse(header)
      return (await store.accounts.household(session, householdId))
    },
  }
}

export async function retryAccountDeletions(store: Store, provider: AccountProvider) {
  const pending = await store.accounts.pendingDeletions().catch(() => {
    console.error('Queued account deletions could not be loaded; the database is temporarily unavailable.')
    return null
  })
  if (pending === null) return
  for (const account of pending) {
    try {
      await provider.deleteUser(account.providerId)
      await store.accounts.finishDeletion(account.id)
    } catch {
      // The durable deletion barrier remains in place until the next retry.
      console.error('An account deletion is pending; the provider or database is temporarily unavailable.')
    }
  }
}
