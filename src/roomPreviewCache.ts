import type { RoomId } from '../shared/rooms.ts'
import type { renderHouseholdRoomPreviews } from './householdRoomPreview.ts'

export type RoomPreviewOptions = Parameters<typeof renderHouseholdRoomPreviews>[0]
type Images = Record<RoomId, string>

export function createRoomPreviewCache(render: (options: RoomPreviewOptions) => Promise<Images>, limit = 4) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Room preview cache size must be a positive integer.')
  const images = new Map<string, Images>()
  const pending = new Map<string, Promise<Images>>()
  const key = (options: RoomPreviewOptions, householdId: string) =>
    JSON.stringify([householdId, options.roomStyle, options.roomStyles, options.components, options.ledger, options.sizes])
  return {
    read(options: RoomPreviewOptions, householdId: string): Images | undefined {
      const id = key(options, householdId)
      const cached = images.get(id)
      if (cached) { images.delete(id); images.set(id, cached) }
      return cached
    },
    render(options: RoomPreviewOptions, householdId: string): Promise<Images> {
      const id = key(options, householdId)
      const cached = images.get(id)
      if (cached) { images.delete(id); images.set(id, cached); return Promise.resolve(cached) }
      const existing = pending.get(id)
      if (existing) return existing
      const request = render(options).then((result) => {
        images.set(id, result)
        if (images.size > limit) {
          const oldest = images.keys().next().value
          if (oldest !== undefined) images.delete(oldest)
        }
        return result
      }).finally(() => pending.delete(id))
      pending.set(id, request)
      return request
    },
  }
}
