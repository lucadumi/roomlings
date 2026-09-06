import {
  AmbientLight, DataTexture, DirectionalLight, Group, HemisphereLight, LinearFilter,
  Mesh, MeshBasicMaterial, PlaneGeometry, RGBAFormat, UnsignedByteType,
} from 'three'

export const daylight = { sun: 2.45, sky: 1.3, fill: 0.65, lamp: 0, bulb: 0.12, window: '#bad6d0', disc: '#ecc86c' }
export const eveningLight = { sun: 0.45, sky: 0.65, fill: 0.3, lamp: 10, bulb: 1.7, window: '#697e98', disc: '#e6edf0' }

export function createRoomLights() {
  const group = new Group()
  const skyLight = new HemisphereLight('#f8f9ee', '#a1ae8d', daylight.sky)
  const sunlight = new DirectionalLight('#fff4e3', daylight.sun)
  sunlight.position.set(-3.5, 9, 6)
  sunlight.target.position.set(0, 1.6, -0.15)
  sunlight.castShadow = true
  sunlight.shadow.mapSize.set(2048, 2048)
  sunlight.shadow.camera.left = -6.6
  sunlight.shadow.camera.right = 6.7
  sunlight.shadow.camera.top = 7.2
  sunlight.shadow.camera.bottom = -6.3
  sunlight.shadow.camera.near = 2.5
  sunlight.shadow.camera.far = 17
  sunlight.shadow.camera.updateProjectionMatrix()
  sunlight.shadow.normalBias = 0.012
  sunlight.shadow.bias = -0.00008
  sunlight.shadow.radius = 6
  sunlight.shadow.intensity = 0.88
  sunlight.shadow.autoUpdate = false
  sunlight.shadow.needsUpdate = true
  const fill = new DirectionalLight('#e5ecdf', daylight.fill)
  fill.position.set(5, 2, -3)
  group.add(skyLight, sunlight, sunlight.target, fill, new AmbientLight('#fff7e8', 0.24))
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
