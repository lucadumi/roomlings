import {
  ACESFilmicToneMapping, AmbientLight, Box3, DirectionalLight, Group, Light, Mesh, MeshStandardMaterial,
  OrthographicCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three'
import type { BufferGeometry, DataTexture, Material, Object3D } from 'three'
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js'
import type { RoomStyle } from '../shared/domain.ts'
import { componentCatalog, componentFinishes, roomSlots } from '../shared/roomComponents.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'
import { buildKitchenModel } from './kitchenModel.ts'
import { buildBathroomModel } from './bathroomModel.ts'
import { buildRoomComponentModel } from './roomComponentModels.ts'
import type { ComponentBindings } from './roomComponentTypes.ts'
import { baseCameraOffset, fitRoomBounds } from './camera.ts'
import { addContactShadows, createContactShadowTexture, createRoomLights } from './lighting.ts'
import { componentPlacements } from './roomLayout.ts'

type Fixture = { room: Group; bindings: ComponentBindings; dispose: () => void }
const fixtures = new Map<string, Fixture>()
const images = new Map<string, string>()
const thumbnailWidth = 320
const thumbnailHeight = 240
let renderer: SVGRenderer | undefined
let rasterizer: WebGLRenderer | null | undefined
let shadowTexture: DataTexture | undefined
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
  const model = roomId === 'kitchen' ? buildKitchenModel(room, style) : buildBathroomModel(room, style)
  const bindings = 'scenery' in model ? model.scenery.componentBindings : model.componentBindings
  const value = {
    room, bindings,
    dispose: () => { disposeGeometry(room); model.materials.forEach((material) => material.dispose()) },
  }
  if (fixtures.size >= 2) {
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
    const tinted = new Map<Material, MeshStandardMaterial>()
    const materialFor = (material: Material): Material => {
      if (!finish || !(material instanceof MeshStandardMaterial) || !binding.finishes.includes(material)) return material
      let copy = tinted.get(material)
      if (!copy) { copy = material.clone(); copy.color.set(finish); tinted.set(material, copy) }
      return copy
    }
    const copyObject = (source: Object3D): Object3D | null => {
      if (!source.visible || source instanceof Light || (source !== binding.root && source instanceof Group && boundaries.has(source))) return null
      if (source instanceof Mesh && (Array.isArray(source.material) ? source.material : [source.material])
        .every((material) => !material.visible || material.opacity === 0)) return null
      const copy = source.clone(false)
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
  rasterizer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' })
  rasterizer.setPixelRatio(2)
  rasterizer.setSize(thumbnailWidth, thumbnailHeight, false)
  rasterizer.setClearColor(0x000000, 0)
  rasterizer.outputColorSpace = SRGBColorSpace
  rasterizer.toneMapping = ACESFilmicToneMapping
  rasterizer.toneMappingExposure = 1.05
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

function draw(component: RoomComponent, style: RoomStyle): string {
  const key = componentThumbnailKey(component, style)
  const cached = images.get(key)
  if (cached) return cached
  const model = buildComponentThumbnail(component, style)
  try {
    const scene = new Scene()
    const camera = componentThumbnailCamera(model.bounds)
    const center = model.bounds.getCenter(new Vector3())
    const wallMounted = componentPlacements[component.slotId]?.surface === 'wall'
      || ['clock', 'mirror', 'noticeboard', 'curtains', 'light'].includes(component.kind)
    const raster = thumbnailRasterizer()
    if (raster) {
      const lights = createRoomLights(model.bounds)
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
        raster.render(scene, camera)
        return rememberImage(key, raster.domElement.toDataURL('image/png'))
      } finally {
        shadow.geometry.dispose()
        shadow.material.dispose()
        lights.sunlight.shadow.dispose()
        scene.clear()
      }
    }
    const ambient = new AmbientLight('#fff8eb')
    ambient.color.multiplyScalar(0.55)
    scene.add(model.root, ambient)
    const light = new DirectionalLight('#fff3dc', 0.85)
    light.position.set(-3, 7, 6)
    scene.add(light)
    const fill = new DirectionalLight('#dce9dc', 0.28)
    fill.position.set(6, 3, -4)
    scene.add(fill)
    if (!renderer) {
      renderer = new SVGRenderer()
      renderer.setSize(thumbnailWidth, thumbnailHeight)
      renderer.setPrecision(2)
    }
    renderer.render(scene, camera)
    renderer.domElement.style.backgroundColor = 'transparent'
    if (!wallMounted) {
      const namespace = 'http://www.w3.org/2000/svg'
      const defs = document.createElementNS(namespace, 'defs')
      const gradient = document.createElementNS(namespace, 'radialGradient')
      gradient.id = 'object-shadow'
      for (const [offset, opacity] of [['0%', '0.25'], ['100%', '0']] as const) {
        const stop = document.createElementNS(namespace, 'stop')
        stop.setAttribute('offset', offset)
        stop.setAttribute('stop-color', '#626b4c')
        stop.setAttribute('stop-opacity', opacity)
        gradient.append(stop)
      }
      defs.append(gradient)
      const size = model.bounds.getSize(new Vector3())
      const floor = new Vector3(center.x, model.bounds.min.y - 0.025, center.z)
      const point = (value: Vector3) => {
        value.project(camera)
        return [value.x * thumbnailWidth / 2, -value.y * thumbnailHeight / 2] as const
      }
      const origin = point(floor.clone())
      const x = point(floor.clone().add(new Vector3(Math.max(0.15, size.x * 0.56), 0, 0)))
      const z = point(floor.clone().add(new Vector3(0, 0, Math.max(0.15, size.z * 0.56))))
      const shadow = document.createElementNS(namespace, 'circle')
      shadow.setAttribute('r', '1')
      shadow.setAttribute('fill', 'url(#object-shadow)')
      shadow.setAttribute('transform', `matrix(${x[0] - origin[0]} ${x[1] - origin[1]} ${z[0] - origin[0]} ${z[1] - origin[1]} ${origin[0]} ${origin[1]})`)
      renderer.domElement.prepend(defs, shadow)
    }
    const svg = new XMLSerializer().serializeToString(renderer.domElement)
    return rememberImage(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  } finally {
    model.dispose()
  }
}

export function renderComponentThumbnail(component: RoomComponent, style: RoomStyle): Promise<string> {
  const cached = cachedComponentThumbnail(component, style)
  if (cached) return Promise.resolve(cached)
  const result = queue.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    .then(() => draw(component, style))
  // Callers receive failures, but one bad preview must not stop the remaining cards.
  queue = result.then(() => {}, () => {})
  return result
}

export function clearComponentThumbnails(): void {
  fixtures.forEach((value) => value.dispose())
  fixtures.clear()
  images.clear()
  renderer?.clear()
  renderer = undefined
  rasterizer?.dispose()
  rasterizer?.forceContextLoss()
  rasterizer = undefined
  shadowTexture?.dispose()
  shadowTexture = undefined
}

if (import.meta.hot) import.meta.hot.dispose(clearComponentThumbnails)
