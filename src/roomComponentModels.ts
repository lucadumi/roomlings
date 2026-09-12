import {
  Box3, CylinderGeometry, DodecahedronGeometry, DoubleSide, Group, LatheGeometry,
  Mesh, MeshStandardMaterial, Shape, ShapeGeometry, Vector2, Vector3,
} from 'three'
import type { ColorRepresentation } from 'three'
import type { RoomStyle } from '../shared/domain.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import type { ComponentModel } from './roomComponentTypes.ts'
import { roomAccents, roomPresets } from './roomStyles.ts'
import type { RoomStyleMaterials } from './roomStyles.ts'
import { buildAdditionalComponentModel } from './additionalComponentModels.ts'
import { componentPlacements } from './roomLayout.ts'
import { buildLivingRoomComponentModel } from './livingRoomComponentModels.ts'
import {
  createRoomMaterial, createRoomMaterialVariant, prepareRoomSurfaceGeometry, roomMaterialSurface, setRoomMaterialSurface,
} from './surfaceMaterials.ts'
import type { RoomSurface } from './surfaceMaterials.ts'
import { createRoomBoxGeometry, createRoomCupGeometry, createRoomTorusGeometry, roomRadialSegments } from './roomGeometry.ts'
import { componentMaterialAppearance, componentMaterialColors } from './componentMaterials.ts'
export { componentPlacements } from './roomLayout.ts'

type Position = [number, number, number]

export function buildRoomComponentModel(component: RoomComponent, style: RoomStyle): ComponentModel {
  const placement = componentPlacements[component.slotId]
  if (!placement) throw new Error(`No designed model position for ${component.slotId}.`)
  const root = new Group()
  root.name = `${component.kind} ${component.variant} model`
  root.position.set(...placement.position)
  const scale = placement.scaleByKind?.[component.kind] ?? placement.scale
  if (typeof scale === 'number') root.scale.setScalar(scale)
  else if (scale) root.scale.set(...scale)
  root.rotation.y = placement.rotation ?? 0
  const materials: MeshStandardMaterial[] = []
  const styleSurfaces = new Map<MeshStandardMaterial, keyof RoomStyleMaterials>()
  const stateObjects: NonNullable<ComponentModel['stateObjects']>[number][] = []
  const material = (name: string, color: ColorRepresentation, roughness = 0.8, finish: RoomSurface = 'paint') => {
    const result = createRoomMaterial(color, roughness, finish, name)
    materials.push(result)
    return result
  }
  const surface = (name: keyof RoomStyleMaterials, finish: RoomSurface = 'paint') => {
    const result = material(name, roomPresets[style].colors[name], 0.8, finish)
    styleSurfaces.set(result, name)
    return result
  }
  const appearance = componentMaterialAppearance(component)
  const paint = appearance
    ? material('Original body finish', appearance.body.color, 0.6, appearance.body.surface) : surface('fridge')
  const edge = appearance
    ? material('Original edge finish', appearance.edge?.color ?? componentMaterialColors.graphite, 0.7, appearance.edge?.surface ?? 'paint')
    : surface('fridgeEdge')
  const wood = surface('wood', 'wood')
  const lightWood = surface('lightWood', 'wood')
  const cream = material('Warm porcelain', componentMaterialColors.ceramic, 0.6, 'ceramic')
  const linen = material('Soft linen', appearance?.textile ?? roomAccents.linen, 0.98, 'fabric')
  const dark = material('Appliance recess', componentMaterialColors.rubber, 0.85, 'rubber')
  const silver = material('Brushed metal', componentMaterialColors.steel, 0.35, 'metal')
  const tomato = material('Tomato detail', roomAccents.tomato)
  const leaf = material('Leaf green', componentMaterialColors.foliage, 0.9, 'foliage')
  const windowGlass = ['washing-machine', 'dryer', 'microwave'].includes(component.kind)
  const glass = material(windowGlass ? 'Smoked appliance window' : 'Clear vessel glass',
    windowGlass ? componentMaterialColors.screen : componentMaterialColors.glass, 0.18, windowGlass ? 'glass' : 'clear-glass')
  const finishes: MeshStandardMaterial[] = [paint]
  const variants = new Map<MeshStandardMaterial, Map<RoomSurface, MeshStandardMaterial>>()
  const variantSources = new Map<MeshStandardMaterial, MeshStandardMaterial>()
  const variant = (source: MeshStandardMaterial, finish: RoomSurface) => {
    if (roomMaterialSurface(source) === finish) return source
    const cached = variants.get(source)?.get(finish)
    if (cached) return cached
    const result = createRoomMaterialVariant(source, finish)
    materials.push(result)
    const binding = styleSurfaces.get(source)
    if (binding) styleSurfaces.set(result, binding)
    const choices = variants.get(source) ?? new Map<RoomSurface, MeshStandardMaterial>()
    choices.set(finish, result)
    variants.set(source, choices)
    variantSources.set(result, source)
    return result
  }
  let indicator: MeshStandardMaterial | undefined
  let contactSize: [number, number] | undefined
  const box = (size: Position, position: Position, mat = paint, radius = 0.015, parent = root) => {
    const mesh = new Mesh(createRoomBoxGeometry(size, radius), mat)
    mesh.position.set(...position)
    mesh.castShadow = !mat.transparent && Math.min(...size) > 0.018
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const cylinder = (radius: number, height: number, position: Position, mat = paint, top = radius, parent = root) => {
    const mesh = new Mesh(new CylinderGeometry(top, radius, height, roomRadialSegments(Math.max(top, radius))), mat)
    mesh.position.set(...position)
    mesh.castShadow = !mat.transparent && radius > 0.02 && height > 0.018
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const disc = (radius: number, depth: number, position: Position, mat = paint, parent = root) => {
    const mesh = cylinder(radius, depth, position, mat, radius, parent)
    mesh.rotation.x = Math.PI / 2
    return mesh
  }
  const ring = (radius: number, tube: number, position: Position, mat = silver, parent = root, arc = Math.PI * 2) => {
    const mesh = new Mesh(createRoomTorusGeometry(radius, tube, arc), mat)
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
    const mesh = cylinder(radius, direction.length(), a.add(b).multiplyScalar(0.5).toArray(), mat, radius, parent)
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize())
    return mesh
  }
  const statusLight = (position: Position) => {
    indicator = material('Manual appliance state', roomAccents.ink, 0.8, 'light')
    indicator.emissive.set(roomAccents.ink)
    indicator.emissiveIntensity = 0.15
    disc(0.025, 0.009, position, indicator)
  }
  const cup = (position: Position) => {
    const [x, y, z] = position
    const vessel = new Mesh(createRoomCupGeometry(0.09, 0.105, 0.15, 0.012), cream)
    vessel.name = 'Cup bowl'
    vessel.position.set(x, y, z)
    vessel.castShadow = vessel.receiveShadow = true
    root.add(vessel)
    cylinder(0.085, 0.006, [x, y + 0.127, z], variant(dark, 'glass')).name = 'Cup contents'
    const handle = ring(0.06, 0.016, [x + 0.097, y + 0.082, z], cream, root, Math.PI)
    handle.name = 'Cup handle'
    handle.rotation.z = -Math.PI / 2
  }
  const clothGroup = (states: readonly string[]) => {
    const group = new Group()
    group.name = 'Manual everyday state'
    root.add(group)
    stateObjects.push({ root: group, states })
    group.visible = states.includes(component.state ?? '')
    return group
  }
  const feet = (width: number, depth: number, height: number) => {
    for (const x of [-width / 2, width / 2]) for (const z of [-depth / 2, depth / 2]) {
      cylinder(height * 1.4, height, [x, height / 2, z], dark)
    }
  }

  const tools = {
    root, box, cylinder, material, finishes, variant, surface: setRoomMaterialSurface,
    palette: { paint, edge, wood, lightWood, cream, linen, dark, silver, tomato, leaf, glass },
  }
  const additional = buildLivingRoomComponentModel(component, tools) ?? buildAdditionalComponentModel(component, tools)
  if (additional) contactSize = additional.contactSize
  else switch (component.kind) {
    case 'dishwasher':
      feet(1.04, 0.95, 0.04)
      box([1.3, 1.43, 1.2], [0, 0.735, 0], paint, 0.035)
      box([1.2, 1.16, 0.05], [0, 0.66, 0.625], paint, 0.025)
      box([1.21, 0.15, 0.055], [0, 1.325, 0.63], silver)
      box([0.67, 0.055, 0.07], [0, 1.17, 0.66], dark)
      for (const x of [-0.43, -0.29]) disc(0.025, 0.012, [x, 1.33, 0.665], dark)
      box([0.23, 0.06, 0.012], [0.23, 1.325, 0.667], dark)
      statusLight([0.47, 1.33, 0.67])
      break
    case 'washing-machine':
    case 'dryer': {
      feet(1.04, 0.95, 0.04)
      box([1.3, 1.46, 1.2], [0, 0.75, 0], paint, 0.055)
      box([1.2, 0.21, 0.035], [0, 1.31, 0.615], variant(cream, 'paint'))
      box([0.4, 0.1, 0.025], [-0.32, 1.32, 0.643], paint)
      disc(0.078, 0.045, [0.17, 1.31, 0.65], silver)
      box([0.16, 0.058, 0.014], [0.39, 1.31, 0.646], dark)
      disc(0.444, 0.085, [0, 0.73, 0.64], silver)
      disc(0.36, 0.014, [0, 0.73, 0.691], dark)
      disc(0.30, 0.01, [0, 0.73, 0.705], glass)
      ring(0.363, 0.03, [0, 0.73, 0.707], cream)
      box([0.075, 0.23, 0.075], [0.335, 0.74, 0.717], dark, 0.03)
      const fabric = clothGroup(['running', 'ready-to-unload'])
      const fold = box([0.37, 0.19, 0.013], [-0.035, 0.57, 0.715],
        variant(component.kind === 'dryer' ? tomato : cream, 'fabric'), 0.025, fabric)
      fold.rotation.z = 0.2
      if (component.kind === 'dryer') {
        for (let i = 0; i < 4; i++) box([0.44, 0.016, 0.025], [-0.26, 0.12 + i * 0.033, 0.62], dark, 0)
      } else box([0.15, 0.12, 0.022], [0.42, 0.17, 0.62], cream)
      statusLight([0.52, 1.31, 0.65])
      contactSize = [1.48, 1.4]
      break
    }
    case 'coffee-machine':
      box([0.63, 0.07, 0.64], [0, 0.035, 0], dark, 0.02)
      if (component.variant === 'filter') {
        box([0.16, 0.66, 0.45], [-0.2, 0.39, -0.08], paint, 0.04)
        cylinder(0.19, 0.2, [0.08, 0.63, -0.015], paint, 0.26)
        cylinder(0.27, 0.045, [0.05, 0.755, -0.015], dark)
        cylinder(0.20, 0.3, [0.09, 0.26, 0.065], glass, 0.155)
        cylinder(0.17, 0.14, [0.09, 0.18, 0.065], dark, 0.155)
        cylinder(0.155, 0.035, [0.09, 0.425, 0.065], cream)
        ring(0.12, 0.026, [0.275, 0.27, 0.065], dark, root, Math.PI).rotation.z = -Math.PI / 2
      } else if (component.variant === 'capsule') {
        box([0.42, 0.59, 0.47], [-0.04, 0.365, -0.08], paint, 0.13)
        box([0.23, 0.12, 0.045], [-0.04, 0.47, 0.177], dark, 0.015)
        box([0.045, 0.035, 0.29], [-0.04, 0.68, -0.08], silver)
        box([0.3, 0.05, 0.23], [-0.02, 0.12, 0.175], silver)
        cup([-0.03, 0.15, 0.17])
      } else {
        box([0.6, 0.59, 0.34], [0, 0.365, -0.12], paint, 0.035)
        box([0.62, 0.14, 0.56], [0, 0.6, -0.015], paint, 0.025)
        box([0.53, 0.042, 0.29], [0, 0.1, 0.145], silver)
        for (const x of [-0.17, 0, 0.17]) disc(0.04, 0.015, [x, 0.6, 0.273], dark)
        cylinder(0.1, 0.045, [-0.05, 0.505, 0.14], silver)
        box([0.055, 0.055, 0.25], [-0.05, 0.49, 0.245], dark)
        rod([0.23, 0.5, 0.14], [0.23, 0.23, 0.23], 0.019)
        cup([-0.055, 0.127, 0.14])
      }
      statusLight([-0.24, 0.11, 0.315])
      break
    case 'grinder': {
      box([0.31, 0.08, 0.34], [0, 0.04, 0], dark, 0.02)
      cylinder(0.13, 0.29, [0, 0.225, -0.025], paint)
      cylinder(0.10, 0.07, [0, 0.405, -0.025], silver, 0.155)
      cylinder(0.155, 0.22, [0, 0.55, -0.025], glass, 0.18)
      cylinder(0.184, 0.035, [0, 0.678, -0.025], dark)
      box([0.1, 0.11, 0.12], [0, 0.31, 0.13], silver)
      const cup = new Mesh(createRoomCupGeometry(0.08, 0.08, 0.12, 0.01), cream)
      cup.name = 'Grounds cup'
      cup.position.set(0, 0.08, 0.14)
      cup.castShadow = cup.receiveShadow = true
      root.add(cup)
      break
    }
    case 'microwave':
      feet(0.49, 0.42, 0.025)
      box([0.66, 0.45, 0.59], [0, 0.24, 0], paint, 0.035)
      box([0.46, 0.32, 0.018], [-0.073, 0.24, 0.306], dark, 0.018)
      box([0.35, 0.23, 0.012], [-0.094, 0.24, 0.322], glass, 0.012)
      box([0.033, 0.26, 0.04], [0.139, 0.24, 0.328], silver)
      disc(0.042, 0.023, [0.248, 0.19, 0.314], dark)
      box([0.097, 0.056, 0.013], [0.248, 0.342, 0.312], dark)
      break
    case 'air-fryer':
      for (const x of [-0.13, 0.13]) for (const z of [-0.15, 0.15]) {
        const foot = cylinder(0.029, 0.04, [x, 0.02, z], dark)
        foot.name = 'Air fryer small foot'
      }
      box([0.53, 0.58, 0.58], [0, 0.305, 0], paint, 0.065).name = 'Air fryer body'
      {
        const doorFrame = disc(0.178, 0.044, [0, 0.27, 0.284], paint)
        doorFrame.name = 'Air fryer round door frame'
        doorFrame.scale.y = 1.16
        const doorGlass = disc(0.142, 0.012, [0, 0.27, 0.304], glass)
        doorGlass.name = 'Air fryer round door window'
        doorGlass.scale.y = 1.18
        for (const x of [-0.115, 0.115]) {
          box([0.04, 0.04, 0.07], [x, 0.35, 0.32], paint, 0.01).name = 'Air fryer handle mount'
        }
        const handle = box([0.29, 0.055, 0.052], [0, 0.35, 0.355], paint, 0.02)
        handle.name = 'Air fryer basket handle'
      }
      box([0.18, 0.04, 0.02], [0, 0.513, 0.287], dark, 0.012).name = 'Air fryer inset controls'
      disc(0.025, 0.02, [0, 0.513, 0.305], silver)
      break
    case 'toaster':
      for (const x of [-0.125, 0.125]) for (const z of [-0.13, 0.13]) {
        const foot = cylinder(0.018, 0.045, [x, 0.0225, z], dark)
        foot.name = 'Toaster small foot'
      }
      box([0.39, 0.29, 0.4], [0, 0.173, 0], paint, 0.065).name = 'Toaster narrow body'
      for (const z of [-0.083, 0.083]) {
        const slot = box([0.25, 0.012, 0.067], [0, 0.324, z], dark, 0.018)
        slot.name = 'Toaster toast slot'
        box([0.21, 0.022, 0.012], [0, 0.326, z + 0.039], silver, 0)
      }
      box([0.028, 0.105, 0.035], [0.21, 0.164, 0], dark)
      box([0.071, 0.043, 0.069], [0.232, 0.195, 0], silver)
      break
    case 'water-filter': {
      const profile = [[0, 0], [0.15, 0], [0.19, 0.1], [0.17, 0.48], [0.17, 0.52], [0, 0.52]]
      const jug = new Mesh(new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), roomRadialSegments(0.19)), glass)
      jug.castShadow = false
      jug.receiveShadow = true
      root.add(jug)
      cylinder(0.18, 0.08, [0, 0.5, 0], paint, 0.185)
      cylinder(0.186, 0.028, [0, 0.555, 0], cream)
      ring(0.16, 0.033, [0.17, 0.3, 0], paint, root, Math.PI).rotation.z = -Math.PI / 2
      box([0.1, 0.055, 0.15], [0, 0.51, 0.145], paint)
      break
    }
    case 'dish-rack': {
      box([0.52, 0.018, 0.39], [0, 0.009, 0], variant(glass, 'rubber'), 0.012)
      for (const z of [-0.19, 0.19]) rod([-0.26, 0.06, z], [0.26, 0.06, z], 0.014, paint)
      for (const x of [-0.26, 0.26]) rod([x, 0.06, -0.19], [x, 0.06, 0.19], 0.014, paint)
      for (const x of [-0.24, 0.24]) for (const z of [-0.17, 0.17]) rod([x, 0.02, z], [x, 0.22, z], 0.013, paint)
      for (const z of [-0.17, 0.17]) rod([-0.24, 0.22, z], [0.24, 0.22, z], 0.014, paint)
      const dishes = clothGroup(['dishes-drying', 'ready-to-put-away'])
      for (let i = 0; i < 4; i++) {
        const z = -0.125 + i * 0.083
        rod([-0.18, 0.06, z - 0.028], [-0.18, 0.18, z + 0.018], 0.011, paint)
        rod([0.18, 0.06, z - 0.028], [0.18, 0.18, z + 0.018], 0.011, paint)
        rod([-0.08, 0.05, z - 0.03], [-0.08, 0.095, z + 0.018], 0.01, paint)
        rod([0.08, 0.05, z - 0.03], [0.08, 0.095, z + 0.018], 0.01, paint)
        const plate = disc(0.135, 0.012, [0, 0.195, z], cream, dishes)
        plate.name = 'Dish rack seated plate'
        plate.rotation.x -= 0.16
      }
      const cupInRack = new Mesh(createRoomCupGeometry(0.055, 0.067, 0.09, 0.008), cream)
      cupInRack.name = 'Dish rack drying cup'
      cupInRack.position.set(-0.145, 0.075, 0.15)
      cupInRack.rotation.z = -0.32
      cupInRack.castShadow = cupInRack.receiveShadow = true
      dishes.add(cupInRack)
      ring(0.04, 0.009, [-0.081, 0.095, 0.151], cream, dishes, Math.PI).rotation.z = -Math.PI / 2
      break
    }
    case 'bins':
      if (component.variant === 'compost') {
        cylinder(0.29, 0.55, [0, 0.275, 0], paint, 0.34).name = 'Bin body'
        cylinder(0.338, 0.07, [0, 0.585, 0], paint, 0.33).name = 'Bin joined lid'
        cylinder(0.312, 0.018, [0, 0.628, 0], edge, 0.306)
        box([0.15, 0.035, 0.068], [0, 0.657, 0], wood, 0.02)
        const handle = ring(0.36, 0.022, [0, 0.31, 0], silver)
        handle.scale.y = 0.74
      } else {
        box([0.65, 0.88, 0.66], [0, 0.44, 0], paint, 0.065).name = 'Bin body'
        box([0.66, 0.086, 0.67], [0, 0.913, 0], paint, 0.055).name = 'Bin joined lid'
        box([0.59, 0.018, 0.6], [0, 0.965, 0], edge, 0.045)
        box([0.2, 0.04, 0.16], [0, 0.07, 0.37], silver)
        if (component.variant === 'recycling') {
          for (let i = 0; i < 3; i++) {
            const angle = i / 3 * Math.PI * 2
            const stripe = box([0.13, 0.035, 0.012], [Math.sin(angle) * 0.09, 0.6 + Math.cos(angle) * 0.09, 0.335], cream, 0)
            stripe.rotation.z = -angle
          }
          box([0.34, 0.024, 0.16], [0, 0.988, 0], dark, 0.04)
        } else box([0.22, 0.038, 0.068], [0, 0.988, 0], wood, 0.018)
      }
      contactSize = [0.88, 0.88]
      break
    case 'vacuum':
      box([0.62, 0.28, 0.42], [-0.08, 0.205, -0.03], paint, 0.09).name = 'Canister vacuum body'
      box([0.3, 0.045, 0.22], [-0.11, 0.365, -0.03], edge, 0.03)
      cylinder(0.1, 0.38, [0.18, 0.235, -0.03], dark, 0.08).rotation.z = Math.PI / 2
      for (const x of [-0.35, 0.12]) {
        const wheel = disc(0.09, 0.055, [x, 0.105, -0.165], dark)
        wheel.name = 'Canister vacuum wheel'
        wheel.rotation.y = Math.PI / 2
      }
      disc(0.075, 0.035, [0.215, 0.255, 0.14], dark).name = 'Canister vacuum hose port'
      const hoseArc = ring(0.145, 0.026, [0.245, 0.36, 0.14], dark, root, Math.PI * 0.96)
      hoseArc.name = 'Canister vacuum hose'
      hoseArc.rotation.z = 0.42
      rod([0.155, 0.31, 0.14], [0.2, 0.34, 0.14], 0.026, dark).name = 'Canister vacuum hose'
      rod([0.37, 0.37, 0.14], [0.43, 0.42, 0.185], 0.023, dark).name = 'Canister vacuum hose'
      rod([0.42, 0.41, 0.185], [0.28, 0.14, 0.33], 0.025, silver).name = 'Canister vacuum wand'
      box([0.38, 0.055, 0.15], [0.28, 0.055, 0.39], paint, 0.035).name = 'Canister vacuum floor head'
      cylinder(0.035, 0.39, [0.28, 0.088, 0.315], silver).rotation.z = Math.PI / 2
      contactSize = [0.87, 0.67]
      break
    case 'plant': {
      const terracotta = material('Terracotta planter', componentMaterialColors.terracotta, 0.95, 'clay')
      const soil = material('Potting soil', componentMaterialColors.soil, 1, 'clay')
      finishes.splice(0, finishes.length, terracotta)
      cylinder(0.24, 0.5, [0, 0.25, 0], terracotta, 0.32)
      cylinder(0.31, 0.06, [0, 0.51, 0], terracotta)
      cylinder(0.28, 0.025, [0, 0.546, 0], soil)
      if (component.variant === 'cactus') {
        cylinder(0.12, 0.57, [0, 0.85, 0], leaf, 0.10)
        disc(0.10, 0.13, [0, 1.14, 0], leaf).rotation.x = 0
        rod([-0.02, 0.76, 0], [-0.2, 0.79, 0], 0.065, leaf)
        cylinder(0.064, 0.24, [-0.2, 0.9, 0], leaf)
        rod([0.02, 0.88, 0], [0.18, 0.94, 0], 0.055, leaf)
        cylinder(0.055, 0.17, [0.18, 1.015, 0], leaf)
        for (const y of [0.73, 0.9, 1.04]) box([0.05, 0.012, 0.015], [0.02, y, 0.118], cream, 0)
      } else {
        const herbs = component.variant === 'herbs'
        for (let i = 0; i < (herbs ? 9 : 6); i++) {
          const angle = i * 2.4
          const x = Math.sin(angle) * (herbs ? 0.21 : 0.3)
          const z = Math.cos(angle) * (herbs ? 0.21 : 0.3)
          const height = herbs ? 0.86 + (i % 3) * 0.07 : 1.14 + Math.sin(i) * 0.1
          rod([x * 0.35, 0.55, z * 0.35], [x, height, z], 0.014, leaf)
          const foliage = new Mesh(new DodecahedronGeometry(herbs ? 0.15 : 0.25, 0), leaf)
          foliage.scale.set(herbs ? 1 : 0.65, herbs ? 0.55 : 1.45, 0.5)
          foliage.position.set(x, height, z)
          foliage.rotation.z = -Math.sin(angle) * 0.7
          foliage.castShadow = true
          root.add(foliage)
        }
      }
      contactSize = [0.85, 0.85]
      break
    }
    case 'table':
      finishes.splice(0, finishes.length, lightWood, wood)
      cylinder(1.79, 0.18, [0, 1.4, 0], lightWood)
      cylinder(0.16, 1.21, [0, 0.685, 0], wood, 0.25)
      cylinder(0.72, 0.13, [0, 0.095, 0], wood, 0.5)
      contactSize = [1.65, 1.65]
      break
    case 'bath': {
      finishes.splice(0, finishes.length, cream)
      box([2.02, 0.2, 3.02], [0, 0.13, 0], cream, 0.075)
      box([1.83, 0.025, 2.81], [0, 0.244, 0], variant(linen, 'rubber'), 0.035)
      cylinder(0.095, 0.015, [0.37, 0.265, -1.06], silver)
      rod([-0.59, 0.3, -1.36], [-0.59, 3.48, -1.36], 0.035)
      rod([-0.59, 3.48, -1.36], [-0.59, 3.48, -0.9], 0.035)
      cylinder(0.22, 0.055, [-0.59, 3.46, -0.82], silver)
      rod([-0.78, 1.22, -1.35], [-0.32, 1.22, -1.35], 0.035)
      const screen = material('Clear shower screen', roomAccents.water, 0.3, 'glass')
      screen.transparent = true
      screen.opacity = 0.22
      screen.depthWrite = false
      screen.side = DoubleSide
      box([0.025, 2.82, 2.58], [0.935, 1.7, -0.16], screen, 0)
      for (const z of [-1.47, 1.16]) rod([0.94, 0.25, z], [0.94, 3.13, z], 0.027)
      rod([0.94, 3.13, -1.47], [0.94, 3.13, 1.16], 0.027)
      contactSize = [2.35, 3.5]
      break
    }
    case 'laundry-basket': {
      setRoomMaterialSurface(paint, 'fabric')
      const basket = new Mesh(createRoomCupGeometry(0.27, 0.42, 0.67, 0.035), paint)
      basket.name = 'Laundry basket hollow body'
      basket.position.set(0, 0, 0)
      basket.castShadow = basket.receiveShadow = true
      root.add(basket)
      cylinder(0.236, 0.012, [0, 0.041, 0], variant(linen, 'fabric'), 0.233).name = 'Laundry basket deep interior'
      const baseRing = ring(0.31, 0.018, [0, 0.055, 0], dark)
      baseRing.rotation.x = Math.PI / 2
      const rim = ring(0.425, 0.029, [0, 0.69, 0], wood)
      rim.rotation.x = Math.PI / 2
      for (let i = 0; i < 12; i++) {
        const angle = i / 12 * Math.PI * 2
        rod([Math.sin(angle) * 0.342, 0.1, Math.cos(angle) * 0.342],
          [Math.sin(angle) * 0.425, 0.65, Math.cos(angle) * 0.425], 0.014, linen)
      }
      const clothes = clothGroup(['filling-up', 'ready-for-washing'])
      box([0.38, 0.08, 0.4], [-0.08, 0.71, 0], variant(cream, 'fabric'), 0.05, clothes)
      box([0.27, 0.1, 0.35], [0.15, 0.745, 0.13], variant(tomato, 'fabric'), 0.04, clothes).rotation.z = 0.24
      contactSize = [1, 1]
      break
    }
    case 'drying-rack': {
      const rackHeight = 1.42
      for (const x of [-0.74, 0.74]) {
        rod([x, 0.05, -0.52], [x, rackHeight, 0.52], 0.023, paint)
        rod([x, 0.05, 0.52], [x, rackHeight, -0.52], 0.023, paint)
      }
      for (const z of [-0.54, 0.54]) rod([-0.95, rackHeight, z], [0.95, rackHeight, z], 0.024, paint).name = 'Drying rack top rail'
      for (let i = 0; i < 7; i++) rod([-0.85 + i * 0.28, rackHeight, -0.54], [-0.85 + i * 0.28, rackHeight, 0.54])
      const clothes = clothGroup(['drying', 'ready-to-fold'])
      box([0.47, 0.58, 0.025], [-0.43, rackHeight - 0.3, 0.06], variant(cream, 'fabric'), 0, clothes)
      box([0.4, 0.44, 0.025], [0.27, rackHeight - 0.23, 0.09], variant(tomato, 'fabric'), 0, clothes)
      contactSize = [1.95, 1.38]
      break
    }
    case 'towel-rack':
      for (const x of [-0.45, 0.45]) {
        disc(0.07, 0.04, [x, 0, 0.025], paint)
        rod([x, 0, 0.025], [x, 0, 0.21], 0.03, silver)
      }
      rod([-0.47, 0, 0.21], [0.47, 0, 0.21], 0.028, silver)
      box([0.63, 0.75, 0.04], [0, -0.36, 0.23], variant(paint, 'fabric'), 0.014)
      box([0.58, 0.032, 0.008], [0, -0.67, 0.255], linen, 0)
      break
    case 'wall-art':
      finishes.splice(0, finishes.length, wood)
      box([0.96, 1.1, 0.07], [0, 0, 0.04], wood, 0.015)
      box([0.82, 0.96, 0.015], [0, 0, 0.086], variant(cream, 'paper'), 0).name = 'Wall art flat canvas'
      {
        const splash = (x: number, y: number, radius: number, mat: MeshStandardMaterial, seed: number) => {
          const shape = new Shape()
          for (let i = 0; i < 11; i++) {
            const angle = i / 11 * Math.PI * 2
            const wobble = 0.66 + (((i * 37 + seed * 19) % 23) / 22) * 0.48
            const px = Math.cos(angle) * radius * wobble
            const py = Math.sin(angle) * radius * (0.72 + (((i * 17 + seed * 11) % 19) / 18) * 0.43)
            if (i === 0) shape.moveTo(px, py)
            else shape.lineTo(px, py)
          }
          shape.closePath()
          const mesh = new Mesh(new ShapeGeometry(shape), mat)
          mesh.name = 'Organic paint splash on canvas'
          mesh.position.set(x, y, 0.098)
          mesh.castShadow = false
          mesh.receiveShadow = true
          root.add(mesh)
          return mesh
        }
        const droplet = (x: number, y: number, radius: number, mat: MeshStandardMaterial) => {
          const mesh = disc(radius, 0.002, [x, y, 0.1], mat)
          mesh.name = 'Paint splash droplet on canvas'
          mesh.castShadow = false
          return mesh
        }
        const splashMaterials = component.variant === 'geometric'
          ? [variant(tomato, 'paper'), variant(leaf, 'paper'), variant(wood, 'paper')]
          : [variant(leaf, 'paper'), variant(tomato, 'paper'), variant(wood, 'paper')]
        splash(-0.15, 0.16, 0.16, splashMaterials[0], 2)
        splash(0.17, -0.06, 0.14, splashMaterials[1], 5).scale.set(0.85, 1.18, 1)
        splash(-0.02, -0.26, 0.105, splashMaterials[2], 8).scale.set(1.45, 0.7, 1)
        for (const [x, y, radius, mat] of [
          [-0.29, -0.06, 0.035, splashMaterials[0]],
          [0.31, 0.18, 0.028, splashMaterials[1]],
          [0.24, -0.3, 0.024, splashMaterials[0]],
          [-0.08, 0.34, 0.022, splashMaterials[2]],
        ] as const) droplet(x, y, radius, mat)
      }
      break
    case 'soap-dispenser':
      cylinder(0.095, 0.26, [0, 0.135, 0], paint, 0.08).name = 'Soap dispenser bottle'
      cylinder(0.033, 0.075, [0, 0.302, 0], silver).name = 'Soap dispenser pump stem'
      box([0.14, 0.035, 0.04], [0.043, 0.35, 0], silver).name = 'Soap dispenser pump spout'
      break
    case 'shower-shelf':
      for (const y of [-0.42, 0]) {
        box([0.9, 0.045, 0.31], [0, y, 0.15], paint)
        box([0.91, 0.065, 0.025], [0, y + 0.04, 0.305], silver)
      }
      for (const x of [-0.36, 0.36]) box([0.045, 0.67, 0.05], [x, -0.15, 0.025], silver)
      cylinder(0.08, 0.31, [-0.21, 0.18, 0.16], cream, 0.06)
      cylinder(0.038, 0.055, [-0.21, 0.363, 0.16], dark)
      cylinder(0.09, 0.23, [0.15, -0.28, 0.16], tomato, 0.07)
      cylinder(0.035, 0.06, [0.15, -0.13, 0.16], cream)
      break
    default:
      materials.forEach((material) => material.dispose())
      throw new Error(`The ${component.kind} uses its original fitted room model.`)
  }

  if (component.kind === 'bath-tray') {
    const width = new Box3().setFromObject(root).getSize(new Vector3()).x
    if (!Number.isFinite(width) || width <= 0) throw new Error('The bath tray needs a finite width.')
    root.scale.x *= 2.05 / width
  }
  const contactWidth = (contactSize?.[0] ?? 0) * root.scale.x
  const contactDepth = (contactSize?.[1] ?? 0) * root.scale.z
  const cosine = Math.abs(Math.cos(root.rotation.y))
  const sine = Math.abs(Math.sin(root.rotation.y))
  const contacts = contactSize ? [{
    position: [placement.position[0], placement.position[1] + 0.003, placement.position[2]] as Position,
    size: [contactWidth * cosine + contactDepth * sine, contactWidth * sine + contactDepth * cosine] as [number, number],
  }] : []
  for (const [copy, source] of variantSources) {
    if (finishes.includes(source)) finishes.push(copy)
  }
  prepareRoomSurfaceGeometry(root)
  return { root, materials, finishes, styleSurfaces, contacts, indicator, stateObjects }
}
