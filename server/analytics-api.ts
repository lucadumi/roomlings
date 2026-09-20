import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import { analyticsBatchSchema } from '../shared/analytics.ts'
import type { AccountSession } from './accounts-store.ts'
import type { Store } from './store.ts'

export function installAnalytics(
  app: Express, store: Store, authenticated: (req: Request, res: Response) => Promise<AccountSession>,
) {
  app.post('/api/account/households/:householdId/analytics', async (req, res) => {
    const session = await authenticated(req, res)
    const householdId = z.string().uuid().parse(req.params.householdId)
    res.json(await store.analytics.record(session, householdId, analyticsBatchSchema.parse(req.body)))
  })
}
