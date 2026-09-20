import { pushFromEnvironment } from './apns.ts'
import { NotificationWorker } from './notification-worker.ts'
import { openStore } from './storage.ts'

const push = pushFromEnvironment()
if (!push) throw new Error('Push worker requires complete APNs and protected-token configuration.')
const store = await openStore()
const worker = new NotificationWorker(store, push)
worker.start()
console.log(`Roomlings push worker ready (${store.driver} storage).`)
let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true
  await worker.stop()
  await store.close()
}
process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
