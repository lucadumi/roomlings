import { createPrivateKey, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { connect, constants, sensitiveHeaders } from 'node:http2'
import type { ClientHttp2Session, ClientHttp2Stream, OutgoingHttpHeaders } from 'node:http2'
import type { NotificationTarget, PushEnvironment } from '../shared/notifications.ts'
import { PushTokenCipher } from './push-crypto.ts'

export type PushPayload = {
  aps: { alert: { title: 'Roomlings'; body: string }; 'thread-id': string; sound: 'default' }
  roomlings: NotificationTarget
}
export type PushRequest = {
  token: string; environment: PushEnvironment; id: string; collapseId: string; expiration: number; payload: PushPayload
}
export type PushResult =
  | { status: 'sent' }
  | { status: 'invalid'; invalidatedAt?: number }
  | { status: 'retry'; reason: 'network' | 'rate-limited' | 'unavailable'; retryAfterMs?: number }
  | { status: 'failed'; reason: 'provider-auth' | 'rejected' }
export interface PushProvider {
  supports(environment: PushEnvironment): boolean
  send(request: PushRequest): Promise<PushResult>
  close(): void
}
export type ApnsCredential = { keyId: string; teamId: string; key: KeyObject }
export const apnsTopic = 'com.roomlings.app'
export const apnsRequestTimeout = 10_000
const endpoints = { sandbox: 'https://api.sandbox.push.apple.com', production: 'https://api.push.apple.com' } as const

export function apnsJwt(credential: ApnsCredential, now: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: credential.keyId })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ iss: credential.teamId, iat: Math.floor(now / 1000) })).toString('base64url')
  const content = `${header}.${claims}`
  const signature = sign('sha256', Buffer.from(content), { key: credential.key, dsaEncoding: 'ieee-p1363' })
  return `${content}.${signature.toString('base64url')}`
}

export function apnsHeaders(request: PushRequest, jwt: string): OutgoingHttpHeaders {
  return {
    ':method': 'POST', ':path': `/3/device/${request.token}`, authorization: `bearer ${jwt}`,
    'apns-topic': apnsTopic, 'apns-push-type': 'alert', 'apns-priority': '10',
    'apns-id': request.id, 'apns-collapse-id': request.collapseId,
    'apns-expiration': String(request.expiration), 'content-type': 'application/json',
    [sensitiveHeaders]: [':path', 'authorization'],
  }
}

export function apnsResult(status: number, body: string, retryAfter: string | undefined, now: number): PushResult {
  if (status === 200) return { status: 'sent' }
  let reason: unknown
  let timestamp: unknown
  try {
    const parsed: unknown = body ? JSON.parse(body) : null
    if (parsed && typeof parsed === 'object') {
      reason = 'reason' in parsed ? parsed.reason : undefined
      timestamp = 'timestamp' in parsed ? parsed.timestamp : undefined
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  if (status === 410 || (status === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(String(reason)))) {
    return { status: 'invalid', ...(status === 410 && typeof timestamp === 'number' && Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp <= 8.64e15
      ? { invalidatedAt: timestamp } : {}) }
  }
  if (status === 429 || status >= 500 || status === 0) {
    const delay = retryAfter === undefined ? NaN
      : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now
    return {
      status: 'retry', reason: status === 429 ? 'rate-limited' : 'unavailable',
      ...(Number.isFinite(delay) && delay > 0 ? { retryAfterMs: Math.min(delay, 3_600_000) } : {}),
    }
  }
  return { status: 'failed', reason: status === 403 ? 'provider-auth' : 'rejected' }
}

export class ApnsProvider implements PushProvider {
  private readonly connections = new Map<PushEnvironment, ClientHttp2Session>()
  private readonly tokens = new Map<PushEnvironment, { value: string; issuedAt: number }>()
  private readonly credentials: Partial<Record<PushEnvironment, ApnsCredential>>
  private readonly now: () => number
  private readonly openConnection: (endpoint: string) => ClientHttp2Session

  constructor(
    credentials: Partial<Record<PushEnvironment, ApnsCredential>>, now: () => number = Date.now,
    openConnection: (endpoint: string) => ClientHttp2Session = (endpoint) => connect(endpoint, { minVersion: 'TLSv1.2' }),
  ) {
    this.credentials = credentials
    this.now = now
    this.openConnection = openConnection
  }

  supports(environment: PushEnvironment) { return this.credentials[environment] !== undefined }

  private connection(environment: PushEnvironment) {
    const current = this.connections.get(environment)
    if (current && !current.closed && !current.destroyed) return current
    const session = this.openConnection(endpoints[environment])
    this.connections.set(environment, session)
    const forget = () => {
      if (this.connections.get(environment) === session) this.connections.delete(environment)
    }
    session.on('error', () => { forget(); session.destroy() })
    session.on('goaway', () => { forget(); session.close() })
    session.on('close', forget)
    return session
  }

  async send(request: PushRequest): Promise<PushResult> {
    const credential = this.credentials[request.environment]
    if (!credential) return { status: 'failed', reason: 'provider-auth' }
    let token = this.tokens.get(request.environment)
    const now = this.now()
    if (!token || now - token.issuedAt >= 50 * 60_000 || now < token.issuedAt) {
      token = { value: apnsJwt(credential, now), issuedAt: now }
      this.tokens.set(request.environment, token)
    }
    const payload = JSON.stringify(request.payload)
    if (Buffer.byteLength(payload) > 4096) return { status: 'failed', reason: 'rejected' }
    const session = this.connection(request.environment)
    return new Promise((resolve) => {
      let stream: ClientHttp2Stream | undefined
      let finished = false
      let status = 0
      let body = ''
      let retryAfter: string | undefined
      const finish = (result: PushResult) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        session.removeListener('error', disconnected)
        session.removeListener('close', disconnected)
        resolve(result)
      }
      const disconnected = () => finish({ status: 'retry', reason: 'network' })
      const timer = setTimeout(() => {
        finish({ status: 'retry', reason: 'network' })
        stream?.close(constants.NGHTTP2_CANCEL)
      }, apnsRequestTimeout)
      session.once('error', disconnected)
      session.once('close', disconnected)
      try {
        stream = session.request(apnsHeaders(request, token.value))
        stream.setEncoding('utf8')
        stream.on('response', (headers) => {
          status = Number(headers[':status'])
          retryAfter = typeof headers['retry-after'] === 'string' ? headers['retry-after'] : undefined
        })
        stream.on('data', (chunk: string) => {
          if (body.length + chunk.length > 8192) {
            finish({ status: 'failed', reason: 'rejected' })
            stream?.close(constants.NGHTTP2_CANCEL)
          } else body += chunk
        })
        stream.on('end', () => finish(apnsResult(status, body, retryAfter, this.now())))
        stream.on('error', disconnected)
        stream.on('close', disconnected)
        stream.end(payload)
      } catch {
        finish({ status: 'retry', reason: 'network' })
        stream?.close(constants.NGHTTP2_CANCEL)
      }
    })
  }

  close() {
    for (const session of this.connections.values()) session.destroy()
    this.connections.clear()
  }
}

export type PushConfiguration = { provider: PushProvider; cipher: PushTokenCipher; mode: 'inline' | 'external' }

export function pushFromEnvironment(env: NodeJS.ProcessEnv = process.env): PushConfiguration | undefined {
  if (env.PUSH_WORKER_MODE === 'disabled') return undefined
  if (env.PUSH_WORKER_MODE && !['inline', 'external'].includes(env.PUSH_WORKER_MODE)) {
    throw new Error('PUSH_WORKER_MODE must be inline, external or disabled.')
  }
  const credentials: Partial<Record<PushEnvironment, ApnsCredential>> = {}
  const configured = ['APNS_TEAM_ID', 'PUSH_TOKEN_ENCRYPTION_KEY', 'APNS_SANDBOX_KEY_ID', 'APNS_SANDBOX_KEY_PATH',
    'APNS_PRODUCTION_KEY_ID', 'APNS_PRODUCTION_KEY_PATH'].some((name) => !!env[name])
  if (!configured) return undefined
  if (!/^[A-Z0-9]{10}$/.test(env.APNS_TEAM_ID ?? '') || (env.APNS_TOPIC && env.APNS_TOPIC !== apnsTopic)) {
    throw new Error('Push requires a valid APNS_TEAM_ID and the com.roomlings.app topic.')
  }
  const encodedKey = env.PUSH_TOKEN_ENCRYPTION_KEY ?? ''
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    throw new Error('PUSH_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte random key.')
  }
  const key = Buffer.from(encodedKey, 'base64')
  if (key.toString('base64') !== encodedKey) throw new Error('PUSH_TOKEN_ENCRYPTION_KEY must use canonical base64.')
  for (const environment of ['sandbox', 'production'] as const) {
    const keyId = env[`APNS_${environment.toUpperCase()}_KEY_ID`]
    const path = env[`APNS_${environment.toUpperCase()}_KEY_PATH`]
    if (!keyId && !path) continue
    if (!keyId || !/^[A-Z0-9]{10}$/.test(keyId) || !path) {
      throw new Error('Each enabled APNs environment needs its key ID and private key file path.')
    }
    let signingKey: KeyObject
    try { signingKey = createPrivateKey(readFileSync(path)) } catch {
      throw new Error('An APNs private key file could not be loaded. Check its path, format and permissions.')
    }
    if (signingKey.asymmetricKeyType !== 'ec' || signingKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('APNs requires an EC P-256 private signing key.')
    }
    credentials[environment] = { keyId, teamId: env.APNS_TEAM_ID!, key: signingKey }
  }
  if (!Object.keys(credentials).length) throw new Error('Configure at least one APNs environment key.')
  return { provider: new ApnsProvider(credentials), cipher: new PushTokenCipher(key), mode: env.PUSH_WORKER_MODE === 'external' ? 'external' : 'inline' }
}
