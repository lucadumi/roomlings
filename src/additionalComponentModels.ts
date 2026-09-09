import {
  ConeGeometry, Group, IcosahedronGeometry, LatheGeometry, Mesh, MeshStandardMaterial,
  TorusGeometry, Vector2, Vector3,
} from 'three'
import type { RoomComponent } from '../shared/roomComponents.ts'

type Position = [number, number, number]

export interface AdditionalModelTools {
  root: Group
  box: (size: Position, position: Position, material?: MeshStandardMaterial, radius?: number, parent?: Group) => Mesh
  cylinder: (radius: number, height: number, position: Position, material?: MeshStandardMaterial, top?: number, parent?: Group) => Mesh
  material: (name: string, color: string, roughness?: number) => MeshStandardMaterial
  finishes: MeshStandardMaterial[]
  palette: {
    paint: MeshStandardMaterial
    edge: MeshStandardMaterial
    wood: MeshStandardMaterial
    lightWood: MeshStandardMaterial
    cream: MeshStandardMaterial
    linen: MeshStandardMaterial
    dark: MeshStandardMaterial
    silver: MeshStandardMaterial
    tomato: MeshStandardMaterial
    leaf: MeshStandardMaterial
    glass: MeshStandardMaterial
  }
}

type BuildResult = { contactSize?: [number, number] }

export function buildAdditionalComponentModel(component: RoomComponent, tools: AdditionalModelTools): BuildResult | null {
  const { root, box, cylinder, material, finishes } = tools
  const { paint, edge, wood, lightWood, cream, linen, dark, silver, tomato, leaf, glass } = tools.palette
  const repaint = (...mats: MeshStandardMaterial[]) => finishes.splice(0, finishes.length, ...mats)

  const disc = (radius: number, depth: number, position: Position, mat = paint, parent = root) => {
    const mesh = cylinder(radius, depth, position, mat, radius, parent)
    mesh.rotation.x = Math.PI / 2
    return mesh
  }
  const ring = (radius: number, tube: number, position: Position, mat = silver, parent = root) => {
    const mesh = new Mesh(new TorusGeometry(radius, tube, 5, 16), mat)
    mesh.position.set(...position)
    mesh.castShadow = tube > 0.018
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const rod = (start: Position, end: Position, radius = 0.018, mat = silver, parent = root) => {
    const a = new Vector3(...start)
    const b = new Vector3(...end)
    const direction = b.clone().sub(a)
    const mesh = cylinder(radius, direction.length(), a.add(b).multiplyScalar(0.5).toArray() as Position, mat, radius, parent)
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize())
    return mesh
  }
  const cone = (radius: number, height: number, position: Position, mat = paint, parent = root) => {
    const mesh = new Mesh(new ConeGeometry(radius, height, 8), mat)
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const blob = (radius: number, position: Position, mat = tomato, parent = root) => {
    const mesh = new Mesh(new IcosahedronGeometry(radius, 0), mat)
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const lathe = (profile: readonly [number, number][], position: Position, mat = cream, parent = root) => {
    const mesh = new Mesh(new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), 12), mat)
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const feet = (width: number, depth: number, height: number) => {
    for (const x of [-width / 2, width / 2]) for (const z of [-depth / 2, depth / 2]) {
      cylinder(height * 1.4, height, [x, height / 2, z], dark)
    }
  }
  const cup = (position: Position, mat = cream, handleMat = mat) => {
    const [x, y, z] = position
    cylinder(0.055, 0.09, [x, y + 0.045, z], mat, 0.048)
    cylinder(0.052, 0.007, [x, y + 0.092, z], dark)
    const handle = ring(0.038, 0.011, [x + 0.075, y + 0.05, z], handleMat)
    handle.rotation.y = Math.PI / 2
  }
  const tint = (name: string, base: MeshStandardMaterial, hueShift: number, satBoost = 0, lightShift = 0) => {
    const hsl = { h: 0, s: 0, l: 0 }
    base.color.getHSL(hsl)
    const color = base.color.clone().setHSL(
      (hsl.h + hueShift + 1) % 1,
      Math.min(1, Math.max(0, hsl.s + satBoost)),
      Math.min(0.85, Math.max(0.15, hsl.l + lightShift)),
    )
    return material(name, `#${color.getHexString()}`)
  }

  const apple = tint('Apple red', tomato, -0.02, 0.08, -0.05)
  const banana = tint('Banana yellow', lightWood, 0.05, 0.12, 0.1)
  const citrus = tint('Citrus orange', tomato, 0.05, 0.05, 0.06)
  const lime = tint('Lime green', leaf, 0.03, 0.05, 0.12)
  let contactSize: [number, number] | undefined

  switch (component.kind) {
    case 'oven': {
      feet(1.1, 1.0, 0.035)
      box([1.25, 1.5, 1.2], [0, 0.75, 0], paint, 0.04)
      box([1.2, 0.16, 0.05], [0, 1.42, 0.615], silver, 0.02)
      for (const x of [-0.42, -0.14, 0.14, 0.42]) disc(0.032, 0.016, [x, 1.42, 0.633], dark)
      box([1.14, 1.02, 0.05], [0, 0.66, 0.615], dark, 0.035)
      box([0.98, 0.84, 0.02], [0, 0.66, 0.645], glass, 0.03)
      box([0.9, 0.05, 0.06], [0, 1.15, 0.665], silver, 0.02)
      rod([-0.4, 0.42, 0.62], [0.4, 0.42, 0.62], 0.014, silver)
      rod([-0.4, 0.72, 0.62], [0.4, 0.72, 0.62], 0.014, silver)
      break
    }
    case 'blender': {
      repaint(dark)
      box([0.28, 0.16, 0.28], [0, 0.08, 0], dark, 0.04)
      for (let i = 0; i < 3; i++) box([0.045, 0.02, 0.012], [-0.08 + i * 0.08, 0.1, 0.141], silver, 0.005)
      cylinder(0.16, 0.5, [0, 0.41, 0], glass, 0.2)
      const handle = ring(0.09, 0.017, [0.21, 0.44, 0], dark)
      handle.rotation.y = Math.PI / 2
      cylinder(0.185, 0.04, [0, 0.68, 0], dark, 0.155)
      box([0.05, 0.05, 0.012], [0, 0.16, 0.145], silver, 0.01)
      break
    }
    case 'rice-cooker': {
      cylinder(0.24, 0.32, [0, 0.16, 0], paint, 0.27)
      cylinder(0.28, 0.09, [0, 0.365, 0], cream, 0.16)
      box([0.13, 0.035, 0.05], [0, 0.42, 0.14], dark, 0.02)
      for (const x of [-0.29, 0.29]) {
        const handle = ring(0.04, 0.014, [x, 0.2, 0], dark)
        handle.rotation.y = Math.PI / 2
      }
      box([0.1, 0.055, 0.018], [0, 0.28, 0.265], dark, 0.008)
      cylinder(0.018, 0.03, [0.11, 0.4, 0], silver)
      break
    }
    case 'fruit-bowl': {
      repaint(tomato)
      const bowl = [[0, 0], [0.18, 0], [0.4, 0.14], [0.42, 0.17], [0.38, 0.18], [0, 0.18]] as [number, number][]
      lathe(bowl, [0, 0, 0], tomato)
      cylinder(0.14, 0.03, [0, 0.015, 0], tomato, 0.1)
      blob(0.11, [-0.12, 0.24, 0.06], apple)
      blob(0.12, [0.13, 0.23, -0.05], citrus)
      blob(0.09, [0, 0.27, 0.12], lime)
      const bananaMesh = new Mesh(new TorusGeometry(0.15, 0.045, 5, 12, Math.PI * 0.65), banana)
      bananaMesh.position.set(0.03, 0.24, -0.14)
      bananaMesh.rotation.set(Math.PI / 2, 0.3, 0.4)
      bananaMesh.castShadow = true
      bananaMesh.receiveShadow = true
      root.add(bananaMesh)
      break
    }
    case 'spice-rack': {
      repaint(wood)
      box([0.5, 0.3, 0.03], [0, 0.16, -0.1], wood, 0.02)
      box([0.5, 0.03, 0.1], [0, 0.06, -0.06], wood, 0.01)
      for (const x of [-0.18, -0.09, 0, 0.09, 0.18]) {
        cylinder(0.033, 0.09, [x, 0.145, 0], glass, 0.031)
        disc(0.031, 0.013, [x, 0.194, 0], cream)
      }
      break
    }
    case 'bread-box': {
      repaint(wood)
      box([0.5, 0.28, 0.32], [0, 0.14, 0], wood, 0.03)
      const lid = cylinder(0.16, 0.48, [0, 0.29, -0.005], wood, 0.16)
      lid.rotation.z = Math.PI / 2
      for (const offset of [-0.18, -0.06, 0.06, 0.18]) box([0.018, 0.02, 0.3], [offset, 0.4, 0], edge, 0)
      box([0.12, 0.03, 0.04], [0, 0.44, 0.145], dark, 0.015)
      break
    }
    case 'knife-block': {
      repaint(wood)
      box([0.24, 0.34, 0.22], [0, 0.17, 0], wood, 0.03)
      const knives: [number, number, MeshStandardMaterial][] = [[-0.08, -0.06, dark], [-0.04, 0.05, tomato],
        [0, -0.03, silver], [0.04, 0.06, dark], [0.08, -0.05, tomato]]
      for (const [x, tilt, handleMat] of knives) {
        const blade = box([0.026, 0.2, 0.045], [x, 0.34 + 0.09, 0], silver, 0.006)
        blade.rotation.z = tilt
        const handle = box([0.03, 0.09, 0.05], [x - tilt * 0.09, 0.34 + 0.005, 0], handleMat, 0.01)
        handle.rotation.z = tilt
      }
      break
    }
    case 'cookbook-stand': {
      repaint(wood)
      box([0.34, 0.02, 0.22], [0, 0.01, 0], wood, 0.01)
      const support = box([0.3, 0.26, 0.02], [0, 0.15, -0.08], wood, 0.02)
      support.rotation.x = -0.4
      const left = box([0.14, 0.02, 0.18], [-0.07, 0.14, 0.02], cream, 0.01)
      left.rotation.x = -0.42
      left.rotation.z = 0.03
      const right = box([0.14, 0.02, 0.18], [0.07, 0.14, 0.02], cream, 0.01)
      right.rotation.x = -0.42
      right.rotation.z = -0.03
      box([0.012, 0.02, 0.19], [0, 0.145, 0.015], edge, 0)
      for (let i = 0; i < 3; i++) box([0.1, 0.006, 0.002], [-0.07, 0.19 - i * 0.04, 0.1], edge, 0)
      break
    }
    case 'paper-towel-holder': {
      repaint(wood)
      cylinder(0.1, 0.03, [0, 0.015, 0], wood, 0.1)
      cylinder(0.014, 0.32, [0, 0.19, 0], wood)
      cylinder(0.085, 0.26, [0, 0.19, 0], cream, 0.085)
      const sheet = box([0.16, 0.14, 0.006], [0, 0.06, 0.09], cream, 0.01)
      sheet.rotation.x = 0.35
      break
    }
    case 'storage-jars': {
      repaint(wood)
      box([0.5, 0.02, 0.22], [0, 0.01, 0], wood, 0.02)
      const jars: [number, number, number, MeshStandardMaterial][] = [
        [-0.16, 0.075, 0.2, wood], [0, 0.09, 0.24, lightWood], [0.16, 0.065, 0.17, cream],
      ]
      for (const [x, radius, height, fill] of jars) {
        cylinder(radius, height, [x, 0.02 + height / 2, 0], glass, radius * 0.96)
        disc(radius * 0.75, height * 0.22, [x, 0.02 + height * 0.24, 0], fill)
        cylinder(radius * 0.9, 0.025, [x, 0.02 + height + 0.012, 0], cream, radius * 0.9)
        box([radius * 0.4, 0.03, radius * 0.4], [x, 0.02 + height + 0.038, 0], wood, 0.01)
      }
      break
    }
    case 'kitchen-cart': {
      repaint(wood)
      for (const x of [-0.24, 0.24]) for (const z of [-0.16, 0.16]) rod([x, 0.06, z], [x, 0.82, z], 0.017, silver)
      box([0.52, 0.03, 0.37], [0, 0.4, 0], wood, 0.02)
      box([0.52, 0.03, 0.37], [0, 0.82, 0], wood, 0.02)
      rod([-0.24, 0.85, -0.16], [0.24, 0.85, -0.16], 0.015, silver)
      for (const x of [-0.22, 0.22]) for (const z of [-0.15, 0.15]) {
        const wheel = disc(0.05, 0.03, [x, 0.05, z], dark)
        wheel.rotation.y = Math.PI / 2
      }
      contactSize = [0.6, 0.45]
      break
    }
    case 'pet-bowls': {
      repaint(silver)
      box([0.6, 0.015, 0.35], [0, 0.0075, 0], linen, 0.05)
      for (const x of [-0.15, 0.15]) {
        cylinder(0.1, 0.06, [x, 0.03, 0], silver, 0.13)
        disc(0.09, 0.014, [x, 0.062, 0], dark)
      }
      contactSize = [0.66, 0.4]
      break
    }
    case 'speaker': {
      box([0.32, 0.5, 0.26], [0, 0.25, 0], paint, 0.06)
      box([0.27, 0.4, 0.02], [0, 0.27, 0.135], linen, 0.03)
      ring(0.09, 0.012, [0, 0.36, 0.15], dark)
      ring(0.06, 0.01, [0, 0.16, 0.15], dark)
      disc(0.028, 0.011, [0.1, 0.51, 0], silver)
      break
    }
    case 'air-purifier': {
      cylinder(0.22, 0.85, [0, 0.425, 0], paint, 0.24)
      cylinder(0.25, 0.05, [0, 0.87, 0], dark, 0.2)
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2
        const slat = box([0.03, 0.28, 0.01], [Math.sin(angle) * 0.235, 0.4, Math.cos(angle) * 0.235], dark, 0)
        slat.rotation.y = angle
      }
      box([0.09, 0.06, 0.02], [0, 0.62, 0.235], silver, 0.01)
      contactSize = [0.5, 0.5]
      break
    }
    case 'watering-can': {
      cylinder(0.14, 0.28, [0, 0.14, 0], paint, 0.16)
      cylinder(0.09, 0.02, [0, 0.29, 0], dark, 0.09)
      const spout = cylinder(0.028, 0.32, [0.24, 0.24, 0], paint, 0.02)
      spout.rotation.z = Math.PI / 2.6
      const rose = disc(0.045, 0.015, [0.38, 0.31, 0], dark)
      rose.rotation.y = Math.PI / 2.6 - Math.PI / 2
      const handle = ring(0.14, 0.02, [0, 0.3, 0], paint)
      handle.scale.set(1, 1.3, 0.6)
      handle.rotation.x = Math.PI / 2
      break
    }
    case 'tea-set': {
      repaint(paint, wood)
      box([0.85, 0.03, 0.5], [0, 0.015, 0], wood, 0.03)
      const pot = [[0, 0], [0.14, 0], [0.17, 0.06], [0.16, 0.16], [0.1, 0.2], [0, 0.2]] as [number, number][]
      lathe(pot, [-0.2, 0.03, 0], paint)
      cylinder(0.05, 0.03, [-0.2, 0.24, 0], paint, 0.03)
      box([0.04, 0.025, 0.04], [-0.2, 0.263, 0], dark, 0.01)
      const spout = cylinder(0.022, 0.16, [-0.34, 0.16, 0], paint, 0.014)
      spout.rotation.z = Math.PI / 2.8
      const handle = ring(0.075, 0.016, [-0.05, 0.14, 0], paint)
      handle.rotation.y = Math.PI / 2
      cup([0.1, 0.045, 0.08], cream, cream)
      cup([0.28, 0.045, -0.08], cream, cream)
      break
    }
    case 'bathroom-scales': {
      box([0.65, 0.05, 0.65], [0, 0.025, 0], paint, 0.06)
      box([0.16, 0.01, 0.12], [0, 0.052, 0.18], silver, 0.01)
      box([0.14, 0.008, 0.1], [0, 0.056, 0.18], dark, 0.01)
      for (const x of [-0.26, 0.26]) for (const z of [-0.26, 0.26]) disc(0.02, 0.006, [x, 0.052, z], silver)
      contactSize = [0.7, 0.7]
      break
    }
    case 'hair-dryer': {
      box([0.09, 0.24, 0.1], [0, 0.12, -0.05], paint, 0.035)
      const barrel = cylinder(0.075, 0.34, [0, 0.24, 0.12], paint, 0.07)
      barrel.rotation.x = Math.PI / 2
      cone(0.075, 0.14, [0, 0.24, 0.36], dark)
      disc(0.07, 0.02, [0, 0.24, -0.05], dark)
      box([0.03, 0.05, 0.04], [0.06, 0.24, -0.02], silver, 0.01)
      break
    }
    case 'toothbrush-holder': {
      repaint(cream)
      cylinder(0.055, 0.11, [0, 0.055, 0], cream, 0.05)
      const brushes: [number, number, MeshStandardMaterial][] = [
        [-0.02, 0.03, tomato], [0.02, -0.03, leaf], [0.045, 0.015, silver],
      ]
      for (const [x, z, color] of brushes) {
        rod([x * 0.5, 0.09, z * 0.5], [x * 1.6, 0.25, z * 1.6], 0.011, color)
        box([0.028, 0.05, 0.017], [x * 1.7, 0.28, z * 1.7], cream, 0.006)
      }
      break
    }
    case 'storage-cabinet': {
      feet(0.86, 0.46, 0.03)
      box([0.9, 1.25, 0.5], [0, 0.685, 0], paint, 0.035)
      box([0.94, 0.04, 0.54], [0, 1.33, 0], edge, 0.02)
      box([0.42, 1.1, 0.02], [-0.215, 0.66, 0.26], paint, 0.02)
      box([0.42, 1.1, 0.02], [0.215, 0.66, 0.26], paint, 0.02)
      box([0.012, 1.1, 0.024], [0, 0.66, 0.263], dark, 0)
      box([0.02, 0.14, 0.03], [-0.06, 0.66, 0.28], silver, 0.01)
      box([0.02, 0.14, 0.03], [0.06, 0.66, 0.28], silver, 0.01)
      contactSize = [1.0, 0.6]
      break
    }
    case 'wall-calendar': {
      repaint(wood)
      box([0.62, 0.62, 0.03], [0, 0, -0.015], wood, 0.02)
      box([0.54, 0.54, 0.01], [0, 0, 0.006], cream, 0.01)
      for (let i = -2; i <= 2; i++) box([0.5, 0.006, 0.004], [0, i * 0.09, 0.012], edge, 0)
      for (let i = -2; i <= 2; i++) box([0.006, 0.5, 0.004], [i * 0.1, 0, 0.012], edge, 0)
      const loop = ring(0.03, 0.008, [0, 0.32, -0.01], silver)
      loop.rotation.x = Math.PI / 2
      break
    }
    case 'key-hooks': {
      repaint(wood)
      box([0.6, 0.09, 0.05], [0, 0, -0.02], wood, 0.02)
      for (const x of [-0.2, -0.067, 0.067, 0.2]) {
        box([0.016, 0.06, 0.016], [x, -0.03, 0.02], silver, 0.006)
        blob(0.018, [x, -0.062, 0.02], silver)
      }
      for (const [x, color] of [[-0.2, tomato], [0.067, edge]] as [number, MeshStandardMaterial][]) {
        const head = ring(0.022, 0.008, [x, -0.11, 0.02], color)
        head.rotation.y = Math.PI / 2
        box([0.008, 0.06, 0.01], [x, -0.16, 0.02], silver, 0.003)
      }
      break
    }
    case 'bath-tray': {
      repaint(wood)
      box([2.1, 0.045, 0.28], [0, 0.0225, 0], wood, 0.02)
      box([2.1, 0.05, 0.02], [0, 0.047, 0.12], wood, 0.01)
      box([2.1, 0.05, 0.02], [0, 0.047, -0.12], wood, 0.01)
      box([0.3, 0.05, 0.22], [-0.75, 0.0675, 0], linen, 0.05)
      box([0.28, 0.03, 0.2], [-0.75, 0.1005, 0], linen, 0.04)
      box([0.16, 0.03, 0.12], [0.7, 0.0575, 0], tomato, 0.02)
      box([0.14, 0.024, 0.1], [0.7, 0.0505, 0], cream, 0.01)
      break
    }
    case 'bathroom-stool': {
      repaint(wood)
      box([0.34, 0.04, 0.26], [0, 0.36, 0], wood, 0.03)
      for (const x of [-0.13, 0.13]) for (const z of [-0.09, 0.09]) cylinder(0.024, 0.34, [x, 0.18, z], wood, 0.017)
      for (const z of [-0.09, 0.09]) rod([-0.13, 0.1, z], [0.13, 0.1, z], 0.014, wood)
      contactSize = [0.4, 0.32]
      break
    }
    case 'stand-mixer': {
      box([0.46, 0.16, 0.46], [0, 0.08, 0], paint, 0.045)
      const bowl = [[0, 0], [0.16, 0], [0.19, 0.05], [0.18, 0.2], [0.14, 0.22], [0, 0.22]] as [number, number][]
      lathe(bowl, [0.02, 0.16, 0], silver)
      box([0.14, 0.5, 0.14], [-0.26, 0.33, 0], paint, 0.03)
      box([0.42, 0.13, 0.16], [-0.02, 0.615, 0], paint, 0.03)
      box([0.16, 0.24, 0.16], [0.19, 0.48, 0], paint, 0.03)
      disc(0.05, 0.02, [0.19, 0.36, 0], silver)
      rod([0.19, 0.36, 0], [0.19, 0.22, 0], 0.012, silver)
      box([0.05, 0.05, 0.03], [-0.02, 0.53, 0.1], dark, 0.01)
      break
    }
    case 'waffle-maker': {
      box([0.34, 0.09, 0.28], [0, 0.045, 0], paint, 0.02)
      box([0.26, 0.02, 0.2], [0, 0.095, 0.02], dark, 0.01)
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
        box([0.02, 0.008, 0.02], [ix * 0.08, 0.105, 0.02 + iz * 0.06], silver, 0.003)
      }
      const lid = box([0.34, 0.06, 0.28], [0.01, 0.14, -0.03], paint, 0.02)
      lid.rotation.x = -0.32
      rod([-0.14, 0.155, -0.15], [0.14, 0.155, -0.15], 0.012, silver)
      box([0.1, 0.03, 0.05], [0, 0.2, 0.06], dark, 0.01)
      disc(0.014, 0.008, [0.14, 0.09, 0.13], tomato)
      break
    }
    case 'kitchen-scale': {
      box([0.3, 0.04, 0.24], [0, 0.02, 0], paint, 0.02)
      box([0.08, 0.006, 0.05], [0, 0.043, 0.075], dark, 0.008)
      cylinder(0.1, 0.02, [0, 0.05, -0.02], silver, 0.11)
      const rim = ring(0.1, 0.01, [0, 0.061, -0.02], silver)
      rim.rotation.x = Math.PI / 2
      break
    }
    case 'cutting-boards': {
      repaint(wood, lightWood)
      box([0.5, 0.03, 0.16], [0, 0.015, 0], wood, 0.02)
      box([0.03, 0.14, 0.16], [-0.22, 0.09, 0], wood, 0.01)
      box([0.03, 0.14, 0.16], [0.22, 0.09, 0], wood, 0.01)
      const board1 = box([0.4, 0.34, 0.02], [-0.09, 0.19, 0], wood, 0.015)
      board1.rotation.z = 0.12
      const board2 = box([0.38, 0.3, 0.02], [0.1, 0.17, 0.005], lightWood, 0.015)
      board2.rotation.z = -0.12
      const hole1 = ring(0.025, 0.006, [-0.09, 0.33, 0.011], wood)
      hole1.rotation.x = Math.PI / 2
      const hole2 = ring(0.025, 0.006, [0.1, 0.3, 0.016], lightWood)
      hole2.rotation.x = Math.PI / 2
      break
    }
    case 'mug-tree': {
      repaint(wood)
      cylinder(0.14, 0.03, [0, 0.015, 0], wood, 0.13)
      cylinder(0.02, 0.5, [0, 0.28, 0], wood)
      const mugColors: MeshStandardMaterial[] = [apple, citrus, lime, cream]
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2
        const dx = Math.sin(angle) * 0.1
        const dz = Math.cos(angle) * 0.1
        rod([0.02 * Math.sin(angle), 0.42, 0.02 * Math.cos(angle)], [dx, 0.42, dz], 0.013, wood)
        cup([dx * 1.2, 0.34, dz * 1.2], mugColors[i], mugColors[i])
      }
      break
    }
    case 'cereal-dispenser': {
      repaint(wood)
      box([0.22, 0.05, 0.18], [0, 0.025, 0], wood, 0.02)
      const hopper = [[0, 0], [0.03, 0], [0.03, 0.05], [0.12, 0.05], [0.12, 0.31], [0.1, 0.33], [0, 0.33]] as [number, number][]
      lathe(hopper, [0, 0.05, 0], glass)
      cylinder(0.09, 0.14, [0, 0.24, 0], lightWood, 0.08)
      disc(0.1, 0.02, [0, 0.38, 0], wood)
      cylinder(0.025, 0.03, [0, 0.06, 0.1], dark, 0.02)
      break
    }
    case 'egg-basket': {
      repaint(wood, lightWood)
      const basket = [[0, 0], [0.12, 0], [0.16, 0.05], [0.17, 0.1], [0.15, 0.14], [0, 0.14]] as [number, number][]
      lathe(basket, [0, 0, 0], wood)
      const weave = ring(0.15, 0.006, [0, 0.06, 0], lightWood)
      weave.rotation.x = Math.PI / 2
      const handle = ring(0.13, 0.012, [0, 0.14, 0], wood)
      handle.rotation.x = Math.PI / 2
      handle.scale.set(1, 1.4, 0.5)
      const eggPositions: [number, number][] = [[-0.05, 0.02], [0.05, -0.01], [0, 0.06], [-0.03, -0.05], [0.06, 0.04]]
      for (const [x, z] of eggPositions) {
        const egg = blob(0.042, [x, 0.1, z], cream)
        egg.scale.set(1, 1.3, 1)
      }
      break
    }
    case 'wall-shelf': {
      repaint(wood)
      box([0.9, 0.04, 0.22], [0, 0, 0.1], wood, 0.02)
      box([0.9, 0.05, 0.03], [0, 0, -0.01], wood, 0.015)
      box([0.03, 0.08, 0.16], [-0.4, -0.04, 0.08], wood, 0.01)
      box([0.03, 0.08, 0.16], [0.4, -0.04, 0.08], wood, 0.01)
      const books: [number, MeshStandardMaterial][] = [[-0.28, tomato], [-0.2, dark], [-0.12, leaf], [0.14, apple]]
      for (const [x, color] of books) box([0.03, 0.16, 0.14], [x, 0.1, 0.12], color, 0.006)
      box([0.16, 0.03, 0.13], [0.28, 0.035, 0.12], citrus, 0.008)
      break
    }
    case 'ironing-board': {
      repaint(paint, linen)
      box([1.4, 0.035, 0.6], [-0.2, 0.8, 0], wood, 0.02)
      box([1.35, 0.02, 0.62], [-0.2, 0.821, 0], linen, 0.02)
      const nose = cone(0.3, 0.4, [0.7, 0.8, 0], wood)
      nose.rotation.z = -Math.PI / 2
      const footA: Position = [-0.75, 0, -0.25]
      const footB: Position = [-0.75, 0, 0.25]
      const attachA: Position = [0.1, 0.78, 0.25]
      const attachB: Position = [0.1, 0.78, -0.25]
      rod(footA, attachB, 0.022, silver)
      rod(footB, attachA, 0.022, silver)
      rod([-0.75, 0.35, -0.25], [-0.75, 0.35, 0.25], 0.018, silver)
      disc(0.03, 0.015, footA, dark)
      disc(0.03, 0.015, footB, dark)
      box([0.22, 0.11, 0.11], [0, 0.885, 0.15], paint, 0.03)
      const ironNose = cone(0.05, 0.16, [0.13, 0.885, 0.15], paint)
      ironNose.rotation.z = -Math.PI / 2
      box([0.22, 0.02, 0.11], [0, 0.83, 0.15], silver, 0.02)
      const ironHandle = ring(0.06, 0.012, [0, 0.95, 0.15], dark)
      ironHandle.scale.set(1, 0.6, 1.3)
      ironHandle.rotation.x = Math.PI / 2
      contactSize = [1.8, 0.6]
      break
    }
    case 'toilet-brush': {
      const holder = [[0, 0], [0.06, 0], [0.065, 0.02], [0.05, 0.28], [0.045, 0.3], [0, 0.3]] as [number, number][]
      lathe(holder, [0, 0, 0], paint)
      disc(0.062, 0.012, [0, 0.3, 0], dark)
      rod([0, 0.28, 0], [0, 0.7, 0], 0.014, silver)
      cylinder(0.022, 0.05, [0, 0.73, 0], dark, 0.018)
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2
        rod([0, 0.75, 0], [Math.sin(angle) * 0.045, 0.775, Math.cos(angle) * 0.045], 0.006, leaf)
      }
      break
    }
    case 'shower-squeegee': {
      box([0.08, 0.03, 0.04], [0, 0.36, 0.015], silver, 0.01)
      rod([0, 0.36, 0.03], [0, 0.36, 0.06], 0.012, silver)
      const handleRing = ring(0.025, 0.008, [0, 0.35, 0.02], silver)
      handleRing.rotation.x = Math.PI / 2
      box([0.035, 0.55, 0.035], [0, 0.08, 0.05], paint, 0.012)
      box([0.55, 0.05, 0.02], [0, -0.22, 0.07], dark, 0.015)
      box([0.55, 0.09, 0.012], [0, -0.29, 0.075], dark, 0.008)
      break
    }
    case 'tissue-box': {
      box([0.24, 0.11, 0.14], [0, 0.055, 0], paint, 0.015)
      const rim = ring(0.06, 0.01, [0, 0.111, 0], cream)
      rim.rotation.x = Math.PI / 2
      rim.scale.set(1.4, 1, 0.6)
      const sheetA = box([0.05, 0.05, 0.008], [0, 0.135, 0], cream, 0.01)
      sheetA.rotation.z = 0.3
      const sheetB = box([0.045, 0.045, 0.008], [0.01, 0.14, 0.01], cream, 0.01)
      sheetB.rotation.z = -0.25
      sheetB.rotation.x = 0.2
      break
    }
    case 'first-aid-kit': {
      box([0.26, 0.16, 0.18], [0, 0.08, 0], paint, 0.02)
      box([0.27, 0.01, 0.19], [0, 0.16, 0], dark, 0.01)
      box([0.14, 0.02, 0.005], [0, 0.09, 0.091], leaf, 0.005)
      box([0.02, 0.14, 0.005], [0, 0.09, 0.091], leaf, 0.005)
      const handle = ring(0.05, 0.012, [0, 0.17, 0], dark)
      handle.scale.set(1, 0.5, 1.2)
      handle.rotation.x = Math.PI / 2
      box([0.03, 0.02, 0.01], [-0.08, 0.05, 0.091], silver, 0.005)
      box([0.03, 0.02, 0.01], [0.08, 0.05, 0.091], silver, 0.005)
      break
    }
    case 'reed-diffuser': {
      repaint(wood, lightWood)
      disc(0.09, 0.015, [0, 0.0075, 0], wood)
      const bottle = [[0, 0], [0.055, 0], [0.06, 0.09], [0.045, 0.12], [0.02, 0.13], [0.02, 0.16], [0, 0.16]] as [number, number][]
      lathe(bottle, [0, 0.015, 0], glass)
      cylinder(0.045, 0.07, [0, 0.05, 0], lightWood, 0.045)
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2
        const dx = Math.sin(angle) * 0.015
        const dz = Math.cos(angle) * 0.015
        rod([dx, 0.16, dz], [dx * 8, 0.42, dz * 8], 0.006, lightWood)
      }
      break
    }
    case 'board-game': {
      repaint(wood)
      box([0.5, 0.03, 0.5], [0, 0.015, 0], wood, 0.02)
      for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
        const isDark = (r + c) % 2 === 0
        box([0.065, 0.01, 0.065], [-0.175 + c * 0.07, 0.036, -0.175 + r * 0.07], isDark ? dark : cream, 0.004)
      }
      const dieA = box([0.045, 0.045, 0.045], [0.15, 0.0525, 0.15], cream, 0.006)
      dieA.rotation.y = 0.4
      const dieB = box([0.04, 0.04, 0.04], [0.18, 0.05, -0.13], cream, 0.006)
      dieB.rotation.y = -0.25
      for (const [x, z] of [[0.14, 0.13], [0.16, 0.17], [0.18, 0.15]] as [number, number][]) {
        cylinder(0.006, 0.006, [x, 0.078, z], dark, 0.006)
      }
      const tokens: [number, number, MeshStandardMaterial][] = [[-0.18, -0.18, apple], [0.18, -0.18, lime], [-0.18, 0.05, silver]]
      for (const [x, z, color] of tokens) cylinder(0.022, 0.03, [x, 0.05, z], color, 0.014)
      break
    }
    case 'record-player': {
      repaint(wood)
      box([0.42, 0.06, 0.32], [0, 0.03, 0], wood, 0.02)
      cylinder(0.15, 0.015, [-0.02, 0.068, 0.02], dark, 0.15)
      cylinder(0.14, 0.006, [-0.02, 0.077, 0.02], dark, 0.14)
      disc(0.04, 0.008, [-0.02, 0.081, 0.02], tomato)
      const groove = ring(0.1, 0.003, [-0.02, 0.081, 0.02], silver)
      groove.rotation.x = Math.PI / 2
      cylinder(0.006, 0.02, [-0.02, 0.088, 0.02], silver)
      cylinder(0.02, 0.03, [0.16, 0.075, -0.1], silver, 0.02)
      rod([0.16, 0.09, -0.1], [0.02, 0.085, 0.06], 0.008, silver)
      box([0.03, 0.012, 0.02], [0.02, 0.083, 0.06], dark, 0.004)
      cylinder(0.014, 0.01, [0.15, 0.062, 0.13], silver, 0.014)
      cylinder(0.014, 0.01, [0.19, 0.062, 0.13], silver, 0.014)
      break
    }
    default:
      return null
  }

  return { contactSize }
}
