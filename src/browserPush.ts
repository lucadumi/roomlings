import { z } from 'zod'
import { browserNotificationSettingsSchema } from '../shared/notifications.ts'
import type { BrowserNotificationSettings, NotificationPreferences } from '../shared/notifications.ts'
import { request } from './api.ts'

const installationKey = 'roomlings.browser-push-installation'
export const browserPushWorker = '/roomlings-sw.js'
export type BrowserPushSupport = 'supported' | 'unsupported' | 'insecure'

export function browserPushSupport(): BrowserPushSupport {
  if (!window.isSecureContext) return 'insecure'
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'supported' : 'unsupported'
}

function installationId(create: boolean): string | null {
  try {
    const saved = localStorage.getItem(installationKey)
    if (saved && z.string().uuid().safeParse(saved).success) return saved
    if (!create) return null
    const next = crypto.randomUUID()
    localStorage.setItem(installationKey, next)
    return next
  } catch {
    return create ? crypto.randomUUID() : null
  }
}

function applicationServerKey(publicKey: string): Uint8Array<ArrayBuffer> {
  const base64 = (publicKey + '='.repeat((4 - (publicKey.length % 4)) % 4)).replaceAll('-', '+').replaceAll('_', '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
  return bytes
}

async function registration() {
  return navigator.serviceWorker.register(browserPushWorker)
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (browserPushSupport() !== 'supported') return null
  const existing = await navigator.serviceWorker.getRegistration(browserPushWorker)
  return existing ? existing.pushManager.getSubscription() : null
}

export async function browserSettings(householdId: string, signal?: AbortSignal): Promise<BrowserNotificationSettings> {
  return browserNotificationSettingsSchema.parse(await request(`/account/households/${householdId}/browser-notifications`, { householdId, signal }))
}

export async function saveBrowserPreferences(householdId: string, csrfToken: string | null | undefined, preferences: NotificationPreferences) {
  return browserNotificationSettingsSchema.parse(await request(`/account/households/${householdId}/browser-notifications`, {
    householdId, csrfToken, body: preferences, method: 'PUT',
  }))
}

// The permission prompt must follow a click, so this only runs from the Turn on button.
export async function enableBrowserPush(publicKey: string, csrfToken: string | null | undefined): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission === 'denied'
    ? 'Alerts are blocked for this site. Allow notifications in your browser settings, then try again.'
    : 'Alerts were not allowed. Try again and choose Allow.')
  const worker = await registration()
  await navigator.serviceWorker.ready
  const subscription = await worker.pushManager.getSubscription()
    ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) })
  const json = subscription.toJSON()
  try {
    await request('/account/browser-push', {
      csrfToken, method: 'PUT',
      body: { installationId: installationId(true), subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } } },
    })
  } catch (failure) {
    await subscription.unsubscribe().catch(() => false)
    throw failure
  }
}

export async function disableBrowserPush(csrfToken: string | null | undefined): Promise<void> {
  const id = installationId(false)
  if (id) await request(`/account/browser-push/${id}`, { csrfToken, method: 'DELETE' })
  const subscription = await currentSubscription()
  await subscription?.unsubscribe()
}

// Keeps an enabled browser's registration fresh; the server forgets devices unused for 30 days.
export async function refreshBrowserPush(csrfToken: string): Promise<void> {
  if (browserPushSupport() !== 'supported' || Notification.permission !== 'granted') return
  const id = installationId(false)
  const subscription = id ? await currentSubscription() : null
  if (!id || !subscription) return
  const json = subscription.toJSON()
  try {
    await request('/account/browser-push', {
      csrfToken, method: 'PUT',
      body: { installationId: id, subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } } },
    })
  } catch {
    // Not a user action; the Notifications panel shows the real state and offers Turn on again.
  }
}
