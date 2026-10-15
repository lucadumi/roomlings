import { CircleGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, LatheGeometry, Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector2 } from 'three'
import type { BufferGeometry, Material } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createRoomTorusGeometry, roomRadialSegments } from './roomGeometry.ts'
import { roomAccents } from './roomStyles.ts'
import { createRoomMaterial, prepareRoomSurfaceGeometry } from './surfaceMaterials.ts'

// A slight turn shows the spout without hiding the face.
const facing = 0.45
const hopSeconds = 1.4
const steamSeconds = 2.6
const blinkEvery = 3800
const blinkLength = 140

// Milliseconds until the next blink starts, so an on-demand view can wake just for it.
export function untilCompanionBlink(now: number): number {
  return blinkEvery - (now % blinkEvery)
}
export const companionBlinkLength = blinkLength

function stripGroups(geometry: BufferGeometry): BufferGeometry {
  geometry.clearGroups()
  return geometry
}

export type CompanionKettle = {
  root: Group
  greet: (now: number) => void
  // Poses the kettle for a frame and returns whether a hop or steam still needs frames.
  update: (now: number, reducedMotion: boolean) => boolean
  dispose: () => void
}

export function createCompanionKettle(): CompanionKettle {
  // One vertex-colored body and one pair of eyes keep the kettle to two draws.
  const glazed = createRoomMaterial('#ffffff', 0.64, 'paint', 'Companion kettle')
  glazed.vertexColors = true
  const ink = createRoomMaterial(roomAccents.ink, 0.9, 'rubber', 'Companion kettle eyes')
  const steam = new MeshBasicMaterial({ color: roomAccents.paper, transparent: true, opacity: 0, depthWrite: false })
  const materials: Material[] = [glazed, ink, steam]

  const root = new Group()
  root.name = 'Companion kettle'
  root.rotation.y = facing
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
  prepareRoomSurfaceGeometry(root)

  let greeted = -Infinity
  return {
    root,
    greet(now) { greeted = now },
    update(now, reducedMotion) {
      const age = (now - greeted) / 1000
      const hopping = !reducedMotion && age >= 0 && age < hopSeconds
      const hop = hopping ? Math.abs(Math.sin(age * Math.PI * 2.5)) * 0.14 * (1 - age / hopSeconds) : 0
      body.position.y = hop
      body.scale.set(1 + hop * 0.35, 1 - hop * 0.45, 1 + hop * 0.35)
      const steaming = !reducedMotion && age >= 0 && age < steamSeconds
      steam.opacity = steaming ? 0.45 * (1 - age / steamSeconds) : 0
      puffs.forEach((puff, index) => {
        const phase = ((age * 0.9) + index / puffs.length) % 1
        puff.visible = steaming
        puff.position.set(0.5 + phase * 0.12, 0.5 + phase * 0.45, Math.sin(phase * 5 + index) * 0.04)
        puff.scale.setScalar((0.6 + phase * 1.4) * Math.sin(phase * Math.PI))
      })
      eyes.scale.y = !reducedMotion && now % blinkEvery < blinkLength ? 0.15 : 1
      return hopping || steaming
    },
    dispose() {
      root.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
      materials.forEach((item) => item.dispose())
      root.removeFromParent()
    },
  }
}

