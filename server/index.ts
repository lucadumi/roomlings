import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import express from 'express'
import { openStore } from './storage.ts'
import { createApp } from './app.ts'
import { providerFromEnvironment } from './provider.ts'
import { retryAccountDeletions } from './accounts-api.ts'
import { pushFromEnvironment } from './apns.ts'
import type { PushConfiguration } from './apns.ts'
import { NotificationWorker } from './notification-worker.ts'

const provider = providerFromEnvironment()
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production')
if (production && (!provider || !process.env.APP_ORIGIN?.startsWith('https://'))) {
  throw new Error('Production startup requires complete Supabase account configuration and an HTTPS APP_ORIGIN.')
}
const store = await openStore()
let push: PushConfiguration | undefined
try { push = pushFromEnvironment() } catch {
  console.error('Push configuration is incomplete or invalid. Push is unavailable; review docs/storage.md.')
}
const app = createApp(store, {
  provider, appOrigin: process.env.APP_ORIGIN,
  allowLocalDevelopment: !production, push,
})
const pushWorker = push?.mode === 'inline' ? new NotificationWorker(store, push) : undefined
pushWorker?.start(true)
if (!push) console.warn('Push notifications are unavailable; configure APNs and protected-token storage to enable them.')
let pushCleanup: Promise<void> | undefined
const cleanPush = () => {
  if (!pushCleanup) pushCleanup = store.notifications.cleanup().catch(() => {
    console.error('Push retention cleanup could not finish; it will retry in one minute.')
  }).finally(() => { pushCleanup = undefined })
}
const pushCleanupTimer = !pushWorker ? setInterval(cleanPush, 60_000) : undefined
pushCleanupTimer?.unref()
if (!pushWorker) cleanPush()
if (!provider) console.warn('Account sign-in is unavailable: configure SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY.')
let retrying = false
const retryDeletions = async () => {
  if (!provider || retrying) return
  retrying = true
  try { await retryAccountDeletions(store, provider) } finally { retrying = false }
}
const deletionTimer = provider ? setInterval(() => { void retryDeletions() }, 60_000) : undefined
deletionTimer?.unref()
void retryDeletions()
const dist = resolve('dist')
if (existsSync(join(dist, 'index.html'))) {
  app.use(express.static(dist))
  app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')))
}
const port = Number(process.env.PORT ?? 4311)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port number.')
const server = app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Roomlings API ready at http://${process.env.HOST ?? '127.0.0.1'}:${port} (${store.driver} storage)`)
})
const shutdown = () => {
  clearInterval(deletionTimer)
  clearInterval(pushCleanupTimer)
  server.close(async () => {
    await pushWorker?.stop()
    await pushCleanup
    push?.provider.close()
    await store.close()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
