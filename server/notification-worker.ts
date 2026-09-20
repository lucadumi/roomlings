import type { PushConfiguration, PushResult } from './apns.ts'
import { PushTokenProtectionError } from './push-crypto.ts'
import type { Store } from './store.ts'

export class NotificationWorker {
  private readonly store: Store
  private readonly push: PushConfiguration
  private readonly log: (message: string) => void
  private readonly now: () => number
  private timer?: NodeJS.Timeout
  private running?: Promise<void>
  private stopping = false
  private scheduledAt = -Infinity
  private cleanedAt = -Infinity

  constructor(store: Store, push: PushConfiguration, options: { now?: () => number; log?: (message: string) => void } = {}) {
    this.store = store
    this.push = push
    this.now = options.now ?? Date.now
    this.log = options.log ?? console.error
  }

  async runOnce(options: { schedule?: boolean; cleanup?: boolean; limit?: number } = {}) {
    if (options.cleanup !== false) await this.store.notifications.cleanup()
    if (options.schedule !== false) await this.store.notifications.scheduleChores()
    const counts = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0 }
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100))
    for (let index = 0; index < limit && !this.stopping; index++) {
      const claim = await this.store.notifications.claim()
      if (!claim) break
      counts.claimed++
      let prepared
      try { prepared = await this.store.notifications.prepare(claim, this.push.cipher) } catch (error) {
        if (!(error instanceof PushTokenProtectionError)) throw error
        this.log('Push delivery failed: a protected registration could not be read. Check the encryption key.')
        await this.store.notifications.failProtectedToken(claim)
        counts.failed++
        continue
      }
      if (!prepared) { counts.skipped++; continue }
      let result: PushResult
      try { result = await this.push.provider.send(prepared.request) } catch {
        this.log('Push transport failed; the notification remains subject to bounded retries.')
        result = { status: 'retry', reason: 'network' }
      }
      await this.store.notifications.finish(claim, prepared, result)
      if (result.status === 'sent') counts.sent++
      else if (result.status === 'retry') counts.retried++
      else {
        counts.failed++
        if (result.status === 'failed') this.log(`Push delivery rejected: ${result.reason}. Check APNs configuration.`)
      }
    }
    return counts
  }

  start(unref = false) {
    if (this.timer) throw new Error('The push worker is already running.')
    this.stopping = false
    const poll = () => {
      if (this.running || this.stopping) return
      this.running = (async () => {
        const now = this.now()
        if (now - this.cleanedAt >= 60_000) {
          await this.store.notifications.cleanup()
          this.cleanedAt = now
        }
        if (now - this.scheduledAt >= 30_000) {
          await this.store.notifications.scheduleChores()
          this.scheduledAt = now
        }
        await this.runOnce({ schedule: false, cleanup: false })
      })().catch(() => {
        this.log('Push worker could not complete a database operation; unconfirmed jobs will be reclaimed.')
      }).finally(() => { this.running = undefined })
    }
    this.timer = setInterval(poll, 1000)
    if (unref) this.timer.unref()
    poll()
  }

  async stop() {
    this.stopping = true
    clearInterval(this.timer)
    this.timer = undefined
    await this.running
    this.push.provider.close()
  }
}
