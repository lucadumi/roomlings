import {
  CylinderGeometry, DodecahedronGeometry, Group, Mesh, MeshStandardMaterial,
  PointLight, SphereGeometry, TorusGeometry,
} from 'three'
import { memberColors } from '../shared/domain.ts'
import { daylight, eveningLight } from './lighting.ts'
import type { ContactShadow } from './lighting.ts'

export type KitchenAction = 'stock' | 'ledger' | 'budget' | 'roommates' | 'settle'
export type SceneAction = KitchenAction | 'fridge' | 'light' | 'brew'
export type Shapes = {
  material: (color: string, roughness?: number) => MeshStandardMaterial
  box: (parent: Group, dimensions: [number, number, number], position: [number, number, number], material: MeshStandardMaterial, radius?: number) => Mesh
  cylinder: (parent: Group, radius: number, height: number, position: [number, number, number], material: MeshStandardMaterial, top?: number) => Mesh
}

export const sceneAnchors: { action: KitchenAction | 'brew'; label: string; position: [number, number, number] }[] = [
  { action: 'stock', label: 'Stock the fridge', position: [-0.45, 2.85, 1.08] },
  { action: 'ledger', label: 'Receipt book', position: [0.8, 1.6, 2.1] },
  { action: 'budget', label: 'The house pot', position: [0, 2.75, -2.35] },
  { action: 'roommates', label: 'Your people', position: [3.7, 4.65, -3.15] },
  { action: 'settle', label: 'Settle up', position: [2.35, 1.9, 1.45] },
  { action: 'brew', label: 'Put the kettle on', position: [1.65, 2.5, -2.45] },
]

export function buildRoom(room: Group, { material, box, cylinder }: Shapes) {
  const tile = material('#e4e7d9', 0.86)
  const tileAlternate = material('#d3dcc6', 0.86)
  const plaster = material('#efe3c8')
  const trim = material('#ded0b0')
  const wood = material('#bb895c', 0.82)
  const lightWood = material('#d7ad78', 0.78)
  const woodGrain = material('#c69c6b', 0.84)
  const teal = material('#879f91', 0.64)
  const cabinetPanel = material('#94ac9b', 0.64)
  const counter = material('#f1e9d7', 0.7)
  const ink = material('#5f6857')
  const paper = material('#fff5df', 0.98)
  const tomato = material('#c7593d', 0.6)
  const gold = material('#d4ae50', 0.38)
  gold.metalness = 0.18
  const leaf = material('#789359')
  const leafLight = material('#a2b878')
  const terracotta = material('#c88a69', 0.98)
  const sky = material(daylight.window)
  const linen = material('#ead5b5', 1)
  const handles = material('#e5dfc9', 0.38)
  handles.metalness = 0.12
  const contacts: ContactShadow[] = []
  const actors = new Map<SceneAction, Group>()
  const actor = (action: SceneAction, position: [number, number, number]) => {
    const group = new Group()
    group.position.set(...position)
    group.userData.action = action
    actors.set(action, group)
    room.add(group)
    return group
  }

  box(room, [10.5, 0.25, 6.7], [0, -0.15, 0], lightWood, 0.14)
  for (let x = 0; x < 10; x++) {
    for (let z = 0; z < 6; z++) {
      const square = box(room, [1.015, 0.025, 1.075], [-4.58 + x * 1.017, -0.008, -2.69 + z * 1.078], (x + z) % 2 ? tile : tileAlternate)
      square.castShadow = false
    }
  }
  box(room, [10.5, 4.65, 0.16], [0, 2.2, -3.32], plaster, 0.055)
  box(room, [0.16, 4.65, 3.3], [-5.16, 2.2, -1.75], plaster, 0.055)
  box(room, [10.37, 0.13, 0.055], [0, 0.15, -3.21], trim)
  box(room, [0.06, 0.13, 3.2], [-5.055, 0.15, -1.72], trim)
  for (let x = 0; x < 10; x++) box(room, [0.015, 1.18, 0.015], [-4.6 + x * 1.02, 0.8, -3.227], trim)
  box(room, [10.3, 0.07, 0.055], [0, 1.43, -3.21], trim)

  const window = actor('light', [0.85, 3.26, -3.2])
  box(window, [2.3, 1.85, 0.1], [0, 0, 0], wood, 0.045)
  box(window, [2.1, 1.63, 0.055], [0, 0, 0.065], sky)
  box(window, [0.065, 1.63, 0.06], [0, 0, 0.115], paper)
  box(window, [2.1, 0.065, 0.06], [0, 0, 0.115], paper)
  box(window, [2.5, 0.12, 0.35], [0, -0.96, 0.05], lightWood, 0.015)
  const windowDisc = material(daylight.disc)
  windowDisc.emissive.set(eveningLight.disc)
  windowDisc.emissiveIntensity = 0
  const sun = new Mesh(new CylinderGeometry(0.17, 0.17, 0.015, 12), windowDisc)
  sun.rotation.x = Math.PI / 2
  sun.position.set(0.55, 0.48, 0.105)
  window.add(sun)
  for (const side of [-1, 1]) {
    for (let fold = 0; fold < 3; fold++) {
      box(window, [0.1, 1.83 - fold * 0.07, 0.13], [side * (1.06 + fold * 0.08), 0.04, 0.22 + (fold % 2) * 0.025], fold % 2 ? linen : paper, 0.025)
    }
  }

  const cupboard = new Group()
  cupboard.position.set(2.05, 0, -2.56)
  room.add(cupboard)
  contacts.push({ position: [2.05, 0.007, -2.56], size: [5.1, 1.65] })
  box(cupboard, [4.77, 1.48, 1.18], [0, 0.85, 0], teal, 0.045)
  box(cupboard, [4.88, 0.15, 1.31], [0, 1.66, 0.015], counter, 0.035)
  box(cupboard, [4.6, 0.17, 0.98], [0, 0.15, -0.02], ink)
  for (let i = 0; i < 5; i++) {
    const x = -1.87 + i * 0.935
    box(cupboard, [0.885, 1.28, 0.065], [x, 0.88, 0.61], teal, 0.025)
    box(cupboard, [0.735, 1.08, 0.012], [x, 0.86, 0.65], cabinetPanel, 0.006)
    box(cupboard, [0.24, 0.04, 0.08], [x, 1.31, 0.68], handles, 0.014)
  }
  box(cupboard, [1.05, 0.035, 0.78], [1.3, 1.76, 0], handles, 0.025)
  box(cupboard, [0.86, 0.04, 0.61], [1.3, 1.775, 0], ink, 0.07)
  cylinder(cupboard, 0.035, 0.48, [1.3, 1.99, -0.46], handles)
  box(cupboard, [0.07, 0.07, 0.31], [1.3, 2.2, -0.32], handles, 0.018)
  box(cupboard, [0.95, 0.04, 0.91], [-0.45, 1.76, 0], ink, 0.025)
  for (const x of [-0.67, -0.23]) for (const z of [-0.21, 0.2]) cylinder(cupboard, 0.135, 0.016, [x, 1.79, z], handles)
  const kettle = new Group()
  kettle.position.set(-0.46, 1.8, 0.08)
  kettle.userData.action = 'brew'
  actors.set('brew', kettle)
  cupboard.add(kettle)
  cylinder(kettle, 0.21, 0.025, [0, 0.017, 0], ink)
  cylinder(kettle, 0.22, 0.34, [0, 0.2, 0], tomato, 0.18)
  const kettleLid = cylinder(kettle, 0.18, 0.045, [0, 0.39, 0], ink)
  cylinder(kettle, 0.04, 0.065, [0, 0.44, 0], wood)
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
    puff.position.set(0.34, 0.44 + i * 0.2, 0)
    kettle.add(puff)
    return puff
  })

  const jar = actor('budget', [-0.02, 1.76, -2.46])
  const glass = material('#cfdfc4', 0.3)
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

  const board = actor('roommates', [3.65, 3.2, -3.14])
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
  table.position.set(0.73, 0, 1.14)
  room.add(table)
  box(table, [3.58, 0.18, 1.86], [0, 1.4, 0], lightWood, 0.065)
  for (const z of [-0.31, 0.31]) box(table, [3.4, 0.004, 0.008], [0, 1.493, z], woodGrain)
  box(table, [3.25, 0.24, 1.54], [0, 1.23, 0], wood)
  for (const x of [-1.42, 1.42]) for (const z of [-0.61, 0.61]) {
    box(table, [0.12, 1.2, 0.12], [x, 0.65, z], wood, 0.015)
    contacts.push({ position: [table.position.x + x, 0.042, table.position.z + z], size: [0.42, 0.42] })
  }
  box(room, [4.5, 0.018, 2.7], [0.85, 0.022, 1.69], linen, 0.07)
  for (const z of [0.49, 2.9]) {
    box(room, [4.13, 0.007, 0.095], [0.85, 0.037, z], tomato)
    for (let i = 0; i < 22; i++) box(room, [0.025, 0.012, 0.2], [-1.22 + i * 0.195, 0.032, z + (z > 2 ? 0.21 : -0.21)], paper)
  }
  for (const [x, z] of [[0.6, 2.76], [2.95, 1.26]]) {
    cylinder(room, 0.38, 0.045, [x, 0.765, z], wood)
    cylinder(room, 0.41, 0.12, [x, 0.84, z], teal)
    contacts.push({ position: [x, 0.042, z], size: [1.05, 0.9] })
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2
      const leg = cylinder(room, 0.035, 0.78, [x + Math.cos(angle) * 0.24, 0.42, z + Math.sin(angle) * 0.24], wood)
      leg.rotation.z = Math.cos(angle) * 0.13
      leg.rotation.x = Math.sin(angle) * 0.13
    }
  }

  const bag = actor('stock', [-0.4, 1.51, 1.1])
  box(bag, [0.74, 0.72, 0.51], [0, 0.36, 0], lightWood, 0.035)
  box(bag, [0.62, 0.03, 0.4], [0, 0.73, 0], wood)
  for (const z of [-0.19, 0.2]) {
    const handle = new Mesh(new TorusGeometry(0.2, 0.027, 4, 9, Math.PI), wood)
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

  const receiptBook = actor('ledger', [0.96, 1.54, 1.65])
  receiptBook.rotation.y = -0.16
  box(receiptBook, [0.8, 0.065, 0.97], [0, 0, 0], tomato, 0.022)
  const receipts = Array.from({ length: 10 }, (_, i) => {
    const sheet = box(receiptBook, [0.69, 0.011, 0.85], [Math.sin(i * 3) * 0.015, 0.038 + i * 0.012, 0], paper)
    sheet.rotation.y = Math.sin(i * 2) * 0.04
    return sheet
  })
  const receiptLines = new Group()
  for (let i = 0; i < 5; i++) box(receiptLines, [i === 4 ? 0.2 : 0.47, 0.005, 0.017], [i === 4 ? 0.13 : 0, 0, -0.2 + i * 0.11], wood)
  receiptBook.add(receiptLines)

  const envelope = actor('settle', [2.05, 1.51, 0.88])
  box(envelope, [0.6, 0.045, 0.44], [0, 0.015, 0], paper, 0.015)
  const seal = cylinder(envelope, 0.05, 0.012, [0, 0.047, 0], tomato)
  seal.rotation.y = 0.4
  for (let i = 0; i < 3; i++) cylinder(envelope, 0.088, 0.02, [-0.17 + i * 0.09, 0.065 + i * 0.025, -0.03], gold)

  const plants: Group[] = []
  const plant = (position: [number, number, number], scale: number) => {
    const pot = new Group()
    pot.position.set(...position)
    pot.scale.setScalar(scale)
    contacts.push({ position: [position[0], position[1] - 0.012, position[2]], size: [0.85 * scale, 0.85 * scale] })
    cylinder(pot, 0.24, 0.5, [0, 0.25, 0], terracotta, 0.32)
    cylinder(pot, 0.31, 0.06, [0, 0.51, 0], terracotta)
    cylinder(pot, 0.28, 0.03, [0, 0.545, 0], wood)
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
  }
  plant([-4.29, 0.02, 1.59], 1)
  plant([4.24, 1.76, -2.66], 0.48)

  const light = new PointLight('#ffca78', 0, 8, 2)
  light.position.set(0.5, 3.55, 0.2)
  room.add(light)
  const pendant = new Group()
  pendant.position.set(0.5, 3.45, 0.2)
  cylinder(pendant, 0.01, 1.25, [0, 0.86, 0], wood)
  cylinder(pendant, 0.48, 0.35, [0, 0.1, 0], terracotta, 0.19)
  const bulb = material('#fff0cc')
  bulb.emissive.set('#ffcc88')
  bulb.emissiveIntensity = 0.12
  cylinder(pendant, 0.44, 0.02, [0, -0.08, 0], bulb)
  room.add(pendant)

  const clock = new Group()
  clock.position.set(-2.8, 4.11, -3.16)
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

  return { actors, coins, portraits, receipts, receiptLines, steam, plants, light, sky, windowDisc, bulb, hourHand, minuteHand, kettleLid, contacts }
}
