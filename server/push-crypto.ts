import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

export class PushTokenProtectionError extends Error {
  constructor() { super('A protected push registration could not be read.') }
}

export class PushTokenCipher {
  private readonly encryptionKey: Buffer
  private readonly lookupKey: Buffer

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('PUSH_TOKEN_ENCRYPTION_KEY must encode exactly 32 random bytes.')
    this.encryptionKey = createHmac('sha256', key).update('roomlings-push-encryption-v1').digest()
    this.lookupKey = createHmac('sha256', key).update('roomlings-push-lookup-v1').digest()
  }

  fingerprint(token: string) { return createHmac('sha256', this.lookupKey).update(token).digest('hex') }

  encrypt(token: string, context: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv)
    cipher.setAAD(Buffer.from(context))
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
  }

  decrypt(value: string, context: string): string {
    const [version, iv, tag, ciphertext, extra] = value.split('.')
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra !== undefined) throw new PushTokenProtectionError()
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'))
      decipher.setAAD(Buffer.from(context))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
    } catch {
      throw new PushTokenProtectionError()
    }
  }
}

export function pushTokenContext(device: {
  installationId: string; accountId: string; sessionId: string; environment: string; revision: string
}) {
  return JSON.stringify([device.installationId, device.accountId, device.sessionId, device.environment, device.revision])
}
