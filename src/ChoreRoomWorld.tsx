import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ClipboardList, Eye, EyeOff, Maximize, Minus, Moon, Move, PackagePlus, Plus, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  ACESFilmicToneMapping, Color, Group, MathUtils, Mesh, MeshBasicMaterial, OrthographicCamera,
  PCFShadowMap, PlaneGeometry, PointLight, Raycaster, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three'
import type { Box3, BufferGeometry, Material, MeshStandardMaterial, Object3D } from 'three'
import type { RoomStyle } from '../shared/domain.ts'
import type { ComponentKind, RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import type { ChoreArea, RoomId } from '../shared/rooms.ts'
import { batchStaticMeshes } from './batchStaticMeshes.ts'
import { baseCameraOffset, cameraProjection, fitRoomBounds, placementPreviewZoom, preferredRoomRotation, roomEntryFraming, roomFramingArea, usesRoomEntryFraming } from './camera.ts'
import type { SceneFocus } from './camera.ts'
import { createContactShadowTexture, createRoomLights, daylight, eveningLight, fitRoomShadowBounds } from './lighting.ts'
import type { ContactShadow } from './lighting.ts'
import { dampTo, frameSeconds } from './motion.ts'
import {
  componentAccessibleName, componentLabel, createRoomComponentScene, installedRoomComponents, isSceneObjectVisible, visibleRoomBounds,
} from './roomComponentScene.ts'
import type { ComponentBindings, ComponentFixtures } from './roomComponentTypes.ts'
import type { RoomStyleMaterials } from './roomStyles.ts'
import type { RoomWorldProps } from './roomViewTypes.ts'
import { createRoomHologram } from './roomHologram.ts'
import { createPlacementArrow } from './placementArrow.ts'
import './bathroom.css'

type ChoreRoomFocus<Target extends string> = Target | 'room'
type Framing = { center: [number, number, number]; halfHeight: number }

export type ChoreRoomModel<Target extends string> = {
  materials: readonly Material[]
  styleMaterials: RoomStyleMaterials
  actors: ReadonlyMap<Target, Group>
  anchors: ReadonlyMap<Target, Object3D>
  bounds: Box3
  actorBounds: ReadonlyMap<Target, Box3>
  contacts: readonly ContactShadow[]
  lampMaterial: MeshStandardMaterial
  windowMaterials?: { sky: MeshStandardMaterial; disc: MeshStandardMaterial }
  componentBindings: ComponentBindings
  componentFixtures: ComponentFixtures
  preserved?: ReadonlySet<Object3D>
}

export type ChoreRoomConfig<Target extends string> = {
  roomId: RoomId
  targets: readonly Target[]
  targetSlots: Partial<Readonly<Record<Target, RoomSlotId>>>
  targetKinds?: Partial<Readonly<Record<Target, ComponentKind>>>
  labels: Readonly<Record<Target, string>>
  targetKey: string
  entryFocus?: Target
  choresTarget: Target
  suppliesTarget: Target
  focusForRequest: (target: SceneFocus | ChoreRoomFocus<Target>) => ChoreRoomFocus<Target>
  getTargetLabel?: (target: Target, component: RoomComponent | undefined) => string
  getTargetArea: (target: Target) => ChoreArea | null
  buildModel: (room: Group, style: RoomStyle) => ChoreRoomModel<Target>
  framing: (width: number, height: number, bounds: Box3, rotation?: number, pitch?: number, options?: { closeRoom?: boolean }) => Framing
  cameraZoom?: (zoom: number, closeRoom: boolean) => number
  tourFraming: (width: number, height: number, progress: number, bounds: Box3, actorBounds: ReadonlyMap<Target, Box3>, stops: readonly ChoreRoomFocus<Target>[]) => Framing
  reducedTourFraming?: (width: number, height: number, bounds: Box3) => Framing
  minimumFocusHalfHeight?: number
  lampPosition: [number, number, number]
  lampSlot?: RoomSlotId
  icon: LucideIcon
  copy: {
    name: string
    room: string
    preview: string
    interactive: string
    editing: string
    objects: string
    unavailable: string
    restockHint: string
    lighting: string
  }
}

type ChoreRoomControls<Target extends string> = {
  focus: ChoreRoomFocus<Target>
  zoom: number
  evening: boolean
  roomView: boolean
  wake: () => void
  focusOn: (target: ChoreRoomFocus<Target>) => void
  reset: () => void
}

type ChoreRoomHit<Target extends string> = Target | { componentId: string } | { lighting: true }

export type ChoreRoomWorldProps<Target extends string> = Pick<RoomWorldProps,
  'roomStyle' | 'paused' | 'panelOpen' | 'onOpenChores' | 'onRestock' | 'dueChores'
  | 'components' | 'editMode' | 'selectedComponentId' | 'placementPreviewId' | 'onComponentSelect' | 'overviewFocus'> & {
  focusRequest: { target: SceneFocus | ChoreRoomFocus<Target>; id: number }
  preview?: boolean
  motionReduced?: boolean
  onStatus?: (status: 'ready' | 'unavailable') => void
  tour?: { progress: RefObject<number>; wake: RefObject<(() => void) | null>; stops: readonly ChoreRoomFocus<Target>[]; overviewBounds?: Box3 }
}

function componentMatchesTarget<Target extends string>(config: ChoreRoomConfig<Target>, target: Target, component: RoomComponent): boolean {
  return config.targetSlots[target] === component.slotId
    && (!config.targetKinds?.[target] || config.targetKinds[target] === component.kind)
}

function targetComponent<Target extends string>(config: ChoreRoomConfig<Target>, target: Target, components: readonly RoomComponent[]): RoomComponent | undefined {
  return components.find((component) => componentMatchesTarget(config, target, component))
}

function availableFocus<Target extends string>(config: ChoreRoomConfig<Target>, focus: ChoreRoomFocus<Target>, components: readonly RoomComponent[]): ChoreRoomFocus<Target> {
  return focus === 'room' || !config.targetSlots[focus] || targetComponent(config, focus, components) ? focus : 'room'
}

export default function ChoreRoomWorld<Target extends string>({
  config, roomStyle, paused, panelOpen, focusRequest, onOpenChores, onRestock, dueChores,
  preview = false, motionReduced, onStatus, tour, components, editMode = false, selectedComponentId = null, placementPreviewId = null, onComponentSelect, overviewFocus = false,
}: ChoreRoomWorldProps<Target> & { config: ChoreRoomConfig<Target> }) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const labels = useRef(new Map<Target, HTMLButtonElement>())
  const componentLabels = useRef(new Map<string, HTMLButtonElement>())
  const controls = useRef<ChoreRoomControls<Target> | null>(null)
  const state = useRef({ roomStyle, focusRequest, onOpenChores, onRestock, paused, panelOpen, motionReduced, onStatus, tour, components, editMode, selectedComponentId, placementPreviewId, onComponentSelect, overviewFocus })
  state.current = { roomStyle, focusRequest, onOpenChores, onRestock, paused, panelOpen, motionReduced, onStatus, tour, components, editMode, selectedComponentId, placementPreviewId, onComponentSelect, overviewFocus }
  const installed = installedRoomComponents(components, config.roomId)
  const requestedFocus = (target: SceneFocus | ChoreRoomFocus<Target>) =>
    !preview && target === 'room' && config.entryFocus ? config.entryFocus : config.focusForRequest(target)
  const [focused, setFocused] = useState<ChoreRoomFocus<Target>>(() => availableFocus(config, requestedFocus(focusRequest.target), installed))
  const [zoom, setZoom] = useState(1)
  const [evening, setEvening] = useState(false)
  const [roomViewReset, setRoomViewReset] = useState(preview || focused !== requestedFocus(focusRequest.target))
  const [showLabels, setShowLabels] = useState(true)
  const [hovered, setHovered] = useState<ChoreRoomHit<Target> | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [cameraMoving, setCameraMoving] = useState(false)
  const [renderingPaused, setRenderingPaused] = useState(false)
  const placementPreview = !preview && !tour && editMode && installed.some((component) => component.id === placementPreviewId)
  const placementLabelsHidden = !preview && !tour && editMode && !!placementPreviewId
  const labelsShown = showLabels && !placementLabelsHidden
  const objectLabels = installed.filter((component) => editMode || !config.targets.some((target) => componentMatchesTarget(config, target, component)))
  const selectedComponent = installed.find((component) => component.id === selectedComponentId)
  const hoveredComponent = hovered && typeof hovered !== 'string' && 'componentId' in hovered
    ? installed.find((component) => component.id === hovered.componentId) : undefined
  const hoveredTarget = typeof hovered === 'string' && availableFocus(config, hovered, installed) === hovered ? hovered : null
  const RoomIcon = config.icon

  const activate = (target: ChoreRoomHit<Target>) => {
    const latest = state.current
    if (preview && latest.paused) return
    const current = installedRoomComponents(latest.components, config.roomId)
    if (typeof target !== 'string') {
      if ('lighting' in target) { changeLight(); return }
      if (current.some((component) => component.id === target.componentId)) latest.onComponentSelect?.(target.componentId)
      return
    }
    const component = targetComponent(config, target, current)
    if (latest.editMode) {
      if (component) latest.onComponentSelect?.(component.id)
      return
    }
    controls.current?.focusOn(target)
    if (target === config.suppliesTarget) latest.onRestock()
    else if (target === config.choresTarget || !config.targetSlots[target] || component) latest.onOpenChores(config.getTargetArea(target))
    else {
      const substitute = current.find((item) => item.slotId === config.targetSlots[target])
      if (substitute) latest.onComponentSelect?.(substitute.id)
    }
  }

  useEffect(() => {
    const element = host.current
    const stageElement = stage.current
    if (!element || !stageElement) return
    const container = element
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch (error) {
      console.warn(`The 3D ${config.copy.name} could not start:`, error instanceof Error ? error.message : error)
      setUnavailable(true)
      setRenderingPaused(true)
      state.current.onStatus?.('unavailable')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.setClearColor(0x000000, 0)
    const canvas = renderer.domElement
    canvas.setAttribute('aria-hidden', 'true')
    element.appendChild(canvas)
    const scene = new Scene()
    const camera = new OrthographicCamera(-7, 7, 5, -5, 0.1, 100)
    const room = new Group()
    scene.add(room)
    const model = config.buildModel(room, state.current.roomStyle)
    const shadowTexture = createContactShadowTexture()
    const componentScene = createRoomComponentScene(room, config.roomId, {
      bindings: model.componentBindings, fixtures: model.componentFixtures, styleMaterials: model.styleMaterials, shadowTexture,
    })
    componentScene.update(state.current.components, state.current.roomStyle,
      state.current.editMode && state.current.selectedComponentId !== state.current.placementPreviewId ? state.current.selectedComponentId : null)
    batchStaticMeshes(room, model.preserved ?? new Set())
    const lightingBounds = componentScene.bounds.clone()
    const { group: lighting, sunlight, skyLight, fill } = createRoomLights(lightingBounds)
    const dayWindow = new Color(daylight.window)
    const nightWindow = new Color(eveningLight.window)
    const dayDisc = new Color(daylight.disc)
    const nightDisc = new Color(eveningLight.disc)
    const lamp = new PointLight('#ffe6bc', 0, 12, 2)
    lamp.position.set(...config.lampPosition)
    room.add(lamp)
    scene.add(lighting)
    const shadowMaterial = new MeshBasicMaterial({
      map: shadowTexture, color: '#535d45', opacity: 0.2, transparent: true, depthWrite: false, toneMapped: false,
    })
    const roomSize = componentScene.bounds.getSize(new Vector3())
    const roomMiddle = componentScene.bounds.getCenter(new Vector3())
    const shadow = new Mesh(new PlaneGeometry(roomSize.x + 4, roomSize.z + 4), shadowMaterial)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(roomMiddle.x, -0.285, roomMiddle.z)
    scene.add(shadow)
    const hologram = createRoomHologram(room, shadow)
    const placementArrow = createPlacementArrow(room)
    scene.add(placementArrow.object)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const projected = new Vector3()
    const cameraCenter = new Vector3()
    const desiredCenter = new Vector3()
    const offset = new Vector3()
    const pointers = new Map<number, Vector2>()
    const viewport = { width: 1, height: 1 }
    const area = { x: 0, y: 0, width: 1, height: 1 }
    let frame = 0
    let last = performance.now()
    let disposed = false
    let contextLost = false
    let visible = true
    let drawing = false
    let dirty = true
    let initialized = false
    let needsResize = true
    let shadowsDirty = true
    let targetRotation = 0
    let targetPitch = 0
    let pitch = 0
    let halfHeight = 1
    let lightMix = 0
    let lastFocusId = state.current.focusRequest.id
    let lastSelectedComponentKey: string | null = null
    let moved = false
    let startX = 0
    let startY = 0
    let previousX = 0
    let previousY = 0
    let pinchDistance = 0
    let pinchZoom = 1
    let displayedProgress = state.current.tour?.progress.current ?? 0
    const tourActorBounds = new Map(model.actorBounds)
    let tourBoundsDirty = true

    const wake = () => {
      dirty = true
      if (disposed || contextLost || document.hidden || !visible || frame || drawing) return
      last = performance.now()
      setRenderingPaused(false)
      frame = requestAnimationFrame(animate)
    }
    const initialFocus = requestedFocus(state.current.focusRequest.target)
    const currentControls: ChoreRoomControls<Target> = {
      focus: availableFocus(config, initialFocus, installedRoomComponents(state.current.components, config.roomId)),
      zoom: 1, evening: false, roomView: roomViewReset, wake,
      focusOn(target) {
        const focus = availableFocus(config, target, installedRoomComponents(state.current.components, config.roomId))
        currentControls.focus = focus
        currentControls.zoom = 1
        currentControls.roomView = (preview && focus === 'room') || focus !== target
        setFocused(focus)
        setRoomViewReset(currentControls.roomView)
        setZoom(1)
        wake()
      },
      reset() {
        const focus = availableFocus(config, config.entryFocus ?? 'room', installedRoomComponents(state.current.components, config.roomId))
        currentControls.focus = focus
        currentControls.zoom = 1
        currentControls.roomView = true
        const pendingId = state.current.editMode ? state.current.placementPreviewId : null
        const pendingActor = pendingId ? componentScene.actors.get(pendingId) : undefined
        targetRotation = preferredRoomRotation(pendingActor ? componentScene.componentForObject(pendingActor)?.slotId : undefined)
        targetPitch = 0
        setFocused(focus)
        setRoomViewReset(true)
        setZoom(1)
        wake()
      },
    }
    controls.current = currentControls
    if (tour) tour.wake.current = wake
    const measure = () => {
      const canvasBounds = element.getBoundingClientRect()
      const stageBounds = stageElement.getBoundingClientRect()
      if (!canvasBounds.width || !canvasBounds.height || !stageBounds.width || !stageBounds.height) return false
      needsResize ||= viewport.width !== canvasBounds.width || viewport.height !== canvasBounds.height
      viewport.width = canvasBounds.width
      viewport.height = canvasBounds.height
      Object.assign(area, roomFramingArea(canvasBounds, stageBounds,
        stageElement.parentElement?.querySelector('.world-camera-controls')?.getBoundingClientRect()))
      return true
    }
    const resize = () => { measure(); wake() }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    observer.observe(stageElement)
    const stopDrawing = () => {
      cancelAnimationFrame(frame)
      frame = 0
      if (preview) { pointers.clear(); moved = true }
      setRenderingPaused(true)
    }
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) wake()
      else stopDrawing()
    })
    visibility.observe(stageElement)
    const visibilityChanged = () => { if (document.hidden) stopDrawing(); else wake() }

    function animate(now: number) {
      frame = 0
      if (disposed || contextLost || document.hidden || !visible || !measure()) {
        setRenderingPaused(true)
        return
      }
      drawing = true
      dirty = false
      const delta = frameSeconds(last, now)
      last = now
      const latest = state.current
      hologram.prepareUpdate()
      const latestInstalled = installedRoomComponents(latest.components, config.roomId)
      const previewId = latest.editMode && !preview && !latest.tour ? latest.placementPreviewId : null
      const componentUpdate = componentScene.update(latest.components, latest.roomStyle,
        latest.editMode && !latest.overviewFocus && latest.selectedComponentId !== previewId ? latest.selectedComponentId : null)
      const placementCandidate = previewId ? componentScene.actors.get(previewId) ?? null : null
      if (placementCandidate && placementCandidate !== hologram.candidate) { currentControls.zoom = placementPreviewZoom; setZoom(placementPreviewZoom) }
      shadowsDirty ||= componentUpdate.shadowsChanged
      tourBoundsDirty ||= componentUpdate.changed
      if (!lightingBounds.equals(componentScene.bounds)) {
        lightingBounds.copy(componentScene.bounds)
        fitRoomShadowBounds(sunlight, lightingBounds)
        shadowsDirty = true
      }
      const selectedActor = placementCandidate ?? (latest.selectedComponentId ? componentScene.actors.get(latest.selectedComponentId) : undefined)
      const selectedObject = selectedActor ? componentScene.componentForObject(selectedActor) : null
      const selectedKey = selectedObject ? `${selectedObject.id}:${selectedObject.slotId}` : null
      if (lastSelectedComponentKey !== selectedKey) {
        lastSelectedComponentKey = selectedKey
        if (selectedObject) {
          currentControls.roomView = false
          currentControls.zoom = placementCandidate ? placementPreviewZoom : 1
          targetRotation = preferredRoomRotation(selectedObject.slotId)
          setRoomViewReset(false)
          setZoom(currentControls.zoom)
        }
      }
      if (latest.focusRequest.id !== lastFocusId) {
        lastFocusId = latest.focusRequest.id
        currentControls.focusOn(requestedFocus(latest.focusRequest.target))
      }
      if (availableFocus(config, currentControls.focus, latestInstalled) !== currentControls.focus) {
        currentControls.focusOn(currentControls.focus)
      }
      if (needsResize) {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(viewport.width, viewport.height)
        needsResize = false
      }
      const reduced = latest.motionReduced ?? reducedMotion.matches
      const snap = !initialized || reduced
      if (latest.tour) {
        displayedProgress = snap ? latest.tour.progress.current : dampTo(displayedProgress, latest.tour.progress.current, 9, delta, 0.0001)
        container.dataset.tourPosition = reduced ? 'static' : displayedProgress.toFixed(3)
      }
      const rotation = snap ? targetRotation : dampTo(room.rotation.y, targetRotation, 9, delta)
      shadowsDirty ||= rotation !== room.rotation.y
      room.rotation.y = rotation
      room.updateMatrixWorld(true)
      pitch = snap ? targetPitch : dampTo(pitch, targetPitch, 9, delta)
      const framedFocus = placementCandidate || latest.overviewFocus || (preview && (latest.motionReduced ?? reducedMotion.matches)) ? 'room' : currentControls.focus
      const focusedComponent = framedFocus === 'room' ? undefined : targetComponent(config, framedFocus, latestInstalled)
      const bounds = framedFocus === 'room' ? componentScene.bounds
        : focusedComponent ? componentScene.getBounds(focusedComponent.id) ?? componentScene.bounds
          : model.actorBounds.get(framedFocus) ?? componentScene.bounds
      const selectedBounds = !placementCandidate && !latest.overviewFocus && !preview && !currentControls.roomView && latest.selectedComponentId
        ? componentScene.getBounds(latest.selectedComponentId) : undefined
      const atEntryFocus = !!config.entryFocus && framedFocus === config.entryFocus
      const closeRoom = usesRoomEntryFraming({
        focus: atEntryFocus ? 'room' : framedFocus, selectedComponentId: latest.selectedComponentId, resetView: currentControls.roomView,
        panelOpen: latest.panelOpen, overviewFocus: latest.overviewFocus, placementPreview: !!placementCandidate, publicPreview: preview,
      })
      const frameArea = closeRoom && !latest.panelOpen ? { x: 0, y: 0, width: viewport.width, height: viewport.height } : area
      const tourBounds = latest.tour?.overviewBounds ?? componentScene.bounds
      const placementBounds = placementCandidate ? visibleRoomBounds(room, placementCandidate) : null
      if (latest.tour && tourBoundsDirty) {
        for (const target of config.targets) {
          if (!config.targetSlots[target]) continue
          const component = targetComponent(config, target, latestInstalled)
          tourActorBounds.set(target, component ? componentScene.getBounds(component.id) ?? componentScene.bounds : componentScene.bounds)
        }
        tourBoundsDirty = false
      }
      const configuredEntry = closeRoom && atEntryFocus
        ? config.framing(viewport.width, viewport.height, bounds, room.rotation.y, pitch) : null
      if (configuredEntry) {
        configuredEntry.halfHeight = Math.max(config.minimumFocusHalfHeight ?? 0, configuredEntry.halfHeight) * frameArea.height / viewport.height
      }
      const framing = selectedBounds
        ? fitRoomBounds(frameArea.width, frameArea.height, selectedBounds, room.rotation.y, pitch)
        : preview && latest.tour
        ? reduced ? (config.reducedTourFraming ?? config.framing)(frameArea.width, frameArea.height, tourBounds)
          : config.tourFraming(frameArea.width, frameArea.height, displayedProgress, tourBounds, tourActorBounds, latest.tour.stops)
        : closeRoom ? configuredEntry ?? roomEntryFraming(viewport.width, viewport.height, frameArea, room.rotation.y)
          : config.framing(frameArea.width, frameArea.height, bounds, room.rotation.y, pitch)
      if (selectedBounds) framing.halfHeight = Math.max(2.05, framing.halfHeight)
      else if (!preview && !closeRoom && framedFocus !== 'room') framing.halfHeight = Math.max(config.minimumFocusHalfHeight ?? 0, framing.halfHeight)
      if (preview) {
        container.dataset.cameraAngle = baseCameraOffset.join(',')
        container.dataset.cameraScale = framing.halfHeight.toFixed(6)
      }
      desiredCenter.set(...framing.center)
      if (placementBounds && !currentControls.roomView) {
        desiredCenter.lerp(placementBounds.getCenter(offset).applyMatrix4(room.matrixWorld), 0.35)
      }
      if (snap) cameraCenter.copy(desiredCenter)
      else cameraCenter.lerp(desiredCenter, 1 - Math.exp(-9 * delta))
      if (cameraCenter.distanceTo(desiredCenter) < 0.002) cameraCenter.copy(desiredCenter)
      halfHeight = snap ? framing.halfHeight : dampTo(halfHeight, framing.halfHeight, 9, delta, 0.002)
      const displayedZoom = latest.overviewFocus ? 1 : currentControls.zoom
      const desiredZoom = config.cameraZoom ? config.cameraZoom(displayedZoom, closeRoom) : displayedZoom
      camera.zoom = snap ? desiredZoom : dampTo(camera.zoom, desiredZoom, 9, delta, 0.002)
      camera.position.copy(cameraCenter).add(offset.set(baseCameraOffset[0], baseCameraOffset[1] + pitch, baseCameraOffset[2]))
      camera.lookAt(cameraCenter)
      const projection = cameraProjection(viewport.width, viewport.height, frameArea, halfHeight, camera.zoom)
      camera.left = projection.left
      camera.right = projection.right
      camera.top = projection.top
      camera.bottom = projection.bottom
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld(true)
      const desiredLight = currentControls.evening ? 1 : 0
      lightMix = snap ? desiredLight : dampTo(lightMix, desiredLight, 7, delta)
      sunlight.intensity = MathUtils.lerp(daylight.sun, eveningLight.sun, lightMix)
      skyLight.intensity = MathUtils.lerp(daylight.sky, eveningLight.sky, lightMix)
      fill.intensity = MathUtils.lerp(daylight.fill, eveningLight.fill, lightMix)
      const lampInstalled = !config.lampSlot || !!componentScene.componentAtSlot(config.lampSlot)
      lamp.intensity = lampInstalled ? eveningLight.lamp * 0.45 * lightMix : 0
      model.lampMaterial.emissiveIntensity = 0.2 + lightMix * 0.8
      if (model.windowMaterials) {
        model.windowMaterials.sky.color.lerpColors(dayWindow, nightWindow, lightMix)
        model.windowMaterials.sky.emissive.copy(model.windowMaterials.sky.color)
        model.windowMaterials.disc.color.lerpColors(dayDisc, nightDisc, lightMix)
        model.windowMaterials.disc.emissive.copy(nightDisc)
        model.windowMaterials.disc.emissiveIntensity = lightMix * 0.2
      }
      const hologramUpdate = hologram.update(placementCandidate, componentScene.actors.values())
      shadowsDirty ||= hologramUpdate.shadowsChanged
      const arrowAnimating = placementArrow.update(placementBounds, now, !reduced && !latest.paused)
      const arrowVisible = String(placementArrow.object.visible)
      if (canvas.dataset.placementArrow !== arrowVisible) canvas.dataset.placementArrow = arrowVisible
      sunlight.shadow.needsUpdate = shadowsDirty
      renderer.shadowMap.needsUpdate = shadowsDirty
      renderer.render(scene, camera)
      shadowsDirty = false
      if (!initialized) latest.onStatus?.('ready')
      initialized = true
      for (const [target, originalAnchor] of model.anchors) {
        const button = labels.current.get(target)
        if (!button) continue
        const component = targetComponent(config, target, latestInstalled)
        if (config.targetSlots[target] && !component) { button.style.visibility = 'hidden'; continue }
        const anchor = component ? componentScene.anchors.get(component.id) ?? originalAnchor : originalAnchor
        if (!isSceneObjectVisible(anchor, room)) { button.style.visibility = 'hidden'; continue }
        anchor.getWorldPosition(projected).project(camera)
        const x = (projected.x * 0.5 + 0.5) * viewport.width
        const y = (-projected.y * 0.5 + 0.5) * viewport.height
        const insetX = Math.max(18, button.offsetWidth / 2)
        const insetY = Math.max(18, button.offsetHeight / 2)
        button.style.left = `${x}px`
        button.style.top = `${y}px`
        button.style.transform = 'translate(-50%, -50%)'
        button.style.visibility = projected.z > -1 && projected.z < 1
          && x > area.x + insetX && x < area.x + area.width - insetX
          && y > area.y + insetY && y < area.y + area.height - insetY ? 'visible' : 'hidden'
      }
      for (const [id, button] of componentLabels.current) {
        const anchor = componentScene.anchors.get(id)
        if (!anchor || !isSceneObjectVisible(anchor, room)) { button.style.visibility = 'hidden'; continue }
        anchor.getWorldPosition(projected).project(camera)
        const x = (projected.x * 0.5 + 0.5) * viewport.width
        const y = (-projected.y * 0.5 + 0.5) * viewport.height
        const insetX = Math.max(18, button.offsetWidth / 2)
        const insetY = Math.max(18, button.offsetHeight / 2)
        button.style.left = `${x}px`
        button.style.top = `${y}px`
        button.style.transform = 'translate(-50%, -50%)'
        button.style.visibility = projected.z > -1 && projected.z < 1
          && x > area.x + insetX && x < area.x + area.width - insetX
          && y > area.y + insetY && y < area.y + area.height - insetY ? 'visible' : 'hidden'
      }
      const moving = room.rotation.y !== targetRotation || pitch !== targetPitch
        || !cameraCenter.equals(desiredCenter) || halfHeight !== framing.halfHeight || camera.zoom !== desiredZoom
        || !!latest.tour && !reduced && displayedProgress !== latest.tour.progress.current
      setCameraMoving(moving)
      drawing = false
      if (moving || lightMix !== desiredLight || dirty || arrowAnimating) frame = requestAnimationFrame(animate)
      else setRenderingPaused(true)
    }

    const hitTarget = (event: PointerEvent): ChoreRoomHit<Target> | null => {
      const rect = canvas.getBoundingClientRect()
      if (!initialized || contextLost || document.hidden || !visible || (preview && state.current.paused) || !rect.width || !rect.height) return null
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(room, true).find(({ object }) => isSceneObjectVisible(object, room))
      let object = hit?.object
      if (!preview) for (let parent = object; parent && parent !== room; parent = parent.parent ?? undefined) {
        if (parent.userData.roomLightSwitch) return { lighting: true }
      }
      const component = object ? componentScene.componentForObject(object) : null
      if (component) {
        const target = config.targets.find((candidate) => componentMatchesTarget(config, candidate, component))
        if (state.current.editMode || !target) return state.current.onComponentSelect ? { componentId: component.id } : null
        return target
      }
      if (state.current.editMode) return null
      while (object && object !== room) {
        const target = config.targets.find((candidate) => candidate === object?.userData[config.targetKey])
        if (target) {
          const current = installedRoomComponents(state.current.components, config.roomId)
          return availableFocus(config, target, current) === target ? target : null
        }
        object = object.parent ?? undefined
      }
      return null
    }
    const updateZoom = (value: number) => {
      currentControls.zoom = MathUtils.clamp(value, 0.65, 1.9)
      setZoom(currentControls.zoom)
      wake()
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || contextLost || (preview && state.current.paused)) {
        if (preview && pointers.size) moved = true
        return
      }
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
      if (!preview) canvas.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, new Vector2(event.clientX, event.clientY))
        if (preview) {
          moved ||= pointers.size > 1 || Math.hypot(event.clientX - startX, event.clientY - startY) > 4
          return
        }
        if (pointers.size > 1) {
          const [a, b] = [...pointers.values()]
          if (pinchDistance > 0) updateZoom(pinchZoom * a.distanceTo(b) / pinchDistance)
          return
        }
        moved ||= Math.hypot(event.clientX - startX, event.clientY - startY) > 4
        targetRotation = MathUtils.clamp(targetRotation + (event.clientX - previousX) * 0.004, -0.75, 0.75)
        targetPitch = MathUtils.clamp(targetPitch + (event.clientY - previousY) * 0.015, -1.7, 3)
        previousX = event.clientX
        previousY = event.clientY
        wake()
      } else if (!pointers.size) {
        const target = hitTarget(event)
        setHovered(target)
        element.style.cursor = target ? 'pointer' : preview ? 'default' : 'grab'
      }
    }
    const finishPointer = (event: PointerEvent, cancelled: boolean) => {
      if (!pointers.has(event.pointerId)) return
      pointers.delete(event.pointerId)
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      if (pointers.size) {
        const remaining = [...pointers.values()][0]
        previousX = remaining.x
        previousY = remaining.y
        moved = true
        if (pointers.size > 1) {
          const [a, b] = [...pointers.values()]
          pinchDistance = a.distanceTo(b)
          pinchZoom = currentControls.zoom
        }
      } else if (!cancelled && event.button === 0 && !moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 5) {
        const target = hitTarget(event)
        if (target) activate(target)
      }
    }
    const up = (event: PointerEvent) => finishPointer(event, false)
    const cancel = (event: PointerEvent) => finishPointer(event, true)
    const leave = () => {
      if (preview) { pointers.clear(); moved = true }
      setHovered(null)
      element.style.cursor = preview ? 'default' : 'grab'
    }
    const otherPointer = (event: PointerEvent) => {
      if (pointers.size && !pointers.has(event.pointerId)) moved = true
    }
    const releaseOutside = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) finishPointer(event, true)
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1
      updateZoom(currentControls.zoom * Math.exp(-event.deltaY * units * 0.0015))
    }
    const onContextLost = (event: Event) => {
      event.preventDefault()
      contextLost = true
      stopDrawing()
      controls.current = null
      pointers.clear()
      setUnavailable(true)
      state.current.onStatus?.('unavailable')
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', cancel)
    canvas.addEventListener('lostpointercapture', cancel)
    canvas.addEventListener('pointerleave', leave)
    if (preview) {
      window.addEventListener('pointerdown', otherPointer)
      window.addEventListener('pointerup', releaseOutside)
      window.addEventListener('pointercancel', releaseOutside)
    } else canvas.addEventListener('wheel', wheel, { passive: false })
    canvas.addEventListener('webglcontextlost', onContextLost)
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', visibilityChanged)
    reducedMotion.addEventListener('change', wake)
    resize()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      visibility.disconnect()
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibilityChanged)
      reducedMotion.removeEventListener('change', wake)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', cancel)
      canvas.removeEventListener('lostpointercapture', cancel)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('wheel', wheel)
      if (preview) {
        window.removeEventListener('pointerdown', otherPointer)
        window.removeEventListener('pointerup', releaseOutside)
        window.removeEventListener('pointercancel', releaseOutside)
      }
      canvas.removeEventListener('webglcontextlost', onContextLost)
      placementArrow.dispose()
      hologram.dispose()
      componentScene.dispose()
      const geometries = new Set<BufferGeometry>()
      scene.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
      geometries.forEach((geometry) => geometry.dispose())
      model.materials.forEach((material) => material.dispose())
      shadowMaterial.dispose()
      shadowTexture.dispose()
      sunlight.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      controls.current = null
      if (tour?.wake.current === wake) tour.wake.current = null
    }
  }, [])

  useEffect(() => { controls.current?.wake() }, [roomStyle, paused, panelOpen, focusRequest.id, showLabels, motionReduced, components, editMode, selectedComponentId, placementPreviewId, overviewFocus])

  const changeZoom = (direction: number) => {
    const current = controls.current
    if (!current) return
    current.zoom = MathUtils.clamp(Math.round((current.zoom + direction * 0.2) * 100) / 100, 0.65, 1.9)
    setZoom(current.zoom)
    current.wake()
  }
  const changeLight = () => {
    const current = controls.current
    if (!current) return
    current.evening = !current.evening
    setEvening(current.evening)
    current.wake()
  }

  if (preview) return <div className={`chore-room-preview-world ${config.roomId}-preview-world`} data-focus={focused}
    data-camera-moving={cameraMoving} data-rendering={renderingPaused ? 'paused' : 'active'} data-unavailable={unavailable}>
    <div className={`chore-room-scene-area ${config.roomId}-scene-area`} ref={stage} aria-hidden="true" />
    <div className={`chore-room-preview-canvas ${config.roomId}-preview-canvas`} ref={host} role="img" hidden={unavailable}
      aria-label={config.copy.preview} />
  </div>

  return (
    <div className={`kitchen-world chore-room-world ${config.roomId}-world`} data-room-style={roomStyle} data-evening={evening} data-focus={overviewFocus ? 'room' : focused}
      data-framing={placementPreview || overviewFocus ? 'whole' : 'close'} data-camera-moving={cameraMoving} data-rendering={renderingPaused ? 'paused' : 'active'}
      data-edit-mode={editMode} data-component-count={installed.length} data-selected-component={overviewFocus ? undefined : selectedComponentId ?? undefined}>
      <div className={`chore-room-scene-area ${config.roomId}-scene-area`} ref={stage} aria-hidden="true" />
      <div className="world-canvas" ref={host} role="img" hidden={unavailable} aria-hidden={unavailable}
        aria-label={editMode ? config.copy.editing : config.copy.interactive} />
      {unavailable ? <div className={`chore-room-unavailable ${config.roomId}-unavailable`} role="status"><RoomIcon size={34} /><strong>{config.copy.unavailable}</strong><p>You can still manage chores and restock supplies with the room controls.</p></div> : <>
        {!placementLabelsHidden && <div className={`world-hotspots${showLabels ? '' : ' hide-labels'}`} aria-label={config.copy.objects}>
          {!editMode && config.targets.filter((target) => availableFocus(config, target, installed) === target).map((target) => {
            const component = targetComponent(config, target, installed)
            const area = config.getTargetArea(target)
            const due = area ? dueChores[area] : undefined
            const base = config.getTargetLabel?.(target, component) ?? config.labels[target]
            const label = `${componentLabel(component, base)}${due && due > 0 ? ` (${due} due)` : ''}`
            return <button key={target} type="button" ref={(button) => { if (button) labels.current.set(target, button); else labels.current.delete(target) }}
              className={`world-hotspot hotspot-${target}`} {...{ [`data-${config.roomId}-target`]: target }} data-component-id={component?.id} data-selected={focused === target}
              aria-label={label} onClick={() => activate(target)} onMouseEnter={() => setHovered(target)} onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(target)} onBlur={() => setHovered(null)}>
              <span className="hotspot-dot"><Plus size={12} /></span><span className="hotspot-label">{label}</span>
            </button>
          })}
          {onComponentSelect && objectLabels.map((component) => <button type="button" key={component.id}
            ref={(button) => { if (button) componentLabels.current.set(component.id, button); else componentLabels.current.delete(component.id) }}
            className="world-hotspot hotspot-component" data-component-id={component.id} data-component-kind={component.kind}
            data-selected={!overviewFocus && selectedComponentId === component.id} aria-label={`${editMode ? 'Edit' : 'Open'} ${componentAccessibleName(component, installed)}`}
            onClick={() => activate({ componentId: component.id })} onMouseEnter={() => setHovered({ componentId: component.id })}
            onMouseLeave={() => setHovered(null)} onFocus={() => setHovered({ componentId: component.id })} onBlur={() => setHovered(null)}>
            <span className="hotspot-dot"><Plus size={12} /></span><span className="hotspot-label">{componentAccessibleName(component, installed)}</span>
          </button>)}
        </div>}
        <div className="world-view-label"><span className="view-label-dot" />{overviewFocus ? config.copy.room : selectedComponent && !roomViewReset ? componentAccessibleName(selectedComponent, installed) : focused === 'room' ? config.copy.room : config.labels[focused]}{cameraMoving && <span className="view-moving">Adjusting view</span>}</div>
        <div className="world-camera-controls">
          <button type="button" className="icon-button" onClick={() => changeZoom(1)} disabled={zoom >= 1.9} aria-label="Zoom in" title="Zoom in"><Plus size={19} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="icon-button" onClick={() => changeZoom(-1)} disabled={zoom <= 0.65} aria-label="Zoom out" title="Zoom out"><Minus size={19} /></button>
          <i />
          <button type="button" className="icon-button" onClick={() => controls.current?.reset()} aria-label="Reset room view" title="Reset room view" aria-pressed={roomViewReset && zoom === 1}><Maximize size={18} /></button>
          <button type="button" className="icon-button" onClick={() => setShowLabels(!showLabels)} disabled={placementLabelsHidden}
            aria-label={labelsShown ? 'Hide object labels' : 'Show object labels'} aria-pressed={labelsShown}
            title={placementLabelsHidden ? 'Object markers are hidden during placement' : 'Object labels'}>{labelsShown ? <Eye size={18} /> : <EyeOff size={18} />}</button>
          <button type="button" className="icon-button" onClick={changeLight} aria-label={evening ? 'Switch to daylight' : 'Switch to evening lighting'} aria-pressed={evening} title={config.copy.lighting}>{evening ? <Moon size={18} /> : <Sun size={18} />}</button>
        </div>
        <div className="world-interaction-hint"><Move size={13} />{hovered && typeof hovered !== 'string'
          ? 'lighting' in hovered ? (evening ? 'Switch to daylight' : 'Switch to evening lighting')
            : `${editMode ? 'Edit' : 'Open'} ${hoveredComponent ? componentAccessibleName(hoveredComponent, installed) : 'room object'}`
          : hoveredTarget === config.suppliesTarget ? config.copy.restockHint : hoveredTarget ? hoveredTarget === config.choresTarget ? 'Open room chores' : config.labels[hoveredTarget]
            : editMode ? 'Select an object to edit. Positions stay fixed.' : 'Drag to turn. Select an object for chores or supplies.'}</div>
      </>}
      {!editMode && <button type="button" className="world-fridge-toggle" onClick={() => activate(config.choresTarget)}><ClipboardList size={15} />Room chores</button>}
      {!editMode && <button type="button" className="world-kettle-toggle" onClick={() => activate(config.suppliesTarget)}><PackagePlus size={16} /><span>Restock supplies</span></button>}
    </div>
  )
}
