import {
  Box3, Color, DodecahedronGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D,
  Quaternion, Raycaster, Shape, ShapeGeometry, Vector3,
} from 'three'
import type { ChoreGrime } from '../shared/chores.ts'
import { createRoomMaterial } from './surfaceMaterials.ts'

// Tint strength for an object's finish surfaces at each dirt level.
export const grimeTint = { 1: 0.12, 2: 0.24, 3: 0.38 } as const
export const grimeColor = new Color('#6f5a3e')

const speckCounts = { 1: 18, 2: 40, 3: 70 } as const
const stainCounts = { 1: 1, 2: 3, 3: 6 } as const
const floorStainCounts = { 1: 0, 2: 2, 3: 4 } as const
const crumbColors = ['#8a6a43', '#a3845a', '#6e6658', '#5d4a35', '#b39a72'].map((color) => new Color(color))
const up = new Vector3(0, 1, 0)
const down = new Vector3(0, -1, 0)

function seeded(text: string) {
  let seed = 2166136261
  for (let index = 0; index < text.length; index++) seed = Math.imul(seed ^ text.charCodeAt(index), 16777619)
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function stainShape(random: () => number): Shape {
  const shape = new Shape()
  const points = 11
  for (let index = 0; index < points; index++) {
    const angle = (index / points) * Math.PI * 2
    const radius = 0.72 + random() * 0.28
    if (index === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
    else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
  }
  shape.closePath()
  return shape
}

function transient(object: Object3D) {
  object.userData.roomTransient = true
  object.raycast = () => {}
  object.castShadow = false
  object.receiveShadow = true
}

export type GrimeTarget = {
  root: Object3D
  // Rejects surfaces owned by nested objects or hidden state props.
  accepts: (object: Object3D) => boolean
}

export function createRoomGrime(room: Group) {
  const speckGeometry = new DodecahedronGeometry(1, 0)
  const speckMaterial = createRoomMaterial('#ffffff', 0.95, 'paint', 'Overdue chore crumbs')
  const stainMaterial = new MeshStandardMaterial({
    name: 'Overdue chore stain', color: '#4e3b27', roughness: 1, transparent: true, opacity: 0.5,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  const layers = new Map<string, { key: string; group: Group }>()
  const raycaster = new Raycaster()
  const bounds = new Box3()
  const point = new Vector3()
  const normal = new Vector3()
  const matrix = new Matrix4()
  const rotation = new Quaternion()
  const scale = new Vector3()

  const surfaceHit = (target: GrimeTarget, x: number, z: number, top: number) => {
    raycaster.set(room.localToWorld(point.set(x, top, z)), down)
    for (const hit of raycaster.intersectObject(target.root, true)) {
      if (!target.accepts(hit.object) || !hit.face) continue
      normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld)
      if (normal.y < 0.75) return null
      const local = normal.clone().applyQuaternion(room.getWorldQuaternion(rotation).invert()).normalize()
      return { position: room.worldToLocal(hit.point.clone()), normal: local }
    }
    return null
  }

  const build = (id: string, target: GrimeTarget, level: ChoreGrime['level']) => {
    const random = seeded(id)
    const group = new Group()
    group.name = 'Overdue chore dirt'
    group.userData.roomTransient = true
    room.updateMatrixWorld(true)
    bounds.setFromObject(target.root, true)
    const min = room.worldToLocal(bounds.min.clone())
    const max = room.worldToLocal(bounds.max.clone())
    const area = (max.x - min.x) * (max.z - min.z)
    const density = Math.min(1.6, Math.max(0.5, area / 0.45))
    const sample = () => surfaceHit(target, min.x + (max.x - min.x) * (0.08 + random() * 0.84),
      min.z + (max.z - min.z) * (0.08 + random() * 0.84), max.y + 0.2)

    const specks: { position: Vector3; size: number; color: Color }[] = []
    const wanted = Math.round(speckCounts[level] * density)
    // Tries draw from the same sequence, so heavier dirt keeps the lighter layout and adds to it.
    for (let attempt = 0; attempt < wanted * 4 && specks.length < wanted; attempt++) {
      const hit = sample()
      const size = 0.016 + random() * 0.022
      const color = crumbColors[Math.floor(random() * crumbColors.length)]
      if (hit) specks.push({ position: hit.position.addScaledVector(hit.normal, size * 0.5), size, color })
    }
    if (specks.length) {
      const mesh = new InstancedMesh(speckGeometry, speckMaterial, specks.length)
      mesh.name = 'Overdue chore crumbs'
      specks.forEach((speck, index) => {
        rotation.setFromAxisAngle(up, speck.size * 997)
        mesh.setMatrixAt(index, matrix.compose(speck.position, rotation, scale.set(speck.size, speck.size * 0.6, speck.size)))
        mesh.setColorAt(index, speck.color)
      })
      transient(mesh)
      group.add(mesh)
    }

    const stain = (position: Vector3, surfaceNormal: Vector3, radius: number) => {
      const mesh = new Mesh(new ShapeGeometry(stainShape(random)), stainMaterial)
      mesh.name = 'Overdue chore stain'
      mesh.position.copy(position).addScaledVector(surfaceNormal, 0.002)
      mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), surfaceNormal)
      mesh.rotateZ(random() * Math.PI * 2)
      mesh.scale.set(radius, radius * (0.6 + random() * 0.4), 1)
      transient(mesh)
      group.add(mesh)
    }
    for (let placed = 0, attempt = 0; placed < stainCounts[level] && attempt < 12; attempt++) {
      const hit = sample()
      const radius = Math.min(0.16, 0.06 + random() * 0.08) * Math.min(1.2, density)
      if (hit) { stain(hit.position, hit.normal, radius); placed++ }
    }
    // Floor stains only belong beside objects that stand on the floor.
    if (min.y < 0.06) {
      for (let index = 0; index < floorStainCounts[level]; index++) {
        const side = Math.floor(random() * 4)
        const along = random()
        const x = side < 2 ? min.x + (max.x - min.x) * along : side === 2 ? min.x - 0.08 : max.x + 0.08
        const z = side >= 2 ? min.z + (max.z - min.z) * along : side === 0 ? min.z - 0.08 : max.z + 0.08
        stain(new Vector3(x, Math.max(min.y, 0) + 0.001, z), up, 0.1 + random() * 0.1)
      }
    }
    room.add(group)
    return group
  }

  const removeGroup = (group: Group) => {
    group.removeFromParent()
    group.traverse((object) => { if (object instanceof Mesh && object.geometry !== speckGeometry) object.geometry.dispose() })
  }

  return {
    // Returns whether the dirt layer for this object changed.
    update(id: string, target: GrimeTarget | null, grime: ChoreGrime | undefined, key: string): boolean {
      const current = layers.get(id)
      const nextKey = target && grime ? `${grime.level}|${key}` : ''
      if ((current?.key ?? '') === nextKey) return false
      if (current) removeGroup(current.group)
      layers.delete(id)
      if (target && grime) layers.set(id, { key: nextKey, group: build(id, target, grime.level) })
      return true
    },
    remove(id: string) {
      const current = layers.get(id)
      if (!current) return
      removeGroup(current.group)
      layers.delete(id)
    },
    dispose() {
      for (const { group } of layers.values()) removeGroup(group)
      layers.clear()
      speckGeometry.dispose()
      speckMaterial.dispose()
      stainMaterial.dispose()
    },
  }
}
