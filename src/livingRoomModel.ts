import {
  Box3, CircleGeometry, Group, Mesh, MeshStandardMaterial,
  Object3D, Vector3,
} from 'three'
import type { RoomStyle } from '../shared/domain.ts'
import { defaultRoomComponents } from '../shared/roomComponents.ts'
import type { RoomSlotId } from '../shared/roomComponents.ts'
import { fitRoomBounds } from './camera.ts'
import { createRoomWallGroup } from './roomCutaway.ts'
import { buildRoomWalls } from './roomShell.ts'
import { roomShellLayout } from './roomLayout.ts'
import type { SceneFocus } from './camera.ts'
import type { ContactShadow } from './lighting.ts'
import { livingRoomWindow } from './livingRoomComponentModels.ts'
import { buildWindowLandscape } from './windowLandscape.ts'
import { buildRoomComponentModel } from './roomComponentModels.ts'
import type { ComponentBindings, ComponentFixtures } from './roomComponentTypes.ts'
import { roomAccents, roomPresets } from './roomStyles.ts'
import type { RoomStyleMaterials } from './roomStyles.ts'
import { createRoomMaterial, prepareRoomSurfaceGeometry, roomMaterialSurface } from './surfaceMaterials.ts'
import type { RoomSurface } from './surfaceMaterials.ts'
import { createRoomBoxGeometry } from './roomGeometry.ts'
import { componentMaterialColors } from './componentMaterials.ts'

export { livingRoomLampPosition } from './livingRoomComponentModels.ts'
export const livingRoomTargets = ['sofa', 'surfaces', 'plants', 'floor', 'bins', 'chores', 'supplies'] as const
export type LivingRoomTarget = typeof livingRoomTargets[number]
export type LivingRoomFocus = LivingRoomTarget | 'room'
export const livingRoomLabels: Record<LivingRoomTarget, string> = {
  sofa: 'Sofa chores', surfaces: 'Surface chores', plants: 'Plant care', floor: 'Floor chores',
  bins: 'Bin chores', chores: 'Cleaning caddy', supplies: 'Supply shelf',
}

type Position = [number, number, number]
type Framing = { center: Position; halfHeight: number }

const targetSlots = {
  sofa: 'living-room-sofa', surfaces: 'living-room-coffee-table', plants: 'living-room-plant',
  bins: 'living-room-bins', chores: 'living-room-cleaning-caddy', supplies: 'living-room-supply-shelf',
} as const satisfies Record<Exclude<LivingRoomTarget, 'floor'>, RoomSlotId>

const labelPositions: Partial<Record<RoomSlotId, Position>> = {
  'living-room-sofa': [0.05, 1.97, -1.56],
  'living-room-coffee-table': [-1.95, 1.22, 0.9],
  'living-room-media-unit': [-3.52, 1.4, -1.3],
  'living-room-tv': [-4.02, 2.78, -0.4],
  'living-room-bookshelf': [3.9, 3.73, -2.56],
  'living-room-floor-lamp': [2.78, 3.17, -1.21],
  'living-room-rug': [-2.42, 0.2, 1.27],
  'living-room-plant': [3.0, 1.83, 1.27],
  'living-room-curtains': [-2.95, 4.34, -2.96],
  'living-room-supply-shelf': [4.16, 2.68, 0.33],
  'living-room-cleaning-caddy': [2.55, 1.3, 2.69],
  'living-room-bins': [4.2, 1.16, 2.34],
  'living-room-table-top': [-0.95, 1.16, 0.35],
}

export function livingRoomFocusForRequest(target: SceneFocus | LivingRoomFocus): LivingRoomFocus {
  return livingRoomTargets.find((candidate) => candidate === target) ?? 'room'
}

export function buildLivingRoomModel(room: Group, style: RoomStyle = 'original') {
  const materials: MeshStandardMaterial[] = []
  const material = (name: string, color: string, roughness = 0.85, finish: RoomSurface = 'paint') => {
    const result = createRoomMaterial(color, roughness, finish, name)
    materials.push(result)
    return result
  }
  const surface = (name: keyof RoomStyleMaterials, finish: RoomSurface = 'paint') => material(name, roomPresets[style].colors[name], 0.85, finish)
  const styleMaterials: RoomStyleMaterials = {
    wall: surface('wall', 'plaster'), trim: surface('trim'), floor: surface('floor', 'wood'), floorAlternate: surface('floorAlternate', 'wood'),
    fridge: surface('fridge'), fridgeDoor: surface('fridgeDoor'), fridgeEdge: surface('fridgeEdge'),
    cabinet: surface('cabinet'), cabinetPanel: surface('cabinetPanel'), counter: surface('counter'),
    wood: surface('wood', 'wood'), lightWood: surface('lightWood', 'wood'), woodGrain: surface('woodGrain', 'wood'),
  }
  const sky = material('Daylight sky', roomAccents.sky, 0.9, 'light')
  sky.emissive.set(roomAccents.sky)
  sky.emissiveIntensity = 0.15
  const cloud = material('Distant clouds', roomAccents.cream, 0.9, 'light')
  const hills = material('Distant sage hills', roomAccents.leafLight, 0.9, 'light')
  const trees = material('Distant trees', roomAccents.leaf, 0.9, 'light')
  const sunshine = material('Window sunshine', roomAccents.gold, 0.9, 'light')
  const doorHardware = material('Entry door hardware', componentMaterialColors.steel, 0.38, 'metal')
  const actors = new Map<LivingRoomTarget, Group>()
  const anchors = new Map<LivingRoomTarget, Object3D>()
  const contacts: ContactShadow[] = []
  const componentBindings: ComponentBindings = new Map()
  const componentFixtures: ComponentFixtures = new Map()
  const preserved = new Set<Object3D>()
  const box = (parent: Group, size: Position, position: Position, mat: MeshStandardMaterial, radius = 0) => {
    const mesh = new Mesh(createRoomBoxGeometry(size, radius), mat)
    mesh.position.set(...position)
    mesh.castShadow = Math.min(...size) > 0.025
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const attachTarget = (target: LivingRoomTarget, group: Group, position: Position) => {
    group.userData.livingRoomTarget = target
    const anchor = new Object3D()
    anchor.name = `${livingRoomLabels[target]} anchor`
    anchor.position.copy(group.worldToLocal(room.localToWorld(new Vector3(...position))))
    group.add(anchor)
    actors.set(target, group)
    anchors.set(target, anchor)
  }

  room.name = 'Open-corner living room'
  const { outer } = roomShellLayout('living-room')
  box(room, [outer.right - outer.left, 0.24, outer.front - outer.back],
    [(outer.left + outer.right) / 2, -0.135, (outer.back + outer.front) / 2], styleMaterials.wood, 0.085)
  box(room, [9.92, 0.035, 6.5], [0, -0.012, 0], styleMaterials.floor, 0.025)
  const floor = new Group()
  floor.name = livingRoomLabels.floor
  room.add(floor)
  for (let row = 0; row < 12; row++) {
    for (let column = 0; column < 3; column++) {
      const plank = box(floor, [3.277, 0.021, 0.534],
        [-3.29 + column * 3.29, 0.009, -2.965 + row * 0.539], styleMaterials.lightWood, 0.004)
      plank.castShadow = false
    }
    for (const x of [-3.98, 0.05, 3.11]) {
      const grain = box(floor, [0.72 + row % 3 * 0.21, 0.004, 0.008],
        [x + (row % 2 ? 0.2 : -0.18), 0.021, -2.91 + row * 0.539], styleMaterials.woodGrain)
      grain.castShadow = false
    }
  }

  const { left, right, bottom, top } = livingRoomWindow
  const wall = new Group()
  wall.name = 'Walls around the open window'
  room.add(wall)
  buildRoomWalls(wall, 'living-room', {
    name: 'Living room', centerY: 2.25, wall: styleMaterials.wall, trim: styleMaterials.trim,
    opening: { left, right, bottom, top },
    entryDoor: { panel: styleMaterials.trim, frame: styleMaterials.trim, hardware: doorHardware },
  })

  const window = new Group()
  window.name = 'Recessed lounge window'
  window.userData.roomLightSwitch = true
  room.add(window)
  const windowPane = createRoomWallGroup(window, 'back', 'Living room window cutaway')
  box(windowPane, [right - left, top - bottom, 0.018],
    [(left + right) / 2, (bottom + top) / 2, -3.405], sky).receiveShadow = false
  buildWindowLandscape(windowPane, { left, right, bottom, top, z: -3.387 }, { cloud, hills, trees })
  const sun = new Mesh(new CircleGeometry(0.22, 16), sunshine)
  sun.name = 'Flat living room sun'
  sun.position.set(-1.79, 3.6, -3.382)
  windowPane.add(sun)
  for (const x of [left, right]) {
    box(windowPane, [0.095, top - bottom + 0.14, 0.245], [x, (top + bottom) / 2, -3.23], styleMaterials.counter, 0.008)
    box(windowPane, [0.045, top - bottom + 0.06, 0.018], [x, (top + bottom) / 2, -3.095], styleMaterials.wood, 0.005)
  }
  for (const y of [bottom, top]) {
    box(windowPane, [right - left + 0.14, 0.095, 0.245], [(left + right) / 2, y, -3.23], styleMaterials.counter, 0.008)
  }
  box(windowPane, [0.065, top - bottom, 0.1], [(left + right) / 2, (top + bottom) / 2, -3.19], styleMaterials.counter, 0.006)
  box(windowPane, [right - left, 0.055, 0.1], [(left + right) / 2, 3.16, -3.19], styleMaterials.counter, 0.006)
  box(window, [4.46, 0.14, 0.48], [-0.55, 2.07, -3.03], styleMaterials.lightWood, 0.018)
  box(window, [4.29, 0.095, 0.08], [-0.55, 1.958, -3.102], styleMaterials.trim, 0.01)

  let lampMaterial: MeshStandardMaterial | undefined
  for (const component of defaultRoomComponents().filter((item) => item.roomId === 'living-room' && item.slotId !== 'living-room-bins')) {
    const generated = buildRoomComponentModel(component, style)
    const replacements = new Map<MeshStandardMaterial, MeshStandardMaterial>()
    for (const [source, name] of generated.styleSurfaces) {
      const shared = styleMaterials[name]
      if (roomMaterialSurface(source) === roomMaterialSurface(shared)) replacements.set(source, shared)
      else {
        source.color = shared.color
        source.name = `${name} ${roomMaterialSurface(source)}`
      }
    }
    const used = new Set<MeshStandardMaterial>()
    generated.root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const replace = (source: MeshStandardMaterial) => {
        const replacement = replacements.get(source) ?? source
        used.add(replacement)
        return replacement
      }
      object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material)
    })
    const finishes = [...new Set(generated.finishes.map((source) => replacements.get(source) ?? source))]
    finishes.forEach((source) => used.add(source))
    // Original fixtures share preset sources, but their editable finishes are isolated by the component scene.
    for (const source of generated.materials) {
      if (replacements.has(source) || !used.has(source)) source.dispose()
      else materials.push(source)
    }
    room.add(generated.root)
    const footprints = generated.contacts ?? []
    contacts.push(...footprints)
    componentBindings.set(component.slotId, {
      root: generated.root, finishes, contacts: footprints, anchor: labelPositions[component.slotId],
    })
    if (component.kind === 'floor-lamp') lampMaterial = [...used].find((source) => source.name === 'Reading lamp glow')
  }
  if (!lampMaterial) throw new Error('The living room needs its original reading lamp material.')

  room.updateMatrixWorld(true)
  attachTarget('floor', floor, [-1.25, 0.15, 2.48])
  for (const [target, slotId] of Object.entries(targetSlots) as [Exclude<LivingRoomTarget, 'floor'>, RoomSlotId][]) {
    const binding = componentBindings.get(slotId)
    if (binding) attachTarget(target, binding.root, binding.anchor!)
  }
  room.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(room)
  const actorBounds = new Map([...actors].map(([target, group]) => [
    target, new Box3().setFromObject(group).expandByPoint(anchors.get(target)!.getWorldPosition(new Vector3())),
  ]))
  prepareRoomSurfaceGeometry(room)
  return { materials, styleMaterials, actors, anchors, bounds, actorBounds, contacts, lampMaterial,
    windowMaterials: { sky, disc: sunshine }, componentBindings, componentFixtures, preserved }
}

export function livingRoomFraming(
  width: number, height: number, bounds: Box3, rotation = 0, pitch = 0, options: { closeRoom?: boolean } = {},
): Framing {
  const framing = fitRoomBounds(width, height, bounds, rotation, pitch)
  if (options.closeRoom) framing.halfHeight /= 1.025
  return framing
}

export function livingRoomTourFraming(
  width: number, height: number, progress: number, bounds: Box3,
  actorBounds: ReadonlyMap<LivingRoomTarget, Box3>, stops: readonly LivingRoomFocus[],
): Framing {
  if (!Number.isFinite(progress) || stops.length < 2 || bounds.isEmpty()
    || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
    throw new Error('Living room exploration needs valid bounds, finite progress and at least two stops.')
  }
  const frames = stops.map((focus) => {
    const measured = focus === 'room' ? bounds : actorBounds.get(focus)
    if (!measured) throw new Error('The living room exploration stop is missing its measured bounds.')
    return livingRoomFraming(width, height, measured)
  })
  const step = Math.max(0, Math.min(1, progress)) * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(step))
  const amount = step - index
  const eased = amount * amount * (3 - 2 * amount)
  const from = frames[index]
  const to = frames[index + 1]
  return {
    center: [
      from.center[0] + (to.center[0] - from.center[0]) * eased,
      from.center[1] + (to.center[1] - from.center[1]) * eased,
      from.center[2] + (to.center[2] - from.center[2]) * eased,
    ],
    halfHeight: from.halfHeight + (to.halfHeight - from.halfHeight) * eased,
  }
}
