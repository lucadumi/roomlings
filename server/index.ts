import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import express from 'express'
import { Store } from './store.ts'
import { createApp } from './app.ts'

const store = new Store(join(resolve(process.env.DATA_DIR ?? './data'), 'kitchen.sqlite'))
const app = createApp(store)
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
const shutdown = () => server.close(() => { store.close(); process.exit(0) })
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
