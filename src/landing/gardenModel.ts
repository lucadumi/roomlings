import {
  Box3, CylinderGeometry, DodecahedronGeometry, Group, LatheGeometry, Mesh,
  MeshStandardMaterial, OctahedronGeometry, Vector2, Vector3,
} from 'three'
import type { BufferGeometry, Object3D } from 'three'
import { batchStaticMeshes } from '../batchStaticMeshes.ts'
import { roomAccents, roomPresets } from '../roomStyles.ts'

export type GardenSide = 'left' | 'right'
export type GardenFoliage = { object: Object3D; restRotation: number; amplitude: number; phase: number }

type Point = [number, number, number]

export function buildGardenModel(side: GardenSide): {
  root: Group
  bounds: Box3
  foliage: GardenFoliage[]
  materials: MeshStandardMaterial[]
  dispose: () => void
} {
  const root = new Group()
  root.name = `${side === 'left' ? 'Left' : 'Right'} landing garden`
  const materials: MeshStandardMaterial[] = []
  const foliage: GardenFoliage[] = []
  const material = (name: string, color: string, roughness = 0.92) => {
    const result = new MeshStandardMaterial({ color, roughness, flatShading: true })
    result.name = name
    materials.push(result)
    return result
  }
  const green = material('Garden leaves', roomAccents.leaf)
  const fresh = material('Fresh leaf tips', roomAccents.leafLight)
  const dark = material('Shaded leaves and stems', roomAccents.leafDark)
  const tomato = material('Tomato petals', roomAccents.tomato)
  const gold = material('Sunflower yellow', roomAccents.gold)
  const clay = material('Terracotta pots', roomAccents.terracotta)
  const sky = material('Sky blue pot bands', roomAccents.sky)
  const wood = material('Garden branches', roomPresets.original.colors.wood, 0.96)
  const earth = material('Warm garden soil', roomAccents.tomatoDark, 0.98)
  const stone = material('Cream pebbles', roomPresets.original.colors.counter, 0.98)
  const rounded = new DodecahedronGeometry(1, 0)
  // The pointed leaf starts at its stem, so a mesh can sway without orbiting its center.
  const pointed = new OctahedronGeometry(1, 0).translate(0, 1, 0)
  const up = new Vector3(0, 1, 0)

  const group = (parent: Group, name: string, position: Point, rotation: Point = [0, 0, 0]) => {
    const result = new Group()
    result.name = name
    result.position.set(...position)
    result.rotation.set(...rotation)
    parent.add(result)
    return result
  }
  const mesh = (parent: Group, geometry: BufferGeometry, mat: MeshStandardMaterial,
    position: Point, scale: Point = [1, 1, 1]) => {
    const result = new Mesh(geometry, mat)
    result.position.set(...position)
    result.scale.set(...scale)
    result.castShadow = true
    result.receiveShadow = true
    parent.add(result)
    return result
  }
  const sway = (object: Object3D, amplitude: number) => {
    foliage.push({
      object, restRotation: object.rotation.z, amplitude,
      phase: foliage.length * 1.61 + (side === 'left' ? 0.2 : 0.9),
    })
  }
  const branch = (parent: Group, from: Point, to: Point, radius: number, mat = wood) => {
    const start = new Vector3(...from)
    const end = new Vector3(...to)
    const direction = end.clone().sub(start)
    const result = mesh(parent, new CylinderGeometry(radius * 0.6, radius, direction.length(), 6),
      mat, start.add(end).multiplyScalar(0.5).toArray())
    result.quaternion.setFromUnitVectors(up, direction.normalize())
    return result
  }
  const leaf = (parent: Group, position: Point, length: number, width: number,
    rotation: Point, mat: MeshStandardMaterial) => {
    const result = mesh(parent, pointed, mat, position, [width, length / 2, width * 0.38])
    result.name = 'Pointed garden leaf'
    result.rotation.set(...rotation)
    return result
  }
  const crown = (parent: Group, position: Point, scale: Point, mat: MeshStandardMaterial) => {
    const result = mesh(parent, rounded, mat, position, scale)
    result.name = 'Faceted tree crown'
    result.rotation.y = 0.27
    return result
  }
  const pot = (name: string, position: Point, radius: number, height: number, blueBand = false) => {
    const planter = group(root, name, position)
    const profile = [
      [0, 0], [radius * 0.72, 0], [radius * 0.97, height * 0.8],
      [radius * 1.08, height * 0.8], [radius * 1.08, height],
      [radius * 0.87, height], [radius * 0.84, height * 0.77], [0, height * 0.77],
    ]
    mesh(planter, new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), 8),
      clay, [0, 0, 0]).name = 'Tapered pot and thick rim'
    const soilHeight = height * 0.8 + 0.012
    mesh(planter, new CylinderGeometry(radius * 0.83, radius * 0.83, 0.024, 8),
      earth, [0, soilHeight - 0.012, 0]).castShadow = false
    if (blueBand) {
      const band = new LatheGeometry([
        new Vector2(radius * 1.084, height * 0.85),
        new Vector2(radius * 1.084, height * 0.94),
      ], 8)
      mesh(planter, band, sky, [0, 0, 0]).castShadow = false
    }
    return { planter, soilHeight }
  }
  const flower = (parent: Group, position: Point, height: number, radius: number,
    petals: MeshStandardMaterial, lean: number, spin: number) => {
    const stalk = group(parent, petals === tomato ? 'Tomato flower' : 'Sunflower',
      position, [0, 0, lean])
    sway(stalk, 0.02)
    branch(stalk, [0, 0, 0], [0, height, 0], 0.028, dark)
    leaf(stalk, [0, height * 0.32, 0], 0.43, 0.14, [0.15, 0.35, 0.95], green)
    leaf(stalk, [0, height * 0.57, 0], 0.34, 0.12, [-0.2, -0.35, -0.85], fresh)
    const head = group(stalk, 'Flower head', [0, height, 0], [-0.42, 0.55, spin])
    const count = petals === gold ? 7 : 5
    for (let index = 0; index < count; index++) {
      const angle = index * Math.PI * 2 / count
      const petal = mesh(head, rounded, petals,
        [Math.sin(angle) * radius * 0.55, Math.cos(angle) * radius * 0.55, 0],
        [radius * 0.42, radius * 0.57, radius * 0.17])
      petal.rotation.z = -angle
    }
    const center = mesh(head, new CylinderGeometry(radius * 0.36, radius * 0.36, radius * 0.3, 8),
      petals === gold ? earth : gold, [0, 0, radius * 0.11])
    center.rotation.x = Math.PI / 2
  }
  const rosette = (parent: Group, soilHeight: number, lean: number) => {
    const tuft = group(parent, 'Leafy planter tuft', [0, soilHeight, 0], [0, 0, lean])
    sway(tuft, 0.014)
    for (let index = 0; index < 6; index++) {
      leaf(tuft, [0, 0, 0], 0.56 + index % 3 * 0.08, 0.17 + index % 2 * 0.025,
        [0, index * Math.PI / 3 + 0.25, 0.65 + index % 2 * 0.28],
        [green, fresh, dark][index % 3])
    }
    leaf(tuft, [0, 0, 0], 0.62, 0.19, [0.1, 0, 0.08], fresh)
  }
  const pebble = (position: Point, scale: Point, turn: number) => {
    const result = mesh(root, rounded, stone, position, scale)
    result.name = 'Garden pebble'
    result.rotation.y = turn
  }

  if (side === 'left') {
    const tree = pot('Left garden tree', [-0.34, 0, -0.35], 0.54, 0.8)
    tree.planter.rotation.y = -0.08
    branch(tree.planter, [0, tree.soilHeight, 0], [0.05, 2.65, -0.04], 0.13)
    branch(tree.planter, [0, 1.4, 0], [-0.16, 2.1, 0.13], 0.085)

    const high = group(tree.planter, 'High tree branch', [0.04, 2.44, -0.04], [0, 0.04, -0.065])
    sway(high, 0.018)
    branch(high, [0, 0, 0], [0.04, 1.3, 0], 0.065)
    crown(high, [-0.12, 1.54, 0], [0.59, 0.78, 0.52], fresh)
    crown(high, [0.3, 1.18, 0.08], [0.48, 0.57, 0.45], green)
    leaf(high, [0.06, 1.82, 0], 0.45, 0.15, [-0.1, 0.1, -0.2], dark)

    const outer = group(tree.planter, 'Outer tree branch', [0, 2.05, 0.03], [0.03, -0.12, 0.11])
    sway(outer, 0.02)
    branch(outer, [0, 0, 0], [-0.64, 0.84, 0.01], 0.07)
    crown(outer, [-0.56, 1.12, 0], [0.67, 0.73, 0.51], green)
    crown(outer, [-0.89, 0.78, 0.1], [0.4, 0.45, 0.37], dark)

    const inner = group(tree.planter, 'Inner tree branch', [0.025, 2.59, 0.06], [0, 0.15, -0.1])
    sway(inner, 0.016)
    branch(inner, [0, 0, 0], [0.55, 0.57, 0.01], 0.055)
    crown(inner, [0.6, 0.83, 0.06], [0.59, 0.62, 0.48], fresh)
    crown(inner, [0.3, 0.48, 0.29], [0.48, 0.42, 0.45], green)

    const flowers = pot('Left tomato flower planter', [0.64, 0, 0.64], 0.47, 0.58)
    flower(flowers.planter, [-0.14, flowers.soilHeight, -0.08], 1.26, 0.33, tomato, 0.11, 0.08)
    flower(flowers.planter, [0.17, flowers.soilHeight, 0.1], 0.94, 0.29, tomato, -0.14, -0.24)
    const herbs = pot('Left small leaf planter', [-0.94, 0, 0.69], 0.31, 0.39, true)
    rosette(herbs.planter, herbs.soilHeight, -0.06)
    pebble([0.02, 0.075, 1.02], [0.2, 0.075, 0.16], 0.3)
    pebble([-1.26, 0.07, 0.14], [0.17, 0.07, 0.11], 0.8)
    pebble([1.22, 0.06, 0.88], [0.15, 0.06, 0.12], -0.4)
  } else {
    const tree = pot('Right garden shrub', [0.31, 0, -0.39], 0.54, 0.79)
    tree.planter.rotation.y = 0.07
    branch(tree.planter, [0, tree.soilHeight, 0], [-0.14, 3.5, 0], 0.115)
    branch(tree.planter, [-0.07, 1.83, 0], [0.37, 2.46, 0.05], 0.063)
    const leaves: [Point, number, number, Point, MeshStandardMaterial][] = [
      [[-0.05, 1.45, 0.03], 1.05, 0.33, [0.1, -0.2, 1], dark],
      [[-0.08, 1.87, -0.01], 1.21, 0.39, [-0.1, 0.18, -0.86], green],
      [[-0.08, 2.23, 0.06], 1.18, 0.38, [0.1, 0.25, 0.88], fresh],
      [[0.29, 2.36, 0.04], 0.99, 0.33, [-0.14, -0.18, -0.93], dark],
      [[-0.11, 2.68, -0.015], 1.2, 0.36, [-0.09, -0.22, -0.54], green],
      [[-0.13, 2.96, 0.06], 1.18, 0.37, [0.12, 0.3, 0.62], fresh],
      [[-0.14, 3.31, -0.02], 1.21, 0.32, [-0.05, -0.1, -0.15], green],
      [[-0.1, 2.52, -0.04], 0.94, 0.31, [0.65, 0.1, -0.1], dark],
    ]
    leaves.forEach(([position, length, width, rotation, mat], index) => {
      sway(leaf(tree.planter, position, length, width, rotation, mat), 0.014 + index % 3 * 0.004)
    })

    const flowers = pot('Right sunflower planter', [-0.74, 0, 0.61], 0.45, 0.6)
    flower(flowers.planter, [0.04, flowers.soilHeight, -0.04], 1.5, 0.38, gold, 0.09, -0.1)
    flower(flowers.planter, [-0.19, flowers.soilHeight, 0.16], 0.89, 0.27, tomato, 0.17, 0.19)
    const herbs = pot('Right small leaf planter', [0.79, 0, 0.75], 0.32, 0.4, true)
    rosette(herbs.planter, herbs.soilHeight, 0.045)
    pebble([-1.27, 0.07, 0.36], [0.17, 0.07, 0.12], -0.2)
    pebble([-0.03, 0.08, 0.95], [0.22, 0.08, 0.16], 0.5)
    pebble([1.18, 0.06, 0.21], [0.16, 0.06, 0.11], 1.1)
  }

  batchStaticMeshes(root, new Set(foliage.map(({ object }) => object)))
  root.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(root, true)
  // Batching releases retired primitives; this model owns only the retained geometry.
  const geometries = new Set<BufferGeometry>()
  root.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
  let disposed = false
  return {
    root, bounds, foliage, materials,
    dispose() {
      if (disposed) return
      disposed = true
      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((entry) => entry.dispose())
    },
  }
}
