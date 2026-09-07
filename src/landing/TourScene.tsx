import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import {
  ACESFilmicToneMapping, Color, Group, MathUtils, Mesh, MeshBasicMaterial,
  PCFShadowMap, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three'
import type { BufferGeometry } from 'three'
import { buildKitchenModel } from '../kitchenModel.ts'
import { batchStaticMeshes } from '../batchStaticMeshes.ts'
import { addContactShadows, createContactShadowTexture, createRoomLights, daylight, eveningLight } from '../lighting.ts'
import { dampTo, frameSeconds } from '../motion.ts'
import { tourArea, tourFrame } from './tour.ts'
import type { TourLayout } from './tour.ts'

export type TourStatus = 'loading' | 'ready' | 'unavailable'

type Props = {
  progress: RefObject<number>
  layout: RefObject<TourLayout | null>
  wake: RefObject<(() => void) | null>
  reducedMotion: boolean
  onStatus: (status: TourStatus) => void
}

export default function TourScene({ progress, layout, wake, reducedMotion, onStatus }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const state = useRef({ reducedMotion, onStatus })
  state.current = { reducedMotion, onStatus }

  useEffect(() => {
    const element = host.current
    if (!element) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch (error) {
      console.warn('The welcome kitchen could not start WebGL:', error)
      state.current.onStatus('unavailable')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.setAttribute('aria-hidden', 'true')
    element.appendChild(renderer.domElement)

    const scene = new Scene()
    const room = new Group()
    scene.add(room)
    const camera = new PerspectiveCamera(35, 1, 0.1, 150)
    const { group: lighting, sunlight, skyLight, fill } = createRoomLights()
    sunlight.shadow.mapSize.setScalar(element.clientWidth < 760 ? 1024 : 2048)
    scene.add(lighting)
    const { kitchen, scenery, materials, doors, iceTray, interiorLight } = buildKitchenModel(room)
    scenery.portraits.forEach((portrait, index) => { portrait.visible = index < 4 })
    scenery.receipts.forEach((receipt, index) => { receipt.visible = index < 5 })
    scenery.hourHand.rotation.z = -(10 + 10 / 60) / 12 * Math.PI * 2
    scenery.minuteHand.rotation.z = -10 / 60 * Math.PI * 2
    iceTray.visible = false
    batchStaticMeshes(room, new Set([
      ...scenery.coins, ...scenery.receipts, ...scenery.steam, scenery.kettleLid,
    ]))
    const texture = createContactShadowTexture()
    const contacts = addContactShadows(room, texture, [
      ...scenery.contacts,
      { position: [kitchen.position.x, 0.007, kitchen.position.z], size: [2.55, 2.1] },
    ])
    const floorMaterial = new MeshBasicMaterial({
      map: texture, color: '#535d45', opacity: 0.2, transparent: true, depthWrite: false, toneMapped: false,
    })
    const floor = new Mesh(new PlaneGeometry(16, 13), floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, -0.29, 0.4)
    scene.add(floor)
    const dayWindow = new Color(daylight.window)
    const nightWindow = new Color(eveningLight.window)
    const dayDisc = new Color(daylight.disc)
    const nightDisc = new Color(eveningLight.disc)

    let frame = 0
    let available = true
    let disposed = false
    let width = 1
    let height = 1
    let needsResize = true
    let ready = false
    let previousTime = performance.now()
    let displayedProgress = progress.current
    let previousReduced = state.current.reducedMotion
    let lastShadow = -Infinity
    let shadowDirty = true
    let ambientTime = 0

    const requestFrame = () => {
      if (!frame && available && !disposed && !document.hidden) frame = requestAnimationFrame(render)
    }
    const render = (now: number) => {
      frame = 0
      if (!available || disposed || document.hidden) return
      const delta = frameSeconds(previousTime, now)
      previousTime = now
      const reduced = state.current.reducedMotion
      if (previousReduced !== reduced) {
        displayedProgress = progress.current
        previousReduced = reduced
        shadowDirty = true
      }
      if (needsResize) {
        renderer.setSize(width, height)
        camera.aspect = width / height
        needsResize = false
      }
      displayedProgress = reduced ? progress.current : dampTo(displayedProgress, progress.current, 9, delta, 0.0001)
      const measured = layout.current
      if (!measured) { requestFrame(); return }
      const area = tourArea(displayedProgress, measured, reduced)
      const visible = area.height >= 48
      const view = tourFrame(displayedProgress, area.width, Math.max(1, area.height), reduced)
      camera.position.set(...view.position)
      camera.lookAt(...view.target)
      camera.far = Math.max(150, Math.hypot(...view.position) + 30)
      camera.fov = 2 * Math.atan(Math.tan(view.fov * Math.PI / 360) * height / Math.max(1, area.height)) * 180 / Math.PI
      camera.setViewOffset(width, height, width / 2 - area.x - area.width / 2, height / 2 - area.y - area.height / 2, width, height)
      camera.updateProjectionMatrix()
      renderer.domElement.style.clipPath = visible
        ? `inset(${area.y}px ${Math.max(0, width - area.x - area.width)}px ${Math.max(0, height - area.y - area.height)}px ${area.x}px)`
        : 'inset(50%)'
      element.dataset.sceneArea = JSON.stringify(area)
      element.dataset.cameraMoving = String(!reduced && displayedProgress !== progress.current)
      element.dataset.tourPosition = reduced ? 'static' : displayedProgress.toFixed(3)

      for (const [index, door] of doors.entries()) {
        const rotation = (index ? -1.72 : -1.97) * view.door
        shadowDirty ||= door.rotation.y !== rotation
        door.rotation.y = rotation
      }
      interiorLight.intensity = view.door * 0.6
      scenery.receipts.forEach((receipt, index) => {
        const lift = index * view.paper * 0.055
        const y = 0.038 + index * 0.012 + lift
        const rotation = Math.sin(index * 2) * 0.04 + view.paper * index * 0.045
        shadowDirty ||= receipt.visible && (receipt.position.y !== y || receipt.rotation.y !== rotation)
        receipt.position.y = y
        receipt.rotation.y = rotation
      })
      scenery.receiptLines.position.y = 0.043 + 5 * 0.012 + 4 * view.paper * 0.055
      scenery.receiptLines.rotation.y = view.paper * 4 * 0.045
      scenery.coins.forEach((coin, index) => {
        const scale = MathUtils.clamp(view.coins * 12 - index, 0, 1)
        shadowDirty ||= coin.scale.x !== scale || coin.visible !== (scale > 0)
        coin.scale.setScalar(scale)
        coin.visible = scale > 0
      })
      if (!reduced) ambientTime += Math.min(delta, 0.1)
      scenery.plants.forEach((plant, index) => { plant.rotation.z = reduced ? 0 : Math.sin(ambientTime / 2.5 + index) * 0.018 })
      scenery.steam.forEach((puff, index) => {
        const phase = (ambientTime / 3.5 + index / 3) % 1
        const fade = Math.sin(phase * Math.PI)
        puff.visible = !reduced
        puff.position.y = 0.44 + phase * 0.7
        puff.position.x = 0.33 + Math.sin(phase * 4) * 0.06
        puff.scale.setScalar(0.4 + fade * 1.3)
        puff.material.opacity = fade * fade * 0.18
      })
      sunlight.intensity = MathUtils.lerp(daylight.sun, eveningLight.sun, view.evening)
      skyLight.intensity = MathUtils.lerp(daylight.sky, eveningLight.sky, view.evening)
      fill.intensity = MathUtils.lerp(daylight.fill, eveningLight.fill, view.evening)
      scenery.light.intensity = MathUtils.lerp(daylight.lamp, eveningLight.lamp, view.evening)
      scenery.bulb.emissiveIntensity = MathUtils.lerp(daylight.bulb, eveningLight.bulb, view.evening)
      scenery.sky.color.lerpColors(dayWindow, nightWindow, view.evening)
      scenery.windowDisc.color.lerpColors(dayDisc, nightDisc, view.evening)
      scenery.windowDisc.emissiveIntensity = view.evening * 0.35
      // The camera can travel freely without repainting shadows for the unchanged room.
      sunlight.shadow.needsUpdate = shadowDirty || (!reduced && now - lastShadow >= 250)
      if (visible || !ready) {
        if (sunlight.shadow.needsUpdate) { lastShadow = now; shadowDirty = false }
        renderer.render(scene, camera)
      }
      element.dataset.rendering = reduced || !visible ? 'paused' : 'active'
      if (!ready) {
        ready = true
        state.current.onStatus('ready')
      }
      if (!reduced) requestFrame()
    }
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return
      width = element.clientWidth
      height = element.clientHeight
      needsResize = true
      requestFrame()
    }
    const visibilityChanged = () => {
      previousTime = performance.now()
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0 }
      else requestFrame()
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      available = false
      cancelAnimationFrame(frame)
      frame = 0
      console.warn('The welcome kitchen lost its WebGL context. The illustrated tour is still available.')
      state.current.onStatus('unavailable')
    }
    wake.current = requestFrame
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    document.addEventListener('visibilitychange', visibilityChanged)
    renderer.domElement.addEventListener('webglcontextlost', contextLost)
    resize()

    return () => {
      disposed = true
      wake.current = null
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('visibilitychange', visibilityChanged)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      const geometries = new Set<BufferGeometry>([contacts.geometry])
      scene.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
      contacts.material.dispose()
      floorMaterial.dispose()
      texture.dispose()
      sunlight.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [progress, layout, wake])

  useEffect(() => { wake.current?.() }, [reducedMotion])

  return <div className="welcome-canvas" ref={host} />
}
