import type { RoomId } from '../shared/rooms.ts'
import kitchen from './assets/rooms/kitchen.png'
import bathroom from './assets/rooms/bathroom.png'
import livingRoom from './assets/rooms/living-room.png'

export const roomPreviewImages: Record<RoomId, string> = { kitchen, bathroom, 'living-room': livingRoom }

export async function householdRoomPreviews(
  options: Parameters<typeof import('./householdRoomPreview.ts').renderHouseholdRoomPreviews>[0],
) {
  const { renderHouseholdRoomPreviews } = await import('./householdRoomPreview.ts')
  return renderHouseholdRoomPreviews(options)
}
