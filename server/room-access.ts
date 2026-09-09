import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import { roomRoleChangeSchema } from '../shared/roomAccess.ts'
import type { Household } from '../shared/domain.ts'
import type { Store } from './store.ts'

export function installRoomAccess(
  app: Express,
  store: Store,
  authenticated: (req: Request, res: Response) => Promise<{ household: Household; memberId: string }>,
  mutate: (req: Request, res: Response, change: (household: Household, memberId: string) => void | Promise<void>) => Promise<void>,
) {
  app.get('/api/household/room-access', async (req, res) => {
    const access = await store.transaction(async () => {
      const { household, memberId } = await authenticated(req, res)
      return store.accounts.roomAccess(household, memberId)
    })
    res.json(access)
  })
  app.patch('/api/household/room-access/:memberId', async (req, res) => {
    await mutate(req, res, async (household, memberId) => {
      const targetId = z.string().uuid().parse(req.params.memberId)
      const input = roomRoleChangeSchema.parse(req.body)
      await store.accounts.setRoomRole(household, memberId, targetId, input.role)
    })
  })
}
