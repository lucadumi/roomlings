import { Box3, Vector3 } from 'three'
import type { RoomId } from '../shared/rooms.ts'
import type { RoomSlotId } from '../shared/roomComponents.ts'

export type RoomPosition = [number, number, number]
export type ComponentPlacement = {
  position: RoomPosition
  scale?: number | RoomPosition
  rotation?: number
  surface: 'floor' | 'counter' | 'table' | 'wall' | 'fitted' | 'bath'
}

export const roomFootprints = {
  kitchen: { width: 11.4, depth: 6.9, centerZ: 0.05, wallHeight: 4.65, backZ: -3.32, leftX: -5.61 },
  bathroom: { width: 10.2, depth: 6.8, centerZ: 0.2, wallHeight: 4.45, backZ: -3.16, leftX: -5.03 },
} as const

const cookingSurface: RoomPosition = [4.875, 0, 0.3075]

export const kitchenLayout = {
  fridge: [-3.2, 0.025, -2.25],
  counters: [1.85, 0, -2.56],
  hob: cookingSurface,
  kettle: [cookingSurface[0] - 0.2, 1.7935, cookingSurface[2] + 0.22],
  table: [0.6, 0, 1.18],
  rug: [2.5, 0, -1.15],
  plant: [-4.72, 0.02, 2.8],
  counterPlant: [4.43, 1.76, -0.64],
  supplies: [-5.08, 1.25, -1.8],
  chores: [-3.7, 0.025, 2.78],
  stock: [-0.54, 1.51, 0.65],
  ledger: [-0.18, 1.54, 1.55],
  settle: [1.85, 1.51, 1.52],
  budget: [1.7, 1.505, 0.77],
  roommates: [4.3, 3.2, -3.14],
  pendant: [0.6, 3.45, 0.78],
  clock: [-3.2, 4.11, -3.16],
} satisfies Record<string, RoomPosition>

export const kitchenWorktops = [
  { name: 'Rear working counter', position: kitchenLayout.counters, width: 7.5, depth: 1.31, top: 1.735 },
  { name: 'Sink-side preparation return', position: [4.875, 0, -0.405], width: 1.45, depth: 3, top: 1.735 },
] satisfies { name: string; position: RoomPosition; width: number; depth: number; top: number }[]

export const kitchenCabinetBays: { slotId?: RoomSlotId; x: number; width: number; blindCorner?: boolean }[] = [
  { slotId: 'kitchen-washing-machine', x: -1.025, width: 1.4 },
  { slotId: 'kitchen-dryer', x: 0.375, width: 1.4 },
  { x: 1.275, width: 0.4 },
  { x: 2.175, width: 1.4 },
  { slotId: 'kitchen-bins', x: 3.5, width: 1.25 },
  { x: 4.825, width: 1.4, blindCorner: true },
]

export const kitchenReturnBays: { slotId?: RoomSlotId; z: number; width: number; blindCorner?: boolean }[] = [
  { slotId: 'kitchen-undercounter', z: -1.1175, width: 1.425 },
  { slotId: 'kitchen-oven', z: kitchenLayout.hob[2], width: 1.425 },
]

export const kitchenApplianceBays: { slotId: RoomSlotId; x: number; z: number; rotation?: number }[] = [
  { slotId: 'kitchen-washing-machine', x: -1.025, z: -2.56 },
  { slotId: 'kitchen-dryer', x: 0.375, z: -2.56 },
  { slotId: 'kitchen-oven', x: kitchenLayout.hob[0], z: kitchenLayout.hob[2], rotation: -Math.PI / 2 },
  { slotId: 'kitchen-undercounter', x: 4.875, z: -1.1175, rotation: -Math.PI / 2 },
]

export const kitchenShelves = [
  { name: 'Appliance shelf', position: [-1.3, 0, -2.87], width: 1.1, depth: 0.7, top: 2.83, slots: ['kitchen-small-appliance'] },
  { name: 'Listening shelf', position: [-5.2, 0, 2.05], width: 0.6, depth: 2.1, top: 1.75, slots: ['kitchen-speaker', 'kitchen-record-player', 'kitchen-diffuser'] },
  { name: 'Household care shelf', position: [-5.2, 0, 2], width: 0.6, depth: 1.2, top: 2.22, slots: ['kitchen-first-aid', 'kitchen-tissue-box'] },
] satisfies { name: string; position: RoomPosition; width: number; depth: number; top: number; slots: RoomSlotId[] }[]

export const bathroomLayout = {
  bath: [-3.75, 0, -1.3],
  sink: [0.55, 0, -2.28],
  mirror: [0.55, 3.06, -3.055],
  toilet: [2.66, 0, -2.12],
  supplies: [4.4, 0, -2.4],
  chores: [4.56, 1.4, -0.6],
} satisfies Record<string, RoomPosition>

export const bathroomMat = { position: [0.55, 0.04, -0.6] as RoomPosition, width: 2.9, depth: 1.65 }
export const bathroomCaddyShelf = { position: [4.52, 1.42, -0.6] as RoomPosition, width: 0.9, depth: 1.4, top: 1.46 }

export const componentPlacements: Partial<Record<RoomSlotId, ComponentPlacement>> = {
  'kitchen-table': { position: kitchenLayout.table, surface: 'floor' },
  'kitchen-plant-floor': { position: kitchenLayout.plant, surface: 'floor' },
  'kitchen-plant-counter': { position: kitchenLayout.counterPlant, scale: 0.48, rotation: -Math.PI / 2, surface: 'counter' },
  ...Object.fromEntries(kitchenApplianceBays.map(({ slotId, x, z, rotation }) =>
    [slotId, { position: [x, 0.235, z], scale: [0.9, 0.89, 0.91], rotation, surface: 'fitted' }])),
  'kitchen-coffee': { position: [-1.57, 1.735, -2.48], surface: 'counter' },
  'kitchen-small-appliance': { position: [-1.3, 2.83, -2.87], surface: 'counter' },
  'kitchen-drinks': { position: [-0.72, 1.735, -2.43], surface: 'counter' },
  'kitchen-dish-rack': { position: [4.3, 1.735, -2.26], surface: 'counter' },
  'kitchen-bins': { position: [3.5, 0.235, -2.36], surface: 'fitted' },
  'kitchen-vacuum': { position: [-2.63, 0.02, 2.85], surface: 'floor' },
  'kitchen-wall-art': { position: [-1.45, 4, -3.238], scale: 0.72, surface: 'wall' },
  'kitchen-soap-dispenser': { position: [3.98, 1.735, -3.02], scale: 0.65, surface: 'counter' },
  'kitchen-table-center': { position: [0.72, 1.495, 0.76], scale: 0.72, surface: 'table' },
  'kitchen-windowsill': { position: [2.24, 2.36, -2.63], scale: 0.35, surface: 'counter' },
  'kitchen-left-wall': { position: [-5.495, 3.9, -0.5], scale: 0.68, rotation: Math.PI / 2, surface: 'wall' },
  'kitchen-air-fryer': { position: [5.1, 1.735, -2.28], surface: 'counter' },
  'kitchen-stand-mixer': { position: [5.23, 1.735, -1.49], rotation: -Math.PI / 2, surface: 'counter' },
  'kitchen-blender': { position: [5.23, 1.735, -0.63], rotation: -Math.PI / 2, surface: 'counter' },
  'kitchen-rice-cooker': { position: [2.18, 1.735, -2.48], surface: 'counter' },
  'kitchen-scale': { position: [0.06, 1.735, -2.25], surface: 'counter' },
  'kitchen-cookbook': { position: [2.7, 1.735, -2.48], surface: 'counter' },
  'kitchen-cutting-boards': { position: [4.43, 1.735, -1.38], rotation: -Math.PI / 2, surface: 'counter' },
  'kitchen-knife-block': { position: [2.82, 1.735, -3.07], surface: 'counter' },
  'kitchen-egg-basket': { position: [0.04, 1.735, -2.88], surface: 'counter' },
  'kitchen-toaster': { position: [0.77, 1.735, -2.42], surface: 'counter' },
  'kitchen-waffle-maker': { position: [1.4, 1.735, -2.45], surface: 'counter' },
  'kitchen-bread-box': { position: [-0.18, 2.36, -2.63], surface: 'counter' },
  'kitchen-water-filter': { position: [4.35, 1.735, -2.97], surface: 'counter' },
  'kitchen-mug-tree': { position: [0.42, 2.36, -2.63], surface: 'counter' },
  'kitchen-cereal-dispenser': { position: [1.91, 2.36, -2.63], surface: 'counter' },
  'kitchen-tea-set': { position: [1.22, 2.36, -2.63], surface: 'counter' },
  'kitchen-paper-towels': { position: [4.92, 1.735, -2.98], surface: 'counter' },
  'kitchen-spice-rack': { position: [2.9, 2.62, -3.12], surface: 'wall' },
  'kitchen-key-hooks': { position: [-5.495, 2.5, 0.85], rotation: Math.PI / 2, surface: 'wall' },
  'kitchen-wall-shelf': { position: [2.75, 3.8, -3.12], surface: 'wall' },
  'kitchen-first-aid': { position: [-5.17, 2.22, 1.62], rotation: Math.PI / 2, surface: 'counter' },
  'kitchen-speaker': { position: [-5.17, 1.75, 1.2], rotation: Math.PI / 2, surface: 'counter' },
  'kitchen-record-player': { position: [-5.17, 1.75, 2], rotation: Math.PI / 2, surface: 'counter' },
  'kitchen-tissue-box': { position: [-5.17, 2.22, 2.3], rotation: Math.PI / 2, surface: 'counter' },
  'kitchen-diffuser': { position: [-5.17, 1.75, 2.72], rotation: Math.PI / 2, surface: 'counter' },
  'kitchen-board-game': { position: [0.78, 1.495, 1.65], surface: 'table' },
  'kitchen-storage-cabinet': { position: [-5.22, 0.02, 1.8], rotation: Math.PI / 2, surface: 'floor' },
  'kitchen-cart': { position: [4.93, 0.02, 1.53], surface: 'floor' },
  'kitchen-pet-bowls': { position: [4.88, 0.02, 2.84], surface: 'floor' },
  'kitchen-air-purifier': { position: [5, 0.02, 2.3], surface: 'floor' },
  'kitchen-watering-can': { position: [-4.5, 0.02, 2.08], surface: 'floor' },
  'bathroom-bath': { position: bathroomLayout.bath, surface: 'floor' },
  'bathroom-laundry': { position: [-4.3, 0.02, 2.4], rotation: Math.PI / 2, surface: 'floor' },
  'bathroom-laundry-basket': { position: [-4.48, 0.02, 1.15], rotation: Math.PI / 2, surface: 'floor' },
  'bathroom-drying-rack': { position: [-0.6, 0.02, 2.8], surface: 'floor' },
  'bathroom-towel-rack': { position: [-4.955, 2.65, -1.25], rotation: Math.PI / 2, surface: 'wall' },
  'bathroom-plant': { position: [4.48, 0.02, 0.65], scale: 0.86, surface: 'floor' },
  'bathroom-wall-art': { position: [3.12, 3.25, -3.088], surface: 'wall' },
  'bathroom-soap-dispenser': { position: [-0.3, 1.66, -2.19], surface: 'counter' },
  'bathroom-shower-shelf': { position: [-3.65, 2.45, -3.088], surface: 'wall' },
  'bathroom-bins': { position: [3.56, 0.02, -2.12], scale: 0.7, surface: 'floor' },
  'bathroom-vanity-accessory': { position: [1.5, 1.66, -2.16], scale: 0.48, surface: 'counter' },
  'bathroom-floor-storage': { position: [-2.08, 0.025, 1.92], scale: 0.85, rotation: Math.PI / 2, surface: 'floor' },
  'bathroom-bath-tray': { position: [-3.75, 1.2, -0.8], surface: 'bath' },
  'bathroom-toilet-accessory': { position: [3.61, 0.025, -1.31], scale: 0.65, surface: 'floor' },
  'bathroom-dryer': { position: [-4.3, 1.61, 2.4], rotation: Math.PI / 2, surface: 'fitted' },
  'bathroom-storage-cabinet': { position: [-1.65, 0.02, -2.7], surface: 'floor' },
  'bathroom-stool': { position: [-2.17, 0.02, 0.8], surface: 'floor' },
  'bathroom-air-purifier': { position: [4.47, 0.02, 1.75], surface: 'floor' },
  'bathroom-ironing-board': { position: [1.78, 0.02, 2.88], surface: 'floor' },
  'bathroom-wall-calendar': { position: [-4.955, 3.15, 1.1], rotation: Math.PI / 2, surface: 'wall' },
  'bathroom-key-hooks': { position: [-4.955, 3.42, 2.4], rotation: Math.PI / 2, surface: 'wall' },
  'bathroom-wall-shelf': { position: [-1.65, 2.35, -3.088], surface: 'wall' },
  'bathroom-shower-squeegee': { position: [-4.7, 2.6, -3.088], surface: 'wall' },
  'bathroom-hair-dryer': { position: [-0.52, 1.66, -2.6], scale: 0.9, surface: 'counter' },
  'bathroom-storage-jars': { position: [1.76, 2.44, -2.92], scale: 0.75, surface: 'counter' },
  'bathroom-tissue-box': { position: [2.33, 2.44, -2.92], surface: 'counter' },
  'bathroom-first-aid': { position: [1.76, 3.02, -2.92], surface: 'counter' },
  'bathroom-diffuser': { position: [2.33, 3.02, -2.92], surface: 'counter' },
  'bathroom-vacuum': { position: [4.28, 0.02, 2.88], surface: 'floor' },
}

export function roomShellBounds(roomId: RoomId): Box3 {
  const footprint = roomFootprints[roomId]
  return new Box3(
    new Vector3(-footprint.width / 2, -0.3, Math.min(footprint.backZ - 0.1, footprint.centerZ - footprint.depth / 2)),
    new Vector3(footprint.width / 2, 5.1, footprint.centerZ + footprint.depth / 2),
  )
}
