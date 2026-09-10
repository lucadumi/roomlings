import { useEffect, useRef, useState } from 'react'
import { Coffee, Eye, EyeOff, Maximize, Minus, Moon, Move, Plus, Snowflake, Sun } from 'lucide-react'
import {
  ACESFilmicToneMapping, BoxGeometry, Color, CylinderGeometry,
  DodecahedronGeometry, Group, MathUtils,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PCFShadowMap,
  PlaneGeometry, Raycaster, Scene, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer,
} from 'three'
import type { BufferGeometry } from 'three'
import type { Category } from '../shared/domain.ts'
import { categoryLabels } from '../shared/domain.ts'
import { roomSlots } from '../shared/roomComponents.ts'
import { kitchenUtilities, kitchenUtilityAnchors, sceneAnchors } from './room.ts'
import type { KitchenAction, KitchenUtility, SceneAction } from './room.ts'
import { buildKitchenModel } from './kitchenModel.ts'
import { baseCameraOffset, cameraFraming, cameraProjection, fitRoomBounds, focusLabels, roomCameraZoom } from './camera.ts'
import type { SceneFocus } from './camera.ts'
import { batchStaticMeshes } from './batchStaticMeshes.ts'
import { createContactShadowTexture, createRoomLights, daylight, eveningLight } from './lighting.ts'
import { dampTo, frameSeconds } from './motion.ts'
import {
  componentAccessibleName, componentAtSlot, componentLabel, createRoomComponentScene, installedRoomComponents, isSceneObjectVisible,
  kitchenActionSlots, kitchenUtilitySlots,
} from './roomComponentScene.ts'
import type { RoomWorldProps } from './roomViewTypes.ts'

type Target = { category: Category } | { action: SceneAction } | { utility: KitchenUtility } | { componentId: string }
const targetLabels: Record<SceneAction, string> = {
  fridge: 'Open or close your fridge',
  stock: 'Open the shared shopping list',
  ledger: 'Open the receipt book',
  budget: 'Check the house pot',
  roommates: 'Meet your roommates',
  settle: 'Make things even',
  light: 'Change the kitchen lighting',
  brew: 'Put the kettle on',
}

type WorldControls = {
  open: boolean
  evening: boolean
  zoom: number
  focus: SceneFocus
  wholeRoom: boolean
  wake: (duration?: number) => void
  focusOn: (target: SceneFocus) => void
  reset: () => void
  brew: () => void
}

export default function KitchenWorld({
  roomStyle, paused, panelOpen, focusRequest, counts, selected, fundFraction, memberCount, expenseCount, stockEvent,
  onSelect, onAction, onOpenChores, onRestock, dueChores, components, editMode = false, selectedComponentId = null, onComponentSelect, overviewFocus = false,
}: RoomWorldProps) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const labels = useRef(new Map<KitchenAction | 'brew', HTMLButtonElement>())
  const utilityLabels = useRef(new Map<KitchenUtility, HTMLButtonElement>())
  const componentLabels = useRef(new Map<string, HTMLButtonElement>())
  const controls = useRef<WorldControls | null>(null)
  const state = useRef({ roomStyle, paused, panelOpen, focusRequest, counts, selected, fundFraction, memberCount, expenseCount, stockEvent, onSelect, onAction, onOpenChores, onRestock, components, editMode, selectedComponentId, onComponentSelect, overviewFocus })
  const [open, setOpen] = useState(true)
  const [evening, setEvening] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [showLabels, setShowLabels] = useState(true)
  const [hovered, setHovered] = useState<Target | null>(null)
  const hoverRef = useRef(hovered)
  const [unavailable, setUnavailable] = useState(false)
  const [focused, setFocused] = useState<SceneFocus>('room')
  const [fittingRoom, setFittingRoom] = useState(false)
  const [renderingPaused, setRenderingPaused] = useState(false)
  const [cameraMoving, setCameraMoving] = useState(false)
  const [brewing, setBrewing] = useState(false)
  state.current = { roomStyle, paused, panelOpen, focusRequest, counts, selected, fundFraction, memberCount, expenseCount, stockEvent, onSelect, onAction, onOpenChores, onRestock, components, editMode, selectedComponentId, onComponentSelect, overviewFocus }
  hoverRef.current = hovered
  const installed = installedRoomComponents(components, 'kitchen')
  const objectLabels = installed.filter((component) => editMode || !roomSlots.find((slot) => slot.id === component.slotId)?.defaultKind)
  const selectedComponent = installed.find((component) => component.id === selectedComponentId)
  const hoveredComponent = hovered && 'componentId' in hovered ? installed.find((component) => component.id === hovered.componentId) : undefined

  useEffect(() => {
    const element = host.current
    const stageElement = stage.current
    if (!element || !stageElement) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch (error) {
      console.warn('The 3D fridge could not start:', error instanceof Error ? error.message : error)
      setUnavailable(true)
      setRenderingPaused(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.setAttribute('aria-hidden', 'true')
    element.appendChild(renderer.domElement)
    const scene = new Scene()
    const camera = new OrthographicCamera(-7, 7, 5, -5, 0.1, 100)
    camera.position.set(9, 9.5, 13)
    camera.lookAt(-0.1, 1.65, -0.05)
    const { group: lighting, sunlight, skyLight, fill } = createRoomLights()
    scene.add(lighting)
    const dayWindow = new Color(daylight.window)
    const eveningWindow = new Color(eveningLight.window)
    const dayDisc = new Color(daylight.disc)
    const eveningDisc = new Color(eveningLight.disc)
    const room = new Group()
    scene.add(room)
    const { kitchen, scenery, materials, doors, foods, iceTray, interiorLight, foodMaterials, styleMaterials } = buildKitchenModel(room, state.current.roomStyle)
    const shadowTexture = createContactShadowTexture()
    const componentScene = createRoomComponentScene(room, 'kitchen', {
      bindings: scenery.componentBindings, fixtures: scenery.componentFixtures, styleMaterials, shadowTexture,
    })
    componentScene.update(state.current.components, state.current.roomStyle, state.current.editMode ? state.current.selectedComponentId : null)
    // These meshes change individually; animated groups keep their own transforms.
    batchStaticMeshes(room, scenery.preserved)

    const flyingShapes = {
      produce: new DodecahedronGeometry(0.2, 0),
      dairy: new BoxGeometry(0.23, 0.39, 0.23),
      pantry: new CylinderGeometry(0.12, 0.12, 0.32, 7),
      drinks: new CylinderGeometry(0.1, 0.1, 0.3, 8),
      other: new BoxGeometry(0.33, 0.2, 0.3),
    }
    const flyingGroceries = Array.from({ length: 5 }, () => {
      const item = new Mesh<BufferGeometry, MeshStandardMaterial>(flyingShapes.produce, foodMaterials.produce)
      item.visible = false
      item.castShadow = true
      item.userData.roomTransient = true
      room.add(item)
      return item
    })
    const shadowMaterial = new MeshBasicMaterial({
      map: shadowTexture, color: '#535d45', opacity: 0.2, transparent: true, depthWrite: false, toneMapped: false,
    })
    const shadow = new Mesh(new PlaneGeometry(16, 13), shadowMaterial)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0, -0.29, 0.4)
    scene.add(shadow)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let targetRotation = 0
    let moved = false
    let startX = 0
    let startY = 0
    let previousX = 0
    let previousY = 0
    let targetPitch = 0
    const pointers = new Map<number, Vector2>()
    let pinchDistance = 0
    let pinchZoom = 1
    let visible = true
    let contextLost = false
    let initialized = false
    let needsFrame = true
    let needsResize = true
    let frame = 0
    let last = performance.now()
    let entrance = 0
    let countsKey = ''
    let lastStockId: string | null = null
    let stockStarted = -10_000
    let stockCategory: Category = 'produce'
    let lastFocusId = -1
    let lastSelectedComponentId: string | null = null
    let activeUntil = performance.now() + (reducedMotion.matches ? 0 : 1000)
    let brewStarted = -20_000
    let wasBrewing = false
    let wasMoving = false
    let wasAnimating = false
    let wasPaused = false
    let visualKey = ''
    let halfHeight = 4.6
    let cameraPitch = 0
    let lightingMix = 0
    let brewIntensity = 0
    let steamPhase = 0
    let shadowsDirty = true
    let lastShadowFrame = -Infinity
    let displayedMinute = -1
    const viewport = { width: 1, height: 1 }
    const framingArea = { x: 0, y: 0, width: 1, height: 1 }
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const vector = new Vector3()
    const projected = new Vector3()
    const cameraCenter = new Vector3(-0.1, 1.65, -0.05)
    const desiredCenter = new Vector3()
    const desiredCamera = new Vector3()
    const actorsY = new Map([...scenery.actors].map(([action, actor]) => [action, actor.position.y]))
    const wake = (duration = 900) => {
      if (contextLost) return
      needsFrame = true
      activeUntil = Math.max(activeUntil, performance.now() + (reducedMotion.matches ? 0 : duration))
    }
    const motionPreferenceChanged = () => { shadowsDirty = true; activeUntil = performance.now(); wake() }
    reducedMotion.addEventListener('change', motionPreferenceChanged)
    const focusOn = (target: SceneFocus) => {
      currentControls.focus = target
      currentControls.wholeRoom = false
      currentControls.zoom = 1
      setFocused(target)
      setFittingRoom(false)
      setZoom(1)
      wake()
    }
    const currentControls: WorldControls = {
      open: true, evening: false, zoom: 1, focus: 'room', wholeRoom: false, wake, focusOn,
      reset: () => {
        targetRotation = 0
        targetPitch = 0
        focusOn('room')
        currentControls.wholeRoom = true
        setFittingRoom(true)
      },
      brew: () => {
        if (state.current.editMode || !componentAtSlot(state.current.components, 'kitchen-kettle')) return
        brewStarted = performance.now()
        wasBrewing = true
        setBrewing(true)
        focusOn('brew')
        wake(1800)
      },
    }
    controls.current = currentControls
    doors.forEach((door, index) => { door.rotation.y = index ? -1.72 : -1.97 })
    const roomBounds = componentScene.bounds

    const resize = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      if (!width || !height) return
      const sceneBounds = element.getBoundingClientRect()
      const stageBounds = stageElement.getBoundingClientRect()
      if (!stageBounds.width || !stageBounds.height) return
      needsResize = needsResize || viewport.width !== width || viewport.height !== height
      viewport.width = width
      viewport.height = height
      framingArea.x = stageBounds.left - sceneBounds.left
      framingArea.y = stageBounds.top - sceneBounds.top
      framingArea.width = stageBounds.width
      framingArea.height = stageBounds.height
      wake()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    observer.observe(stageElement)
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    visibility.observe(element)
    const hitTarget = (event: PointerEvent): Target | null => {
      const rect = element.getBoundingClientRect()
      if (!initialized || contextLost || !rect.width || !rect.height) return null
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const intersections = raycaster.intersectObjects(room.children, true)
      const hit = intersections.find((intersection) => isSceneObjectVisible(intersection.object, room))
      let object = hit?.object
      const component = object ? componentScene.componentForObject(object) : null
      if (component && state.current.onComponentSelect && (state.current.editMode
        || ![...Object.values(kitchenActionSlots), ...Object.values(kitchenUtilitySlots)].some((slot) => slot === component.slotId))) {
        return { componentId: component.id }
      }
      if (state.current.editMode) {
        while (object && object !== room) {
          if (object.userData.action === 'light') {
            const light = componentScene.componentAtSlot('kitchen-light')
            return light && state.current.onComponentSelect ? { componentId: light.id } : null
          }
          object = object.parent ?? undefined
        }
        return null
      }
      while (object && object !== room) {
        if (object.userData.category) return { category: object.userData.category as Category }
        if (object.userData.action) return { action: object.userData.action as SceneAction }
        const utility = kitchenUtilities.find((kind) => kind === object?.userData.utility)
        if (utility) return { utility }
        object = object.parent ?? undefined
      }
      if (component?.slotId === 'kitchen-light') return { action: 'light' }
      return null
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || contextLost) return
      pointers.set(event.pointerId, new Vector2(event.clientX, event.clientY))
      if (pointers.size === 1) {
        startX = previousX = event.clientX
        startY = previousY = event.clientY
        moved = false
      } else {
        const [a, b] = [...pointers.values()]
        pinchDistance = a.distanceTo(b)
        pinchZoom = currentControls.zoom
        moved = true
      }
      wake()
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (contextLost) return
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, new Vector2(event.clientX, event.clientY))
        if (pointers.size > 1) {
          const [a, b] = [...pointers.values()]
          if (pinchDistance > 0) {
            currentControls.zoom = MathUtils.clamp(pinchZoom * a.distanceTo(b) / pinchDistance, 0.65, 1.9)
            setZoom(currentControls.zoom)
            wake()
          }
          return
        }
        const dx = event.clientX - previousX
        const dy = event.clientY - previousY
        moved ||= Math.hypot(event.clientX - startX, event.clientY - startY) > 4
        targetRotation = MathUtils.clamp(targetRotation + dx * 0.004, -0.75, 0.75)
        targetPitch = MathUtils.clamp(targetPitch + dy * 0.015, -1.7, 3)
        previousX = event.clientX
        previousY = event.clientY
        wake()
      } else if (!pointers.size) {
        const target = hitTarget(event)
        setHovered((previous) => JSON.stringify(previous) === JSON.stringify(target) ? previous : target)
        element.style.cursor = target ? 'pointer' : 'grab'
        if (JSON.stringify(hoverRef.current) !== JSON.stringify(target)) wake()
      }
    }
    const finishPointer = (event: PointerEvent, cancelled: boolean) => {
      if (!pointers.has(event.pointerId)) return
      pointers.delete(event.pointerId)
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
      if (pointers.size) {
        const pointer = [...pointers.values()][0]
        previousX = pointer.x
        previousY = pointer.y
        moved = true
        if (pointers.size > 1) {
          const [a, b] = [...pointers.values()]
          pinchDistance = a.distanceTo(b)
          pinchZoom = currentControls.zoom
        }
        return
      }
      if (!cancelled && event.button === 0 && !moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 5) {
        const target = hitTarget(event)
        if (target && 'componentId' in target) state.current.onComponentSelect?.(target.componentId)
        else if (target && 'category' in target) state.current.onSelect(target.category)
        else if (target && 'utility' in target) {
          focusOn(target.utility)
          if (target.utility === 'supplies') state.current.onRestock()
          else state.current.onOpenChores(target.utility === 'chores' ? null : target.utility)
        } else if (target?.action === 'fridge') {
          currentControls.open = !currentControls.open
          setOpen(currentControls.open)
          focusOn('fridge')
        } else if (target?.action === 'light') {
          currentControls.evening = !currentControls.evening
          setEvening(currentControls.evening)
          wake()
        } else if (target?.action === 'brew') {
          currentControls.brew()
        } else if (target) state.current.onAction(target.action)
      }
    }
    const up = (event: PointerEvent) => finishPointer(event, false)
    const leave = () => { setHovered(null); element.style.cursor = 'grab'; wake() }
    const cancel = (event: PointerEvent) => { finishPointer(event, true); leave() }
    const wheel = (event: WheelEvent) => {
      if (contextLost) return
      event.preventDefault()
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1
      currentControls.zoom = MathUtils.clamp(currentControls.zoom * Math.exp(-event.deltaY * units * 0.0015), 0.65, 1.9)
      setZoom(currentControls.zoom)
      wake()
    }
    renderer.domElement.addEventListener('pointerdown', down)
    renderer.domElement.addEventListener('pointermove', move)
    renderer.domElement.addEventListener('pointerup', up)
    renderer.domElement.addEventListener('pointerleave', leave)
    renderer.domElement.addEventListener('pointercancel', cancel)
    renderer.domElement.addEventListener('lostpointercapture', cancel)
    renderer.domElement.addEventListener('wheel', wheel, { passive: false })
    const onContextLost = (event: Event) => {
      event.preventDefault()
      contextLost = true
      cancelAnimationFrame(frame)
      controls.current = null
      pointers.clear()
      setHovered(null)
      setCameraMoving(false)
      setBrewing(false)
      setRenderingPaused(true)
      setUnavailable(true)
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)
    const animate = (now: number) => {
      if (contextLost) return
      frame = requestAnimationFrame(animate)
      const delta = frameSeconds(last, now)
      last = now
      const latest = state.current
      if (!visible || document.hidden) return
      const componentUpdate = componentScene.update(latest.components, latest.roomStyle, latest.editMode && !latest.overviewFocus ? latest.selectedComponentId : null)
      if (componentUpdate.changed) { shadowsDirty ||= componentUpdate.shadowsChanged; wake(0) }
      if (lastSelectedComponentId !== latest.selectedComponentId) {
        lastSelectedComponentId = latest.selectedComponentId
        if (lastSelectedComponentId) {
          currentControls.wholeRoom = false
          currentControls.zoom = 1
          setFittingRoom(false)
          setZoom(1)
        }
        wake()
      }
      if (latest.focusRequest.id !== lastFocusId) {
        lastFocusId = latest.focusRequest.id
        focusOn(latest.focusRequest.target)
      }
      const nextVisualKey = JSON.stringify([latest.counts, latest.selected, latest.fundFraction, latest.memberCount, latest.expenseCount, latest.stockEvent])
      if (nextVisualKey !== visualKey) { visualKey = nextVisualKey; shadowsDirty = true; wake() }
      if (!latest.paused && Math.floor(Date.now() / 60_000) !== displayedMinute) wake(0)
      const isBrewing = !!componentScene.componentAtSlot('kitchen-kettle') && now - brewStarted < 12_000
      if (isBrewing !== wasBrewing) { wasBrewing = isBrewing; setBrewing(isBrewing); wake(300) }
      const resting = (latest.paused || reducedMotion.matches) && !needsFrame && !wasMoving && !wasAnimating && now > activeUntil
      if (resting !== wasPaused) { wasPaused = resting; setRenderingPaused(resting) }
      // Finish transitions before pausing for a panel or reduced motion.
      if (resting) return
      needsFrame = false
      let shadowsMoving = false
      let transitioning = false
      if (needsResize) {
        renderer.setSize(viewport.width, viewport.height)
        needsResize = false
      }
      const key = JSON.stringify(latest.counts)
      if (key !== countsKey) { entrance = now; countsKey = key }
      if (latest.stockEvent && latest.stockEvent.id !== lastStockId) {
        lastStockId = latest.stockEvent.id
        stockStarted = now
        stockCategory = latest.stockEvent.category
        currentControls.open = true
        setOpen(true)
        focusOn('fridge')
        wake(2800)
        flyingGroceries.forEach((item) => {
          item.geometry = flyingShapes[stockCategory]
          item.material = foodMaterials[stockCategory]
        })
      }
      for (const [index, door] of doors.entries()) {
        const target = currentControls.open ? (index ? -1.72 : -1.97) : 0
        const rotation = reducedMotion.matches ? target : dampTo(door.rotation.y, target, 7 - index, delta)
        shadowsMoving ||= door.rotation.y !== rotation
        transitioning ||= rotation !== target
        door.rotation.y = rotation
      }
      const rotation = reducedMotion.matches ? targetRotation : dampTo(room.rotation.y, targetRotation, 9, delta)
      shadowsMoving ||= room.rotation.y !== rotation
      room.rotation.y = rotation
      room.updateMatrixWorld(true)
      cameraPitch = reducedMotion.matches ? targetPitch : dampTo(cameraPitch, targetPitch, 9, delta)
      const area = latest.panelOpen ? framingArea : { x: 0, y: 0, width: viewport.width, height: viewport.height }
      const selectedBounds = !latest.overviewFocus && !currentControls.wholeRoom && latest.selectedComponentId ? componentScene.getBounds(latest.selectedComponentId) : undefined
      const closeRoom = !latest.overviewFocus && !currentControls.wholeRoom && currentControls.focus === 'room' && !selectedBounds
      const framing = selectedBounds
        ? fitRoomBounds(area.width, area.height, selectedBounds, room.rotation.y, cameraPitch)
        : cameraFraming(area.width, area.height, latest.overviewFocus ? 'room' : currentControls.focus, latest.overviewFocus || currentControls.wholeRoom, {
          bounds: roomBounds, rotation: room.rotation.y, pitch: cameraPitch,
        })
      if (selectedBounds) framing.halfHeight = Math.max(2.05, framing.halfHeight)
      desiredCenter.set(...framing.center)
      if (!selectedBounds) desiredCenter.applyMatrix4(room.matrixWorld)
      if (reducedMotion.matches) cameraCenter.copy(desiredCenter)
      else cameraCenter.lerp(desiredCenter, 1 - Math.exp(-9 * delta))
      if (cameraCenter.distanceTo(desiredCenter) < 0.002) cameraCenter.copy(desiredCenter)
      desiredCamera.copy(cameraCenter).add(vector.set(baseCameraOffset[0], baseCameraOffset[1] + cameraPitch, baseCameraOffset[2]))
      camera.position.copy(desiredCamera)
      camera.lookAt(cameraCenter)
      halfHeight = reducedMotion.matches ? framing.halfHeight : dampTo(halfHeight, framing.halfHeight, 9, delta, 0.002)
      const desiredZoom = roomCameraZoom(latest.overviewFocus ? 1 : currentControls.zoom, closeRoom)
      camera.zoom = reducedMotion.matches ? desiredZoom : dampTo(camera.zoom, desiredZoom, 8, delta, 0.002)
      const projection = cameraProjection(viewport.width, viewport.height, area, halfHeight, camera.zoom)
      camera.left = projection.left
      camera.right = projection.right
      camera.top = projection.top
      camera.bottom = projection.bottom
      camera.updateProjectionMatrix()
      const moving = cameraCenter.distanceTo(desiredCenter) > 0.002 || cameraPitch !== targetPitch
        || halfHeight !== framing.halfHeight || camera.zoom !== desiredZoom || room.rotation.y !== targetRotation
      if (moving !== wasMoving) { wasMoving = moving; setCameraMoving(moving) }
      if (moving) activeUntil = Math.max(activeUntil, now + 120)
      for (const item of foods) {
        const count = latest.counts[item.category]
        item.group.visible = count > 0 && item.index < Math.min(count + 1, 3)
        const highlighted = latest.selected === 'all' || latest.selected === item.category
        const scale = highlighted ? 1 : 0.88
        const age = (now - entrance) / 1000
        const bounce = reducedMotion.matches ? 0 : Math.sin(Math.min(age, 1) * Math.PI * 2) * Math.max(0, 1 - age) * 0.09
        const nextScale = reducedMotion.matches ? scale : dampTo(item.group.scale.x, scale, 8, delta)
        transitioning ||= item.group.visible && (nextScale !== scale || (!reducedMotion.matches && age < 1))
        shadowsMoving ||= item.group.visible && (item.group.position.y !== item.baseline + bounce || item.group.scale.x !== nextScale)
        item.group.position.y = item.baseline + bounce
        item.group.scale.setScalar(nextScale)
      }
      for (const [index, item] of flyingGroceries.entries()) {
        const age = (now - stockStarted) / 1000 - index * 0.18
        const visible = !reducedMotion.matches && age >= 0 && age < 1.65
        shadowsMoving ||= item.visible !== visible || visible
        item.visible = visible
        if (!item.visible) continue
        const t = MathUtils.clamp(age / 1.65, 0, 1)
        const ease = t * t * (3 - 2 * t)
        const shelf = { produce: 0.95, dairy: 2.25, pantry: 1.6, drinks: 2.25, other: 2.9 }[stockCategory]
        item.position.set(
          MathUtils.lerp(-0.4, kitchen.position.x + (index - 2) * 0.19, ease),
          MathUtils.lerp(2.4, shelf, ease) + Math.sin(t * Math.PI) * 1.6,
          MathUtils.lerp(1.1, kitchen.position.z + 0.3, ease),
        )
        item.rotation.set(age * 2, age * 4 + index, Math.sin(age * 3) * 0.3)
        item.scale.setScalar(0.7 + Math.sin(t * Math.PI) * 0.5)
      }
      scenery.coins.forEach((coin, index) => {
        const target = index < Math.ceil(MathUtils.clamp(latest.fundFraction, 0, 1) * 12) ? 1 : 0
        const scale = reducedMotion.matches ? target : dampTo(coin.scale.x, target, 9, delta)
        shadowsMoving ||= coin.scale.x !== scale
        transitioning ||= scale !== target
        coin.scale.setScalar(scale < 0.001 ? 0 : scale)
        coin.visible = scale > 0.001
      })
      scenery.portraits.forEach((portrait, index) => { portrait.visible = index < latest.memberCount })
      scenery.receipts.forEach((receipt, index) => { receipt.visible = index < latest.expenseCount })
      scenery.receiptLines.visible = latest.expenseCount > 0
      scenery.receiptLines.position.y = 0.043 + Math.min(latest.expenseCount, 10) * 0.012
      const brewTarget = isBrewing && !reducedMotion.matches ? 1 : 0
      brewIntensity = reducedMotion.matches ? 0 : dampTo(brewIntensity, brewTarget, 4, delta)
      transitioning ||= brewIntensity !== brewTarget
      steamPhase = (steamPhase + delta / MathUtils.lerp(3.5, 1.7, brewIntensity)) % 1
      scenery.steam.forEach((puff, index) => {
        const phase = (steamPhase + index / 3) % 1
        const fade = Math.sin(phase * Math.PI)
        puff.visible = !reducedMotion.matches
        puff.position.y = 0.44 + phase * MathUtils.lerp(0.65, 1.05, brewIntensity)
        puff.position.x = 0.33 + Math.sin(phase * 4) * 0.06
        puff.scale.setScalar(0.4 + fade * MathUtils.lerp(1.3, 2, brewIntensity))
        puff.material.opacity = fade * fade * MathUtils.lerp(0.18, 0.3, brewIntensity)
      })
      const lidHeight = 0.39 + Math.abs(Math.sin(now / 140)) * 0.012 * brewIntensity
      shadowsMoving ||= scenery.kettleLid.position.y !== lidHeight
      scenery.kettleLid.position.y = lidHeight
      scenery.plants.forEach((plant, index) => { plant.rotation.z = reducedMotion.matches ? 0 : Math.sin(now / 2500 + index) * 0.025 })
      const hoveredTarget = hoverRef.current
      for (const [action, actor] of scenery.actors) {
        const lifted = hoveredTarget && 'action' in hoveredTarget && hoveredTarget.action === action
        const base = actorsY.get(action) ?? 0
        const previousY = actor.position.y
        const previousRotation = actor.rotation.z
        const targetY = base + (lifted && action !== 'light' && !reducedMotion.matches ? 0.06 : 0)
        actor.position.y = reducedMotion.matches ? base : dampTo(actor.position.y, targetY, 10, delta)
        transitioning ||= actor.position.y !== targetY
        if (action === 'stock' && now - stockStarted < 2400 && !reducedMotion.matches) {
          const age = (now - stockStarted) / 1000
          actor.position.y = base + Math.abs(Math.sin(age * 7)) * Math.max(0, 1 - age / 2.4) * 0.13
          actor.rotation.z = Math.sin(age * 9) * Math.max(0, 1 - age / 2.4) * 0.025
        } else if (action === 'stock') {
          actor.rotation.z = 0
        }
        shadowsMoving ||= actor.position.y !== previousY || actor.rotation.z !== previousRotation
      }
      const targetLighting = currentControls.evening ? 1 : 0
      lightingMix = reducedMotion.matches ? targetLighting : dampTo(lightingMix, targetLighting, 4, delta)
      transitioning ||= lightingMix !== targetLighting
      sunlight.intensity = MathUtils.lerp(daylight.sun, eveningLight.sun, lightingMix)
      skyLight.intensity = MathUtils.lerp(daylight.sky, eveningLight.sky, lightingMix)
      fill.intensity = MathUtils.lerp(daylight.fill, eveningLight.fill, lightingMix)
      scenery.light.intensity = MathUtils.lerp(daylight.lamp, eveningLight.lamp, lightingMix)
      scenery.bulb.emissiveIntensity = MathUtils.lerp(daylight.bulb, eveningLight.bulb, lightingMix)
      scenery.sky.color.lerpColors(dayWindow, eveningWindow, lightingMix)
      scenery.windowDisc.color.lerpColors(dayDisc, eveningDisc, lightingMix)
      scenery.windowDisc.emissiveIntensity = lightingMix * 0.35
      const time = new Date()
      displayedMinute = Math.floor(time.getTime() / 60_000)
      scenery.hourHand.rotation.z = -((time.getHours() % 12 + time.getMinutes() / 60) / 12) * Math.PI * 2
      scenery.minuteHand.rotation.z = -(time.getMinutes() / 60) * Math.PI * 2
      iceTray.visible = latest.counts.other === 0
      const fridgeLight = currentControls.open ? 0.6 : 0
      interiorLight.intensity = reducedMotion.matches ? fridgeLight : dampTo(interiorLight.intensity, fridgeLight, 8, delta)
      transitioning ||= interiorLight.intensity !== fridgeLight
      wasAnimating = transitioning
      // Cache the shadow pass between interactions; the small idle leaf sway only needs a 4 Hz refresh.
      sunlight.shadow.needsUpdate = shadowsDirty || shadowsMoving || (!reducedMotion.matches && now - lastShadowFrame >= 250)
      if (sunlight.shadow.needsUpdate) { lastShadowFrame = now; shadowsDirty = false }
      renderer.render(scene, camera)
      initialized = true
      for (const anchor of sceneAnchors) {
        const label = labels.current.get(anchor.action)
        if (!label) continue
        projected.set(...anchor.position).applyMatrix4(room.matrixWorld).project(camera)
        const x = (projected.x * 0.5 + 0.5) * viewport.width
        const y = (-projected.y * 0.5 + 0.5) * viewport.height
        const insetX = Math.max(18, label.offsetWidth / 2)
        const insetY = Math.max(18, label.offsetHeight / 2)
        label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
        label.style.visibility = projected.z > -1 && projected.z < 1
          && x > area.x + insetX && x < area.x + area.width - insetX
          && y > area.y + insetY && y < area.y + area.height - insetY ? 'visible' : 'hidden'
      }
      for (const anchor of kitchenUtilityAnchors) {
        const label = utilityLabels.current.get(anchor.utility)
        if (!label) continue
        projected.set(...anchor.position).applyMatrix4(room.matrixWorld).project(camera)
        const x = (projected.x * 0.5 + 0.5) * viewport.width
        const y = (-projected.y * 0.5 + 0.5) * viewport.height
        const insetX = Math.max(24, label.offsetWidth / 2)
        const insetY = Math.max(24, label.offsetHeight / 2)
        label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
        label.style.visibility = projected.z > -1 && projected.z < 1
          && x > area.x + insetX && x < area.x + area.width - insetX
          && y > area.y + insetY && y < area.y + area.height - insetY ? 'visible' : 'hidden'
      }
      for (const [id, label] of componentLabels.current) {
        const anchor = componentScene.anchors.get(id)
        if (!anchor || !isSceneObjectVisible(anchor, room)) { label.style.visibility = 'hidden'; continue }
        anchor.getWorldPosition(projected).project(camera)
        const x = (projected.x * 0.5 + 0.5) * viewport.width
        const y = (-projected.y * 0.5 + 0.5) * viewport.height
        const insetX = Math.max(18, label.offsetWidth / 2)
        const insetY = Math.max(18, label.offsetHeight / 2)
        label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
        label.style.visibility = projected.z > -1 && projected.z < 1
          && x > area.x + insetX && x < area.x + area.width - insetX
          && y > area.y + insetY && y < area.y + area.height - insetY ? 'visible' : 'hidden'
      }
    }
    resize()
    frame = requestAnimationFrame(animate)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      visibility.disconnect()
      reducedMotion.removeEventListener('change', motionPreferenceChanged)
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointermove', move)
      renderer.domElement.removeEventListener('pointerup', up)
      renderer.domElement.removeEventListener('pointerleave', leave)
      renderer.domElement.removeEventListener('pointercancel', cancel)
      renderer.domElement.removeEventListener('lostpointercapture', cancel)
      renderer.domElement.removeEventListener('wheel', wheel)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      componentScene.dispose()
      const geometries = new Set<BufferGeometry>(Object.values(flyingShapes))
      scene.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((mat) => mat.dispose())
      shadowMaterial.dispose()
      shadowTexture.dispose()
      sunlight.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      controls.current = null
    }
  }, [])

  // The loop detects component content changes; refreshed copies must not wake a paused scene.
  useEffect(() => { controls.current?.wake(0) }, [showLabels, editMode, selectedComponentId, overviewFocus])

  const toggle = () => {
    if (editMode) {
      const fridge = componentAtSlot(components, 'kitchen-fridge')
      if (fridge) onComponentSelect?.(fridge.id)
      return
    }
    const next = !(controls.current?.open ?? open)
    if (controls.current) controls.current.open = next
    setOpen(next)
    controls.current?.focusOn('fridge')
  }
  const changeZoom = (direction: number) => {
    const next = MathUtils.clamp(Math.round(((controls.current?.zoom ?? zoom) + direction * 0.2) * 100) / 100, 0.65, 1.9)
    if (controls.current) controls.current.zoom = next
    setZoom(next)
    controls.current?.wake()
  }
  const changeLight = () => {
    const next = !(controls.current?.evening ?? evening)
    if (controls.current) controls.current.evening = next
    setEvening(next)
    controls.current?.wake()
  }
  const openUtility = (utility: KitchenUtility) => {
    if (editMode) {
      const component = utility === 'floor' ? undefined : componentAtSlot(components, kitchenUtilitySlots[utility])
      if (component) onComponentSelect?.(component.id)
      return
    }
    controls.current?.focusOn(utility)
    if (utility === 'supplies') onRestock()
    else onOpenChores(utility === 'chores' ? null : utility)
  }

  return (
    <div className="kitchen-world" ref={stage} data-room-style={roomStyle} data-evening={evening} data-focus={overviewFocus ? 'room' : focused} data-framing={overviewFocus || fittingRoom ? 'whole' : 'close'} data-camera-moving={cameraMoving} data-rendering={renderingPaused ? 'paused' : 'active'} data-edit-mode={editMode} data-component-count={installed.length} data-selected-component={overviewFocus ? undefined : selectedComponentId ?? undefined}>
      <div className="world-canvas" ref={host} role="img" hidden={unavailable} aria-hidden={unavailable} aria-label={editMode
        ? 'Kitchen editing preview. Select an object to edit its settings in its fixed position, or use the room objects list. Drag to turn the room, scroll or pinch to zoom.'
        : 'Interactive low-poly shared kitchen. Select objects to move closer. The shopping bag opens the shared shopping list, the receipt book opens grocery runs, the house pot shows the grocery budget, and the noticeboard holds your roommates. The cleaning caddy opens room chores and the shelf opens kitchen supplies. Drag to turn the room, scroll or pinch to zoom.'} />
      {unavailable && <div className="fridge-unavailable" role="status"><Snowflake size={42} /><strong>Your kitchen, minus the 3D.</strong><p>This browser could not display the kitchen. All household tools still work.</p></div>}
      {!unavailable && <>
        <div className={`world-hotspots${showLabels ? '' : ' hide-labels'}`} aria-label="Objects in your kitchen">
          {!editMode && sceneAnchors.filter((anchor) => componentAtSlot(components, kitchenActionSlots[anchor.action])).map((anchor) => {
            const component = componentAtSlot(components, kitchenActionSlots[anchor.action])
            const label = componentLabel(component, anchor.label)
            return <button key={anchor.action} ref={(element) => { if (element) labels.current.set(anchor.action, element); else labels.current.delete(anchor.action) }} className={`world-hotspot hotspot-${anchor.action}`} aria-label={label} data-component-id={component?.id} data-selected={focused === anchor.action} onClick={() => { if (anchor.action === 'brew') controls.current?.brew(); else onAction(anchor.action) }} onMouseEnter={() => { setHovered({ action: anchor.action }); controls.current?.wake() }} onMouseLeave={() => { setHovered(null); controls.current?.wake() }} onFocus={() => { setHovered({ action: anchor.action }); controls.current?.wake() }} onBlur={() => { setHovered(null); controls.current?.wake() }}><span className="hotspot-dot"><Plus size={12} /></span><span className="hotspot-label">{label}</span></button>
          })}
          {!editMode && kitchenUtilityAnchors.filter((anchor) => anchor.utility === 'floor' || componentAtSlot(components, kitchenUtilitySlots[anchor.utility])).map((anchor) => {
            const component = anchor.utility === 'floor' ? undefined : componentAtSlot(components, kitchenUtilitySlots[anchor.utility])
            const label = `${componentLabel(component, anchor.label)}${anchor.utility === 'sink' && dueChores.sink ? ` (${dueChores.sink} due)` : ''}`
            return <button key={anchor.utility} ref={(element) => { if (element) utilityLabels.current.set(anchor.utility, element); else utilityLabels.current.delete(anchor.utility) }}
              className={`world-hotspot hotspot-${anchor.utility}`} aria-label={label} data-component-id={component?.id} data-selected={focused === anchor.utility}
              onClick={() => openUtility(anchor.utility)}><span className="hotspot-dot"><Plus size={12} /></span><span className="hotspot-label">{label}</span></button>
          })}
          {onComponentSelect && objectLabels.map((component) => <button type="button" key={component.id}
            ref={(element) => { if (element) componentLabels.current.set(component.id, element); else componentLabels.current.delete(component.id) }}
            className="world-hotspot hotspot-component" data-component-id={component.id} data-component-kind={component.kind}
            aria-label={`${editMode ? 'Edit' : 'Open'} ${componentAccessibleName(component, installed)}`} data-selected={!overviewFocus && selectedComponentId === component.id}
            onClick={() => onComponentSelect(component.id)} onMouseEnter={() => setHovered({ componentId: component.id })}
            onMouseLeave={() => setHovered(null)} onFocus={() => setHovered({ componentId: component.id })} onBlur={() => setHovered(null)}>
            <span className="hotspot-dot"><Plus size={12} /></span><span className="hotspot-label">{componentAccessibleName(component, installed)}</span>
          </button>)}
        </div>
        <div className="world-view-label"><span className="view-label-dot" />{overviewFocus ? focusLabels.room : selectedComponent && !fittingRoom ? componentAccessibleName(selectedComponent, installed) : focusLabels[focused]}{cameraMoving && <span className="view-moving">Adjusting view</span>}</div>
        <div className="world-camera-controls"><button className="icon-button" onClick={() => changeZoom(1)} disabled={zoom >= 1.9} aria-label="Zoom in" title="Zoom in"><Plus size={19} /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" onClick={() => changeZoom(-1)} disabled={zoom <= 0.65} aria-label="Zoom out" title="Zoom out"><Minus size={19} /></button><i /><button className="icon-button" onClick={() => controls.current?.reset()} aria-label="Frame the whole room" title="Whole room" aria-pressed={fittingRoom}><Maximize size={18} /></button><button className="icon-button" onClick={() => setShowLabels(!showLabels)} aria-label={showLabels ? 'Hide object labels' : 'Show object labels'} aria-pressed={showLabels} title="Object labels">{showLabels ? <Eye size={18} /> : <EyeOff size={18} />}</button><button className="icon-button" onClick={changeLight} aria-label={evening ? 'Switch to daylight' : 'Switch to evening lighting'} aria-pressed={evening} title="Kitchen lighting">{evening ? <Moon size={18} /> : <Sun size={18} />}</button></div>
        <div className="world-interaction-hint"><Move size={13} />{hovered ? ('componentId' in hovered ? `${editMode ? 'Edit' : 'Open'} ${hoveredComponent ? componentAccessibleName(hoveredComponent, installed) : 'room object'}` : 'category' in hovered ? `${categoryLabels[hovered.category]}: open the receipt book` : 'utility' in hovered ? hovered.utility === 'supplies' ? 'Restock kitchen supplies' : 'Open related chores' : targetLabels[hovered.action]) : editMode ? 'Select an object to edit. Positions stay fixed.' : 'Drag to explore. Select an object to get closer.'}</div>
        {!editMode && componentAtSlot(components, 'kitchen-fridge') && <button className="world-fridge-toggle" onClick={toggle} aria-label={open ? 'Close the fridge' : 'Peek inside'} aria-pressed={open}><Snowflake size={15} />{open ? 'Close the fridge' : 'Peek inside'}<span>{open ? 'Keep it cool' : 'See what is shared'}</span></button>}
        {!editMode && componentAtSlot(components, 'kitchen-kettle') && <button className="world-kettle-toggle" onClick={() => controls.current?.brew()} aria-label="Put the kettle on" aria-pressed={brewing}><Coffee size={16} /><span>{brewing ? 'Kettle is on' : 'Tea break'}</span></button>}
      </>}
    </div>
  )
}
