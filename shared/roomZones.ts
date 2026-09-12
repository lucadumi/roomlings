import type { RoomComponent, RoomSlotId } from './roomComponents.ts'
import type { RoomId } from './rooms.ts'

export const roomZoneLabels = {
  floor: 'Floor', counter: 'Counter', table: 'Table', wall: 'Wall', fitted: 'Fitted', bath: 'Bath',
} as const
export type ComponentSurface = keyof typeof roomZoneLabels

export const roomZoneCapacities = {
  kitchen: { floor: 4, counter: 6, table: 1, wall: 3, fitted: 3 },
  bathroom: { floor: 5, counter: 4, wall: 3, fitted: 1, bath: 1 },
  'living-room': { floor: 10, counter: 3, table: 1, wall: 3 },
} as const satisfies Record<RoomId, Partial<Record<ComponentSurface, number>>>

// Only authored surface tags belong here. Untagged built-ins do not use a zone.
export const componentSurfaces: Partial<Record<RoomSlotId, ComponentSurface>> = {
  'living-room-sofa': 'floor',
  'living-room-coffee-table': 'floor',
  'living-room-media-unit': 'floor',
  'living-room-tv': 'wall',
  'living-room-bookshelf': 'floor',
  'living-room-floor-lamp': 'floor',
  'living-room-rug': 'floor',
  'living-room-plant': 'floor',
  'living-room-curtains': 'wall',
  'living-room-supply-shelf': 'floor',
  'living-room-cleaning-caddy': 'floor',
  'living-room-bins': 'floor',
  'living-room-table-top': 'table',
  'living-room-media-accessory': 'counter',
  'living-room-shelf-accessory': 'counter',
  'living-room-wall-art': 'wall',
  'living-room-cleaning-station': 'floor',
  'living-room-windowsill': 'counter',
  'kitchen-table': 'floor',
  'kitchen-plant-floor': 'floor',
  'kitchen-plant-counter': 'counter',
  'kitchen-washing-machine': 'fitted',
  'kitchen-dryer': 'fitted',
  'kitchen-oven': 'fitted',
  'kitchen-undercounter': 'fitted',
  'kitchen-coffee': 'counter',
  'kitchen-small-appliance': 'counter',
  'kitchen-drinks': 'counter',
  'kitchen-dish-rack': 'counter',
  'kitchen-bins': 'fitted',
  'kitchen-vacuum': 'floor',
  'kitchen-wall-art': 'wall',
  'kitchen-soap-dispenser': 'counter',
  'kitchen-table-center': 'table',
  'kitchen-windowsill': 'counter',
  'kitchen-left-wall': 'wall',
  'kitchen-air-fryer': 'counter',
  'kitchen-stand-mixer': 'counter',
  'kitchen-blender': 'counter',
  'kitchen-rice-cooker': 'counter',
  'kitchen-scale': 'counter',
  'kitchen-cookbook': 'counter',
  'kitchen-cutting-boards': 'counter',
  'kitchen-knife-block': 'counter',
  'kitchen-egg-basket': 'counter',
  'kitchen-toaster': 'counter',
  'kitchen-waffle-maker': 'counter',
  'kitchen-bread-box': 'counter',
  'kitchen-water-filter': 'counter',
  'kitchen-mug-tree': 'counter',
  'kitchen-cereal-dispenser': 'counter',
  'kitchen-tea-set': 'counter',
  'kitchen-paper-towels': 'counter',
  'kitchen-spice-rack': 'wall',
  'kitchen-key-hooks': 'wall',
  'kitchen-wall-shelf': 'wall',
  'kitchen-first-aid': 'counter',
  'kitchen-speaker': 'counter',
  'kitchen-record-player': 'counter',
  'kitchen-tissue-box': 'counter',
  'kitchen-diffuser': 'counter',
  'kitchen-board-game': 'table',
  'kitchen-storage-cabinet': 'floor',
  'kitchen-cart': 'floor',
  'kitchen-pet-bowls': 'floor',
  'kitchen-air-purifier': 'floor',
  'kitchen-watering-can': 'floor',
  'bathroom-bath': 'floor',
  'bathroom-laundry': 'floor',
  'bathroom-laundry-basket': 'floor',
  'bathroom-drying-rack': 'floor',
  'bathroom-towel-rack': 'wall',
  'bathroom-plant': 'floor',
  'bathroom-wall-art': 'wall',
  'bathroom-soap-dispenser': 'counter',
  'bathroom-shower-shelf': 'wall',
  'bathroom-bins': 'floor',
  'bathroom-vanity-accessory': 'counter',
  'bathroom-floor-storage': 'floor',
  'bathroom-bath-tray': 'bath',
  'bathroom-toilet-accessory': 'floor',
  'bathroom-dryer': 'fitted',
  'bathroom-storage-cabinet': 'floor',
  'bathroom-stool': 'floor',
  'bathroom-air-purifier': 'floor',
  'bathroom-ironing-board': 'floor',
  'bathroom-wall-calendar': 'wall',
  'bathroom-key-hooks': 'wall',
  'bathroom-wall-shelf': 'wall',
  'bathroom-shower-squeegee': 'wall',
  'bathroom-hair-dryer': 'counter',
  'bathroom-storage-jars': 'counter',
  'bathroom-tissue-box': 'counter',
  'bathroom-first-aid': 'counter',
  'bathroom-diffuser': 'counter',
  'bathroom-vacuum': 'floor',
}

type ZonedComponent = Pick<RoomComponent, 'id' | 'roomId' | 'slotId' | 'installed'>
export type RoomZoneUsage = { surface: ComponentSurface; label: string; used: number; capacity: number }

export function roomZoneUsage(components: readonly ZonedComponent[], roomId: RoomId): RoomZoneUsage[] {
  const counts = new Map<ComponentSurface, number>()
  for (const component of components) {
    const surface = componentSurfaces[component.slotId]
    if (component.installed && component.roomId === roomId && surface) {
      counts.set(surface, (counts.get(surface) ?? 0) + 1)
    }
  }
  return Object.entries(roomZoneCapacities[roomId]).map(([key, capacity]) => {
    const surface = key as ComponentSurface
    return { surface, label: roomZoneLabels[surface], used: counts.get(surface) ?? 0, capacity }
  })
}

export function componentZonePlacementReason(
  components: readonly ZonedComponent[], roomId: RoomId, slotId: RoomSlotId, movingComponentId?: string,
): string | null {
  const surface = componentSurfaces[slotId]
  if (!surface) return null
  const zone = roomZoneUsage(components.filter((component) => component.id !== movingComponentId), roomId)
    .find((zone) => zone.surface === surface)
  return zone && zone.used >= zone.capacity ? `${zone.label} ${zone.used} of ${zone.capacity}. Make room first.` : null
}
