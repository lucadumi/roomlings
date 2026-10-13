// Shows Roomlings alerts. Payloads carry only generic text and routing IDs; the app fetches current data on open.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const title = data.title === 'Roomlings' ? data.title : 'Roomlings'
  const body = typeof data.body === 'string' ? data.body : 'Something changed in your home.'
  event.waitUntil(self.registration.showNotification(title, {
    body, tag: typeof data.tag === 'string' ? data.tag : 'roomlings', renotify: true,
    icon: '/favicon.svg', badge: '/favicon.svg', data: { householdId: data.target?.householdId ?? null },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (open) {
      await open.focus()
      open.postMessage({ type: 'roomlings:open-notifications' })
      return
    }
    await self.clients.openWindow('/rooms#notifications')
  })())
})
