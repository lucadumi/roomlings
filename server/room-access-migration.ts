import { z } from 'zod'
import { isRetiredHouseholdState } from './retired-household.ts'
import type { Database } from './database.ts'

const creatorSchema = z.object({ members: z.array(z.object({ id: z.string().uuid() })).min(1) })

export function originalRoomOwner(state: string): string | null {
  const value: unknown = JSON.parse(state)
  if (isRetiredHouseholdState(value)) return null
  return creatorSchema.parse(value).members[0].id
}

export async function backfillRoomOwners(db: Database): Promise<void> {
  const rows = await db.prepare(`SELECT h.id, h.state FROM households h
    LEFT JOIN household_room_owners o ON o.household_id = h.id WHERE o.household_id IS NULL`).all()
  for (const row of rows) {
    const memberId = originalRoomOwner(String(row.state))
    if (memberId) {
      await db.prepare('INSERT INTO household_room_owners (household_id, member_id) VALUES (?, ?) ON CONFLICT(household_id) DO NOTHING')
        .run(row.id, memberId)
    }
  }
}
