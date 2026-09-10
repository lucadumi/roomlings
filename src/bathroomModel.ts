import {
  Box3, BoxGeometry, CylinderGeometry, Group, LatheGeometry, Mesh,
  MeshStandardMaterial, Object3D, Vector2, Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { RoomStyle } from '../shared/domain.ts'
import { cameraFraming, fitRoomBounds } from './camera.ts'
import type { SceneFocus } from './camera.ts'
import type { ContactShadow } from './lighting.ts'
import { roomAccents, roomPresets } from './roomStyles.ts'
import type { RoomStyleMaterials } from './roomStyles.ts'
import type { ComponentBindings, ComponentFixtures } from './roomComponentTypes.ts'
import { bathroomCaddyShelf, bathroomLayout, bathroomMat, componentPlacements, roomFootprints, roomShellLayout } from './roomLayout.ts'
import { buildRoomWalls } from './roomShell.ts'

export const bathroomTargets = ['sink', 'mirror', 'toilet', 'bath', 'floor', 'chores', 'supplies'] as const
export type BathroomTarget = typeof bathroomTargets[number]
export type BathroomFocus = BathroomTarget | 'room'
export const bathroomLabels: Record<BathroomTarget, string> = {
  sink: 'Sink chores', mirror: 'Mirror chores', toilet: 'Toilet chores',
  bath: 'Bath chores', floor: 'Floor chores', chores: 'Cleaning caddy', supplies: 'Supply shelf',
}

type Position = [number, number, number]

export function bathroomFocusForRequest(target: SceneFocus | BathroomFocus): BathroomFocus {
  return bathroomTargets.find((candidate) => candidate === target) ?? 'room'
}

export function buildBathroomModel(room: Group, style: RoomStyle = 'original') {
  const materials: MeshStandardMaterial[] = []
  const material = (name: string, color: string, roughness = 0.85) => {
    const result = new MeshStandardMaterial({ color, roughness, flatShading: true })
    result.name = name
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
  const porcelain = material('Warm porcelain', roomAccents.cream, 0.55)
  const water = material('Bath water', roomAccents.water, 0.48)
  const silver = material('Brushed fittings', roomAccents.metal, 0.36)
  silver.metalness = 0.25
  const mirrorGlass = material('Opaque mirror', roomAccents.sky, 0.38)
  mirrorGlass.metalness = 0.2
  const tomato = material('Tomato accessories', roomAccents.tomato, 0.75)
  const linen = material('Folded linen', roomAccents.linen)
  const dark = material('Fitting recesses', roomAccents.ink)
  const lampMaterial = material('Mirror light', '#fff1ce', 0.65)
  lampMaterial.emissive.set('#ffe5b0')
  lampMaterial.emissiveIntensity = 0.2
  const actors = new Map<BathroomTarget, Group>()
  const anchors = new Map<BathroomTarget, Object3D>()
  const contacts: ContactShadow[] = []
  const actor = (target: BathroomTarget, position: Position, anchorPosition: Position) => {
    const group = new Group()
    group.name = bathroomLabels[target]
    group.position.set(...position)
    group.userData.bathroomTarget = target
    const anchor = new Object3D()
    anchor.name = `${bathroomLabels[target]} anchor`
    anchor.position.set(...anchorPosition)
    group.add(anchor)
    room.add(group)
    actors.set(target, group)
    anchors.set(target, anchor)
    return group
  }
  const box = (parent: Group, dimensions: Position, position: Position, mat: MeshStandardMaterial, radius = 0) => {
    const geometry = radius ? new RoundedBoxGeometry(...dimensions, 1, radius) : new BoxGeometry(...dimensions)
    const mesh = new Mesh(geometry, mat)
    mesh.position.set(...position)
    mesh.castShadow = Math.min(...dimensions) > 0.025
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const cylinder = (parent: Group, radius: number, height: number, position: Position, mat: MeshStandardMaterial, top = radius, segments = 10) => {
    const mesh = new Mesh(new CylinderGeometry(top, radius, height, segments), mat)
    mesh.position.set(...position)
    mesh.castShadow = radius > 0.025 && height > 0.025
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const basin = (parent: Group, profile: [number, number][], scale: Position, position: Position, mat = porcelain) => {
    const mesh = new Mesh(new LatheGeometry(profile.map(([radius, y]) => new Vector2(radius, y)), 16), mat)
    mesh.scale.set(...scale)
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const bottle = (parent: Group, position: Position, mat: MeshStandardMaterial, height = 0.38) => {
    const group = new Group()
    group.position.set(...position)
    parent.add(group)
    cylinder(group, 0.12, height, [0, height / 2, 0], mat, 0.095, 8)
    cylinder(group, 0.045, 0.11, [0, height + 0.055, 0], porcelain, 0.045, 8)
    box(group, [0.17, 0.045, 0.055], [0.05, height + 0.11, 0], dark, 0.012)
    box(group, [0.12, height * 0.38, 0.016], [0, height * 0.47, 0.117], linen)
    return group
  }

  room.name = 'Open-corner bathroom'
  const footprint = roomFootprints.bathroom
  const { outer } = roomShellLayout('bathroom')
  const floorBase = box(room, [outer.right - outer.left, 0.24, outer.front - outer.back],
    [(outer.left + outer.right) / 2, -0.145, (outer.back + outer.front) / 2], styleMaterials.lightWood, 0.1)
  floorBase.name = 'Bathroom floor base'
  buildRoomWalls(room, 'bathroom', { name: 'Bathroom', centerY: 2.15, wall: styleMaterials.wall, trim: styleMaterials.trim, lowerPanel: styleMaterials.floor })
  const floor = actor('floor', [0, 0, 0], [bathroomMat.position[0], 0.16, bathroomMat.position[2]])
  const tileWidth = (footprint.width - 0.26) / 10
  const tileDepth = (footprint.depth - 0.25) / 6
  for (let x = 0; x < 10; x++) {
    for (let z = 0; z < 6; z++) {
      const tile = box(floor, [tileWidth - 0.008, 0.025, tileDepth - 0.008],
        [(x - 4.5) * tileWidth, -0.006, footprint.centerZ + (z - 2.5) * tileDepth],
        (x + z) % 2 ? styleMaterials.floor : styleMaterials.floorAlternate)
      tile.castShadow = false
    }
  }
  const mat = box(floor, [bathroomMat.width, 0.045, bathroomMat.depth], bathroomMat.position, styleMaterials.fridgeDoor, 0.02)
  mat.name = 'Vanity bath mat'
  for (const side of [-1, 1]) {
    box(floor, [0.055, 0.012, bathroomMat.depth - 0.09],
      [bathroomMat.position[0] + side * (bathroomMat.width / 2 - 0.18), 0.07, bathroomMat.position[2]], styleMaterials.fridgeEdge)
    for (let i = 0; i < 10; i++) {
      box(floor, [0.16, 0.025, 0.035],
        [bathroomMat.position[0] + side * (bathroomMat.width / 2 + 0.035), 0.035, bathroomMat.position[2] - 0.7 + i * 0.155], linen)
    }
  }

  const bath = actor('bath', bathroomLayout.bath, [0, 1.45, 0.55])
  basin(bath, [[0, 0.13], [0.69, 0.13], [0.79, 0.22], [0.98, 1.03], [1, 1.13],
    [0.97, 1.19], [0.86, 1.19], [0.8, 1.02], [0.67, 0.43], [0, 0.43]], [1, 1, 1.52], [0, 0, 0])
  const bathWater = cylinder(bath, 0.695, 0.025, [0, 0.52, 0], water, 0.695, 16)
  bathWater.scale.z = 1.52
  bathWater.castShadow = false
  cylinder(bath, 0.046, 1.65, [-0.89, 0.86, -1.24], silver)
  box(bath, [0.46, 0.075, 0.075], [-0.68, 1.71, -1.24], silver, 0.02)
  cylinder(bath, 0.045, 0.13, [-0.46, 1.65, -1.24], silver)
  box(bath, [0.3, 0.06, 0.08], [-0.89, 1.25, -1.24], silver, 0.015)
  const bathTray = new Group()
  bath.add(bathTray)
  box(bathTray, [2.02, 0.085, 0.31], [0, 1.24, 0.5], styleMaterials.wood, 0.025)
  box(bathTray, [0.58, 0.035, 0.29], [0.47, 1.302, 0.5], linen, 0.012)
  box(bathTray, [0.2, 0.09, 0.15], [-0.49, 1.322, 0.5], tomato, 0.035)
  contacts.push({ position: [bath.position.x, 0.014, bath.position.z], size: [2.35, 3.55] })

  const sink = actor('sink', bathroomLayout.sink, [0, 2.37, 0.42])
  for (const x of [-0.95, 0.95]) for (const z of [-0.44, 0.44]) {
    cylinder(sink, 0.075, 0.24, [x, 0.14, z], styleMaterials.wood)
  }
  box(sink, [2.31, 1.34, 1.2], [0, 0.84, 0], styleMaterials.cabinet, 0.045)
  for (const x of [-0.58, 0.58]) {
    box(sink, [1.08, 1.19, 0.055], [x, 0.86, 0.625], styleMaterials.cabinetPanel, 0.025)
    box(sink, [0.24, 0.045, 0.075], [x, 1.27, 0.675], silver, 0.014)
  }
  box(sink, [2.45, 0.13, 1.34], [0, 1.59, 0], styleMaterials.counter, 0.035)
  basin(sink, [[0, 0], [0.55, 0], [0.83, 0.13], [1, 0.38], [1, 0.44],
    [0.89, 0.44], [0.71, 0.14], [0, 0.12]], [0.68, 1, 0.49], [0, 1.66, 0.04])
  cylinder(sink, 0.048, 0.024, [0, 1.796, 0.04], silver, 0.048, 8)
  cylinder(sink, 0.036, 0.62, [0, 1.97, -0.53], silver)
  box(sink, [0.075, 0.065, 0.4], [0, 2.27, -0.36], silver, 0.02)
  cylinder(sink, 0.035, 0.11, [0, 2.22, -0.18], silver)
  const sinkSoap = bottle(sink, [-0.85, 1.66, 0.09], tomato, 0.26)
  contacts.push({ position: [sink.position.x, 0.014, sink.position.z], size: [2.7, 1.65] })

  const mirror = actor('mirror', bathroomLayout.mirror, [0, 0.92, 0.11])
  const frame = cylinder(mirror, 0.84, 0.11, [0, 0, 0], styleMaterials.wood, 0.84, 16)
  frame.rotation.x = Math.PI / 2
  const glass = cylinder(mirror, 0.735, 0.035, [0, 0, 0.073], mirrorGlass, 0.735, 16)
  glass.rotation.x = Math.PI / 2
  for (const [x, height] of [[-0.16, 0.76], [0.06, 0.47]]) {
    const gleam = box(mirror, [0.045, height, 0.008], [x, 0.06, 0.097], linen)
    gleam.rotation.z = -0.48
  }
  box(mirror, [0.98, 0.09, 0.2], [0, 0.98, 0.075], styleMaterials.cabinet, 0.025)
  box(mirror, [0.8, 0.035, 0.14], [0, 0.922, 0.095], lampMaterial, 0.015)

  const toilet = actor('toilet', bathroomLayout.toilet, [0, 2.14, 0.06])
  const foot = cylinder(toilet, 0.4, 0.14, [0, 0.09, 0.18], porcelain, 0.34, 12)
  foot.scale.z = 1.3
  cylinder(toilet, 0.34, 0.54, [0, 0.4, 0.16], porcelain, 0.25, 12)
  basin(toilet, [[0, 0], [0.48, 0], [0.73, 0.1], [1, 0.46], [1, 0.54],
    [0.8, 0.56], [0.65, 0.32], [0, 0.3]], [0.58, 1, 0.78], [0, 0.59, 0.2])
  basin(toilet, [[0.82, 0], [1, 0], [1, 0.095], [0.82, 0.095], [0.82, 0]],
    [0.62, 1, 0.83], [0, 1.15, 0.2])
  const toiletWater = cylinder(toilet, 0.27, 0.015, [0, 0.905, 0.2], water, 0.27, 12)
  toiletWater.scale.z = 1.35
  toiletWater.castShadow = false
  box(toilet, [1.12, 1.21, 0.51], [0, 1.2, -0.62], porcelain, 0.09)
  box(toilet, [1.2, 0.1, 0.6], [0, 1.855, -0.62], porcelain, 0.04)
  box(toilet, [0.18, 0.045, 0.11], [0, 1.925, -0.62], silver, 0.015)
  box(toilet, [0.4, 0.045, 0.07], [0.73, 1.37, -0.52], silver)
  const paperRoll = cylinder(toilet, 0.15, 0.25, [0.88, 1.34, -0.52], linen, 0.15, 10)
  paperRoll.rotation.z = Math.PI / 2
  box(toilet, [0.24, 0.22, 0.025], [0.88, 1.18, -0.365], linen)
  contacts.push({ position: [toilet.position.x, 0.014, toilet.position.z + 0.17], size: [1.55, 1.9] })

  const supplies = actor('supplies', bathroomLayout.supplies, [0, 3.46, 0.03])
  for (const x of [-0.51, 0.51]) for (const z of [-0.36, 0.36]) {
    box(supplies, [0.075, 2.84, 0.075], [x, 1.47, z], styleMaterials.wood, 0.012)
  }
  for (const y of [0.25, 1.07, 1.92, 2.78]) {
    box(supplies, [1.12, 0.085, 0.89], [0, y, 0], styleMaterials.lightWood, 0.015)
    box(supplies, [1.13, 0.045, 0.025], [0, y, 0.457], styleMaterials.woodGrain)
  }
  for (let i = 0; i < 3; i++) {
    box(supplies, [0.8, 0.12, 0.64], [0, 0.365 + i * 0.135, 0.02], i === 1 ? linen : styleMaterials.fridgeDoor, 0.045)
    box(supplies, [0.66, 0.018, 0.015], [0, 0.35 + i * 0.135, 0.348], styleMaterials.fridgeEdge)
  }
  for (const [x, y] of [[-0.23, 1.23], [0.23, 1.23], [0, 1.51]]) {
    cylinder(supplies, 0.18, 0.26, [x, y, 0], linen, 0.18, 10)
    cylinder(supplies, 0.046, 0.008, [x, y + 0.134, 0], dark, 0.046, 8)
  }
  bottle(supplies, [-0.24, 1.97, 0], styleMaterials.fridge, 0.41)
  bottle(supplies, [0.23, 1.97, 0.02], tomato, 0.28)
  box(supplies, [0.74, 0.15, 0.59], [0, 2.91, 0.01], linen, 0.045)
  box(supplies, [0.66, 0.13, 0.56], [0, 3.06, 0.01], styleMaterials.fridgeDoor, 0.045)
  contacts.push({ position: [supplies.position.x, 0.014, supplies.position.z], size: [1.4, 1.25] })

  const chores = actor('chores', bathroomLayout.chores, [0, 1.45, 0])
  chores.rotation.y = -Math.PI / 2
  const caddyShelf = new Group()
  caddyShelf.name = 'Cleaning caddy wall shelf'
  caddyShelf.position.set(...bathroomCaddyShelf.position)
  room.add(caddyShelf)
  box(caddyShelf, [bathroomCaddyShelf.width, 0.08, bathroomCaddyShelf.depth], [0, 0, 0], styleMaterials.lightWood, 0.018)
  for (const z of [-0.48, 0.48]) {
    box(caddyShelf, [0.055, 0.38, 0.055], [0.38, -0.2, z], styleMaterials.wood, 0.01)
    box(caddyShelf, [0.66, 0.055, 0.055], [0.08, -0.06, z], styleMaterials.wood, 0.01)
  }
  box(chores, [1.1, 0.08, 0.72], [0, 0.1, 0], styleMaterials.fridge, 0.03)
  for (const x of [-0.51, 0.51]) {
    box(chores, [0.085, 0.38, 0.7], [x, 0.29, 0], styleMaterials.fridge, 0.02)
    box(chores, [0.06, 0.67, 0.075], [x, 0.79, 0], styleMaterials.fridgeEdge, 0.02)
  }
  for (const z of [-0.32, 0.32]) box(chores, [1.07, 0.38, 0.08], [0, 0.29, z], styleMaterials.fridge, 0.02)
  box(chores, [1.08, 0.075, 0.11], [0, 1.13, 0], styleMaterials.wood, 0.025)
  bottle(chores, [-0.25, 0.15, -0.07], tomato, 0.41)
  bottle(chores, [0.22, 0.15, -0.08], porcelain, 0.5)
  box(chores, [0.3, 0.09, 0.2], [0.18, 0.21, 0.17], styleMaterials.fridgeDoor, 0.02)
  const brush = cylinder(chores, 0.027, 0.77, [-0.32, 0.61, 0.19], styleMaterials.wood, 0.027, 8)
  brush.rotation.z = 0.18
  box(chores, [0.18, 0.15, 0.12], [-0.25, 0.23, 0.19], linen, 0.02)
  contacts.push({ position: [chores.position.x, bathroomCaddyShelf.top + 0.007, chores.position.z], size: [0.86, 1.3] })

  const laundryFrame = new Group()
  laundryFrame.name = 'Wall-backed laundry stacking frame'
  const laundryPosition = componentPlacements['bathroom-laundry']!.position
  laundryFrame.position.set(laundryPosition[0], 0, laundryPosition[2])
  laundryFrame.rotation.y = componentPlacements['bathroom-laundry']!.rotation ?? 0
  laundryFrame.visible = false
  room.add(laundryFrame)
  for (const x of [-0.715, 0.715]) for (const z of [-0.615, 0.615]) {
    box(laundryFrame, [0.055, 1.54, 0.055], [x, 0.79, z], styleMaterials.wood, 0.01)
  }
  box(laundryFrame, [1.49, 0.08, 1.32], [0, 1.56, 0], styleMaterials.lightWood, 0.012)
  const lowerStorage = new Group()
  lowerStorage.name = 'Laundry cabinet below a standalone dryer'
  laundryFrame.add(lowerStorage)
  box(lowerStorage, [1.28, 1.42, 1.15], [0, 0.77, 0], styleMaterials.cabinet, 0.025)
  box(lowerStorage, [1.18, 1.22, 0.045], [0, 0.79, 0.6], styleMaterials.cabinetPanel, 0.02)
  box(lowerStorage, [0.26, 0.045, 0.065], [0, 1.31, 0.655], silver, 0.012)
  const careShelves = [2.44, 3.02].map((height) => {
    const group = new Group()
    group.name = 'Vanity care ledge'
    group.visible = false
    box(group, [1.3, 0.06, 0.42], [1.8, height - 0.03, -2.96], styleMaterials.lightWood, 0.012)
    room.add(group)
    return group
  })

  room.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(room)
  const actorBounds = new Map([...actors].map(([target, group]) => [
    target, new Box3().setFromObject(group).expandByPoint(anchors.get(target)!.getWorldPosition(new Vector3())),
  ]))
  const anchorPosition = (target: BathroomTarget): Position => anchors.get(target)!.getWorldPosition(new Vector3()).toArray()
  const componentBindings: ComponentBindings = new Map([
    ['bathroom-sink', { root: sink, finishes: [styleMaterials.cabinet, styleMaterials.cabinetPanel], contacts: contacts.slice(1, 2), anchor: anchorPosition('sink') }],
    ['bathroom-mirror', { root: mirror, finishes: [styleMaterials.wood], anchor: anchorPosition('mirror') }],
    ['bathroom-toilet', { root: toilet, finishes: [porcelain], contacts: contacts.slice(2, 3), anchor: anchorPosition('toilet') }],
    ['bathroom-bath', { root: bath, finishes: [porcelain], contacts: contacts.slice(0, 1), anchor: anchorPosition('bath') }],
    ['bathroom-supply-shelf', { root: supplies, finishes: [styleMaterials.wood, styleMaterials.lightWood, styleMaterials.woodGrain], contacts: contacts.slice(3, 4), anchor: anchorPosition('supplies') }],
    ['bathroom-cleaning-caddy', { root: chores, finishes: [styleMaterials.fridge, styleMaterials.fridgeEdge], contacts: contacts.slice(4, 5), anchor: anchorPosition('chores') }],
  ])
  const componentFixtures: ComponentFixtures = new Map([
    ['bathroom-soap-dispenser', { vacant: [sinkSoap], occupied: [] }],
    ['bathroom-bath-tray', { vacant: [bathTray], occupied: [] }],
    ['bathroom-laundry', { vacant: [lowerStorage], occupied: [] }],
    ['bathroom-dryer', { vacant: [], occupied: [laundryFrame] }],
    ['bathroom-storage-jars', { vacant: [], occupied: [careShelves[0]], occupiedBy: ['bathroom-storage-jars', 'bathroom-tissue-box'] }],
    ['bathroom-first-aid', { vacant: [], occupied: [careShelves[1]], occupiedBy: ['bathroom-first-aid', 'bathroom-diffuser'] }],
  ])
  return { materials, styleMaterials, actors, anchors, bounds, actorBounds, contacts, lampMaterial, componentBindings, componentFixtures }
}

export function bathroomFraming(width: number, height: number, bounds: Box3, rotation = 0, pitch = 0, options: { closeRoom?: boolean } = {}): {
  center: Position; halfHeight: number
} {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)
    || ![...bounds.min.toArray(), ...bounds.max.toArray(), rotation, pitch].every(Number.isFinite)
    || bounds.isEmpty()) {
    throw new Error('Bathroom framing needs positive scene dimensions and finite bounds.')
  }

  if (options.closeRoom) {
    const view = cameraFraming(width, height, 'room', false)
    const center = new Vector3(...view.center).applyAxisAngle(new Vector3(0, 1, 0), rotation)
    return { center: center.toArray(), halfHeight: view.halfHeight }
  }
  return fitRoomBounds(width, height, bounds, rotation, pitch)
}

export function bathroomTourFraming(
  width: number, height: number, progress: number, bounds: Box3,
  actorBounds: ReadonlyMap<BathroomTarget, Box3>, stops: readonly BathroomFocus[],
): { center: Position; halfHeight: number } {
  if (!Number.isFinite(progress) || stops.length < 2 || bounds.isEmpty()
    || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
    throw new Error('Bathroom exploration needs valid bounds, finite progress and at least two stops.')
  }
  const step = Math.max(0, Math.min(1, progress)) * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(step))
  const amount = step - index
  const eased = amount * amount * (3 - 2 * amount)
  const frame = (focus: BathroomFocus) => {
    if (focus === 'room') return fitRoomBounds(width, height, bounds)
    const box = actorBounds.get(focus)
    if (!box) throw new Error('The bathroom exploration stop is missing its measured bounds.')
    return bathroomFraming(width, height, box)
  }
  const from = frame(stops[index])
  const to = frame(stops[index + 1])
  return {
    center: [
      from.center[0] + (to.center[0] - from.center[0]) * eased,
      from.center[1] + (to.center[1] - from.center[1]) * eased,
      from.center[2] + (to.center[2] - from.center[2]) * eased,
    ],
    halfHeight: from.halfHeight + (to.halfHeight - from.halfHeight) * eased,
  }
}
