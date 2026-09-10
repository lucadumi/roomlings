import { createRoomComponent, defaultRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import type { ComponentKind, RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'

const preferred: Partial<Record<RoomSlotId, ComponentKind>> = {
  'kitchen-small-appliance': 'microwave',
  'kitchen-vacuum': 'vacuum',
  'kitchen-table-center': 'fruit-bowl',
  'kitchen-windowsill': 'storage-jars',
  'kitchen-left-wall': 'wall-calendar',
  'bathroom-vanity-accessory': 'toothbrush-holder',
  'bathroom-floor-storage': 'bathroom-scales',
}

export function completeRoomLayout(): RoomComponent[] {
  return [
    ...defaultRoomComponents(),
    ...roomSlots.filter((slot) => !slot.defaultKind).map((slot) =>
      createRoomComponent(preferred[slot.id] ?? slot.kinds[0], slot.id, `layout-${slot.id}`)),
  ]
}
