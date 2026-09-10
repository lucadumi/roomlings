import {
  AmbientLight, Box3, DataTexture, DirectionalLight, Group, HemisphereLight, LinearFilter,
  Mesh, MeshBasicMaterial, PlaneGeometry, RGBAFormat, UnsignedByteType, Vector3,
} from 'three'
import { roomAccents } from './roomStyles.ts'
import { roomShellBounds } from './roomLayout.ts'

export const daylight = { sun: 2.45, sky: 1.3, fill: 0.65, lamp: 0, bulb: 0.12, window: roomAccents.sky, disc: roomAccents.gold }
export const eveningLight = { sun: 0.45, sky: 0.65, fill: 0.3, lamp: 10, bulb: 1.7, window: '#697e98', disc: '#e6edf0' }

export function fitRoomShadowBounds(sunlight: DirectionalLight, bounds: Box3): void {
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
    throw new Error('Room lighting needs finite, nonempty scene bounds.')
  }
  const center = bounds.getCenter(new Vector3())
  const corners: Vector3[] = []
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    corners.push(new Vector3(x, y, z))
  }
  const distance = Math.max(...corners.map((corner) => corner.length())) + center.length() + 3
  sunlight.target.position.copy(center)
  sunlight.position.copy(center).add(new Vector3(-3.5, 7.4, 6.15).normalize().multiplyScalar(distance))
  sunlight.updateWorldMatrix(true, false)
  sunlight.target.updateWorldMatrix(true, false)
  sunlight.shadow.updateMatrices(sunlight)
  const camera = sunlight.shadow.camera
  const inverse = camera.matrixWorldInverse
  const lightBounds = new Box3()
  const axis = new Vector3(0, 1, 0)
  const point = new Vector3()
  for (const corner of corners) {
    const angles = [-0.75, 0, 0.75]
    // Include the exact extrema between drag endpoints in each light-space axis.
    for (let row = 0; row < 3; row++) {
      const a = inverse.elements[row] * corner.x + inverse.elements[row + 8] * corner.z
      const b = inverse.elements[row] * corner.z - inverse.elements[row + 8] * corner.x
      const extremum = Math.atan2(b, a)
      for (const angle of [extremum - Math.PI, extremum, extremum + Math.PI]) {
        if (angle > -0.75 && angle < 0.75) angles.push(angle)
      }
    }
    for (const angle of angles) lightBounds.expandByPoint(point.copy(corner).applyAxisAngle(axis, angle).applyMatrix4(inverse))
  }
  camera.left = lightBounds.min.x - 0.35
  camera.right = lightBounds.max.x + 0.35
  camera.bottom = lightBounds.min.y - 0.35
  camera.top = lightBounds.max.y + 0.35
  camera.near = Math.max(0.1, -lightBounds.max.z - 0.75)
  camera.far = -lightBounds.min.z + 0.75
  camera.updateProjectionMatrix()
  sunlight.shadow.needsUpdate = true
}

export function createRoomLights(bounds?: Box3) {
  const group = new Group()
  const skyLight = new HemisphereLight('#f8f9ee', '#a1ae8d', daylight.sky)
  const sunlight = new DirectionalLight('#fff4e3', daylight.sun)
  sunlight.castShadow = true
  sunlight.shadow.mapSize.set(2048, 2048)
  sunlight.shadow.normalBias = 0.012
  sunlight.shadow.bias = -0.00008
  sunlight.shadow.radius = 6
  sunlight.shadow.intensity = 0.88
  sunlight.shadow.autoUpdate = false
  sunlight.shadow.needsUpdate = true
  const fill = new DirectionalLight('#e5ecdf', daylight.fill)
  fill.position.set(5, 2, -3)
  group.add(skyLight, sunlight, sunlight.target, fill, new AmbientLight('#fff7e8', 0.24))
  fitRoomShadowBounds(sunlight, bounds ?? roomShellBounds('kitchen').union(roomShellBounds('bathroom')))
  return { group, sunlight, skyLight, fill }
}

export type ContactShadow = { position: [number, number, number]; size: [number, number] }

export function createContactShadowTexture(): DataTexture {
  const size = 128
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1
      const dy = (y + 0.5) / size * 2 - 1
      const falloff = Math.max(0, 1 - dx * dx - dy * dy)
      const offset = (y * size + x) * 4
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255
      pixels[offset + 3] = Math.round(falloff * falloff * 255)
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType)
  texture.name = 'Soft contact shadow'
  texture.minFilter = texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

export function addContactShadows(parent: Group, texture: DataTexture, footprints: readonly ContactShadow[]) {
  const geometry = new PlaneGeometry(1, 1)
  const material = new MeshBasicMaterial({
    map: texture, color: '#535d45', opacity: 0.22, transparent: true, depthWrite: false, toneMapped: false,
  })
  for (const footprint of footprints) {
    const shadow = new Mesh(geometry, material)
    shadow.name = 'Furniture contact shadow'
    shadow.position.set(...footprint.position)
    shadow.rotation.x = -Math.PI / 2
    shadow.scale.set(...footprint.size, 1)
    // Transparent decoration must not intercept clicks on room objects.
    shadow.raycast = () => {}
    parent.add(shadow)
  }
  return { geometry, material }
}
