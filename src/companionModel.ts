import { CircleGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, LatheGeometry, Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector2 } from 'three'
import type { BufferGeometry, Material } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { RoomId } from '../shared/rooms.ts'
import { roomEntryDoors, roomFootprints } from './roomLayout.ts'
import type { RoomPosition } from './roomLayout.ts'
import { createRoomTorusGeometry, roomRadialSegments } from './roomGeometry.ts'
import { roomAccents } from './roomStyles.ts'
import { createRoomMaterial, prepareRoomSurfaceGeometry } from './surfaceMaterials.ts'

// The kettle greets each room from just inside its entry door, clear of every object slot.
// The kitchen kettle steps toward the stove return so the table stools and HUD hint stay clear.
const doorstep: Record<RoomId, { inset: number; shift: number }> = {
  kitchen: { inset: 1.75, shift: 0.6 },
  bathroom: { inset: 0.95, shift: 0 },
  'living-room': { inset: 0.95, shift: 0 },
}
export function companionPosition(roomId: RoomId): RoomPosition {
  const footprint = roomFootprints[roomId]
  const { inset, shift } = doorstep[roomId]
  return [roomEntryDoors[roomId].centerX + shift, 0.02, footprint.centerZ + footprint.depth / 2 - inset]
}
// Faces the default camera so the face reads from the entry view.
const facing = 0.6
const scale = 1.15
const hopSeconds = 1.4
const steamSeconds = 2.6
const blinkEvery = 3800
const blinkLength = 140

function stripGroups(geometry: BufferGeometry): BufferGeometry {
  geometry.clearGroups()
  return geometry
}

export type RoomCompanion = {
  root: Group
  anchor: Object3D
  contains: (object: Object3D | null | undefined) => boolean
  greet: (now: number) => void
  // Returns whether the companion still needs frames and whether shadow casters moved.
  update: (now: number, options: { reducedMotion: boolean; hidden: boolean }) => { animating: boolean; shadowsChanged: boolean }
  dispose: () => void
}

export function createRoomCompanion(roomId: RoomId): RoomCompanion {
  // One vertex-colored body and one pair of eyes keep the kettle to three draws with its shadow.
  const glazed = createRoomMaterial('#ffffff', 0.64, 'paint', 'Companion kettle')
  glazed.vertexColors = true
  const ink = createRoomMaterial(roomAccents.ink, 0.9, 'rubber', 'Companion kettle eyes')
  const steam = new MeshBasicMaterial({ color: roomAccents.paper, transparent: true, opacity: 0, depthWrite: false })
  const materials: Material[] = [glazed, ink, steam]

  const root = new Group()
  root.name = 'Companion kettle'
  root.userData.companion = true
  root.position.set(...companionPosition(roomId))
  root.rotation.y = facing
  root.scale.setScalar(scale)
  const body = new Group()
  root.add(body)

  const placed = new Object3D()
  const color = new Color()
  const part = (geometry: BufferGeometry, hex: string, setup: (object: Object3D) => void) => {
    placed.position.set(0, 0, 0)
    placed.rotation.set(0, 0, 0)
    placed.scale.set(1, 1, 1)
    setup(placed)
    placed.updateMatrix()
    const shaped = (geometry.index ? geometry : geometry.toNonIndexed()).applyMatrix4(placed.matrix)
    color.set(hex)
    const count = shaped.getAttribute('position').count
    shaped.setAttribute('color', new Float32BufferAttribute(Array.from({ length: count }, () => [color.r, color.g, color.b]).flat(), 3))
    return shaped
  }
  // Face details sit just proud of the rounded glaze.
  const faceAt = (x: number, y: number, inset: number) => {
    const radius = 0.325
    return { x, y, z: Math.sqrt(Math.max(radius * radius - x * x, 0)) - inset, turn: Math.atan2(x, radius) }
  }
  // A rounded lathe keeps the kettle soft without subdividing the rest of the room.
  const profile = [[0, 0.07], [0.27, 0.07], [0.32, 0.13], [0.34, 0.23], [0.32, 0.36], [0.26, 0.46], [0.2, 0.5], [0, 0.5]]
    .map(([x, y]) => new Vector2(x, y))
  const parts = [
    part(new LatheGeometry(profile, roomRadialSegments(0.34)), roomAccents.leaf, () => {}),
    part(new CylinderGeometry(0.035, 0.065, 0.28, roomRadialSegments(0.065)), roomAccents.leaf, (object) => {
      object.position.set(0.36, 0.33, 0)
      object.rotation.z = -0.85
    }),
    part(new CylinderGeometry(0.19, 0.21, 0.04, roomRadialSegments(0.21)), roomAccents.leafDark, (object) => { object.position.y = 0.52 }),
    part(new SphereGeometry(0.055, 16, 10), roomAccents.tomato, (object) => { object.position.y = 0.585 }),
    part(createRoomTorusGeometry(0.13, 0.03, Math.PI), roomAccents.leafDark, (object) => {
      object.position.set(-0.31, 0.3, 0)
      object.rotation.z = Math.PI / 2
    }),
    ...[-1, 1].flatMap((side) => {
      const cheek = faceAt(side * 0.17, 0.25, -0.003)
      return [
        part(new SphereGeometry(0.07, 16, 10), roomAccents.ink, (object) => {
          object.position.set(side * 0.14, 0.035, 0.06)
          object.scale.set(1, 0.55, 1.25)
        }),
        part(new CircleGeometry(0.042, 16), roomAccents.tomato, (object) => {
          object.position.set(cheek.x, cheek.y, cheek.z)
          object.rotation.y = cheek.turn
        }),
      ]
    }),
    part(createRoomTorusGeometry(0.045, 0.011, Math.PI), roomAccents.ink, (object) => {
      const mouth = faceAt(0, 0.255, -0.004)
      object.position.set(0, mouth.y, mouth.z)
      object.rotation.z = Math.PI
    }),
  ]
  const kettle = new Mesh(mergeGeometries(parts.map(stripGroups)), glazed)
  parts.forEach((geometry) => geometry.dispose())
  kettle.castShadow = true
  kettle.receiveShadow = true
  body.add(kettle)

  const eyeParts = [-1, 1].map((side) => {
    const point = faceAt(side * 0.1, 0.32, 0.006)
    return part(new SphereGeometry(0.036, 16, 10), roomAccents.ink, (object) => {
      object.position.set(point.x, 0, point.z)
      object.scale.set(1, 1.2, 0.45)
      object.rotation.y = point.turn
    })
  })
  const eyes = new Mesh(mergeGeometries(eyeParts.map(stripGroups)), ink)
  eyeParts.forEach((geometry) => geometry.dispose())
  eyes.position.y = 0.32
  body.add(eyes)

  const puffs = Array.from({ length: 3 }, () => {
    const puff = new Mesh(new SphereGeometry(0.05, 12, 8), steam)
    puff.visible = false
    body.add(puff)
    return puff
  })
  const anchor = new Group()
  anchor.position.y = 0.95
  root.add(anchor)
  prepareRoomSurfaceGeometry(root)

  let greeted = -Infinity
  let wasVisible = true
  let lastHop = 0
  return {
    root,
    anchor,
    contains(object) {
      for (let current = object; current; current = current.parent) if (current === root) return true
      return false
    },
    greet(now) { greeted = now },
    update(now, { reducedMotion, hidden }) {
      const visible = !hidden
      let shadowsChanged = visible !== wasVisible
      wasVisible = visible
      root.visible = visible
      const age = (now - greeted) / 1000
      const hopping = visible && !reducedMotion && age >= 0 && age < hopSeconds
      const hop = hopping ? Math.abs(Math.sin(age * Math.PI * 2.5)) * 0.14 * (1 - age / hopSeconds) : 0
      if (hop !== lastHop) shadowsChanged = true
      lastHop = hop
      body.position.y = hop
      body.scale.set(1 + hop * 0.35, 1 - hop * 0.45, 1 + hop * 0.35)
      const steaming = visible && !reducedMotion && age >= 0 && age < steamSeconds
      puffs.forEach((puff, index) => {
        const phase = ((age * 0.9) + index / puffs.length) % 1
        puff.visible = steaming
        if (!steaming) return
        const fade = Math.sin(phase * Math.PI) * (1 - age / steamSeconds)
        puff.position.set(0.5 + phase * 0.12, 0.5 + phase * 0.45, Math.sin(phase * 5 + index) * 0.04)
        puff.scale.setScalar(0.6 + phase * 1.4)
        steam.opacity = Math.max(steam.opacity * 0.5, fade * 0.45)
      })
      if (!steaming) steam.opacity = 0
      const blinking = !reducedMotion && now % blinkEvery < blinkLength
      eyes.scale.y = blinking ? 0.15 : 1
      return { animating: hopping || steaming, shadowsChanged }
    },
    dispose() {
      root.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
      materials.forEach((item) => item.dispose())
      root.removeFromParent()
    },
  }
}

