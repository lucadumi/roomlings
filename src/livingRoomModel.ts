import {
  Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  Object3D, Shape, ShapeGeometry, Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { RoomStyle } from '../shared/domain.ts'
import { defaultRoomComponents } from '../shared/roomComponents.ts'
import type { RoomSlotId } from '../shared/roomComponents.ts'
import { fitRoomBounds } from './camera.ts'
import type { SceneFocus } from './camera.ts'
import type { ContactShadow } from './lighting.ts'
import { livingRoomWindow } from './livingRoomComponentModels.ts'
import { buildRoomComponentModel } from './roomComponentModels.ts'
import type { ComponentBindings, ComponentFixtures } from './roomComponentTypes.ts'
import { roomAccents, roomPresets } from './roomStyles.ts'
import type { RoomStyleMaterials } from './roomStyles.ts'

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
  const material = (name: string, color: string, roughness = 0.85) => {
    const result = new MeshStandardMaterial({ name, color, roughness, flatShading: true })
    materials.push(result)
    return result
  }
  const surface = (name: keyof RoomStyleMaterials) => material(name, roomPresets[style].colors[name])
  const styleMaterials: RoomStyleMaterials = {
    wall: surface('wall'), trim: surface('trim'), floor: surface('floor'), floorAlternate: surface('floorAlternate'),
    fridge: surface('fridge'), fridgeDoor: surface('fridgeDoor'), fridgeEdge: surface('fridgeEdge'),
    cabinet: surface('cabinet'), cabinetPanel: surface('cabinetPanel'), counter: surface('counter'),
    wood: surface('wood'), lightWood: surface('lightWood'), woodGrain: surface('woodGrain'),
  }
  const sky = material('Daylight sky', roomAccents.sky)
  sky.emissive.set(roomAccents.sky)
  sky.emissiveIntensity = 0.15
  const cloud = material('Distant clouds', roomAccents.cream)
  const hills = material('Distant sage hills', roomAccents.leafLight)
  const trees = material('Distant trees', roomAccents.leaf)
  const sunshine = material('Window sunshine', roomAccents.gold)
  const actors = new Map<LivingRoomTarget, Group>()
  const anchors = new Map<LivingRoomTarget, Object3D>()
  const contacts: ContactShadow[] = []
  const componentBindings: ComponentBindings = new Map()
  const componentFixtures: ComponentFixtures = new Map()
  const preserved = new Set<Object3D>()
  const box = (parent: Group, size: Position, position: Position, mat: MeshStandardMaterial, radius = 0) => {
    const mesh = new Mesh(radius ? new RoundedBoxGeometry(...size, 1, radius) : new BoxGeometry(...size), mat)
    mesh.position.set(...position)
    mesh.castShadow = Math.min(...size) > 0.025
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const silhouette = (parent: Group, points: readonly [number, number][], z: number, mat: MeshStandardMaterial) => {
    const shape = new Shape()
    points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y))
    shape.closePath()
    const mesh = new Mesh(new ShapeGeometry(shape), mat)
    mesh.position.z = z
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
  box(room, [10, 0.24, 6.6], [0, -0.135, 0], styleMaterials.wood, 0.085)
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

  const { left, right, bottom, top, wallZ } = livingRoomWindow
  const wall = new Group()
  wall.name = 'Walls around the open window'
  room.add(wall)
  box(wall, [left + 5, 4.5, 0.14], [(left - 5) / 2, 2.25, wallZ], styleMaterials.wall)
  box(wall, [5 - right, 4.5, 0.14], [(right + 5) / 2, 2.25, wallZ], styleMaterials.wall)
  box(wall, [right - left, bottom, 0.14], [(right + left) / 2, bottom / 2, wallZ], styleMaterials.wall)
  box(wall, [right - left, 4.5 - top, 0.14], [(right + left) / 2, (4.5 + top) / 2, wallZ], styleMaterials.wall)
  box(wall, [0.14, 4.5, 4.0], [-4.93, 2.25, -1.23], styleMaterials.wall, 0.025)
  box(wall, [10, 0.095, 0.19], [0, 4.49, wallZ + 0.01], styleMaterials.trim, 0.012)
  box(wall, [0.19, 0.095, 4.01], [-4.92, 4.49, -1.23], styleMaterials.trim, 0.012)
  box(wall, [9.84, 0.13, 0.065], [0.01, 0.115, -3.128], styleMaterials.trim, 0.008)
  box(wall, [0.065, 0.13, 3.91], [-4.824, 0.115, -1.24], styleMaterials.trim, 0.008)

  const window = new Group()
  window.name = 'Recessed lounge window'
  room.add(window)
  box(window, [right - left, top - bottom, 0.018],
    [(left + right) / 2, (bottom + top) / 2, -3.405], sky).receiveShadow = false
  silhouette(window, [[left, bottom], [right, bottom], [right, 2.58], [0.82, 2.81],
    [0.1, 2.55], [-0.8, 2.83], [-1.64, 2.56], [left, 2.75]], -3.387, hills)
  silhouette(window, [[left, bottom], [right, bottom], [right, 2.35], [0.77, 2.54],
    [0.1, 2.33], [-0.82, 2.52], [-1.74, 2.29], [left, 2.41]], -3.377, trees)
  const sun = new Mesh(new CylinderGeometry(0.22, 0.22, 0.012, 12), sunshine)
  sun.rotation.x = Math.PI / 2
  sun.position.set(-1.79, 3.6, -3.383)
  window.add(sun)
  for (const [x, y, width] of [[-0.33, 3.65, 0.62], [0.76, 3.29, 0.48]]) {
    silhouette(window, [[x - width / 2, y - 0.04], [x + width / 2, y - 0.04], [x + width / 2, y + 0.04],
      [x + width * 0.18, y + 0.04], [x, y + 0.16], [x - width * 0.2, y + 0.06],
      [x - width / 2, y + 0.05]], -3.38, cloud)
  }
  for (const x of [left, right]) {
    box(window, [0.095, top - bottom + 0.14, 0.245], [x, (top + bottom) / 2, -3.23], styleMaterials.counter, 0.008)
    box(window, [0.045, top - bottom + 0.06, 0.018], [x, (top + bottom) / 2, -3.095], styleMaterials.wood, 0.005)
  }
  for (const y of [bottom, top]) {
    box(window, [right - left + 0.14, 0.095, 0.245], [(left + right) / 2, y, -3.23], styleMaterials.counter, 0.008)
  }
  box(window, [0.065, top - bottom, 0.1], [(left + right) / 2, (top + bottom) / 2, -3.19], styleMaterials.counter, 0.006)
  box(window, [right - left, 0.055, 0.1], [(left + right) / 2, 3.16, -3.19], styleMaterials.counter, 0.006)
  box(window, [4.46, 0.14, 0.48], [-0.55, 2.07, -3.03], styleMaterials.lightWood, 0.018)
  box(window, [4.29, 0.095, 0.08], [-0.55, 1.958, -3.102], styleMaterials.trim, 0.01)

  let lampMaterial: MeshStandardMaterial | undefined
  for (const component of defaultRoomComponents().filter((item) => item.roomId === 'living-room')) {
    const generated = buildRoomComponentModel(component, style)
    const replacements = new Map([...generated.styleSurfaces].map(([source, name]) => [source, styleMaterials[name]]))
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
    const binding = componentBindings.get(slotId)!
    attachTarget(target, binding.root, binding.anchor!)
  }
  room.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(room)
  const actorBounds = new Map([...actors].map(([target, group]) => [
    target, new Box3().setFromObject(group).expandByPoint(anchors.get(target)!.getWorldPosition(new Vector3())),
  ]))
  return { materials, styleMaterials, actors, anchors, bounds, actorBounds, contacts, lampMaterial, componentBindings, componentFixtures, preserved }
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
