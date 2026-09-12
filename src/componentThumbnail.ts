import {
  ACESFilmicToneMapping, Box3, Group, Light, Mesh, MeshStandardMaterial,
  OrthographicCamera, PCFShadowMap, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three'
import type { BufferGeometry, DataTexture, Material, Object3D } from 'three'
import type { RoomStyle } from '../shared/domain.ts'
import { componentCatalog, componentFinishes, roomSlots } from '../shared/roomComponents.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'
import { roomModels } from './roomModels.ts'
import { buildRoomComponentModel } from './roomComponentModels.ts'
import { componentThumbnailSelection } from './componentPresentation.ts'
import type { ComponentBindings } from './roomComponentTypes.ts'
import { baseCameraOffset, fitRoomBounds } from './camera.ts'
import { addContactShadows, createContactShadowTexture, createRoomLights } from './lighting.ts'
import { componentPlacements } from './roomLayout.ts'
import { cloneRoomMaterial } from './surfaceMaterials.ts'
import { applyRoomReflections, createRoomReflections } from './roomEnvironment.ts'
import type { RoomReflections } from './roomEnvironment.ts'

type Fixture = { room: Group; bindings: ComponentBindings; dispose: () => void }
const fixtures = new Map<string, Fixture>()
const images = new Map<string, string>()
const thumbnailWidth = 320
const thumbnailHeight = 240
let rasterizer: WebGLRenderer | null | undefined
let shadowTexture: DataTexture | undefined
let reflections: RoomReflections | undefined
let generation = 0
let queue: Promise<void> = Promise.resolve()

function disposeGeometry(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  root.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
  geometries.forEach((geometry) => geometry.dispose())
}

function fixture(roomId: RoomId, style: RoomStyle): Fixture {
  const key = `${roomId}:${style}`
  const cached = fixtures.get(key)
  if (cached) return cached
  const room = new Group()
  const model = roomModels[roomId](room, style)
  const bindings = 'scenery' in model ? model.scenery.componentBindings : model.componentBindings
  const value = {
    room, bindings,
    dispose: () => { disposeGeometry(room); model.materials.forEach((material) => material.dispose()) },
  }
  if (fixtures.size >= Object.keys(roomModels).length) {
    const oldest = fixtures.entries().next().value
    if (oldest) { oldest[1].dispose(); fixtures.delete(oldest[0]) }
  }
  fixtures.set(key, value)
  return value
}

function visibleBounds(root: Object3D): Box3 {
  root.updateMatrixWorld(true)
  const bounds = new Box3()
  const part = new Box3()
  root.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.computeBoundingBox()
    if (object.geometry.boundingBox) bounds.union(part.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld))
  })
  return bounds
}

export function buildComponentThumbnail(component: RoomComponent, style: RoomStyle) {
  const original = fixture(component.roomId, style)
  const binding = original.bindings.get(component.slotId)
  let object: Object3D
  let dispose: () => void
  const finish = componentFinishes[component.finish].color
  if (binding && roomSlots.find((slot) => slot.id === component.slotId)?.defaultKind === component.kind
    && component.variant === componentCatalog[component.kind].variants[0].id) {
    const boundaries = new Set([...original.bindings.values()].map((binding) => binding.root))
    const selection = componentThumbnailSelection(binding.root)
    const tinted = new Map<Material, MeshStandardMaterial>()
    const materialFor = (material: Material): Material => {
      if (!finish || !(material instanceof MeshStandardMaterial) || !binding.finishes.includes(material)) return material
      let copy = tinted.get(material)
      if (!copy) { copy = cloneRoomMaterial(material); copy.color.set(finish); tinted.set(material, copy) }
      return copy
    }
    const copyObject = (source: Object3D): Object3D | null => {
      if (!source.visible || source instanceof Light || (source !== binding.root && source instanceof Group && boundaries.has(source))) return null
      if (source instanceof Mesh && (Array.isArray(source.material) ? source.material : [source.material])
        .every((material) => !material.visible || material.opacity === 0)) return null
      const copy = source.clone(false)
      if (selection && !selection.has(source)) copy.visible = false
      if (source instanceof Mesh && copy instanceof Mesh) {
        copy.material = Array.isArray(source.material) ? source.material.map(materialFor) : materialFor(source.material)
      }
      for (const child of source.children) {
        const next = copyObject(child)
        if (next) copy.add(next)
      }
      return copy
    }
    binding.root.updateWorldMatrix(true, true)
    const copy = copyObject(binding.root)
    if (!copy) throw new Error(`The ${component.name} model has no visible preview.`)
    binding.root.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale)
    object = copy
    dispose = () => tinted.forEach((material) => material.dispose())
  } else {
    const model = buildRoomComponentModel(component, style)
    if (finish) model.finishes.forEach((material) => material.color.set(finish))
    model.stateObjects?.forEach((item) => { item.root.visible = item.states.includes(component.state ?? '') })
    object = model.root
    dispose = () => { disposeGeometry(model.root); model.materials.forEach((material) => material.dispose()) }
    const selection = componentThumbnailSelection(model.root)
    if (selection) model.root.traverse((part) => { if (!selection.has(part)) part.visible = false })
  }
  // Cards show the model's front even when its fitted position faces an invisible side wall.
  object.rotation.y -= componentPlacements[component.slotId]?.rotation ?? 0
  const root = new Group()
  root.add(object)
  const bounds = visibleBounds(root)
  if (bounds.isEmpty()) { dispose(); throw new Error(`The ${component.name} model has no preview geometry.`) }
  const size = bounds.getSize(new Vector3())
  const scale = 3 / Math.max(size.x, size.y, size.z)
  root.scale.setScalar(scale)
  root.position.copy(bounds.getCenter(new Vector3())).multiplyScalar(-scale)
  root.updateMatrixWorld(true)
  return { root, bounds: visibleBounds(root), dispose }
}

export function componentThumbnailKey(component: RoomComponent, style: RoomStyle): string {
  return [component.kind, component.slotId, component.variant, component.finish, component.state ?? '', style].join(':')
}

export function cachedComponentThumbnail(component: RoomComponent, style: RoomStyle): string | undefined {
  return images.get(componentThumbnailKey(component, style))
}

export function componentThumbnailCamera(bounds: Box3): OrthographicCamera {
  const frame = fitRoomBounds(thumbnailWidth, thumbnailHeight, bounds)
  const horizontal = frame.halfHeight * thumbnailWidth / thumbnailHeight
  const camera = new OrthographicCamera(-horizontal, horizontal, frame.halfHeight, -frame.halfHeight, 0.1, 100)
  const center = new Vector3(...frame.center)
  camera.position.copy(center).add(new Vector3(...baseCameraOffset))
  camera.lookAt(center)
  camera.updateMatrixWorld(true)
  let top = Infinity
  let bottom = -Infinity
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new Vector3(x, y, z).project(camera)
    const screenY = -point.y * thumbnailHeight / 2
    top = Math.min(top, screenY)
    bottom = Math.max(bottom, screenY)
  }
  // Give low-profile objects a common ground line without clipping taller models.
  const shift = Math.max(-thumbnailHeight / 2 + 12 - top, Math.min(thumbnailHeight / 2 - 12 - bottom, thumbnailHeight * 0.34 - bottom))
  const offset = shift * frame.halfHeight * 2 / thumbnailHeight
  camera.top += offset
  camera.bottom += offset
  camera.updateProjectionMatrix()
  return camera
}

function thumbnailRasterizer(): WebGLRenderer | null {
  if (rasterizer !== undefined) return rasterizer?.getContext().isContextLost() ? null : rasterizer
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' })
  if (!context || context.isContextLost()) { rasterizer = null; return null }
  const candidate = new WebGLRenderer({ canvas, context, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' })
  try {
    reflections = createRoomReflections(candidate)
    candidate.setPixelRatio(2)
    candidate.setSize(thumbnailWidth, thumbnailHeight, false)
    candidate.setClearColor(0x000000, 0)
    candidate.outputColorSpace = SRGBColorSpace
    candidate.toneMapping = ACESFilmicToneMapping
    candidate.toneMappingExposure = 1.05
    candidate.shadowMap.enabled = true
    candidate.shadowMap.type = PCFShadowMap
    candidate.shadowMap.autoUpdate = false
    rasterizer = candidate
  } catch (error) {
    reflections?.dispose()
    reflections = undefined
    candidate.dispose()
    candidate.forceContextLoss()
    throw error
  }
  return rasterizer
}

function rememberImage(key: string, image: string): string {
  if (images.size >= 120) {
    const oldest = images.keys().next().value
    if (oldest) images.delete(oldest)
  }
  images.set(key, image)
  return image
}

async function draw(component: RoomComponent, style: RoomStyle, currentGeneration: number): Promise<string> {
  if (currentGeneration !== generation) throw new Error('The component preview was interrupted before it could be rendered.')
  const key = componentThumbnailKey(component, style)
  const cached = images.get(key)
  if (cached) return cached
  const raster = thumbnailRasterizer()
  if (!raster) throw new Error('3D is unavailable.')
  const model = buildComponentThumbnail(component, style)
  try {
    const scene = new Scene()
    const camera = componentThumbnailCamera(model.bounds)
    const center = model.bounds.getCenter(new Vector3())
    const wallMounted = componentPlacements[component.slotId]?.surface === 'wall'
      || ['clock', 'mirror', 'noticeboard', 'curtains', 'light'].includes(component.kind)
    if (!reflections) throw new Error('The thumbnail renderer needs its surface reflections.')
    applyRoomReflections(scene, reflections)
    const lights = createRoomLights(model.bounds)
    lights.sunlight.shadow.mapSize.set(512, 512)
    scene.add(model.root, lights.group)
    const ground = new Group()
    scene.add(ground)
    shadowTexture ??= createContactShadowTexture()
    const size = model.bounds.getSize(new Vector3())
    const shadow = addContactShadows(ground, shadowTexture, wallMounted ? [] : [{
      position: [center.x, model.bounds.min.y - 0.025, center.z],
      size: [Math.max(0.3, size.x * 1.12), Math.max(0.3, size.z * 1.12)],
    }])
    try {
      raster.compile(scene, camera)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      if (currentGeneration !== generation || raster.getContext().isContextLost()) {
        throw new Error('The component preview was interrupted before it could be rendered.')
      }
      raster.shadowMap.needsUpdate = true
      raster.render(scene, camera)
      return rememberImage(key, raster.domElement.toDataURL('image/png'))
    } finally {
      shadow.geometry.dispose()
      shadow.material.dispose()
      lights.sunlight.shadow.dispose()
      scene.clear()
    }
  } finally {
    model.dispose()
  }
}

export function renderComponentThumbnail(component: RoomComponent, style: RoomStyle): Promise<string> {
  const currentGeneration = generation
  const cached = cachedComponentThumbnail(component, style)
  if (cached) return Promise.resolve(cached)
  const result = queue.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    .then(() => draw(component, style, currentGeneration))
  // Callers receive failures, but one bad preview must not stop the remaining cards.
  queue = result.then(() => {}, () => {})
  return result
}

export function clearComponentThumbnails(): void {
  generation++
  queue = Promise.resolve()
  fixtures.forEach((value) => value.dispose())
  fixtures.clear()
  images.clear()
  reflections?.dispose()
  reflections = undefined
  rasterizer?.dispose()
  rasterizer?.forceContextLoss()
  rasterizer = undefined
  shadowTexture?.dispose()
  shadowTexture = undefined
}

if (import.meta.hot) import.meta.hot.dispose(clearComponentThumbnails)
