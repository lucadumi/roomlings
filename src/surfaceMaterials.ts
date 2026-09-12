import {
  BoxGeometry, CylinderGeometry, DataTexture, DoubleSide, FrontSide, LatheGeometry, LinearFilter, LinearMipmapLinearFilter,
  Mesh, MeshStandardMaterial, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace,
  TorusGeometry, UnsignedByteType,
} from 'three'
import type { BufferGeometry, ColorRepresentation, Object3D } from 'three'

type Pattern = 'grain' | 'weave' | 'fine'
type SurfaceRecipe = {
  pattern?: Pattern
  tint?: boolean
  bump: number
  density: number
  roughness: readonly [number, number]
  smooth: boolean
}

const recipes = {
  paint: { pattern: 'fine', bump: 0.0014, density: 2, roughness: [0.98, 1], smooth: true },
  wood: { pattern: 'grain', tint: true, bump: 0.003, density: 0.8, roughness: [1, 1], smooth: true },
  fabric: { pattern: 'weave', tint: true, bump: 0.004, density: 2.2, roughness: [1, 1], smooth: true },
  paper: { pattern: 'fine', bump: 0.0004, density: 3, roughness: [1, 1], smooth: true },
  ceramic: { pattern: 'fine', bump: 0.0005, density: 1.5, roughness: [0.98, 1], smooth: true },
  metal: { pattern: 'fine', bump: 0.0003, density: 3, roughness: [0.98, 1], smooth: true },
  rubber: { bump: 0, density: 1, roughness: [0.99, 1], smooth: true },
  glass: { bump: 0, density: 1, roughness: [0.98, 1], smooth: true },
  'clear-glass': { bump: 0, density: 1, roughness: [0.98, 1], smooth: true },
  plaster: { pattern: 'fine', bump: 0.006, density: 1.6, roughness: [1, 1], smooth: false },
  tile: { pattern: 'fine', bump: 0.0008, density: 2, roughness: [0.98, 1], smooth: false },
  clay: { pattern: 'fine', bump: 0.005, density: 2, roughness: [1, 1], smooth: true },
  foliage: { bump: 0, density: 1, roughness: [1, 1], smooth: false },
  food: { bump: 0, density: 1, roughness: [0.98, 1], smooth: true },
  light: { bump: 0, density: 1, roughness: [1, 1], smooth: false },
} satisfies Record<string, SurfaceRecipe>

export type RoomSurface = keyof typeof recipes
type Pixels = { size: number; detail: Uint8Array; tint?: Uint8Array }
type TextureSet = { detail: DataTexture; tint?: DataTexture; users: number }
const pixels = new Map<Pattern, Pixels>()
const textures = new Map<Pattern, TextureSet>()
const leases = new WeakMap<MeshStandardMaterial, { pattern: Pattern; set: TextureSet }>()
const observed = new WeakSet<MeshStandardMaterial>()
const turn = Math.PI * 2

function noise(u: number, v: number, frequency: number, seed: number): number {
  const x = u * frequency
  const y = v * frequency
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const hash = (a: number, b: number) => {
    const wrap = (value: number) => (value % frequency + frequency) % frequency
    let value = Math.imul(wrap(a) + seed, 374761393) ^ Math.imul(wrap(b) + seed, 668265263)
    value = Math.imul(value ^ value >>> 13, 1274126177)
    return ((value ^ value >>> 16) >>> 0) / 0xffffffff
  }
  const smooth = (value: number) => value * value * (3 - 2 * value)
  const mix = (a: number, b: number, amount: number) => a + (b - a) * amount
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), smooth(x - ix)),
    mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), smooth(x - ix)), smooth(y - iy))
}

function surfacePixels(pattern: Pattern): Pixels {
  const cached = pixels.get(pattern)
  if (cached) return cached
  const size = pattern === 'grain' ? 512 : 256
  const detail = new Uint8Array(size * size * 4)
  const tint = pattern !== 'fine' ? new Uint8Array(detail.length) : undefined
  const byte = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size
    const v = y / size
    const small = noise(u, v, 64, 17)
    const broad = noise(u, v, 16, 41)
    let height = 0.4 + broad * 0.14 + small * 0.06
    let roughness = 0.98 + small * 0.02
    let shade = 1
    if (pattern === 'grain') {
      const across = v + (noise(u, v, 4, 73) - 0.5) * 0.035
      const grain = noise(u, across * 8, 8, 29)
      const fiber = noise(u * 2, across * 20, 8, 59)
      height = 0.42 + grain * 0.11 + fiber * 0.035
      roughness = 0.98 + grain * 0.015 + fiber * 0.005
      shade = 0.86 + grain * 0.105 + fiber * 0.025
    } else if (pattern === 'weave') {
      const warp = Math.cos(turn * u * 22)
      const weft = Math.cos(turn * v * 22)
      height = 0.5 + warp * 0.055 + weft * 0.055 + warp * weft * 0.018
      roughness = 0.98 + small * 0.02
      shade = 0.97 + (warp + weft) * 0.012 + (small - 0.5) * 0.008
    }
    const offset = (y * size + x) * 4
    // Standard materials read bump from red and multiply roughness by green.
    detail[offset] = byte(height)
    detail[offset + 1] = byte(roughness)
    detail[offset + 2] = 0
    detail[offset + 3] = 255
    if (tint) {
      tint[offset] = tint[offset + 1] = tint[offset + 2] = byte(shade)
      tint[offset + 3] = 255
    }
  }
  const result = { size, detail, tint }
  pixels.set(pattern, result)
  return result
}

function surfaceTexture(data: Uint8Array, size: number, name: string, color = false): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.name = name
  texture.colorSpace = color ? SRGBColorSpace : NoColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 2
  texture.needsUpdate = true
  return texture
}

function releaseTextures(material: MeshStandardMaterial): void {
  const lease = leases.get(material)
  if (!lease) return
  leases.delete(material)
  if (--lease.set.users === 0) {
    lease.set.detail.dispose()
    lease.set.tint?.dispose()
    textures.delete(lease.pattern)
  }
}

function bindTextures(material: MeshStandardMaterial, recipe: SurfaceRecipe): void {
  releaseTextures(material)
  material.map = material.bumpMap = material.roughnessMap = null
  if (!recipe.pattern) return
  let set = textures.get(recipe.pattern)
  if (!set) {
    const source = surfacePixels(recipe.pattern)
    set = {
      detail: surfaceTexture(source.detail, source.size, `Room ${recipe.pattern} surface detail`),
      tint: source.tint ? surfaceTexture(source.tint, source.size, `Neutral room ${recipe.pattern} color detail`, true) : undefined,
      users: 0,
    }
    textures.set(recipe.pattern, set)
  }
  set.users++
  leases.set(material, { pattern: recipe.pattern, set })
  if (!observed.has(material)) {
    observed.add(material)
    material.addEventListener('dispose', () => releaseTextures(material))
  }
  material.bumpMap = material.roughnessMap = set.detail
  material.map = recipe.tint ? set.tint ?? null : null
}

function isRoomSurface(value: unknown): value is RoomSurface {
  return typeof value === 'string' && Object.hasOwn(recipes, value)
}

export function roomMaterialSurface(material: MeshStandardMaterial): RoomSurface | undefined {
  const value: unknown = material.userData.roomSurface
  return isRoomSurface(value) ? value : undefined
}

export function setRoomMaterialSurface(material: MeshStandardMaterial, surface: RoomSurface): void {
  const recipe: SurfaceRecipe = recipes[surface]
  const previous = roomMaterialSurface(material)
  if (previous === surface && (!recipe.pattern || leases.has(material))) return
  bindTextures(material, recipe)
  material.userData.roomSurface = surface
  material.bumpScale = recipe.bump
  material.roughness = Math.max(recipe.roughness[0], Math.min(recipe.roughness[1], material.roughness))
  material.metalness = surface === 'metal' ? 0.9 : 0
  material.flatShading = !recipe.smooth
  if (surface === 'clear-glass') {
    material.transparent = true
    material.opacity = 0.28
    material.depthWrite = false
    material.side = DoubleSide
  } else if (previous === 'clear-glass') {
    material.transparent = false
    material.opacity = 1
    material.depthWrite = true
    material.side = FrontSide
  }
  material.needsUpdate = true
}

export function createRoomMaterial(color: ColorRepresentation, roughness = 0.8, surface: RoomSurface = 'paint', name = ''): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ name, color, roughness, flatShading: true })
  setRoomMaterialSurface(material, surface)
  return material
}

export function cloneRoomMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
  const material = source.clone()
  const surface = roomMaterialSurface(source)
  if (surface) bindTextures(material, recipes[surface])
  return material
}

export function createRoomMaterialVariant(source: MeshStandardMaterial, surface: RoomSurface): MeshStandardMaterial {
  const material = cloneRoomMaterial(source)
  setRoomMaterialSurface(material, surface)
  material.color = source.color
  material.name = `${source.name} ${surface}`
  return material
}

function prepareGeometry(geometry: BufferGeometry, surface: RoomSurface): void {
  const recipe: SurfaceRecipe = recipes[surface]
  if (!recipe.pattern || geometry.userData.roomSurfaceUV) return
  const uv = geometry.getAttribute('uv')
  if (!uv) throw new Error('Textured room geometry needs texture coordinates.')
  const adjusted = new Set<number>()
  const index = geometry.getIndex()
  const scale = (start: number, count: number, width: number, height: number) => {
    for (let item = start; item < start + count; item++) {
      const vertex = index ? index.getX(item) : item
      if (adjusted.has(vertex)) continue
      adjusted.add(vertex)
      const u = uv.getX(vertex)
      const v = uv.getY(vertex)
      const alongHeight = surface === 'wood' && height > width
      uv.setXY(vertex, (alongHeight ? v * height : u * width) * recipe.density,
        (alongHeight ? u * width : v * height) * recipe.density)
    }
  }
  if (geometry instanceof BoxGeometry) {
    const { width, height, depth } = geometry.parameters
    const sizes: readonly (readonly [number, number])[] = [
      [depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height],
    ]
    geometry.groups.forEach((group, face) => scale(group.start, group.count, ...sizes[face]))
  } else if (geometry instanceof CylinderGeometry) {
    const { radiusTop, radiusBottom, height, thetaLength } = geometry.parameters
    for (const group of geometry.groups) {
      const radius = group.materialIndex === 1 ? radiusTop : radiusBottom
      scale(group.start, group.count, group.materialIndex === 0 ? Math.max(radiusTop, radiusBottom) * thetaLength : radius * 2,
        group.materialIndex === 0 ? height : radius * 2)
    }
  } else if (geometry instanceof LatheGeometry) {
    const { points, phiLength } = geometry.parameters
    const radius = Math.max(...points.map((point) => point.x))
    const height = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))
    scale(0, index?.count ?? uv.count, radius * phiLength, height)
  } else if (geometry instanceof TorusGeometry) {
    const { radius, tube, arc } = geometry.parameters
    scale(0, index?.count ?? uv.count, radius * arc, tube * turn)
  } else scale(0, index?.count ?? uv.count, 1, 1)
  geometry.userData.roomSurfaceUV = true
  uv.needsUpdate = true
}

export function prepareRoomSurfaceGeometry(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) continue
      const surface = roomMaterialSurface(material)
      if (surface) prepareGeometry(object.geometry, surface)
    }
  })
}
