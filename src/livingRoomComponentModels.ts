import { Group, LatheGeometry, Mesh, Vector2, Vector3 } from 'three'
import type { MeshStandardMaterial } from 'three'
import type { RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import type { AdditionalModelTools } from './additionalComponentModels.ts'
import { roomAccents } from './roomStyles.ts'

type Position = [number, number, number]
type Placement = { position: Position; scale?: number | Position; rotation?: number }

export const livingRoomPlacements = {
  'living-room-sofa': { position: [-0.4, 0.022, -2.09] },
  'living-room-coffee-table': { position: [-0.95, 0.022, 0.35] },
  'living-room-media-unit': { position: [-4.08, 0.022, -0.85], rotation: Math.PI / 2 },
  'living-room-tv': { position: [-4.08, 1.072, -0.4], rotation: Math.PI / 2 },
  'living-room-bookshelf': { position: [3.9, 0.022, -2.68] },
  'living-room-floor-lamp': { position: [2.78, 0.022, -1.26] },
  'living-room-rug': { position: [-0.35, 0.021, 0.25] },
  'living-room-plant': { position: [3.0, 0.022, 1.13] },
  'living-room-curtains': { position: [-0.55, 0, -3.1] },
  'living-room-supply-shelf': { position: [4.16, 0.022, 0.25] },
  'living-room-cleaning-caddy': { position: [2.55, 0.022, 2.64] },
  'living-room-bins': { position: [4.2, 0.022, 2.23], scale: 0.76 },
  'living-room-table-top': { position: [-0.95, 0.855, 0.35], scale: 0.9 },
  'living-room-media-accessory': { position: [-4.08, 1.075, -2.09], scale: 0.76, rotation: Math.PI / 2 },
  'living-room-shelf-accessory': { position: [4.3, 1.345, -2.64], scale: 0.58 },
  'living-room-wall-art': { position: [2.43, 3.55, -3.145], scale: 0.85 },
  'living-room-cleaning-station': { position: [4.2, 0.022, 1.25], scale: 0.85 },
  'living-room-windowsill': { position: [-0.95, 2.143, -2.98], scale: 0.43 },
} satisfies Partial<Record<RoomSlotId, Placement>>

export const livingRoomWindow = { left: -2.65, right: 1.55, bottom: 2.14, top: 4.08, wallZ: -3.23 } as const
export const livingRoomLampPosition: Position = [2.78, 2.382, -1.26]

export function buildLivingRoomComponentModel(
  component: RoomComponent, tools: AdditionalModelTools,
): { contactSize?: [number, number] } | null {
  const { root, box, cylinder, material, finishes } = tools
  const { paint, edge, wood, lightWood, cream, linen, dark, silver, tomato } = tools.palette
  const fittedOriginal = component.roomId === 'living-room' && component.variant === 'original'
  const repaint = (...surfaces: MeshStandardMaterial[]) => finishes.splice(0, finishes.length, ...surfaces)
  const rod = (start: Position, end: Position, radius: number, mat = wood) => {
    const from = new Vector3(...start)
    const to = new Vector3(...end)
    const direction = to.clone().sub(from)
    const mesh = cylinder(radius, direction.length(), from.add(to).multiplyScalar(0.5).toArray(), mat)
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize())
    return mesh
  }
  const book = (position: Position, size: Position, cover: MeshStandardMaterial, upright = false) => {
    const group = new Group()
    group.position.set(...position)
    root.add(group)
    box(size, [0, 0, 0], cover, 0.012, group)
    box(upright ? [size[0] * 0.7, size[1] * 0.89, size[2] + 0.006]
      : [size[0] * 0.94, size[1] * 0.55, size[2] + 0.006], [0, 0, 0.005], linen, 0, group)
    return group
  }
  const bottle = (position: Position, height: number, color: MeshStandardMaterial) => {
    const [x, y, z] = position
    cylinder(0.09, height, [x, y + height / 2, z], color, 0.073)
    cylinder(0.035, 0.075, [x, y + height + 0.0375, z], cream)
    box([0.12, height * 0.36, 0.015], [x, y + height * 0.52, z + 0.088], linen, 0.005)
  }

  switch (component.kind) {
    case 'sofa': {
      repaint(paint, edge)
      const corner = component.variant !== 'straight'
      for (const x of [-1.95, 1.95]) for (const z of [-0.57, 0.57]) {
        cylinder(0.075, 0.25, [x, 0.135, z], wood, 0.06)
      }
      box([4.45, 0.32, 1.44], [0, 0.43, 0], edge, 0.1)
      box([4.45, 0.93, 0.28], [0, 1.14, -0.65], paint, 0.09)
      for (const x of [-2.12, 2.12]) {
        const chaiseArm = corner && x > 0
        box([0.32, 0.79, chaiseArm ? 2.5 : 1.65], [x, 0.77, chaiseArm ? 0.46 : 0.02], paint, 0.1)
      }
      if (corner) {
        for (const x of [0.82, 1.95]) cylinder(0.075, 0.25, [x, 0.135, 1.47], wood, 0.06)
        box([1.53, 0.32, 2.44], [1.36, 0.43, 0.5], edge, 0.08)
      }
      for (const x of [-1.36, 0, 1.36]) {
        const chaiseSeat = corner && x > 1
        box([1.28, 0.23, chaiseSeat ? 2.18 : 1.14], [x, 0.705, chaiseSeat ? 0.59 : 0.1], paint, 0.075)
        const cushion = box([1.3, 0.68, 0.29], [x, 1.225, -0.415], paint, 0.085)
        cushion.rotation.x = -0.11
      }
      const warmCushion = box([0.54, 0.5, 0.24], [-1.39, 1.12, -0.11], tomato, 0.09)
      warmCushion.rotation.set(-0.2, 0.05, 0.18)
      const paleCushion = box([0.49, 0.48, 0.23], [0.48, 1.105, -0.1], linen, 0.08)
      paleCushion.rotation.set(-0.18, -0.1, -0.18)
      box([0.65, 0.04, 0.77], [-1.39, 0.837, 0.34], linen, 0.015)
      box([0.65, 0.39, 0.035], [-1.39, 0.655, 0.743], linen, 0.012)
      for (const x of [-1.61, -1.49, -1.37, -1.25, -1.13]) {
        box([0.025, 0.1, 0.026], [x, 0.43, 0.746], linen, 0)
      }
      return { contactSize: [4.85, 1.9] }
    }
    case 'coffee-table': {
      repaint(wood, lightWood)
      if (component.variant === 'round') {
        cylinder(1.07, 0.14, [0, 0.76, 0], lightWood)
        cylinder(0.92, 0.12, [0, 0.67, 0], wood)
        for (let i = 0; i < 3; i++) {
          const angle = i * Math.PI * 2 / 3
          rod([Math.cos(angle) * 0.87, 0.035, Math.sin(angle) * 0.87],
            [Math.cos(angle) * 0.65, 0.69, Math.sin(angle) * 0.65], 0.06)
        }
        cylinder(0.67, 0.05, [0, 0.245, 0], wood)
        book([0, 0.32, 0], [0.52, 0.1, 0.38], tomato)
        return { contactSize: [2.2, 2.2] }
      }
      box([2.45, 0.14, 1.38], [0, 0.76, 0], lightWood, 0.1)
      box([2.16, 0.12, 1.11], [0, 0.67, 0], wood, 0.025)
      for (const x of [-0.96, 0.96]) for (const z of [-0.45, 0.45]) {
        cylinder(0.065, 0.69, [x, 0.345, z], wood, 0.045)
      }
      box([1.87, 0.06, 0.86], [0, 0.25, 0], wood, 0.02)
      book([-0.45, 0.325, 0], [0.63, 0.09, 0.49], tomato)
      book([-0.4, 0.406, 0.015], [0.57, 0.07, 0.45], paint).rotation.y = 0.1
      return { contactSize: [2.65, 1.62] }
    }
    case 'tv': {
      repaint(dark)
      const screen = material('TV off screen', roomAccents.ink, 0.32)
      box([2.08, 1.22, 0.105], [0, 0.82, 0], dark, 0.035)
      box([1.94, 1.075, 0.014], [0, 0.837, 0.059], screen, 0.015)
      for (const x of [-0.69, 0.69]) {
        rod([x, 0.25, -0.018], [x - 0.13, 0.027, 0.23], 0.025, dark)
        rod([x, 0.25, -0.018], [x + 0.1, 0.027, -0.2], 0.025, dark)
        box([0.34, 0.035, 0.075], [x - 0.09, 0.022, 0.23], dark, 0.012)
      }
      return {}
    }
    case 'media-unit': {
      repaint(wood, lightWood)
      for (const x of [-1.39, 1.39]) for (const z of [-0.32, 0.32]) {
        cylinder(0.065, 0.23, [x, 0.125, z], wood, 0.05)
      }
      box([3.4, 0.1, 0.97], [0, 1, 0], lightWood, 0.03)
      box([3.28, 0.075, 0.88], [0, 0.28, 0], wood, 0.012)
      box([3.28, 0.67, 0.055], [0, 0.615, -0.414], paint, 0.012)
      for (const x of [-1.61, -0.55, 0.55, 1.61]) {
        box([0.065, 0.67, 0.88], [x, 0.615, 0], wood, 0.012)
      }
      for (const x of [-1.085, 1.085]) {
        box([0.985, 0.59, 0.06], [x, 0.615, 0.445], lightWood, 0.02)
        for (let i = 0; i < 6; i++) box([0.026, 0.45, 0.018], [x - 0.37 + i * 0.148, 0.615, 0.484], wood, 0)
        box([0.07, 0.045, 0.042], [x + (x < 0 ? 0.34 : -0.34), 0.67, 0.498], dark, 0.008)
      }
      box([1.04, 0.045, 0.81], [0, 0.61, 0.01], wood, 0.01)
      book([-0.08, 0.369, 0.03], [0.76, 0.1, 0.52], tomato)
      book([-0.04, 0.738, 0.025], [0.72, 0.16, 0.51], linen)
      // Contact shadows are room-aligned; this console faces across the room.
      return { contactSize: [3.55, 1.12] }
    }
    case 'bookshelf': {
      repaint(wood, lightWood)
      for (const x of [-0.68, 0.68]) for (const z of [-0.32, 0.32]) {
        box([0.095, 0.25, 0.095], [x, 0.135, z], wood, 0.01)
      }
      box([1.57, 3.13, 0.055], [0, 1.795, -0.411], paint, 0.012)
      for (const x of [-0.805, 0.805]) box([0.085, 3.17, 0.89], [x, 1.825, 0], wood, 0.012)
      for (const y of [0.29, 1.28, 2.39, 3.34]) box([1.69, 0.08, 0.91], [0, y, 0], lightWood, 0.012)
      box([0.055, 1.03, 0.78], [-0.015, 1.835, 0.03], wood, 0.008)
      for (const [i, cover] of [tomato, linen, edge, dark, tomato].entries()) {
        const height = 0.54 + i % 3 * 0.09
        book([-0.61 + i * 0.16, 0.33 + height / 2, 0.08], [0.115, height, 0.48], cover, true)
      }
      box([0.44, 0.38, 0.61], [0.46, 0.53, 0.035], linen, 0.035)
      box([0.17, 0.04, 0.015], [0.46, 0.59, 0.348], wood, 0.012)
      for (let i = 0; i < 3; i++) book([-0.42, 1.395 + i * 0.105, 0.05],
        [0.52, 0.09, 0.52], i % 2 ? tomato : linen)
      for (const [i, cover] of [edge, tomato, linen, dark].entries()) {
        book([-0.61 + i * 0.17, 2.72, 0.05], [0.12, 0.58, 0.49], cover, true)
      }
      cylinder(0.16, 0.29, [0.44, 2.585, 0.05], cream, 0.12)
      cylinder(0.075, 0.11, [0.44, 2.775, 0.05], cream)
      return { contactSize: [1.92, 1.1] }
    }
    case 'floor-lamp': {
      repaint(cream)
      cylinder(0.33, 0.065, [0, 0.042, 0], wood, 0.28)
      cylinder(0.035, 2.39, [0, 1.25, 0], dark)
      cylinder(0.064, 0.17, [0, 2.37, 0], silver)
      const shade = new Mesh(new LatheGeometry([
        [0.48, 2.32], [0.28, 2.92], [0.255, 2.92], [0.455, 2.32], [0.48, 2.32],
      ].map(([x, y]) => new Vector2(x, y)), 12), cream)
      shade.castShadow = true
      shade.receiveShadow = true
      root.add(shade)
      const glow = material('Reading lamp glow', roomAccents.cream, 0.6)
      glow.emissive.set(roomAccents.gold)
      glow.emissiveIntensity = 0.12
      cylinder(0.09, 0.12, [0, 2.36, 0], glow, 0.07)
      return { contactSize: [0.82, 0.82] }
    }
    case 'rug':
      if (!fittedOriginal) return null
      repaint(paint, edge)
      box([5.0, 0.014, 3.5], [0, 0.008, 0], linen, 0.025)
      box([4.83, 0.006, 3.33], [0, 0.018, 0], paint, 0.02)
      box([4.46, 0.004, 2.96], [0, 0.023, 0], linen, 0.02)
      for (const x of [-2.18, 2.18]) box([0.045, 0.002, 2.87], [x, 0.0265, 0], edge, 0)
      for (const z of [-1.43, 1.43]) box([4.39, 0.002, 0.045], [0, 0.0265, z], edge, 0)
      for (const side of [-1, 1]) for (let i = 0; i < 13; i++) {
        box([0.16, 0.012, 0.025], [side * 2.54, 0.006, -1.51 + i * 0.252], linen, 0)
      }
      return {}
    case 'curtains':
      if (!fittedOriginal) return null
      repaint(linen)
      rod([-2.44, 4.32, 0.13], [2.44, 4.32, 0.13], 0.027)
      for (const side of [-1, 1]) {
        cylinder(0.052, 0.12, [side * 2.44, 4.32, 0.13], wood).rotation.z = Math.PI / 2
        for (let i = 0; i < 5; i++) {
          const x = side * (1.8 + i * 0.145)
          box([0.155, 2.08 - i * 0.012, 0.055], [x, 3.23 + i * 0.006, i % 2 ? 0.09 : 0.04], linen, 0.016)
          box([0.085, 0.1, 0.05], [x, 4.282, 0.105], linen, 0.012)
        }
        box([0.71, 0.072, 0.1], [side * 2.09, 2.66, 0.105], tomato, 0.018)
      }
      return {}
    case 'supply-shelf':
      if (!fittedOriginal) return null
      repaint(wood, lightWood)
      for (const x of [-0.51, 0.51]) for (const z of [-0.31, 0.31]) {
        box([0.065, 2.12, 0.065], [x, 1.07, z], wood, 0.012)
      }
      for (const y of [0.24, 1.12, 2.1]) box([1.18, 0.08, 0.8], [0, y, 0], lightWood, 0.018)
      box([0.81, 0.4, 0.59], [0, 0.48, 0], linen, 0.035)
      box([0.23, 0.04, 0.016], [0, 0.54, 0.304], wood, 0.01)
      bottle([-0.27, 1.16, -0.02], 0.42, paint)
      bottle([0, 1.16, -0.02], 0.34, tomato)
      bottle([0.27, 1.16, -0.02], 0.49, cream)
      box([0.83, 0.1, 0.57], [0, 2.19, 0], linen, 0.028)
      box([0.7, 0.085, 0.51], [0, 2.2825, 0], paint, 0.025)
      return { contactSize: [1.38, 1.04] }
    case 'cleaning-caddy':
      if (!fittedOriginal) return null
      repaint(paint, edge)
      box([1.03, 0.065, 0.68], [0, 0.0425, 0], paint, 0.025)
      for (const x of [-0.48, 0.48]) {
        box([0.07, 0.31, 0.66], [x, 0.235, 0], paint, 0.02)
        box([0.05, 0.56, 0.07], [x, 0.62, 0], edge, 0.012)
      }
      for (const z of [-0.31, 0.31]) box([0.96, 0.31, 0.06], [0, 0.235, z], paint, 0.02)
      box([1.0, 0.07, 0.1], [0, 0.915, 0], wood, 0.02)
      bottle([-0.23, 0.1, -0.1], 0.41, tomato)
      bottle([0.18, 0.1, -0.1], 0.48, cream)
      box([0.3, 0.07, 0.2], [0.13, 0.17, 0.15], linen, 0.018)
      rod([-0.3, 0.17, 0.17], [-0.38, 0.78, 0.17], 0.021)
      box([0.18, 0.13, 0.11], [-0.3, 0.22, 0.17], linen, 0.018)
      return { contactSize: [1.26, 0.94] }
    default:
      return null
  }
}
