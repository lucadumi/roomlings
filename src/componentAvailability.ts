import { availableComponentSlots } from '../shared/roomComponents.ts'
import type { ComponentKind, RoomComponent } from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'

export type ComponentAvailability = {
  status: 'available' | 'placed' | 'preview' | 'occupied'
  label: string
  placed: number
  free: number
}

export function componentAvailability(
  kind: ComponentKind, roomId: RoomId, preview: readonly RoomComponent[], saved: readonly RoomComponent[],
): ComponentAvailability {
  const placed = preview.filter((component) => component.installed && component.roomId === roomId && component.kind === kind)
  const existing = saved.filter((component) => component.installed && component.roomId === roomId && component.kind === kind)
  const free = availableComponentSlots(preview, roomId, kind).length
  if (placed.some((component) => !existing.some((saved) => saved.id === component.id))) {
    return { status: 'preview', label: 'In preview', placed: placed.length, free }
  }
  if (placed.length) return { status: 'placed', label: placed.length > 1 ? `${placed.length} placed` : 'Placed', placed: placed.length, free }
  if (free) return { status: 'available', label: existing.length ? 'Available in preview' : 'Available to add', placed: 0, free }
  return { status: 'occupied', label: 'Unavailable', placed: 0, free: 0 }
}

export function groupedRoomComponents(components: readonly RoomComponent[]): { kind: ComponentKind; items: RoomComponent[] }[] {
  const groups = new Map<ComponentKind, RoomComponent[]>()
  for (const component of components) {
    const items = groups.get(component.kind) ?? []
    items.push(component)
    groups.set(component.kind, items)
  }
  return [...groups].map(([kind, items]) => ({ kind, items }))
}
