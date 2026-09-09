import { z } from 'zod'

export const roomIds = ['kitchen', 'bathroom'] as const
export const roomIdSchema = z.enum(roomIds)
export type RoomId = z.infer<typeof roomIdSchema>

export const choreAreas = ['sink', 'counters', 'fridge', 'floor', 'bins', 'mirror', 'toilet', 'bath'] as const
export const choreAreaSchema = z.enum(choreAreas)
export type ChoreArea = z.infer<typeof choreAreaSchema>

type RoomDefinition = {
  name: string
  label: string
  areas: readonly { id: ChoreArea; label: string }[]
  supplies: readonly { id: string; name: string; quantity: string }[]
}

export const roomCatalog: Record<RoomId, RoomDefinition> = {
  kitchen: {
    name: 'Kitchen', label: 'The kitchen',
    areas: [
      { id: 'sink', label: 'Sink and dishes' }, { id: 'counters', label: 'Counters' },
      { id: 'fridge', label: 'Fridge' }, { id: 'floor', label: 'Floor' }, { id: 'bins', label: 'Rubbish' },
    ],
    supplies: [
      { id: 'dish-soap', name: 'Dish soap', quantity: '1 bottle' },
      { id: 'sponges', name: 'Sponges', quantity: '1 pack' },
      { id: 'rubbish-bags', name: 'Rubbish bags', quantity: '1 roll' },
    ],
  },
  bathroom: {
    name: 'Bathroom', label: 'The bathroom',
    areas: [
      { id: 'sink', label: 'Sink' }, { id: 'mirror', label: 'Mirror' }, { id: 'toilet', label: 'Toilet' },
      { id: 'bath', label: 'Bath' }, { id: 'floor', label: 'Floor' },
    ],
    supplies: [
      { id: 'toilet-paper', name: 'Toilet paper', quantity: '1 pack' },
      { id: 'hand-soap', name: 'Hand soap', quantity: '1 bottle' },
      { id: 'bathroom-cleaner', name: 'Bathroom cleaner', quantity: '1 bottle' },
    ],
  },
}

export function choreLocationLabel(roomId: RoomId | null, area: ChoreArea | null = null, componentName?: string): string {
  if (roomId === null) return 'Whole home'
  const room = roomCatalog[roomId]
  if (componentName) return `${room.name}: ${componentName}`
  const detail = room.areas.find((item) => item.id === area)
  return detail ? `${room.name}: ${detail.label}` : room.name
}
