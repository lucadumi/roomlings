import webpush from 'web-push'
import { z } from 'zod'
import type { PushResult } from './apns.ts'
import type { NotificationTarget } from '../shared/notifications.ts'

export const browserSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => value.startsWith('https://'), 'Push endpoints must use HTTPS.'),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }).strict(),
}).strict()
export type BrowserSubscription = z.infer<typeof browserSubscriptionSchema>
export type BrowserPushPayload = { title: 'Roomlings'; body: string; tag: string; target: NotificationTarget }
export type BrowserPushRequest = { subscription: BrowserSubscription; topic: string; expiration: number; payload: BrowserPushPayload }
export type BrowserPushSender = (subscription: BrowserSubscription, payload: string, options: webpush.RequestOptions) => Promise<{ statusCode: number }>
export type BrowserPushKeys = { publicKey: string; privateKey: string; subject: string }

export function browserPushResult(status: number, retryAfter?: string, now = Date.now()): PushResult {
  if (status >= 200 && status < 300) return { status: 'sent' }
  if (status === 404 || status === 410) return { status: 'invalid' }
  if (status === 429 || status >= 500 || status === 0) {
    const delay = retryAfter === undefined ? NaN
      : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now
    return {
      status: 'retry', reason: status === 429 ? 'rate-limited' : 'unavailable',
      ...(Number.isFinite(delay) && delay > 0 ? { retryAfterMs: Math.min(delay, 3_600_000) } : {}),
    }
  }
  return { status: 'failed', reason: status === 401 || status === 403 ? 'provider-auth' : 'rejected' }
}

export class BrowserPushProvider {
  readonly publicKey: string
  private readonly keys: BrowserPushKeys
  private readonly sender: BrowserPushSender
  private readonly now: () => number

  constructor(keys: BrowserPushKeys, options: { sender?: BrowserPushSender; now?: () => number } = {}) {
    this.keys = keys
    this.publicKey = keys.publicKey
    this.sender = options.sender ?? ((subscription, payload, requestOptions) => webpush.sendNotification(subscription, payload, requestOptions))
    this.now = options.now ?? Date.now
  }

  async send(request: BrowserPushRequest): Promise<PushResult> {
    const ttl = Math.max(0, Math.min(request.expiration - Math.floor(this.now() / 1000), 24 * 60 * 60))
    if (!ttl) return { status: 'failed', reason: 'rejected' }
    try {
      const response = await this.sender(request.subscription, JSON.stringify(request.payload), {
        vapidDetails: { subject: this.keys.subject, publicKey: this.keys.publicKey, privateKey: this.keys.privateKey },
        TTL: ttl, topic: request.topic, urgency: 'normal', timeout: 10_000,
      })
      return browserPushResult(response.statusCode, undefined, this.now())
    } catch (error) {
      if (error instanceof webpush.WebPushError) {
        const header = error.headers?.['retry-after']
        return browserPushResult(error.statusCode, Array.isArray(header) ? header[0] : header, this.now())
      }
      return { status: 'retry', reason: 'network' }
    }
  }
}

export function browserPushFromEnvironment(env: NodeJS.ProcessEnv = process.env): BrowserPushKeys | undefined {
  const names = ['WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY', 'WEB_PUSH_SUBJECT'] as const
  if (!names.some((name) => !!env[name])) return undefined
  const [publicKey, privateKey, subject] = names.map((name) => env[name] ?? '')
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) {
    throw new Error('Browser push needs WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY from npx web-push generate-vapid-keys.')
  }
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) {
    throw new Error('WEB_PUSH_SUBJECT must be a mailto: address or an https:// URL for push services to contact.')
  }
  return { publicKey, privateKey, subject }
}
