import {
  Box3, BoxGeometry, CylinderGeometry, Group, LatheGeometry, Mesh,
  MeshStandardMaterial, Object3D, Vector2, Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { RoomStyle } from '../shared/domain.ts'
import { baseCameraOffset } from './camera.ts'
import type { SceneFocus } from './camera.ts'
import type { ContactShadow } from './lighting.ts'
import { roomPresets } from './roomStyles.ts'
import type { RoomStyleMaterials } from './roomStyles.ts'

export const bathroomTargets = ['sink', 'mirror', 'toilet', 'bath', 'floor', 'chores', 'supplies'] as const
export type BathroomTarget = typeof bathroomTargets[number]
export type BathroomFocus = BathroomTarget | 'room'
export const bathroomLabels: Record<BathroomTarget, string> = {
  sink: 'Sink chores', mirror: 'Mirror chores', toilet: 'Toilet chores',
  bath: 'Bath chores', floor: 'Floor chores', chores: 'Cleaning caddy', supplies: 'Supply shelf',
}

type Position = [number, number, number]

export function bathroomFocusForRequest(target: SceneFocus): BathroomFocus {
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
  const porcelain = material('Warm porcelain', '#f7f0dc', 0.55)
  const water = material('Muted bath water', '#a9c4b9', 0.48)
  const silver = material('Brushed fittings', '#d9ddcf', 0.36)
  silver.metalness = 0.25
  const mirrorGlass = material('Opaque mirror', '#a2bfbd', 0.38)
  mirrorGlass.metalness = 0.2
  const tomato = material('Tomato accessories', '#c7593d', 0.75)
  const linen = material('Folded linen', '#efe5ce')
  const dark = material('Fitting recesses', '#626d5c')
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
  }

  room.name = 'Open-corner bathroom'
  box(room, [9.4, 0.24, 6.4], [0, -0.145, 0], styleMaterials.lightWood, 0.1)
  box(room, [9.4, 4.45, 0.14], [0, 2.15, -3.16], styleMaterials.wall, 0.045)
  box(room, [0.14, 4.45, 3.7], [-4.63, 2.15, -1.38], styleMaterials.wall, 0.045)
  box(room, [9.2, 1.35, 0.028], [0, 0.83, -3.07], styleMaterials.floor)
  box(room, [9.22, 0.08, 0.07], [0, 1.54, -3.06], styleMaterials.trim)
  box(room, [9.22, 0.13, 0.07], [0, 0.13, -3.06], styleMaterials.trim)
  box(room, [0.065, 0.13, 3.62], [-4.53, 0.13, -1.38], styleMaterials.trim)
  for (let x = 0; x < 12; x++) {
    box(room, [0.018, 1.28, 0.012], [-4.2 + x * 0.76, 0.84, -3.048], styleMaterials.trim)
  }
  box(room, [9.18, 0.018, 0.012], [0, 0.83, -3.048], styleMaterials.trim)
  const floor = actor('floor', [0, 0, 0], [-1.45, 0.16, 1.42])
  for (let x = 0; x < 9; x++) {
    for (let z = 0; z < 6; z++) {
      const tile = box(floor, [1.021, 0.025, 1.029], [-4.12 + x * 1.03, -0.006, -2.59 + z * 1.037],
        (x + z) % 2 ? styleMaterials.floor : styleMaterials.floorAlternate)
      tile.castShadow = false
    }
  }
  box(floor, [2.25, 0.045, 1.12], [-1.35, 0.04, 1.42], styleMaterials.fridgeDoor, 0.02)
  for (const side of [-1, 1]) {
    box(floor, [0.055, 0.012, 1.03], [-1.35 + side * 0.94, 0.07, 1.42], styleMaterials.fridgeEdge)
    for (let i = 0; i < 7; i++) {
      box(floor, [0.16, 0.025, 0.035], [-1.35 + side * 1.16, 0.035, 0.98 + i * 0.145], linen)
    }
  }

  const bath = actor('bath', [-2.85, 0, -1.3], [0, 1.45, 0.55])
  basin(bath, [[0, 0.13], [0.69, 0.13], [0.79, 0.22], [0.98, 1.03], [1, 1.13],
    [0.97, 1.19], [0.86, 1.19], [0.8, 1.02], [0.67, 0.43], [0, 0.43]], [1, 1, 1.52], [0, 0, 0])
  const bathWater = cylinder(bath, 0.695, 0.025, [0, 0.52, 0], water, 0.695, 16)
  bathWater.scale.z = 1.52
  bathWater.castShadow = false
  cylinder(bath, 0.046, 1.65, [-0.89, 0.86, -1.24], silver)
  box(bath, [0.46, 0.075, 0.075], [-0.68, 1.71, -1.24], silver, 0.02)
  cylinder(bath, 0.045, 0.13, [-0.46, 1.65, -1.24], silver)
  box(bath, [0.3, 0.06, 0.08], [-0.89, 1.25, -1.24], silver, 0.015)
  box(bath, [2.02, 0.085, 0.31], [0, 1.24, 0.5], styleMaterials.wood, 0.025)
  box(bath, [0.58, 0.035, 0.29], [0.47, 1.302, 0.5], linen, 0.012)
  box(bath, [0.2, 0.09, 0.15], [-0.49, 1.322, 0.5], tomato, 0.035)
  contacts.push({ position: [-2.85, 0.014, -1.3], size: [2.35, 3.55] })

  const sink = actor('sink', [0.15, 0, -2.28], [0, 2.37, 0.42])
  for (const x of [-0.85, 0.85]) for (const z of [-0.44, 0.44]) {
    cylinder(sink, 0.075, 0.24, [x, 0.14, z], styleMaterials.wood)
  }
  box(sink, [2.08, 1.34, 1.2], [0, 0.84, 0], styleMaterials.cabinet, 0.045)
  for (const x of [-0.51, 0.51]) {
    box(sink, [0.97, 1.19, 0.055], [x, 0.86, 0.625], styleMaterials.cabinetPanel, 0.025)
    box(sink, [0.24, 0.045, 0.075], [x, 1.27, 0.675], silver, 0.014)
  }
  box(sink, [2.22, 0.13, 1.34], [0, 1.59, 0], styleMaterials.counter, 0.035)
  basin(sink, [[0, 0], [0.55, 0], [0.83, 0.13], [1, 0.38], [1, 0.44],
    [0.89, 0.44], [0.71, 0.14], [0, 0.12]], [0.68, 1, 0.49], [0, 1.66, 0.04])
  cylinder(sink, 0.048, 0.024, [0, 1.796, 0.04], silver, 0.048, 8)
  cylinder(sink, 0.036, 0.62, [0, 1.97, -0.53], silver)
  box(sink, [0.075, 0.065, 0.4], [0, 2.27, -0.36], silver, 0.02)
  cylinder(sink, 0.035, 0.11, [0, 2.22, -0.18], silver)
  bottle(sink, [-0.85, 1.66, 0.09], tomato, 0.26)
  contacts.push({ position: [0.15, 0.014, -2.28], size: [2.5, 1.65] })

  const mirror = actor('mirror', [0.15, 3.06, -3.055], [0, 0.92, 0.11])
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

  const toilet = actor('toilet', [2.8, 0, -0.95], [0, 2.14, 0.06])
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
  contacts.push({ position: [2.8, 0.014, -0.78], size: [1.55, 1.9] })

  const supplies = actor('supplies', [3.92, 0, -2.4], [0, 3.46, 0.03])
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
  contacts.push({ position: [3.92, 0.014, -2.4], size: [1.4, 1.25] })

  const chores = actor('chores', [0.93, 0, 1.15], [0, 1.45, 0])
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
  contacts.push({ position: [0.93, 0.014, 1.15], size: [1.45, 1] })

  room.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(room)
  const actorBounds = new Map([...actors].map(([target, group]) => [
    target, new Box3().setFromObject(group).expandByPoint(anchors.get(target)!.getWorldPosition(new Vector3())),
  ]))
  return { materials, styleMaterials, actors, anchors, bounds, actorBounds, contacts, lampMaterial }
}

export function bathroomFraming(width: number, height: number, bounds: Box3, rotation = 0, pitch = 0): {
  center: Position; halfHeight: number
} {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)
    || ![...bounds.min.toArray(), ...bounds.max.toArray(), rotation, pitch].every(Number.isFinite)
    || bounds.isEmpty()) {
    throw new Error('Bathroom framing needs positive scene dimensions and finite bounds.')
  }
  const axis = new Vector3(0, 1, 0)
  const center = bounds.getCenter(new Vector3())
  const backward = new Vector3(baseCameraOffset[0], baseCameraOffset[1] + pitch, baseCameraOffset[2]).normalize()
  const right = new Vector3().crossVectors(axis, backward).normalize()
  const up = new Vector3().crossVectors(backward, right).normalize()
  let horizontal = 0
  let vertical = 0
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
    for (const z of [bounds.min.z, bounds.max.z]) {
      const corner = new Vector3(x, y, z).sub(center).applyAxisAngle(axis, rotation)
      horizontal = Math.max(horizontal, Math.abs(corner.dot(right)))
      vertical = Math.max(vertical, Math.abs(corner.dot(up)))
    }
  }
  center.applyAxisAngle(axis, rotation)
  return {
    center: [center.x, center.y, center.z],
    halfHeight: Math.max(1.25, vertical + 0.18, (horizontal + 0.18) * height / width) * 1.08,
  }
}
