import {
  CylinderGeometry, DodecahedronGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial,
  PointLight, Shape, SphereGeometry, TorusGeometry,
} from 'three'
import { memberColors } from '../shared/domain.ts'
import type { RoomStyle } from '../shared/domain.ts'
import { daylight, eveningLight } from './lighting.ts'
import type { ContactShadow } from './lighting.ts'
import { roomAccents, roomPresets } from './roomStyles.ts'
import type { ComponentBindings, ComponentFixtures } from './roomComponentTypes.ts'
import { componentPlacements, kitchenCabinetBays, kitchenLayout, kitchenReturnBays, kitchenShelves, kitchenWorktops, roomFootprints, roomShellLayout } from './roomLayout.ts'
import { createRoomWallGroup } from './roomCutaway.ts'
import { buildRoomWalls } from './roomShell.ts'

export type KitchenAction = 'stock' | 'ledger' | 'budget' | 'roommates' | 'settle'
export type SceneAction = KitchenAction | 'fridge' | 'light' | 'brew'
export const kitchenUtilities = ['chores', 'supplies', 'sink', 'counters', 'floor'] as const
export type KitchenUtility = typeof kitchenUtilities[number]
export type Shapes = {
  material: (color: string, roughness?: number) => MeshStandardMaterial
  box: (parent: Group, dimensions: [number, number, number], position: [number, number, number], material: MeshStandardMaterial, radius?: number) => Mesh
  cylinder: (parent: Group, radius: number, height: number, position: [number, number, number], material: MeshStandardMaterial, top?: number) => Mesh
}

export const sceneAnchors: { action: KitchenAction | 'brew'; label: string; position: [number, number, number] }[] = [
  { action: 'stock', label: 'Shopping bag', position: [-0.54, 2.85, 0.65] },
  { action: 'ledger', label: 'Receipt book', position: [-0.18, 1.85, 1.9] },
  { action: 'budget', label: 'The house pot', position: [1.7, 2.55, 0.77] },
  { action: 'roommates', label: 'Your people', position: [4.3, 4.3, -3.15] },
  { action: 'settle', label: 'Settle up', position: [1.85, 1.9, 1.52] },
  { action: 'brew', label: 'Put the kettle on', position: [kitchenLayout.kettle[0], 2.55, kitchenLayout.kettle[2]] },
]

export const kitchenUtilityAnchors: { utility: KitchenUtility; label: string; position: [number, number, number] }[] = [
  { utility: 'chores', label: 'Kitchen chores', position: [-3.7, 1.2, 2.78] },
  { utility: 'supplies', label: 'Kitchen supplies', position: [-5.08, 2.55, -1.8] },
  { utility: 'sink', label: 'Sink chores', position: [3.5, 2.55, -2.56] },
]

export function buildRoom(room: Group, { material, box, cylinder }: Shapes, style: RoomStyle = 'original') {
  const palette = roomPresets[style].colors
  const tile = material(palette.floor, 0.86)
  const tileAlternate = material(palette.floorAlternate, 0.86)
  const plaster = material(palette.wall)
  const wallTrim = material(palette.trim)
  const trim = material(roomPresets.original.colors.trim)
  const wood = material(palette.wood, 0.82)
  const lightWood = material(palette.lightWood, 0.78)
  const woodGrain = material(palette.woodGrain, 0.84)
  const cabinet = material(palette.cabinet, 0.64)
  const cabinetPanel = material(palette.cabinetPanel, 0.64)
  const counter = material(palette.counter, 0.7)
  const bagPaper = material(roomPresets.original.colors.lightWood, 0.78)
  const brown = material(roomPresets.original.colors.wood, 0.82)
  const ink = material(roomAccents.ink)
  const paper = material(roomAccents.paper, 0.98)
  const tomato = material(roomAccents.tomato, 0.6)
  const gold = material(roomAccents.gold, 0.38)
  gold.metalness = 0.18
  const leaf = material(roomAccents.leaf)
  const leafLight = material(roomAccents.leafLight)
  const terracotta = material(roomAccents.terracotta, 0.98)
  const sky = material(daylight.window)
  const linen = material(roomAccents.linen, 1)
  const handles = material(roomAccents.metal, 0.38)
  handles.metalness = 0.12
  const contacts: ContactShadow[] = []
  const componentBindings: ComponentBindings = new Map()
  const componentFixtures: ComponentFixtures = new Map()
  const actors = new Map<SceneAction, Group>()
  const utilityActors = new Map<KitchenUtility, Group>()
  const actor = (action: SceneAction, position: [number, number, number]) => {
    const group = new Group()
    group.position.set(...position)
    group.userData.action = action
    actors.set(action, group)
    room.add(group)
    return group
  }
  const utility = (kind: KitchenUtility, position: [number, number, number]) => {
    const group = new Group()
    group.position.set(...position)
    group.userData.utility = kind
    utilityActors.set(kind, group)
    room.add(group)
    return group
  }

  const footprint = roomFootprints.kitchen
  const { outer } = roomShellLayout('kitchen')
  box(room, [outer.right - outer.left, 0.25, outer.front - outer.back],
    [(outer.left + outer.right) / 2, -0.15, (outer.back + outer.front) / 2], lightWood, 0.14)
  const floor = utility('floor', [0, 0, 0])
  const tileWidth = (footprint.width - 0.26) / 11
  const tileDepth = (footprint.depth - 0.27) / 6
  for (let x = 0; x < 11; x++) {
    for (let z = 0; z < 6; z++) {
      const square = box(floor, [tileWidth - 0.003, 0.025, tileDepth - 0.003],
        [(x - 5) * tileWidth, -0.008, footprint.centerZ + (z - 2.5) * tileDepth], (x + z) % 2 ? tile : tileAlternate)
      square.castShadow = false
    }
  }
  buildRoomWalls(room, 'kitchen', { name: 'Kitchen', centerY: 2.2, wall: plaster, trim: wallTrim, lowerPanel: plaster })

  const window = actor('light', [0.85, 3.26, -3.2])
  const windowPane = createRoomWallGroup(window, 'back', 'Kitchen window cutaway')
  box(windowPane, [2.3, 1.85, 0.1], [0, 0, 0], wood, 0.045)
  box(windowPane, [2.1, 1.63, 0.055], [0, 0, 0.065], sky)
  box(windowPane, [0.065, 1.63, 0.06], [0, 0, 0.115], paper)
  box(windowPane, [2.1, 0.065, 0.06], [0, 0, 0.115], paper)
  box(window, [2.77, 0.12, 0.9], [0.085, -0.96, 0.39], lightWood, 0.015)
  const windowDisc = material(daylight.disc)
  windowDisc.emissive.set(eveningLight.disc)
  windowDisc.emissiveIntensity = 0
  const sun = new Mesh(new CylinderGeometry(0.17, 0.17, 0.015, 12), windowDisc)
  sun.rotation.x = Math.PI / 2
  sun.position.set(0.55, 0.48, 0.105)
  windowPane.add(sun)
  const curtains = new Group()
  window.add(curtains)
  for (const side of [-1, 1]) {
    for (let fold = 0; fold < 3; fold++) {
      box(curtains, [0.1, 1.83 - fold * 0.07, 0.13], [side * (1.06 + fold * 0.08), 0.04, 0.22 + (fold % 2) * 0.025], fold % 2 ? linen : paper, 0.025)
    }
  }

  const cupboard = utility('counters', kitchenLayout.counters)
  const cabinetBodies: Mesh[] = []
  const [backTop, returnTop] = kitchenWorktops
  const outline = new Shape()
  const left = backTop.position[0] - backTop.width / 2
  const right = backTop.position[0] + backTop.width / 2
  const back = backTop.position[2] - backTop.depth / 2
  const corner = backTop.position[2] + backTop.depth / 2
  const inside = returnTop.position[0] - returnTop.width / 2
  const front = returnTop.position[2] + returnTop.depth / 2
  outline.moveTo(left, -back)
  outline.lineTo(right, -back)
  outline.lineTo(right, -front)
  outline.lineTo(inside, -front)
  outline.lineTo(inside, -corner)
  outline.lineTo(left, -corner)
  outline.closePath()
  const topGeometry = new ExtrudeGeometry(outline, { depth: 0.15, bevelEnabled: false, steps: 1, curveSegments: 1 })
  topGeometry.rotateX(-Math.PI / 2)
  const worktop = new Mesh(topGeometry, counter)
  worktop.name = 'Continuous L-shaped worktop'
  worktop.position.set(-cupboard.position.x, backTop.top - 0.15, -cupboard.position.z)
  worktop.castShadow = worktop.receiveShadow = true
  cupboard.add(worktop)
  for (const top of kitchenWorktops) {
    const section = new Group()
    section.name = top.name
    section.position.set(top.position[0] - cupboard.position.x, 0, top.position[2] - cupboard.position.z)
    cupboard.add(section)
    const bodyHeight = top.top - 0.255
    const bodyY = 0.11 + bodyHeight / 2
    box(section, [top.width - 0.22, 0.17, top.depth - 0.3], [0, 0.15, 0], ink)
    contacts.push({ position: [top.position[0], 0.007, top.position[2]], size: [top.width + 0.22, top.depth + 0.25] })
    const rear = top === kitchenWorktops[0]
    const units = rear ? kitchenCabinetBays.map((bay) => ({ ...bay, x: bay.x - top.position[0] }))
      : kitchenReturnBays.map((bay) => ({ ...bay, x: bay.z - top.position[2] }))
    for (const unitDefinition of units) {
      const { x, width: unit } = unitDefinition
      const bay = new Group()
      bay.position.set(rear ? x : 0, 0, rear ? 0 : x)
      if (!rear) bay.rotation.y = -Math.PI / 2
      section.add(bay)
      const depth = (rear ? top.depth : top.width) - 0.13
      const body = box(bay, [unit - 0.035, bodyHeight, depth], [0, bodyY, 0], cabinet, 0.025)
      const front = new Group()
      bay.add(front)
      if (!unitDefinition.blindCorner) {
        box(front, [unit - 0.075, bodyHeight - 0.13, 0.065], [0, bodyY, depth / 2 + 0.02], cabinet, 0.025)
        box(front, [unit - 0.22, bodyHeight - 0.3, 0.012], [0, bodyY - 0.01, depth / 2 + 0.06], cabinetPanel, 0.006)
        box(front, [0.24, 0.04, 0.08], [0, top.top - 0.42, depth / 2 + 0.085], handles, 0.014)
      }
      if (!unitDefinition.slotId) continue
      cabinetBodies.push(body)
      const shell = new Group()
      shell.visible = false
      bay.add(shell)
      for (const side of [-1, 1]) box(shell, [0.06, bodyHeight, depth], [side * (unit / 2 - 0.045), bodyY, 0], cabinet)
      box(shell, [unit - 0.06, bodyHeight, 0.035], [0, bodyY, -depth / 2 + 0.0175], cabinet)
      componentFixtures.set(unitDefinition.slotId, { vacant: [body, front], occupied: [shell] })
    }
  }
  const counterContacts = contacts.slice()
  for (const shelf of kitchenShelves) {
    const group = new Group()
    group.name = shelf.name
    group.position.set(shelf.position[0] - cupboard.position.x, 0, shelf.position[2] - cupboard.position.z)
    group.visible = false
    cupboard.add(group)
    box(group, [shelf.width, 0.07, shelf.depth], [0, shelf.top - 0.035, 0], lightWood, 0.015)
    componentFixtures.set(shelf.slots[0], { vacant: [], occupied: [group], occupiedBy: shelf.slots })
  }
  const sink = new Group()
  sink.position.x = 0.35
  sink.userData.utility = 'sink'
  utilityActors.set('sink', sink)
  cupboard.add(sink)
  box(sink, [1.05, 0.035, 0.78], [1.3, 1.76, 0], handles, 0.025)
  box(sink, [0.86, 0.04, 0.61], [1.3, 1.775, 0], ink, 0.07)
  cylinder(sink, 0.035, 0.48, [1.3, 1.99, -0.46], handles)
  box(sink, [0.07, 0.07, 0.31], [1.3, 2.2, -0.32], handles, 0.018)
  const hob = new Group()
  hob.position.set(kitchenLayout.hob[0] - cupboard.position.x, 0, kitchenLayout.hob[2] - cupboard.position.z)
  hob.rotation.y = -Math.PI / 2
  cupboard.add(hob)
  box(hob, [0.95, 0.04, 0.91], [0, 1.76, 0], ink, 0.025)
  for (const x of [-0.22, 0.22]) for (const z of [-0.21, 0.2]) cylinder(hob, 0.135, 0.016, [x, 1.79, z], handles)
  const kettle = new Group()
  kettle.position.set(kitchenLayout.kettle[0] - cupboard.position.x, kitchenLayout.kettle[1], kitchenLayout.kettle[2] - cupboard.position.z)
  kettle.rotation.y = -Math.PI / 2
  kettle.userData.action = 'brew'
  actors.set('brew', kettle)
  cupboard.add(kettle)
  cylinder(kettle, 0.21, 0.025, [0, 0.017, 0], ink)
  cylinder(kettle, 0.22, 0.34, [0, 0.2, 0], tomato, 0.18)
  const kettleLid = new Group()
  kettleLid.name = 'Kettle lid assembly'
  kettleLid.position.y = 0.39
  kettle.add(kettleLid)
  cylinder(kettleLid, 0.18, 0.045, [0, 0, 0], ink)
  const kettleKnob = cylinder(kettleLid, 0.04, 0.065, [0, 0.05, 0], wood)
  kettleKnob.name = 'Kettle lid knob'
  const spout = cylinder(kettle, 0.07, 0.3, [0.22, 0.26, 0], tomato, 0.04)
  spout.rotation.z = -0.9
  const kettleHandle = new Mesh(new TorusGeometry(0.19, 0.035, 4, 8, Math.PI), wood)
  kettleHandle.position.set(0, 0.4, 0)
  kettleHandle.castShadow = true
  kettleHandle.receiveShadow = true
  kettle.add(kettleHandle)

  const steam = Array.from({ length: 3 }, (_, i) => {
    const steamMaterial = material('#fff9e9')
    steamMaterial.transparent = true
    steamMaterial.opacity = 0
    steamMaterial.depthWrite = false
    const puff = new Mesh(new SphereGeometry(0.055, 5, 4), steamMaterial)
    puff.userData.roomTransient = true
    puff.position.set(0.34, 0.44 + i * 0.2, 0)
    kettle.add(puff)
    return puff
  })

  const jar = actor('budget', kitchenLayout.budget)
  const glass = material(roomAccents.water, 0.3)
  glass.transparent = true
  glass.opacity = 0.25
  glass.depthWrite = false
  cylinder(jar, 0.31, 0.75, [0, 0.39, 0], glass, 0.28)
  cylinder(jar, 0.3, 0.07, [0, 0.78, 0], wood)
  box(jar, [0.21, 0.012, 0.042], [0, 0.824, 0], ink)
  box(jar, [0.33, 0.23, 0.015], [0, 0.41, 0.31], paper, 0.015)
  const jarLeaf = new Mesh(new DodecahedronGeometry(0.06, 0), leaf)
  jarLeaf.scale.set(0.7, 1.3, 0.15)
  jarLeaf.position.set(0, 0.42, 0.328)
  jar.add(jarLeaf)
  const coins = Array.from({ length: 12 }, (_, i) => {
    const coin = cylinder(jar, 0.18, 0.035, [Math.sin(i * 2) * 0.065, 0.09 + i * 0.045, Math.cos(i * 2) * 0.06], gold)
    coin.rotation.z = Math.sin(i) * 0.13
    return coin
  })

  const board = actor('roommates', kitchenLayout.roommates)
  box(board, [2.1, 1.8, 0.12], [0, 0, 0], wood, 0.06)
  box(board, [1.93, 1.62, 0.025], [0, 0, 0.075], linen)
  const portraits = Array.from({ length: 12 }, (_, i) => {
    const portrait = new Group()
    portrait.position.set(-0.62 + (i % 4) * 0.415, 0.51 - Math.floor(i / 4) * 0.5, 0.12)
    portrait.rotation.z = Math.sin(i * 17) * 0.12
    box(portrait, [0.34, 0.4, 0.015], [0, 0, 0], paper)
    const face = new Mesh(new CylinderGeometry(0.088, 0.088, 0.012, 9), material(memberColors[i % memberColors.length]))
    face.rotation.x = Math.PI / 2
    face.position.set(0, 0.035, 0.018)
    portrait.add(face)
    box(portrait, [0.17, 0.016, 0.012], [0, -0.13, 0.018], trim)
    const pin = new Mesh(new DodecahedronGeometry(0.025, 0), tomato)
    pin.position.set(0, 0.19, 0.022)
    portrait.add(pin)
    board.add(portrait)
    return portrait
  })

  const table = new Group()
  table.position.set(...kitchenLayout.table)
  room.add(table)
  box(table, [3.58, 0.18, 1.86], [0, 1.4, 0], lightWood, 0.065)
  for (const z of [-0.31, 0.31]) box(table, [3.4, 0.004, 0.008], [0, 1.493, z], woodGrain)
  box(table, [3.25, 0.24, 1.54], [0, 1.23, 0], wood)
  const tableContacts: ContactShadow[] = []
  for (const x of [-1.42, 1.42]) for (const z of [-0.61, 0.61]) {
    box(table, [0.12, 1.2, 0.12], [x, 0.65, z], wood, 0.015)
    tableContacts.push({ position: [table.position.x + x, 0.042, table.position.z + z], size: [0.42, 0.42] })
  }
  contacts.push(...tableContacts)
  const rug = new Group()
  rug.position.set(...kitchenLayout.rug)
  room.add(rug)
  box(rug, [3, 0.018, 1.18], [0, 0.022, 0], linen, 0.05)
  for (const z of [-0.46, 0.46]) {
    box(rug, [2.7, 0.007, 0.075], [0, 0.037, z], tomato)
    for (let i = 0; i < 15; i++) box(rug, [0.025, 0.012, 0.12], [-1.35 + i * 0.193, 0.032, z + (z > 0 ? 0.16 : -0.16)], paper)
  }
  const seating = new Group()
  room.add(seating)
  const seatContacts: ContactShadow[] = []
  for (const [x, z] of [[0.47, 2.8], [2.82, 1.3]]) {
    cylinder(seating, 0.38, 0.045, [x, 0.765, z], wood)
    cylinder(seating, 0.41, 0.12, [x, 0.84, z], cabinet)
    seatContacts.push({ position: [x, 0.042, z], size: [1.05, 0.9] })
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2
      const leg = cylinder(seating, 0.035, 0.78, [x + Math.cos(angle) * 0.24, 0.42, z + Math.sin(angle) * 0.24], wood)
      leg.rotation.z = Math.cos(angle) * 0.13
      leg.rotation.x = Math.sin(angle) * 0.13
    }
  }
  contacts.push(...seatContacts)

  const bag = actor('stock', kitchenLayout.stock)
  box(bag, [0.74, 0.72, 0.51], [0, 0.36, 0], bagPaper, 0.035)
  box(bag, [0.62, 0.03, 0.4], [0, 0.73, 0], brown)
  for (const z of [-0.19, 0.2]) {
    const handle = new Mesh(new TorusGeometry(0.2, 0.027, 4, 9, Math.PI), brown)
    handle.position.set(0, 0.77, z)
    handle.castShadow = true
    handle.receiveShadow = true
    bag.add(handle)
  }
  const baguette = cylinder(bag, 0.095, 0.78, [0.13, 0.81, 0.04], linen, 0.07)
  baguette.rotation.z = -0.21
  for (let i = 0; i < 3; i++) {
    const broccoli = new Mesh(new DodecahedronGeometry(0.14, 0), i % 2 ? leaf : leafLight)
    broccoli.position.set(-0.19 + i * 0.055, 0.76 + i * 0.07, -0.06)
    bag.add(broccoli)
  }
  box(bag, [0.3, 0.28, 0.009], [0, 0.37, 0.26], paper)
  const bagLeaf = new Mesh(new DodecahedronGeometry(0.073, 0), leaf)
  bagLeaf.scale.set(0.6, 1.2, 0.1)
  bagLeaf.position.set(0, 0.37, 0.277)
  bagLeaf.rotation.z = -0.5
  bag.add(bagLeaf)

  const receiptBook = actor('ledger', kitchenLayout.ledger)
  receiptBook.rotation.y = -0.16
  box(receiptBook, [0.8, 0.065, 0.97], [0, 0, 0], tomato, 0.022)
  const receipts = Array.from({ length: 10 }, (_, i) => {
    const sheet = box(receiptBook, [0.69, 0.011, 0.85], [Math.sin(i * 3) * 0.015, 0.038 + i * 0.012, 0], paper)
    sheet.rotation.y = Math.sin(i * 2) * 0.04
    return sheet
  })
  const receiptLines = new Group()
  for (let i = 0; i < 5; i++) box(receiptLines, [i === 4 ? 0.2 : 0.47, 0.005, 0.017], [i === 4 ? 0.13 : 0, 0, -0.2 + i * 0.11], brown)
  receiptBook.add(receiptLines)

  const envelope = actor('settle', kitchenLayout.settle)
  box(envelope, [0.6, 0.045, 0.44], [0, 0.015, 0], paper, 0.015)
  const seal = cylinder(envelope, 0.05, 0.012, [0, 0.047, 0], tomato)
  seal.rotation.y = 0.4
  for (let i = 0; i < 3; i++) cylinder(envelope, 0.088, 0.02, [-0.17 + i * 0.09, 0.065 + i * 0.025, -0.03], gold)

  const plants: Group[] = []
  const planters: Group[] = []
  const plantContacts: ContactShadow[] = []
  const plant = (position: [number, number, number], scale: number) => {
    const pot = new Group()
    pot.position.set(...position)
    pot.scale.setScalar(scale)
    plantContacts.push({ position: [position[0], position[1] - 0.012, position[2]], size: [0.85 * scale, 0.85 * scale] })
    cylinder(pot, 0.24, 0.5, [0, 0.25, 0], terracotta, 0.32)
    cylinder(pot, 0.31, 0.06, [0, 0.51, 0], terracotta)
    cylinder(pot, 0.28, 0.03, [0, 0.545, 0], brown)
    const branches = new Group()
    branches.position.y = 0.56
    for (let i = 0; i < 6; i++) {
      const angle = i * 2.4
      const stem = cylinder(branches, 0.017, 0.7, [Math.sin(angle) * 0.12, 0.27, Math.cos(angle) * 0.12], leaf)
      stem.rotation.z = Math.sin(angle) * 0.5
      const foliage = new Mesh(new DodecahedronGeometry(0.25, 0), i % 2 ? leaf : leafLight)
      foliage.scale.set(0.65, 1.45, 0.5)
      foliage.position.set(Math.sin(angle) * 0.3, 0.58 + Math.sin(i) * 0.1, Math.cos(angle) * 0.3)
      foliage.rotation.z = -Math.sin(angle) * 0.7
      foliage.castShadow = true
      branches.add(foliage)
    }
    pot.add(branches)
    room.add(pot)
    plants.push(branches)
    planters.push(pot)
  }
  plant(kitchenLayout.plant, 1)
  plant(kitchenLayout.counterPlant, 0.48)
  planters[1].rotation.y = componentPlacements['kitchen-plant-counter']!.rotation!
  contacts.push(...plantContacts)

  const caddy = utility('chores', kitchenLayout.chores)
  box(caddy, [0.78, 0.18, 0.5], [0, 0.12, 0], cabinet, 0.02)
  box(caddy, [0.67, 0.025, 0.39], [0, 0.22, 0], ink)
  for (const x of [-0.32, 0.32]) box(caddy, [0.045, 0.42, 0.045], [x, 0.39, 0], wood)
  box(caddy, [0.68, 0.05, 0.045], [0, 0.6, 0], wood, 0.012)
  cylinder(caddy, 0.09, 0.25, [-0.18, 0.35, 0.09], tomato)
  cylinder(caddy, 0.055, 0.08, [-0.18, 0.515, 0.09], paper)
  box(caddy, [0.18, 0.2, 0.12], [0.16, 0.32, 0.1], paper, 0.014)
  box(caddy, [0.2, 0.05, 0.14], [0.16, 0.44, 0.1], leaf)
  const supplies = utility('supplies', kitchenLayout.supplies)
  box(supplies, [0.075, 1.4, 0.88], [-0.37, 0.56, 0], wood, 0.015)
  for (const y of [0.04, 0.68]) box(supplies, [0.75, 0.07, 0.88], [0, y, 0], lightWood, 0.015)
  for (const [z, mat] of [[-0.2, tomato], [0.2, paper]] as const) {
    cylinder(supplies, 0.095, 0.31, [0.08, 0.23, z], mat)
    cylinder(supplies, 0.05, 0.065, [0.08, 0.415, z], ink)
  }
  box(supplies, [0.33, 0.15, 0.49], [0.08, 0.795, 0], paper, 0.015)
  box(supplies, [0.35, 0.04, 0.5], [0.08, 0.89, 0], leaf)

  const light = new PointLight('#ffca78', 0, 12, 2)
  light.position.set(kitchenLayout.pendant[0], 3.55, kitchenLayout.pendant[2])
  room.add(light)
  const pendant = new Group()
  pendant.position.set(...kitchenLayout.pendant)
  cylinder(pendant, 0.01, 1.25, [0, 0.86, 0], wood)
  cylinder(pendant, 0.48, 0.35, [0, 0.1, 0], terracotta, 0.19)
  const bulb = material('#fff0cc')
  bulb.emissive.set('#ffcc88')
  bulb.emissiveIntensity = 0.12
  cylinder(pendant, 0.44, 0.02, [0, -0.08, 0], bulb)
  room.add(pendant)

  const clock = new Group()
  clock.position.set(...kitchenLayout.clock)
  const rim = cylinder(clock, 0.28, 0.065, [0, 0, 0], wood)
  rim.rotation.x = Math.PI / 2
  const clockFace = cylinder(clock, 0.245, 0.016, [0, 0, 0.041], paper)
  clockFace.rotation.x = Math.PI / 2
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2
    const tick = box(clock, [0.012, 0.035, 0.012], [Math.sin(angle) * 0.204, Math.cos(angle) * 0.204, 0.055], wood)
    tick.rotation.z = -angle
  }
  const hourHand = new Group()
  const minuteHand = new Group()
  box(hourHand, [0.025, 0.14, 0.014], [0, 0.057, 0.07], ink)
  box(minuteHand, [0.016, 0.19, 0.014], [0, 0.08, 0.085], ink)
  clock.add(hourHand, minuteHand)
  room.add(clock)

  const styleMaterials = {
    wall: plaster, trim: wallTrim, floor: tile, floorAlternate: tileAlternate,
    cabinet, cabinetPanel, counter, wood, lightWood, woodGrain,
  }
  componentBindings.set('kitchen-counters', { root: cupboard, finishes: [cabinet, cabinetPanel], contacts: counterContacts, anchor: [4.43, 1.95, -0.4] })
  componentBindings.set('kitchen-sink', { root: sink, finishes: [handles], anchor: [3.5, 2.55, -2.56] })
  componentBindings.set('kitchen-hob', { root: hob, finishes: [ink], anchor: [kitchenLayout.hob[0], 1.95, kitchenLayout.hob[2]] })
  componentBindings.set('kitchen-kettle', { root: kettle, finishes: [tomato], anchor: [kitchenLayout.kettle[0], 2.55, kitchenLayout.kettle[2]] })
  componentBindings.set('kitchen-table', { root: table, finishes: [lightWood, wood, woodGrain], contacts: tableContacts })
  componentBindings.set('kitchen-seating', { root: seating, finishes: [cabinet], contacts: seatContacts, anchor: [2.82, 1.2, 1.3] })
  componentBindings.set('kitchen-rug', { root: rug, finishes: [linen], anchor: [kitchenLayout.rug[0], 0.1, kitchenLayout.rug[2]] })
  componentBindings.set('kitchen-plant-floor', { root: planters[0], finishes: [terracotta], contacts: plantContacts.slice(0, 1) })
  componentBindings.set('kitchen-plant-counter', { root: planters[1], finishes: [terracotta], contacts: plantContacts.slice(1, 2) })
  componentBindings.set('kitchen-curtains', { root: curtains, finishes: [linen, paper], anchor: [2.07, 3.9, -2.94] })
  componentBindings.set('kitchen-light', { root: pendant, finishes: [terracotta], anchor: [0.6, 3.6, 0.78] })
  componentBindings.set('kitchen-clock', { root: clock, finishes: [wood], anchor: [-3.2, 4.48, -3.16] })
  componentBindings.set('kitchen-supply-shelf', { root: supplies, finishes: [wood, lightWood], anchor: [-5.08, 2.55, -1.8] })
  componentBindings.set('kitchen-cleaning-caddy', { root: caddy, finishes: [cabinet], contacts: [{ position: [-3.7, 0.012, 2.78], size: [1.05, 0.75] }], anchor: [-3.7, 1.2, 2.78] })
  componentBindings.set('kitchen-noticeboard', { root: board, finishes: [wood], anchor: [4.3, 4.3, -3.15] })
  componentBindings.set('kitchen-receipt-book', { root: receiptBook, finishes: [tomato], anchor: [-0.18, 1.85, 1.9] })
  componentBindings.set('kitchen-house-pot', { root: jar, finishes: [wood], anchor: [1.7, 2.55, 0.77] })
  componentBindings.set('kitchen-shopping-bag', { root: bag, finishes: [bagPaper], anchor: [-0.54, 2.85, 0.65] })
  componentBindings.set('kitchen-settlement-envelope', { root: envelope, finishes: [paper], anchor: [1.85, 1.9, 1.52] })
  const preserved = new Set([...cabinetBodies, ...coins, ...receipts, ...steam, kettleLid])
  return { actors, utilityActors, coins, portraits, receipts, receiptLines, steam, plants, light, sky, windowDisc, bulb, hourHand, minuteHand, kettleLid, contacts, styleMaterials, componentBindings, componentFixtures, preserved }
}
