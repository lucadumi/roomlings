import {
  availableComponentSlots, componentAllowedInRoom, componentCatalog, componentIsRetired, componentPositionOffered,
  componentPositionSupported, roomComponentLimit, roomSlots,
} from '../shared/roomComponents.ts'
import type { ComponentKind, ComponentSlotContext, RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'
import { componentSurfaces, componentZonePlacementReason } from '../shared/roomZones.ts'
import type { ComponentSurface } from '../shared/roomZones.ts'

type ComponentSlot = typeof roomSlots[number]
type AvailabilityContext = ComponentSlotContext & { selectedComponentId?: string | null; storedComponentId?: string }

export type ComponentAvailability = {
  status: 'available' | 'placed' | 'preview' | 'occupied'
  label: string
  placed: number
  free: number
  positions: ComponentSlot[]
  available: ComponentSlot[]
  position: ComponentSlot | undefined
  instance: RoomComponent | undefined
  stored: RoomComponent | undefined
  reason: string | null
}

export function preferredComponentSlot(
  kind: ComponentKind, available: readonly ComponentSlot[], components: readonly RoomComponent[], componentId?: string,
) {
  const chosen = componentId ? components.find((component) => component.id === componentId && component.kind === kind) : undefined
  return available.find((slot) => slot.id === chosen?.slotId)
    ?? available.find((slot) => components.some((component) => component.kind === kind && component.slotId === slot.id && !component.installed
      && (!componentId || component.id === componentId)))
    ?? available.find((slot) => slot.kinds.length === 1)
    ?? available[0]
}

export function componentPlacementReason(
  components: readonly RoomComponent[], roomId: RoomId, kind: ComponentKind, slotId: RoomSlotId, movingComponentId?: string,
): string | null {
  const name = componentCatalog[kind].name
  if (componentIsRetired(kind)) return `${name} is no longer offered for new placements. Its settings and history are kept, but it cannot be moved or brought back.`
  if (!componentAllowedInRoom(kind, roomId)) return `${name} is not available for new placements in this room.`
  const slot = roomSlots.find((slot) => slot.id === slotId && slot.roomId === roomId && slot.kinds.includes(kind))
  if (!slot || !componentPositionOffered(kind, slotId)) return `${name} is not available for new placements in that position.`
  if (!componentPositionSupported(slotId, components)) return slot.requires?.message ?? 'This position needs its required fixture.'
  const occupant = components.find((component) => component.installed && component.slotId === slotId && component.id !== movingComponentId)
  if (occupant) return `Occupied by ${occupant.name || componentCatalog[occupant.kind].name}.`
  const zoneReason = componentZonePlacementReason(components, roomId, slotId, movingComponentId)
  if (!zoneReason && availableComponentSlots(components, roomId, kind, { movingComponentId }).some((slot) => slot.id === slotId)) return null
  return zoneReason ?? 'No compatible position is available.'
}

export function componentAvailability(
  kind: ComponentKind, roomId: RoomId, preview: readonly RoomComponent[], saved: readonly RoomComponent[], context: AvailabilityContext = {},
): ComponentAvailability {
  const placed = preview.filter((component) => component.installed && component.roomId === roomId && component.kind === kind)
  const inZone = placed.filter((component) => !context.surface || componentSurfaces[component.slotId] === context.surface)
  const instance = inZone.find((component) => component.id === context.selectedComponentId) ?? inZone[0]
    ?? placed.find((component) => component.id === context.selectedComponentId) ?? placed[0]
  const existing = saved.filter((component) => component.installed && component.roomId === roomId && component.kind === kind)
  const available = availableComponentSlots(preview, roomId, kind, context)
  const positions = componentAllowedInRoom(kind, roomId) ? roomSlots.filter((slot) => slot.roomId === roomId && slot.kinds.includes(kind)
    && componentPositionOffered(kind, slot.id) && (!context.surface || componentSurfaces[slot.id] === context.surface)) : []
  const position = preferredComponentSlot(kind, available, preview, context.storedComponentId)
    ?? preferredComponentSlot(kind, positions, preview, context.storedComponentId)
  const storedItems = preview.filter((component) => !component.installed && component.roomId === roomId && component.kind === kind
    && saved.some((saved) => saved.id === component.id))
  const stored = context.storedComponentId ? storedItems.find((component) => component.id === context.storedComponentId)
    : storedItems.find((component) => component.slotId === position?.id) ?? storedItems[0]
  const atLimit = !instance && !stored && preview.length >= roomComponentLimit
  const free = atLimit ? 0 : available.length
  const reason = atLimit ? 'This home has reached its saved-object limit. Bring back an owned object, or discard an unused draft-only trial.'
    : position ? componentPlacementReason(preview, roomId, kind, position.id, stored?.id)
      : componentIsRetired(kind) ? `${componentCatalog[kind].name} is no longer offered for new placements. Its settings and history are kept, but it cannot be moved or brought back.`
        : 'No compatible position is available in this zone.'
  const result = { placed: placed.length, free, positions, available, position, instance, stored, reason }
  if (placed.some((component) => !existing.some((saved) => saved.id === component.id && saved.slotId === component.slotId))) {
    return { ...result, status: 'preview', label: 'In preview' }
  }
  if (placed.length) return { ...result, status: 'placed', label: placed.length > 1 ? `${placed.length} placed` : 'Placed' }
  if (free) return { ...result, status: 'available', label: stored ? 'In Storage' : existing.length ? 'Available in preview' : 'Available to add' }
  return { ...result, status: 'occupied', label: 'Make room first' }
}

export function groupedRoomComponents(
  components: readonly RoomComponent[], context: { roomId?: RoomId; surface?: ComponentSurface; installed?: boolean } = {},
): { kind: ComponentKind; items: RoomComponent[] }[] {
  const groups = new Map<ComponentKind, RoomComponent[]>()
  for (const component of components) {
    if ((context.roomId && component.roomId !== context.roomId)
      || (context.surface && componentSurfaces[component.slotId] !== context.surface)
      || (context.installed !== undefined && component.installed !== context.installed)) continue
    const items = groups.get(component.kind) ?? []
    items.push(component)
    groups.set(component.kind, items)
  }
  return [...groups].map(([kind, items]) => ({ kind, items }))
}
