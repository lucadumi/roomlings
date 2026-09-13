import { roomIds } from '../shared/rooms.ts'
import { createRoomPreviewCache } from './roomPreviewCache.ts'
import type { RoomPreviewOptions } from './roomPreviewCache.ts'
const savedPreviews = createRoomPreviewCache(async (options, signal) => {
  const { renderHouseholdRoomPreviews } = await import('./householdRoomPreview.ts')
  signal?.throwIfAborted()
  return renderHouseholdRoomPreviews(options, signal)
})

export function roomSelectorPreviewSizes(ratio = 1, area = { width: 86, height: 86 * 24 / 35 }): RoomPreviewOptions['sizes'] {
  const scale = Math.min(ratio, 2)
  return Object.fromEntries(roomIds.map((roomId) => [roomId, {
    width: Math.max(1, Math.round(area.width * scale)), height: Math.max(1, Math.round(area.height * scale)),
  }])) as RoomPreviewOptions['sizes']
}

export function cachedHouseholdRoomPreviews(options: RoomPreviewOptions, householdId: string) {
  return savedPreviews.read(options, householdId)
}

export function householdRoomPreviews(options: RoomPreviewOptions, householdId: string) {
  return savedPreviews.render(options, householdId)
}

export function preloadHouseholdRoomPreviews(options: RoomPreviewOptions, householdId: string, signal: AbortSignal) {
  return savedPreviews.preload(options, householdId, signal)
}
