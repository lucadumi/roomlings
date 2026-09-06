import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Minus, Moon, Plus, RotateCcw, Snowflake, Sun } from 'lucide-react'
import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, CanvasTexture, ConeGeometry, CylinderGeometry,
  DirectionalLight, DodecahedronGeometry, Group, HemisphereLight, MathUtils,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PCFSoftShadowMap,
  PlaneGeometry, PointLight, Raycaster, Scene, SphereGeometry, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer,
} from 'three'
import type { BufferGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Category } from '../shared/domain.ts'
import { categoryLabels } from '../shared/domain.ts'
import { buildRoom, sceneAnchors } from './room.ts'
import type { KitchenAction, SceneAction } from './room.ts'

type Props = {
  paused: boolean
  counts: Record<Category, number>
  selected: Category | 'all'
  fundFraction: number
  memberCount: number
  expenseCount: number
  stockEvent: { id: string; category: Category } | null
  onSelect: (category: Category) => void
  onAction: (action: KitchenAction) => void
}

type Target = { category: Category } | { action: SceneAction }
const targetLabels: Record<SceneAction, string> = {
  fridge: 'Open or close your fridge',
  stock: 'Unpack a grocery run',
  ledger: 'Open the receipt book',
  budget: 'Check the house pot',
  roommates: 'Meet your roommates',
  settle: 'Make things even',
  light: 'Change the kitchen lighting',
}

export default function KitchenWorld({ paused, counts, selected, fundFraction, memberCount, expenseCount, stockEvent, onSelect, onAction }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const labels = useRef(new Map<KitchenAction, HTMLButtonElement>())
  const controls = useRef<{ open: boolean; evening: boolean; zoom: number; reset: () => void } | null>(null)
  const state = useRef({ paused, counts, selected, fundFraction, memberCount, expenseCount, stockEvent, onSelect, onAction })
  const [open, setOpen] = useState(true)
  const [evening, setEvening] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [showLabels, setShowLabels] = useState(true)
  const [hovered, setHovered] = useState<Target | null>(null)
  const hoverRef = useRef(hovered)
  const [unavailable, setUnavailable] = useState(false)
  state.current = { paused, counts, selected, fundFraction, memberCount, expenseCount, stockEvent, onSelect, onAction }
  hoverRef.current = hovered

  useEffect(() => {
    const element = host.current
    if (!element) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch (error) {
      console.warn('The 3D fridge could not start:', error instanceof Error ? error.message : error)
      setUnavailable(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFSoftShadowMap
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.setAttribute('aria-hidden', 'true')
    element.appendChild(renderer.domElement)
    const scene = new Scene()
    const camera = new OrthographicCamera(-7, 7, 5, -5, 0.1, 100)
    camera.position.set(9, 9, 13)
    camera.lookAt(-0.15, 1.55, 0)
    const skyLight = new HemisphereLight(0xfffff3, 0xb1b69d, 2)
    scene.add(skyLight, new AmbientLight(0xffffff, 0.3))
    const sunlight = new DirectionalLight(0xfff5d5, 2.7)
    sunlight.position.set(-3, 9, 6)
    sunlight.castShadow = true
    sunlight.shadow.mapSize.set(1024, 1024)
    sunlight.shadow.camera.left = -8
    sunlight.shadow.camera.right = 8
    sunlight.shadow.camera.top = 8
    sunlight.shadow.camera.bottom = -8
    sunlight.shadow.normalBias = 0.035
    scene.add(sunlight)
    const fill = new DirectionalLight(0xffffff, 1)
    fill.position.set(5, 2, -3)
    scene.add(fill)
    const room = new Group()
    scene.add(room)
    const kitchen = new Group()
    kitchen.position.set(-2.7, 0.025, -2.25)
    kitchen.userData.action = 'fridge'
    room.add(kitchen)
    const materials: MeshStandardMaterial[] = []
    const material = (color: string, roughness = 0.9) => {
      const result = new MeshStandardMaterial({ color, roughness, flatShading: true })
      materials.push(result)
      return result
    }
    const sage = material('#a3b49a')
    const lightSage = material('#b6c5ab')
    const edge = material('#8b9d82')
    const porcelain = material('#f2f1dd')
    const inside = material('#dce3d0')
    const dark = material('#59674f')
    const silver = material('#e9e8d9', 0.55)
    const milk = material('#f8f3de')
    const blue = material('#72979b')
    const red = material('#d35739')
    const orange = material('#e99938')
    const green = material('#5b8451')
    const yellow = material('#e0bb5a')
    const bread = material('#c69150')
    const berry = material('#9b677b')

    const box = (parent: Group, dimensions: [number, number, number], position: [number, number, number], mat: MeshStandardMaterial, radius = 0) => {
      const geometry = radius ? new RoundedBoxGeometry(...dimensions, 1, radius) : new BoxGeometry(...dimensions)
      const mesh = new Mesh(geometry, mat)
      mesh.position.set(...position)
      mesh.castShadow = true
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }
    const cylinder = (parent: Group, radius: number, height: number, position: [number, number, number], mat: MeshStandardMaterial, top = radius) => {
      const mesh = new Mesh(new CylinderGeometry(top, radius, height, 8), mat)
      mesh.position.set(...position)
      mesh.castShadow = true
      parent.add(mesh)
      return mesh
    }
    const scenery = buildRoom(room, { material, box, cylinder })
    box(kitchen, [0.14, 3.48, 1.7], [-1.02, 1.97, 0], sage, 0.035)
    box(kitchen, [0.14, 3.48, 1.7], [1.02, 1.97, 0], sage, 0.035)
    box(kitchen, [2, 3.48, 0.14], [0, 1.97, -0.78], sage, 0.035)
    box(kitchen, [2.15, 0.15, 1.7], [0, 3.68, 0], lightSage, 0.035)
    box(kitchen, [2.15, 0.2, 1.7], [0, 0.3, 0], sage, 0.035)
    box(kitchen, [1.88, 3.15, 0.08], [0, 1.94, -0.66], inside)
    box(kitchen, [1.9, 0.08, 1.4], [0, 2.64, 0.02], porcelain)
    for (const y of [0.63, 1.38, 2.05]) {
      box(kitchen, [1.9, 0.07, 1.4], [0, y, 0.02], porcelain, 0.015)
      box(kitchen, [1.91, 0.05, 0.05], [0, y - 0.025, 0.73], silver)
    }
    box(kitchen, [1.68, 0.37, 1.1], [0, 0.63, 0.01], edge, 0.06)
    box(kitchen, [1.48, 0.04, 0.84], [0, 0.83, 0.01], dark)
    for (const x of [-0.78, 0.78]) {
      for (const z of [-0.53, 0.55]) cylinder(kitchen, 0.09, 0.24, [x, 0.15, z], dark)
    }
    const foods: { group: Group; category: Category; baseline: number; index: number }[] = []
    const food = (category: Category, position: [number, number, number], index: number, build: (group: Group) => void, parent = kitchen) => {
      const group = new Group()
      group.position.set(...position)
      group.userData.category = category
      build(group)
      parent.add(group)
      foods.push({ group, category, baseline: position[1], index })
    }
    const doors: Group[] = []
    for (const [y, height] of [[1.5, 2.27], [3.19, 0.97]]) {
      const pivot = new Group()
      pivot.position.set(-1.1, y, 0.88)
      kitchen.add(pivot)
      doors.push(pivot)
      box(pivot, [2.2, height, 0.2], [1.1, 0, 0], lightSage, 0.07)
      box(pivot, [1.96, height - 0.18, 0.05], [1.1, 0, -0.12], porcelain, 0.025)
      box(pivot, [0.1, Math.min(0.6, height * 0.5), 0.12], [1.91, height > 1 ? 0.55 : -0.06, 0.18], silver, 0.03)
      if (height > 1) {
        for (const shelf of [-0.67, 0.2]) {
          box(pivot, [1.65, 0.05, 0.26], [1.1, shelf, -0.28], porcelain)
          box(pivot, [1.65, 0.19, 0.05], [1.1, shelf + 0.08, -0.42], inside)
        }
        food('pantry', [0, 0, 0], 0, (group) => {
          cylinder(group, 0.11, 0.37, [0.55, -0.46, -0.28], red)
          cylinder(group, 0.06, 0.1, [0.55, -0.225, -0.28], porcelain)
          cylinder(group, 0.12, 0.32, [0.94, -0.48, -0.28], yellow)
        }, pivot)
        food('drinks', [0, 0, 0], 0, (group) => {
          box(group, [0.24, 0.31, 0.18], [1.4, 0.38, -0.29], blue, 0.02)
        }, pivot)
      } else {
        const note = box(pivot, [0.43, 0.42, 0.012], [0.76, 0, 0.113], milk)
        note.rotation.z = -0.11
        const magnet = new Mesh(new DodecahedronGeometry(0.06, 0), red)
        magnet.position.set(0.73, 0.18, 0.14)
        pivot.add(magnet)
      }
    }
    const interiorLight = new PointLight(0xfff6d4, 0.6, 3)
    interiorLight.position.set(0, 3.4, 0.4)
    kitchen.add(interiorLight)
    for (let i = 0; i < 6; i++) {
      food('produce', [-0.62 + (i % 3) * 0.55, 0.94, -0.26 + Math.floor(i / 3) * 0.51], Math.floor(i / 3), (group) => {
        const tomato = new Mesh(new DodecahedronGeometry(i % 2 ? 0.21 : 0.24, 0), i % 2 ? green : red)
        tomato.scale.y = 0.85
        tomato.castShadow = true
        group.add(tomato)
        const leaf = new Mesh(new ConeGeometry(0.11, 0.1, 4), green)
        leaf.position.y = 0.2
        group.add(leaf)
      })
    }
    for (let i = 0; i < 3; i++) {
      food('dairy', [-0.63 + i * 0.48, 2.1, -0.08], i, (group) => {
        box(group, [0.29, 0.32, 0.3], [0, 0.16, 0], milk)
        const top = new Mesh(new CylinderGeometry(0.16, 0.16, 0.29, 3), milk)
        top.rotation.set(0, 0, Math.PI / 2)
        top.position.y = 0.32
        group.add(top)
        box(group, [0.295, 0.12, 0.305], [0, 0.17, 0], blue)
        box(group, [0.035, 0.02, 0.29], [0, 0.475, 0], blue)
      })
    }
    food('dairy', [0.58, 1.43, 0.35], 0, (group) => {
      box(group, [0.49, 0.1, 0.43], [0, 0.05, 0], bread, 0.02)
      for (let i = 0; i < 4; i++) {
        const egg = new Mesh(new SphereGeometry(0.075, 7, 5), milk)
        egg.scale.y = 1.4
        egg.position.set(-0.12 + (i % 2) * 0.23, 0.13, -0.1 + Math.floor(i / 2) * 0.21)
        group.add(egg)
      }
    })
    for (let i = 0; i < 3; i++) {
      food('pantry', [-0.65 + i * 0.43, 1.43, -0.15], i, (group) => {
        cylinder(group, 0.155, 0.42, [0, 0.21, 0], i % 2 ? bread : yellow)
        cylinder(group, 0.16, 0.07, [0, 0.43, 0], i % 2 ? green : red)
        box(group, [0.22, 0.16, 0.008], [0, 0.2, 0.157], milk)
      })
    }
    for (let i = 0; i < 3; i++) {
      food('drinks', [0.58, 2.1, -0.3 + i * 0.34], i, (group) => {
        cylinder(group, 0.135, 0.39, [0, 0.2, 0], i % 2 ? orange : red)
        cylinder(group, 0.115, 0.025, [0, 0.407, 0], silver)
        box(group, [0.08, 0.16, 0.012], [0, 0.2, 0.135], milk)
      })
    }
    for (let i = 0; i < 3; i++) {
      food('other', [-0.57 + i * 0.55, 2.7, 0], i, (group) => {
        box(group, [0.43, 0.32, 0.57], [0, 0.16, 0], i % 2 ? berry : blue, 0.045)
        box(group, [0.44, 0.035, 0.58], [0, 0.33, 0], milk, 0.015)
      })
    }
    const iceTray = new Group()
    box(iceTray, [0.78, 0.12, 0.55], [0.2, 2.76, 0], blue, 0.015)
    for (let i = 0; i < 6; i++) box(iceTray, [0.18, 0.06, 0.18], [-0.04 + (i % 3) * 0.24, 2.84, -0.12 + Math.floor(i / 3) * 0.24], porcelain, 0.015)
    kitchen.add(iceTray)

    const flyingShapes = {
      produce: new DodecahedronGeometry(0.2, 0),
      dairy: new BoxGeometry(0.23, 0.39, 0.23),
      pantry: new CylinderGeometry(0.12, 0.12, 0.32, 7),
      drinks: new CylinderGeometry(0.1, 0.1, 0.3, 8),
      other: new BoxGeometry(0.33, 0.2, 0.3),
    }
    const flyingColors = { produce: red, dairy: milk, pantry: yellow, drinks: blue, other: berry }
    const flyingGroceries = Array.from({ length: 5 }, () => {
      const item = new Mesh<BufferGeometry, MeshStandardMaterial>(flyingShapes.produce, red)
      item.visible = false
      item.castShadow = true
      room.add(item)
      return item
    })
    const shadowCanvas = document.createElement('canvas')
    shadowCanvas.width = shadowCanvas.height = 128
    const context = shadowCanvas.getContext('2d')
    if (context) {
      const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
      gradient.addColorStop(0, 'rgba(72,80,54,0.23)')
      gradient.addColorStop(1, 'rgba(72,80,54,0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 128, 128)
    }
    const shadowTexture = new CanvasTexture(shadowCanvas)
    const shadowMaterial = new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false })
    const shadow = new Mesh(new PlaneGeometry(16, 13), shadowMaterial)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0, -0.29, 0.4)
    scene.add(shadow)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let targetRotation = 0
    let dragging = false
    let startX = 0
    let previousX = 0
    let visible = true
    let needsFrame = true
    let frame = 0
    let last = performance.now()
    let entrance = 0
    let countsKey = ''
    let lastStockId: string | null = null
    let stockStarted = -10_000
    let stockCategory: Category = 'produce'
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const vector = new Vector3()
    const projected = new Vector3()
    const actorsY = new Map([...scenery.actors].map(([action, actor]) => [action, actor.position.y]))
    const currentControls = { open: true, evening: false, zoom: 1, reset: () => { targetRotation = 0; currentControls.zoom = 1; setZoom(1) } }
    controls.current = currentControls
    doors.forEach((door, index) => { door.rotation.y = index ? -1.72 : -1.97 })

    const resize = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height)
      needsFrame = true
      const aspect = width / height
      const halfHeight = Math.max(4.8, 7.25 / aspect)
      camera.left = -halfHeight * aspect
      camera.right = halfHeight * aspect
      camera.top = halfHeight
      camera.bottom = -halfHeight
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    visibility.observe(element)
    const hitTarget = (event: PointerEvent): Target | null => {
      const rect = element.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const intersections = raycaster.intersectObjects(room.children, true)
      const hit = intersections.find((intersection) => {
        let item = intersection.object
        while (item.parent && item !== room) {
          if (!item.visible) return false
          item = item.parent
        }
        return true
      })
      let object = hit?.object
      while (object && object !== room) {
        if (object.userData.category) return { category: object.userData.category as Category }
        if (object.userData.action) return { action: object.userData.action as SceneAction }
        object = object.parent ?? undefined
      }
      return null
    }
    const down = (event: PointerEvent) => {
      dragging = true
      startX = previousX = event.clientX
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (dragging) {
        targetRotation = MathUtils.clamp(targetRotation + (event.clientX - previousX) * 0.003, -0.42, 0.42)
        previousX = event.clientX
      } else {
        const target = hitTarget(event)
        setHovered(target)
        element.style.cursor = target ? 'pointer' : 'grab'
      }
    }
    const up = (event: PointerEvent) => {
      if (!dragging) return
      dragging = false
      if (Math.abs(event.clientX - startX) < 5) {
        const target = hitTarget(event)
        if (target && 'category' in target) state.current.onSelect(target.category)
        else if (target?.action === 'fridge') {
          currentControls.open = !currentControls.open
          setOpen(currentControls.open)
        } else if (target?.action === 'light') {
          currentControls.evening = !currentControls.evening
          setEvening(currentControls.evening)
        } else if (target) state.current.onAction(target.action)
      }
    }
    const leave = () => { setHovered(null) }
    const cancel = () => { dragging = false; setHovered(null) }
    renderer.domElement.addEventListener('pointerdown', down)
    renderer.domElement.addEventListener('pointermove', move)
    renderer.domElement.addEventListener('pointerup', up)
    renderer.domElement.addEventListener('pointerleave', leave)
    renderer.domElement.addEventListener('pointercancel', cancel)
    const onContextLost = (event: Event) => {
      event.preventDefault()
      setUnavailable(true)
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate)
      const delta = Math.min((now - last) / 1000, 0.05)
      last = now
      const latest = state.current
      // Preserve one frame behind panels, then leave the GPU free for the active form.
      if (!visible || document.hidden || (latest.paused && !needsFrame)) return
      needsFrame = false
      const key = JSON.stringify(latest.counts)
      if (key !== countsKey) { entrance = now; countsKey = key }
      if (latest.stockEvent && latest.stockEvent.id !== lastStockId) {
        lastStockId = latest.stockEvent.id
        stockStarted = now
        stockCategory = latest.stockEvent.category
        currentControls.open = true
        setOpen(true)
        flyingGroceries.forEach((item) => {
          item.geometry = flyingShapes[stockCategory]
          item.material = flyingColors[stockCategory]
        })
      }
      for (const [index, door] of doors.entries()) {
        const target = currentControls.open ? (index ? -1.72 : -1.97) : 0
        door.rotation.y = reducedMotion.matches ? target : MathUtils.damp(door.rotation.y, target, 7 - index, delta)
      }
      room.rotation.y = reducedMotion.matches ? targetRotation : MathUtils.damp(room.rotation.y, targetRotation, 9, delta)
      camera.zoom = reducedMotion.matches ? currentControls.zoom : MathUtils.damp(camera.zoom, currentControls.zoom, 8, delta)
      camera.updateProjectionMatrix()
      for (const item of foods) {
        const count = latest.counts[item.category]
        item.group.visible = count > 0 && item.index < Math.min(count + 1, 3)
        const highlighted = latest.selected === 'all' || latest.selected === item.category
        const scale = highlighted ? 1 : 0.88
        const age = (now - entrance) / 1000
        const bounce = reducedMotion.matches ? 0 : Math.sin(Math.min(age, 1) * Math.PI * 2) * Math.max(0, 1 - age) * 0.09
        item.group.position.y = item.baseline + bounce
        item.group.scale.lerp(vector.setScalar(scale), reducedMotion.matches ? 1 : Math.min(delta * 8, 1))
      }
      for (const [index, item] of flyingGroceries.entries()) {
        const age = (now - stockStarted) / 1000 - index * 0.13
        item.visible = !reducedMotion.matches && age >= 0 && age < 1.25
        if (!item.visible) continue
        const t = MathUtils.clamp(age / 1.25, 0, 1)
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
      scenery.coins.forEach((coin, index) => { coin.visible = index < Math.ceil(MathUtils.clamp(latest.fundFraction, 0, 1) * 12) })
      scenery.portraits.forEach((portrait, index) => { portrait.visible = index < latest.memberCount })
      scenery.receipts.forEach((receipt, index) => { receipt.visible = index < latest.expenseCount })
      scenery.receiptLines.visible = latest.expenseCount > 0
      scenery.receiptLines.position.y = 0.043 + Math.min(latest.expenseCount, 10) * 0.012
      scenery.steam.forEach((puff, index) => {
        const phase = ((now / 3500 + index * 0.29) % 1)
        puff.visible = !reducedMotion.matches
        puff.position.y = 0.44 + phase * 0.65
        puff.position.x = 0.33 + Math.sin(phase * 4) * 0.06
        puff.scale.setScalar(0.4 + Math.sin(phase * Math.PI) * 1.3)
      })
      scenery.plants.forEach((plant, index) => { plant.rotation.z = reducedMotion.matches ? 0 : Math.sin(now / 2500 + index) * 0.025 })
      const hoveredTarget = hoverRef.current
      for (const [action, actor] of scenery.actors) {
        const lifted = hoveredTarget && 'action' in hoveredTarget && hoveredTarget.action === action
        const base = actorsY.get(action) ?? 0
        actor.position.y = reducedMotion.matches ? base : MathUtils.damp(actor.position.y, base + (lifted && action !== 'light' ? 0.06 : 0), 10, delta)
      }
      sunlight.intensity = MathUtils.damp(sunlight.intensity, currentControls.evening ? 0.7 : 2.7, 4, delta)
      skyLight.intensity = MathUtils.damp(skyLight.intensity, currentControls.evening ? 0.85 : 2, 4, delta)
      scenery.light.intensity = MathUtils.damp(scenery.light.intensity, currentControls.evening ? 10 : 0, 4, delta)
      scenery.bulb.emissiveIntensity = currentControls.evening ? 1.7 : 0.12
      scenery.sky.color.set(currentControls.evening ? '#697a90' : '#b5d2c8')
      const time = new Date()
      scenery.hourHand.rotation.z = -((time.getHours() % 12 + time.getMinutes() / 60) / 12) * Math.PI * 2
      scenery.minuteHand.rotation.z = -(time.getMinutes() / 60) * Math.PI * 2
      iceTray.visible = latest.counts.other === 0
      interiorLight.intensity = currentControls.open ? 0.6 : 0
      renderer.render(scene, camera)
      for (const anchor of sceneAnchors) {
        const label = labels.current.get(anchor.action)
        if (!label) continue
        projected.set(...anchor.position).applyMatrix4(room.matrixWorld).project(camera)
        const x = (projected.x * 0.5 + 0.5) * element.clientWidth
        const y = (-projected.y * 0.5 + 0.5) * element.clientHeight
        label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
        label.style.visibility = x < 5 || x > element.clientWidth - 5 || y < 0 || y > element.clientHeight ? 'hidden' : 'visible'
      }
    }
    resize()
    frame = requestAnimationFrame(animate)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      visibility.disconnect()
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointermove', move)
      renderer.domElement.removeEventListener('pointerup', up)
      renderer.domElement.removeEventListener('pointerleave', leave)
      renderer.domElement.removeEventListener('pointercancel', cancel)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      scene.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
      materials.forEach((mat) => mat.dispose())
      Object.values(flyingShapes).forEach((geometry) => geometry.dispose())
      shadowMaterial.dispose()
      shadowTexture.dispose()
      sunlight.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      controls.current = null
    }
  }, [])

  const toggle = () => {
    const next = !(controls.current?.open ?? open)
    if (controls.current) controls.current.open = next
    setOpen(next)
  }
  const changeZoom = (direction: number) => {
    const next = MathUtils.clamp((controls.current?.zoom ?? zoom) + direction * 0.2, 0.8, 1.8)
    if (controls.current) controls.current.zoom = next
    setZoom(next)
  }
  const changeLight = () => {
    const next = !(controls.current?.evening ?? evening)
    if (controls.current) controls.current.evening = next
    setEvening(next)
  }

  return (
    <div className="kitchen-world" data-evening={evening}>
      <div className="world-canvas" ref={host} role="img" aria-label="Interactive low-poly shared kitchen. Click the grocery bag to stock the fridge, the receipt book for expenses, the coin jar for your budget, the noticeboard for roommates, or the envelope to settle up. Drag to turn the room." />
      {unavailable && <div className="fridge-unavailable"><Snowflake size={42} /><strong>Your kitchen, minus the 3D.</strong><p>This browser could not display the fridge. All expenses and balances still work.</p></div>}
      {!unavailable && <>
        <div className={`world-hotspots${showLabels ? '' : ' hide-labels'}`} aria-label="Objects in your kitchen">
          {sceneAnchors.map((anchor) => <button key={anchor.action} ref={(element) => { if (element) labels.current.set(anchor.action, element); else labels.current.delete(anchor.action) }} className={`world-hotspot hotspot-${anchor.action}`} onClick={() => onAction(anchor.action)} onMouseEnter={() => setHovered({ action: anchor.action })} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered({ action: anchor.action })} onBlur={() => setHovered(null)}><span className="hotspot-dot" /><span>{anchor.label}</span></button>)}
        </div>
        <div className="world-camera-controls"><button className="icon-button" onClick={() => changeZoom(-1)} disabled={zoom <= 0.8} aria-label="Zoom out"><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" onClick={() => changeZoom(1)} disabled={zoom >= 1.8} aria-label="Zoom in"><Plus size={16} /></button><i /><button className="icon-button" onClick={() => controls.current?.reset()} aria-label="Reset kitchen view"><RotateCcw size={15} /></button><button className="icon-button" onClick={() => setShowLabels(!showLabels)} aria-label={showLabels ? 'Hide object labels' : 'Show object labels'} aria-pressed={showLabels}>{showLabels ? <Eye size={16} /> : <EyeOff size={16} />}</button><button className="icon-button" onClick={changeLight} aria-label={evening ? 'Switch to daylight' : 'Switch to evening lighting'} aria-pressed={evening}>{evening ? <Moon size={16} /> : <Sun size={16} />}</button></div>
        <div className="world-interaction-hint">{hovered ? ('category' in hovered ? `${categoryLabels[hovered.category]}: open the receipt book` : targetLabels[hovered.action]) : 'Drag to turn the room. Tap something to make yourself at home.'}</div>
        <button className="world-fridge-toggle" onClick={toggle} aria-label={open ? 'Close the fridge' : 'Peek inside'} aria-pressed={open}><Snowflake size={15} />{open ? 'Close the fridge' : 'Peek inside'}<span>{open ? 'Keep it cool' : 'See what is shared'}</span></button>
      </>}
    </div>
  )
}
