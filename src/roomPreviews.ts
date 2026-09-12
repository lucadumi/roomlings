import { roomIds } from '../shared/rooms.ts'
import { createRoomPreviewCache } from './roomPreviewCache.ts'
import type { RoomPreviewOptions } from './roomPreviewCache.ts'
const savedPreviews = createRoomPreviewCache(async (options) => {
  const { renderHouseholdRoomPreviews } = await import('./householdRoomPreview.ts')
  return renderHouseholdRoomPreviews(options)
})

export function roomSelectorPreviewSizes(ratio = 1): RoomPreviewOptions['sizes'] {
  const scale = Math.min(ratio, 2)
  return Object.fromEntries(roomIds.map((roomId) => [roomId, {
    width: Math.round(86 * scale), height: Math.round(86 * 24 / 35 * scale),
  }])) as RoomPreviewOptions['sizes']
}

export function cachedHouseholdRoomPreviews(options: RoomPreviewOptions, householdId: string) {
  return savedPreviews.read(options, householdId)
}

export function householdRoomPreviews(options: RoomPreviewOptions, householdId: string) {
  return savedPreviews.render(options, householdId)
}
