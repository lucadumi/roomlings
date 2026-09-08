import { useEffect, useRef, useState } from 'react'
import { Bath, ClipboardList, Eye, EyeOff, Maximize, Minus, Moon, Move, PackagePlus, Plus, Sun } from 'lucide-react'
import {
  ACESFilmicToneMapping, Group, MathUtils, Mesh, MeshBasicMaterial, OrthographicCamera,
  PCFShadowMap, PlaneGeometry, PointLight, Raycaster, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three'
import type { BufferGeometry } from 'three'
import { bathroomFocusForRequest, bathroomFraming, bathroomLabels, bathroomTargets, buildBathroomModel } from './bathroomModel.ts'
import type { BathroomFocus, BathroomTarget } from './bathroomModel.ts'
import { batchStaticMeshes } from './batchStaticMeshes.ts'
import { baseCameraOffset, cameraProjection } from './camera.ts'
import { addContactShadows, createContactShadowTexture, createRoomLights, daylight, eveningLight } from './lighting.ts'
import { dampTo, frameSeconds } from './motion.ts'
import { applyRoomStyle } from './roomStyles.ts'
import type { RoomWorldProps } from './roomViewTypes.ts'
import './bathroom.css'

type BathroomControls = {
  focus: BathroomFocus
  zoom: number
  evening: boolean
  wake: () => void
  focusOn: (target: BathroomTarget) => void
  reset: () => void
}

export default function BathroomWorld({ roomStyle, paused, panelOpen, focusRequest, onOpenChores, onRestock, dueChores }: RoomWorldProps) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const labels = useRef(new Map<BathroomTarget, HTMLButtonElement>())
  const controls = useRef<BathroomControls | null>(null)
  const state = useRef({ roomStyle, focusRequest, onOpenChores, onRestock })
  state.current = { roomStyle, focusRequest, onOpenChores, onRestock }
  const [focused, setFocused] = useState<BathroomFocus>(() => bathroomFocusForRequest(focusRequest.target))
  const [zoom, setZoom] = useState(1)
  const [evening, setEvening] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [hovered, setHovered] = useState<BathroomTarget | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [cameraMoving, setCameraMoving] = useState(false)
  const [renderingPaused, setRenderingPaused] = useState(false)

  const activate = (target: BathroomTarget) => {
    controls.current?.focusOn(target)
    if (target === 'supplies') state.current.onRestock()
    else state.current.onOpenChores(target === 'chores' ? null : target)
  }

  useEffect(() => {
    const element = host.current
    const stageElement = stage.current
    if (!element || !stageElement) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch (error) {
      console.warn('The 3D bathroom could not start:', error instanceof Error ? error.message : error)
      setUnavailable(true)
      setRenderingPaused(true)
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
    const model = buildBathroomModel(room, state.current.roomStyle)
    batchStaticMeshes(room, new Set())
    const { group: lighting, sunlight, skyLight, fill } = createRoomLights()
    const lamp = new PointLight('#ffe6bc', 0, 8, 2)
    lamp.position.set(0.15, 3.9, -2.7)
    room.add(lamp)
    scene.add(lighting)
    const shadowTexture = createContactShadowTexture()
    const contacts = addContactShadows(room, shadowTexture, model.contacts)
    const shadowMaterial = new MeshBasicMaterial({
      map: shadowTexture, color: '#535d45', opacity: 0.2, transparent: true, depthWrite: false, toneMapped: false,
    })
    const shadow = new Mesh(new PlaneGeometry(14, 11), shadowMaterial)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0, -0.285, 0.3)
    scene.add(shadow)
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
    let displayedStyle = state.current.roomStyle
    let lastFocusId = state.current.focusRequest.id
    let moved = false
    let startX = 0
    let startY = 0
    let previousX = 0
    let previousY = 0
    let pinchDistance = 0
    let pinchZoom = 1

    const wake = () => {
      dirty = true
      if (disposed || contextLost || document.hidden || !visible || frame || drawing) return
      last = performance.now()
      setRenderingPaused(false)
      frame = requestAnimationFrame(animate)
    }
    const currentControls: BathroomControls = {
      focus: bathroomFocusForRequest(state.current.focusRequest.target), zoom: 1, evening: false, wake,
      focusOn(target) {
        currentControls.focus = target
        currentControls.zoom = 1
        setFocused(target)
        setZoom(1)
        wake()
      },
      reset() {
        currentControls.focus = 'room'
        currentControls.zoom = 1
        targetRotation = 0
        targetPitch = 0
        setFocused('room')
        setZoom(1)
        wake()
      },
    }
    controls.current = currentControls
    const measure = () => {
      const canvasBounds = element.getBoundingClientRect()
      const stageBounds = stageElement.getBoundingClientRect()
      if (!canvasBounds.width || !canvasBounds.height || !stageBounds.width || !stageBounds.height) return false
      needsResize ||= viewport.width !== canvasBounds.width || viewport.height !== canvasBounds.height
      viewport.width = canvasBounds.width
      viewport.height = canvasBounds.height
      area.x = stageBounds.left - canvasBounds.left
      area.y = stageBounds.top - canvasBounds.top
      area.width = stageBounds.width
      area.height = stageBounds.height
      return true
    }
    const resize = () => { measure(); wake() }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    observer.observe(stageElement)
    const stopDrawing = () => {
      cancelAnimationFrame(frame)
      frame = 0
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
      if (displayedStyle !== latest.roomStyle) {
        applyRoomStyle(model.styleMaterials, latest.roomStyle)
        displayedStyle = latest.roomStyle
      }
      if (latest.focusRequest.id !== lastFocusId) {
        lastFocusId = latest.focusRequest.id
        const target = bathroomFocusForRequest(latest.focusRequest.target)
        if (target === 'room') currentControls.reset()
        else currentControls.focusOn(target)
      }
      if (needsResize) {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(viewport.width, viewport.height)
        needsResize = false
      }
      const snap = !initialized || reducedMotion.matches
      const rotation = snap ? targetRotation : dampTo(room.rotation.y, targetRotation, 9, delta)
      shadowsDirty ||= rotation !== room.rotation.y
      room.rotation.y = rotation
      room.updateMatrixWorld(true)
      pitch = snap ? targetPitch : dampTo(pitch, targetPitch, 9, delta)
      const bounds = currentControls.focus === 'room' ? model.bounds : model.actorBounds.get(currentControls.focus)!
      const framing = bathroomFraming(area.width, area.height, bounds, room.rotation.y, pitch)
      desiredCenter.set(...framing.center)
      if (snap) cameraCenter.copy(desiredCenter)
      else cameraCenter.lerp(desiredCenter, 1 - Math.exp(-9 * delta))
      if (cameraCenter.distanceTo(desiredCenter) < 0.002) cameraCenter.copy(desiredCenter)
      halfHeight = snap ? framing.halfHeight : dampTo(halfHeight, framing.halfHeight, 9, delta, 0.002)
      camera.zoom = snap ? currentControls.zoom : dampTo(camera.zoom, currentControls.zoom, 9, delta, 0.002)
      camera.position.copy(cameraCenter).add(offset.set(baseCameraOffset[0], baseCameraOffset[1] + pitch, baseCameraOffset[2]))
      camera.lookAt(cameraCenter)
      const projection = cameraProjection(viewport.width, viewport.height, area, halfHeight, camera.zoom)
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
      lamp.intensity = eveningLight.lamp * 0.45 * lightMix
      model.lampMaterial.emissiveIntensity = 0.2 + lightMix * 0.8
      sunlight.shadow.needsUpdate = shadowsDirty
      renderer.shadowMap.needsUpdate = shadowsDirty
      renderer.render(scene, camera)
      shadowsDirty = false
      initialized = true
      for (const [target, anchor] of model.anchors) {
        const button = labels.current.get(target)
        if (!button) continue
        anchor.getWorldPosition(projected).project(camera)
        const x = (projected.x * 0.5 + 0.5) * viewport.width
        const y = (-projected.y * 0.5 + 0.5) * viewport.height
        button.style.left = `${x}px`
        button.style.top = `${y}px`
        button.style.transform = 'translate(-50%, -50%)'
        button.style.visibility = projected.z > -1 && projected.z < 1
          && x > area.x + 18 && x < area.x + area.width - 18
          && y > area.y + 18 && y < area.y + area.height - 18 ? 'visible' : 'hidden'
      }
      const moving = room.rotation.y !== targetRotation || pitch !== targetPitch
        || !cameraCenter.equals(desiredCenter) || halfHeight !== framing.halfHeight || camera.zoom !== currentControls.zoom
      setCameraMoving(moving)
      drawing = false
      if (moving || lightMix !== desiredLight || dirty) frame = requestAnimationFrame(animate)
      else setRenderingPaused(true)
    }

    const hitTarget = (event: PointerEvent): BathroomTarget | null => {
      const rect = canvas.getBoundingClientRect()
      if (!initialized || !rect.width || !rect.height) return null
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(room, true).find(({ object }) => {
        for (let item = object; item !== room && item.parent; item = item.parent) if (!item.visible) return false
        return true
      })
      let object = hit?.object
      while (object && object !== room) {
        const target = bathroomTargets.find((candidate) => candidate === object?.userData.bathroomTarget)
        if (target) return target
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
      if (event.pointerType === 'mouse' && event.button !== 0) return
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
      canvas.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, new Vector2(event.clientX, event.clientY))
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
        element.style.cursor = target ? 'pointer' : 'grab'
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
      } else if (!cancelled && !moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 5) {
        const target = hitTarget(event)
        if (target) activate(target)
      }
    }
    const up = (event: PointerEvent) => finishPointer(event, false)
    const cancel = (event: PointerEvent) => finishPointer(event, true)
    const leave = () => { setHovered(null); element.style.cursor = 'grab' }
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
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', cancel)
    canvas.addEventListener('lostpointercapture', cancel)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('wheel', wheel, { passive: false })
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
      canvas.removeEventListener('webglcontextlost', onContextLost)
      const geometries = new Set<BufferGeometry>()
      scene.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
      geometries.forEach((geometry) => geometry.dispose())
      model.materials.forEach((material) => material.dispose())
      contacts.material.dispose()
      shadowMaterial.dispose()
      shadowTexture.dispose()
      sunlight.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      controls.current = null
    }
  }, [])

  useEffect(() => { controls.current?.wake() }, [roomStyle, paused, panelOpen, focusRequest.id])

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

  return (
    <div className="kitchen-world bathroom-world" data-room-style={roomStyle} data-evening={evening} data-focus={focused}
      data-framing={focused === 'room' ? 'whole' : 'close'} data-camera-moving={cameraMoving} data-rendering={renderingPaused ? 'paused' : 'active'}>
      <div className="bathroom-scene-area" ref={stage} aria-hidden="true" />
      <div className="world-canvas" ref={host} role="img" hidden={unavailable} aria-hidden={unavailable}
        aria-label="Interactive low-poly shared bathroom. Select the sink, mirror, toilet, bath or floor for chores, the cleaning caddy for room chores, or the shelf to restock supplies. Drag to turn, scroll or pinch to zoom." />
      {unavailable ? <div className="bathroom-unavailable" role="status"><Bath size={34} /><strong>The 3D bathroom is unavailable.</strong><p>You can still manage chores and restock supplies with the room controls.</p></div> : <>
        <div className={`world-hotspots${showLabels ? '' : ' hide-labels'}`} aria-label="Objects in your bathroom">
          {bathroomTargets.map((target) => {
            const due = target === 'chores' || target === 'supplies' ? undefined : dueChores[target]
            const label = `${bathroomLabels[target]}${due && due > 0 ? ` (${due} due)` : ''}`
            return <button key={target} type="button" ref={(button) => { if (button) labels.current.set(target, button); else labels.current.delete(target) }}
              className={`world-hotspot hotspot-${target}`} data-bathroom-target={target} data-selected={focused === target}
              aria-label={label} onClick={() => activate(target)} onMouseEnter={() => setHovered(target)} onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(target)} onBlur={() => setHovered(null)}>
              <span className="hotspot-dot"><Plus size={12} /></span><span className="hotspot-label">{label}</span>
            </button>
          })}
        </div>
        <div className="world-view-label"><span className="view-label-dot" />{focused === 'room' ? 'The bathroom' : bathroomLabels[focused]}{cameraMoving && <span className="view-moving">Adjusting view</span>}</div>
        <div className="world-camera-controls">
          <button type="button" className="icon-button" onClick={() => changeZoom(1)} disabled={zoom >= 1.9} aria-label="Zoom in" title="Zoom in"><Plus size={19} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="icon-button" onClick={() => changeZoom(-1)} disabled={zoom <= 0.65} aria-label="Zoom out" title="Zoom out"><Minus size={19} /></button>
          <i />
          <button type="button" className="icon-button" onClick={() => controls.current?.reset()} aria-label="Frame the whole room" title="Whole room" aria-pressed={focused === 'room'}><Maximize size={18} /></button>
          <button type="button" className="icon-button" onClick={() => setShowLabels(!showLabels)} aria-label={showLabels ? 'Hide object labels' : 'Show object labels'} aria-pressed={showLabels} title="Object labels">{showLabels ? <Eye size={18} /> : <EyeOff size={18} />}</button>
          <button type="button" className="icon-button" onClick={changeLight} aria-label={evening ? 'Switch to daylight' : 'Switch to evening lighting'} aria-pressed={evening} title="Bathroom lighting">{evening ? <Moon size={18} /> : <Sun size={18} />}</button>
        </div>
        <div className="world-interaction-hint"><Move size={13} />{hovered === 'supplies' ? 'Restock bathroom supplies' : hovered ? hovered === 'chores' ? 'Open room chores' : bathroomLabels[hovered] : 'Drag to turn. Select an object for chores or supplies.'}</div>
      </>}
      <button type="button" className="world-fridge-toggle" onClick={() => activate('chores')}><ClipboardList size={15} />Room chores</button>
      <button type="button" className="world-kettle-toggle" onClick={() => activate('supplies')}><PackagePlus size={16} /><span>Restock supplies</span></button>
    </div>
  )
}
