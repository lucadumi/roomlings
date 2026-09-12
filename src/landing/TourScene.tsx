import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import {
  ACESFilmicToneMapping, Color, Group, MathUtils, Mesh, MeshBasicMaterial,
  PCFShadowMap, OrthographicCamera, PlaneGeometry, Raycaster, Scene, SRGBColorSpace, Vector2, WebGLRenderer,
} from 'three'
import type { BufferGeometry } from 'three'
import { buildKitchenModel } from '../kitchenModel.ts'
import { batchStaticMeshes } from '../batchStaticMeshes.ts'
import { addContactShadows, createContactShadowTexture, createRoomLights, daylight, eveningLight } from '../lighting.ts'
import { dampTo, frameSeconds } from '../motion.ts'
import { tourArea, tourFrame } from './tour.ts'
import type { TourLayout } from './tour.ts'
import { tourChapterForObject } from './tourPicking.ts'
import { baseCameraOffset, cameraProjection } from '../camera.ts'
import { visibleRoomBounds } from '../roomComponentScene.ts'
import { tourCameraFraming } from './tourCamera.ts'
import { measureKitchenTourBounds, sharedTourOverviewBounds, tourDoorAngles } from './tourGeometry.ts'
import { applyRoomReflections, createRoomReflections, roomReflectionIntensity } from '../roomEnvironment.ts'
import type { RoomReflections } from '../roomEnvironment.ts'

export type TourStatus = 'loading' | 'ready' | 'unavailable'

type Props = {
  progress: RefObject<number>
  layout: RefObject<TourLayout | null>
  wake: RefObject<(() => void) | null>
  reducedMotion: boolean
  onStatus: (status: TourStatus) => void
  onSelectChapter?: (index: number) => void
}

export default function TourScene({ progress, layout, wake, reducedMotion, onStatus, onSelectChapter }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const pickingUsable = useRef(false)
  const cancelPicking = useRef<(() => void) | null>(null)
  const state = useRef({ reducedMotion, onStatus, onSelectChapter })
  state.current = { reducedMotion, onStatus, onSelectChapter }

  useEffect(() => {
    const element = host.current
    if (!element) return
    let renderer: WebGLRenderer
    let reflections: RoomReflections
    let candidate: WebGLRenderer | undefined
    try {
      candidate = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
      reflections = createRoomReflections(candidate)
      renderer = candidate
    } catch (error) {
      candidate?.dispose()
      candidate?.forceContextLoss()
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
    renderer.domElement.style.pointerEvents = 'none'
    element.appendChild(renderer.domElement)
    canvas.current = renderer.domElement

    const scene = new Scene()
    applyRoomReflections(scene, reflections)
    const room = new Group()
    scene.add(room)
    const camera = new OrthographicCamera(-7, 7, 5, -5, 0.1, 150)
    const model = buildKitchenModel(room)
    const { kitchen, scenery, materials, doors, iceTray, interiorLight } = model
    scenery.portraits.forEach((portrait, index) => { portrait.visible = index < 4 })
    scenery.receipts.forEach((receipt, index) => { receipt.visible = index < 5 })
    scenery.hourHand.rotation.z = -(10 + 10 / 60) / 12 * Math.PI * 2
    scenery.minuteHand.rotation.z = -10 / 60 * Math.PI * 2
    iceTray.visible = false
    const tourBounds = measureKitchenTourBounds(room, model)
    const cameraBounds = { ...tourBounds, room: sharedTourOverviewBounds() }
    const { group: lighting, sunlight, skyLight, fillLights } = createRoomLights(tourBounds.room)
    sunlight.shadow.mapSize.setScalar(element.clientWidth < 760 ? 1024 : 2048)
    scene.add(lighting)
    batchStaticMeshes(room, scenery.preserved)
    const texture = createContactShadowTexture()
    const contacts = addContactShadows(room, texture, [
      ...scenery.contacts,
      { position: [kitchen.position.x, 0.007, kitchen.position.z], size: [2.55, 2.1] },
    ])
    const floorMaterial = new MeshBasicMaterial({
      map: texture, color: '#535d45', opacity: 0.2, transparent: true, depthWrite: false, toneMapped: false,
    })
    const floorWidth = tourBounds.room.max.x - tourBounds.room.min.x
    const floorDepth = tourBounds.room.max.z - tourBounds.room.min.z
    const floor = new Mesh(new PlaneGeometry(floorWidth * 1.45, floorDepth * 1.5), floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.position.set((tourBounds.room.min.x + tourBounds.room.max.x) / 2, visibleRoomBounds(room).min.y - 0.015,
      (tourBounds.room.min.z + tourBounds.room.max.z) / 2)
    scene.add(floor)
    const dayWindow = new Color(daylight.window)
    const nightWindow = new Color(eveningLight.window)
    const dayDisc = new Color(daylight.disc)
    const nightDisc = new Color(eveningLight.disc)

    let frame = 0
    let available = true
    let disposed = false
    let onScreen = false
    let width = 1
    let height = 1
    let needsResize = true
    let ready = false
    let previousTime = performance.now()
    let displayedProgress = progress.current
    let previousReduced = state.current.reducedMotion
    let lastShadow = -Infinity
    let shadowDirty = true
    let shadersReady = false
    let ambientTime = 0
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    let gesture: {
      pointerId: number
      startX: number
      startY: number
      chapter: number | null
      invalid: boolean
    } | null = null

    const requestFrame = () => {
      if (!frame && shadersReady && available && !disposed && onScreen && !document.hidden) frame = requestAnimationFrame(render)
    }
    const render = (now: number) => {
      frame = 0
      if (!available || disposed || !onScreen || document.hidden) return
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
        needsResize = false
      }
      displayedProgress = reduced ? progress.current : dampTo(displayedProgress, progress.current, 9, delta, 0.0001)
      const measured = layout.current
      if (!measured) { requestFrame(); return }
      const area = tourArea(displayedProgress, measured, reduced)
      const visible = area.height >= 48
      const view = tourFrame(displayedProgress, area.width, Math.max(1, area.height), reduced)
      const framing = tourCameraFraming(displayedProgress, area.width, Math.max(1, area.height), reduced, cameraBounds)
      camera.position.set(
        framing.center[0] + baseCameraOffset[0], framing.center[1] + baseCameraOffset[1], framing.center[2] + baseCameraOffset[2],
      )
      camera.lookAt(...framing.center)
      const projection = cameraProjection(width, height, area, framing.halfHeight, 1)
      camera.left = projection.left
      camera.right = projection.right
      camera.top = projection.top
      camera.bottom = projection.bottom
      camera.updateProjectionMatrix()
      renderer.domElement.style.clipPath = visible
        ? `inset(${area.y}px ${Math.max(0, width - area.x - area.width)}px ${Math.max(0, height - area.y - area.height)}px ${area.x}px)`
        : 'inset(50%)'
      element.dataset.sceneArea = JSON.stringify(area)
      element.dataset.cameraMoving = String(!reduced && displayedProgress !== progress.current)
      element.dataset.tourPosition = reduced ? 'static' : displayedProgress.toFixed(3)
      element.dataset.cameraAngle = baseCameraOffset.join(',')
      element.dataset.cameraScale = framing.halfHeight.toFixed(6)

      for (const [index, door] of doors.entries()) {
        const rotation = tourDoorAngles[index ? 1 : 0] * view.door
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
      scene.environmentIntensity = roomReflectionIntensity(view.evening)
      sunlight.intensity = MathUtils.lerp(daylight.sun, eveningLight.sun, view.evening)
      skyLight.intensity = MathUtils.lerp(daylight.sky, eveningLight.sky, view.evening)
      for (const fill of fillLights) fill.intensity = MathUtils.lerp(daylight.fill, eveningLight.fill, view.evening)
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
        pickingUsable.current = true
        renderer.domElement.style.pointerEvents = state.current.onSelectChapter ? 'auto' : 'none'
        state.current.onStatus('ready')
      }
      if (!reduced) requestFrame()
    }
    const canPick = () => available && !disposed && ready && Boolean(state.current.onSelectChapter)
      && onScreen && !document.hidden && renderer.domElement.isConnected
    const hitChapter = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (!canPick() || !rect.width || !rect.height) return null
      pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1)
      camera.updateMatrixWorld()
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(room, true).find(({ object }) => {
        for (let current = object; current !== room && current.parent; current = current.parent) {
          if (!current.visible) return false
        }
        return true
      })
      return hit ? tourChapterForObject(hit.object, room) : null
    }
    const resetCursor = () => { renderer.domElement.style.cursor = '' }
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || (event.buttons & ~1) !== 0 || !event.isPrimary || !canPick()) {
        if (gesture) gesture.invalid = true
        return
      }
      if (gesture) {
        gesture.invalid = true
        return
      }
      gesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        chapter: hitChapter(event.clientX, event.clientY),
        invalid: false,
      }
    }
    const pointerMove = (event: PointerEvent) => {
      if (gesture?.pointerId === event.pointerId) {
        gesture.invalid ||= Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 5
        return
      }
      if (!gesture && event.pointerType !== 'touch') {
        renderer.domElement.style.cursor = hitChapter(event.clientX, event.clientY) === null ? '' : 'pointer'
      }
    }
    const pointerUp = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return
      const finished = gesture
      gesture = null
      if (event.button !== 0 || finished.invalid
        || Math.hypot(event.clientX - finished.startX, event.clientY - finished.startY) >= 5) return
      const chapter = hitChapter(event.clientX, event.clientY)
      if (chapter !== null && chapter === finished.chapter) state.current.onSelectChapter?.(chapter)
    }
    const pointerCancelled = (event: PointerEvent) => {
      if (gesture?.pointerId === event.pointerId) gesture = null
      resetCursor()
    }
    const pointerLeft = (event: PointerEvent) => {
      if (gesture?.pointerId === event.pointerId) gesture = null
      resetCursor()
    }
    const invalidateMultipleContacts = (event: PointerEvent) => {
      if (gesture && gesture.pointerId !== event.pointerId) gesture.invalid = true
    }
    const releaseOutsideCanvas = (event: PointerEvent) => {
      if (gesture?.pointerId === event.pointerId) gesture = null
    }
    cancelPicking.current = () => {
      gesture = null
      resetCursor()
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
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; cancelPicking.current?.() }
      else requestFrame()
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      available = false
      cancelAnimationFrame(frame)
      frame = 0
      gesture = null
      pickingUsable.current = false
      cancelPicking.current = null
      renderer.domElement.style.pointerEvents = 'none'
      resetCursor()
      console.warn('The welcome kitchen lost its WebGL context. The illustrated tour is still available.')
      state.current.onStatus('unavailable')
    }
    wake.current = requestFrame
    const observer = new ResizeObserver(resize)
    const visibility = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting)
      previousTime = performance.now()
      if (onScreen) requestFrame()
      else {
        cancelAnimationFrame(frame)
        frame = 0
        cancelPicking.current?.()
        element.dataset.rendering = 'paused'
      }
    })
    observer.observe(element)
    visibility.observe(element)
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('pointerdown', invalidateMultipleContacts)
    window.addEventListener('pointerup', releaseOutsideCanvas)
    window.addEventListener('pointercancel', releaseOutsideCanvas)
    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('pointermove', pointerMove)
    renderer.domElement.addEventListener('pointerup', pointerUp)
    renderer.domElement.addEventListener('pointercancel', pointerCancelled)
    renderer.domElement.addEventListener('pointerleave', pointerLeft)
    renderer.domElement.addEventListener('webglcontextlost', contextLost)
    resize()
    const cleanup = () => {
      if (disposed) return
      disposed = true
      gesture = null
      pickingUsable.current = false
      cancelPicking.current = null
      renderer.domElement.style.pointerEvents = 'none'
      resetCursor()
      wake.current = null
      cancelAnimationFrame(frame)
      observer.disconnect()
      visibility.disconnect()
      document.removeEventListener('visibilitychange', visibilityChanged)
      window.removeEventListener('pointerdown', invalidateMultipleContacts)
      window.removeEventListener('pointerup', releaseOutsideCanvas)
      window.removeEventListener('pointercancel', releaseOutsideCanvas)
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('pointercancel', pointerCancelled)
      renderer.domElement.removeEventListener('pointerleave', pointerLeft)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      const geometries = new Set<BufferGeometry>([contacts.geometry])
      scene.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
      contacts.material.dispose()
      floorMaterial.dispose()
      texture.dispose()
      sunlight.shadow.dispose()
      reflections.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      canvas.current = null
    }
    try {
      renderer.compile(scene, camera)
      shadersReady = true
      requestFrame()
    } catch (error) {
      available = false
      console.warn('The welcome kitchen materials could not be prepared:', error)
      state.current.onStatus('unavailable')
      cleanup()
    }
    return cleanup
  }, [progress, layout, wake])

  useEffect(() => { wake.current?.() }, [reducedMotion])
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    element.style.pointerEvents = pickingUsable.current && onSelectChapter ? 'auto' : 'none'
    if (!onSelectChapter) cancelPicking.current?.()
  }, [onSelectChapter])

  return <div className="welcome-canvas" ref={host} />
}
