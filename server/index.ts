import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import express from 'express'
import { Store } from './store.ts'
import { createApp } from './app.ts'
import { providerFromEnvironment } from './provider.ts'
import { retryAccountDeletions } from './accounts-api.ts'

const provider = providerFromEnvironment()
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production')
if (production && (!provider || !process.env.APP_ORIGIN?.startsWith('https://'))) {
  throw new Error('Production startup requires complete Supabase account configuration and an HTTPS APP_ORIGIN.')
}
const store = new Store(join(resolve(process.env.DATA_DIR ?? './data'), 'kitchen.sqlite'))
const app = createApp(store, {
  provider, appOrigin: process.env.APP_ORIGIN,
  allowLocalDevelopment: !production,
})
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
  console.log(`Roomlings API ready at http://${process.env.HOST ?? '127.0.0.1'}:${port}`)
})
const shutdown = () => {
  clearInterval(deletionTimer)
  server.close(() => { store.close(); process.exit(0) })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
