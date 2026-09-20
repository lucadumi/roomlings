import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import { notificationPreferencesSchema, pushDeviceSchema } from '../shared/notifications.ts'
import type { AccountSession } from './accounts-store.ts'
import { isNativeAccountRequest } from './accounts-api.ts'
import type { PushConfiguration } from './apns.ts'
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
    res.json(await store.notifications.settings(session, z.string().uuid().parse(req.params.householdId), !!push))
  })
  app.put('/api/account/households/:householdId/notifications', async (req, res) => {
    const session = await native(req, res)
    res.json(await store.notifications.settings(session, z.string().uuid().parse(req.params.householdId), !!push,
      notificationPreferencesSchema.parse(req.body)))
  })
  app.put('/api/account/push-devices', async (req, res) => {
    const session = await native(req, res)
    const input = pushDeviceSchema.parse(req.body)
    if (!push || !push.provider.supports(input.environment)) {
      throw new ApiError(503, 'Push notifications are not configured for this app environment.', 'PUSH_NOT_CONFIGURED')
    }
    await store.notifications.register(session, input, push.cipher)
    res.json({ registered: true })
  })
  app.delete('/api/account/push-devices/:installationId', async (req, res) => {
    const session = await native(req, res)
    await store.notifications.removeDevice(session, z.string().uuid().parse(req.params.installationId))
    res.json({ removed: true })
  })
}
