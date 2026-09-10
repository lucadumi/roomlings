import {
  BoxGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Group,
  Mesh, MeshStandardMaterial, PointLight, SphereGeometry,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Category, RoomStyle } from '../shared/domain.ts'
import { buildRoom } from './room.ts'
import { roomAccents, roomPresets } from './roomStyles.ts'
import { kitchenLayout } from './roomLayout.ts'

export function buildKitchenModel(room: Group, style: RoomStyle = 'original') {
  const kitchen = new Group()
  kitchen.position.set(...kitchenLayout.fridge)
  kitchen.userData.action = 'fridge'
  room.add(kitchen)
  const materials: MeshStandardMaterial[] = []
  const material = (color: string, roughness = 0.9) => {
    const result = new MeshStandardMaterial({ color, roughness, flatShading: true })
    materials.push(result)
    return result
  }
  const palette = roomPresets[style].colors
  const sage = material(palette.fridge, 0.6)
  const lightSage = material(palette.fridgeDoor, 0.6)
  const edge = material(palette.fridgeEdge)
  const porcelain = material(roomAccents.cream, 0.65)
  const inside = material('#dce3d0')
  const dark = material(roomAccents.ink)
  const silver = material(roomAccents.metal, 0.34)
  silver.metalness = 0.18
  const milk = material('#f8f3de')
  const blue = material(roomAccents.blue)
  const red = material(roomAccents.tomato)
  const orange = material(roomAccents.orange)
  const green = material(roomAccents.leaf)
  const yellow = material(roomAccents.gold)
  const bread = material('#c69150')
  const berry = material(roomAccents.berry)

  const box = (parent: Group, dimensions: [number, number, number], position: [number, number, number], mat: MeshStandardMaterial, radius = 0) => {
    const geometry = radius ? new RoundedBoxGeometry(...dimensions, 1, radius) : new BoxGeometry(...dimensions)
    const mesh = new Mesh(geometry, mat)
    mesh.position.set(...position)
    mesh.castShadow = !mat.transparent && Math.min(...dimensions) > 0.018
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const cylinder = (parent: Group, radius: number, height: number, position: [number, number, number], mat: MeshStandardMaterial, top = radius) => {
    const mesh = new Mesh(new CylinderGeometry(top, radius, height, 8), mat)
    mesh.position.set(...position)
    mesh.castShadow = !mat.transparent && radius >= 0.025 && height > 0.02
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const scenery = buildRoom(room, { material, box, cylinder }, style)
  const styleMaterials = { ...scenery.styleMaterials, fridge: sage, fridgeDoor: lightSage, fridgeEdge: edge }
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
  const foodMaterials: Record<Category, MeshStandardMaterial> = { produce: red, dairy: milk, pantry: yellow, drinks: blue, other: berry }
  scenery.componentBindings.set('kitchen-fridge', {
    root: kitchen, finishes: [sage, lightSage, edge], anchor: [kitchen.position.x, 3.95, kitchen.position.z + 0.15],
    contacts: [{ position: [kitchen.position.x, 0.007, kitchen.position.z], size: [2.55, 2.1] }],
  })
  return { kitchen, scenery, materials, doors, foods, iceTray, interiorLight, foodMaterials, styleMaterials }
}
