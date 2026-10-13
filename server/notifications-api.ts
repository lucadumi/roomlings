import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import { browserNotificationSettingsSchema, browserPushRegistrationSchema, notificationPreferencesSchema, pushDeviceSchema } from '../shared/notifications.ts'
import type { AccountSession } from './accounts-store.ts'
import { isNativeAccountRequest } from './accounts-api.ts'
import { apnsAvailable } from './apns.ts'
import type { PushConfiguration } from './apns.ts'
import { browserSubscriptionSchema } from './web-push.ts'
import { ApiError } from './errors.ts'
import type { Store } from './store.ts'

export function installNotifications(
  app: Express, store: Store, authenticated: (req: Request, res: Response) => Promise<AccountSession>, push?: PushConfiguration,
) {
  const native = async (req: Request, res: Response) => {
    if (!isNativeAccountRequest(req)) throw new ApiError(403, 'Use the Roomlings native app to manage push notifications.', 'NATIVE_CLIENT_REQUIRED')
    return authenticated(req, res)
  }
  app.get('/api/account/households/:householdId/notifications', async (req, res) => {
    const session = await native(req, res)
    res.json(await store.notifications.settings(session, z.string().uuid().parse(req.params.householdId), apnsAvailable(push)))
  })
  app.put('/api/account/households/:householdId/notifications', async (req, res) => {
    const session = await native(req, res)
    res.json(await store.notifications.settings(session, z.string().uuid().parse(req.params.householdId), apnsAvailable(push),
      notificationPreferencesSchema.parse(req.body)))
  })
  app.put('/api/account/push-devices', async (req, res) => {
    const session = await native(req, res)
    const input = pushDeviceSchema.parse(req.body)
    if (!push || !apnsAvailable(push) || !push.provider.supports(input.environment)) {
      throw new ApiError(503, 'Push notifications are not configured for this app environment.', 'PUSH_NOT_CONFIGURED')
    }
    await store.notifications.register(session, input, push.cipher)
    res.json({ registered: true })
  })
  // Browser alerts share the member's chores and money preferences with the native app.
  const browserSettings = async (req: Request, res: Response, change?: unknown) => {
    const session = await authenticated(req, res)
    const householdId = z.string().uuid().parse(req.params.householdId)
    const preferences = change === undefined ? undefined : notificationPreferencesSchema.parse(change)
    const settings = await store.notifications.settings(session, householdId, apnsAvailable(push), preferences)
    return browserNotificationSettingsSchema.parse({
      preferences: settings.preferences, available: !!push?.browser, publicKey: push?.browser?.publicKey ?? null,
    })
  }
  app.get('/api/account/households/:householdId/browser-notifications', async (req, res) => {
    res.json(await browserSettings(req, res))
  })
  app.put('/api/account/households/:householdId/browser-notifications', async (req, res) => {
    res.json(await browserSettings(req, res, req.body))
  })
  app.put('/api/account/browser-push', async (req, res) => {
    const input = browserPushRegistrationSchema.parse(req.body)
    const subscription = browserSubscriptionSchema.safeParse(input.subscription)
    if (!subscription.success) throw new ApiError(400, 'This browser returned an unsupported push subscription.', 'INVALID_SUBSCRIPTION')
    const session = await authenticated(req, res)
    if (!push?.browser) throw new ApiError(503, 'Browser alerts are not configured on this server.', 'PUSH_NOT_CONFIGURED')
    await store.notifications.registerBrowser(session, input.installationId, subscription.data, push.cipher)
    res.json({ registered: true })
  })
  app.delete('/api/account/browser-push/:installationId', async (req, res) => {
    const session = await authenticated(req, res)
    await store.notifications.removeDevice(session, z.string().uuid().parse(req.params.installationId))
    res.json({ removed: true })
  })
  app.delete('/api/account/push-devices/:installationId', async (req, res) => {
    const session = await native(req, res)
    await store.notifications.removeDevice(session, z.string().uuid().parse(req.params.installationId))
    res.json({ removed: true })
  })
}
