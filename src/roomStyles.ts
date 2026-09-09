import type { MeshStandardMaterial } from 'three'
import type { RoomStyle } from '../shared/domain.ts'

const surfaces = [
  'wall', 'trim', 'floor', 'floorAlternate', 'fridge', 'fridgeDoor', 'fridgeEdge',
  'cabinet', 'cabinetPanel', 'counter', 'wood', 'lightWood', 'woodGrain',
] as const
type Surface = typeof surfaces[number]
export type RoomStyleMaterials = Record<Surface, MeshStandardMaterial>

export const roomAccents = {
  tomato: '#e07a5f',
  tomatoDark: '#985746',
  gold: '#f2cc8f',
  leaf: '#81b29a',
  leafLight: '#b0d0bd',
  leafDark: '#527861',
  terracotta: '#c58d71',
  blue: '#767d9b',
  sky: '#d0d5df',
  water: '#c3dccf',
  orange: '#e9a377',
  berry: '#3d405b',
  cream: '#fcf9f1',
  paper: '#fffaf1',
  linen: '#f3e5cf',
  ink: '#3d405b',
  metal: '#d7d9e1',
} as const

export const roomPresets: Record<RoomStyle, {
  name: string
  description: string
  colors: Record<Surface, string>
}> = {
  original: {
    name: 'Original',
    description: 'Soft white, mint-sage finishes, honey wood and warm clay accents.',
    colors: {
      wall: '#faf7ee', trim: '#ded5c4', floor: '#f4f5ef', floorAlternate: '#d2e2d5',
      fridge: '#81b29a', fridgeDoor: '#acd0ba', fridgeEdge: '#5d8b73',
      cabinet: '#5d8973', cabinetPanel: '#83b099', counter: '#fffdf7',
      wood: '#ba9164', lightWood: '#e4bf88', woodGrain: '#c5a375',
    },
  },
  sage: {
    name: 'Sage',
    description: 'Forest cabinets, sage walls, ivory finishes and honey oak.',
    colors: {
      wall: '#b1cabb', trim: '#7b9c89', floor: '#faf8f1', floorAlternate: '#90b29b',
      fridge: '#ede9db', fridgeDoor: '#fffdf5', fridgeEdge: '#b4ae9d',
      cabinet: '#426450', cabinetPanel: '#5a836b', counter: '#fcfaf4',
      wood: '#a27c51', lightWood: '#d0ab73', woodGrain: '#856644',
    },
  },
  clay: {
    name: 'Clay',
    description: 'Burnt-clay cabinets, a tomato fridge and bold sand-and-clay tiles.',
    colors: {
      wall: '#f7e8dc', trim: '#dfb49a', floor: '#f7e3c5', floorAlternate: '#ca9676',
      fridge: '#cb7057', fridgeDoor: '#e49376', fridgeEdge: '#a75b46',
      cabinet: '#c78a69', cabinetPanel: '#e0ae88', counter: '#fffaf0',
      wood: '#af815b', lightWood: '#dcba87', woodGrain: '#8e6848',
    },
  },
  linen: {
    name: 'Linen',
    description: 'Cream cabinets and fridge, pale stone walls and dark walnut wood.',
    colors: {
      wall: '#f1eee3', trim: '#b9b6a6', floor: '#eeeae0', floorAlternate: '#73786c',
      fridge: '#ded5c1', fridgeDoor: '#fbf1d8', fridgeEdge: '#b5a68c',
      cabinet: '#e1d9c7', cabinetPanel: '#f7efdc', counter: '#57564b',
      wood: '#4e3528', lightWood: '#6a4834', woodGrain: '#a17751',
    },
  },
}

export function applyRoomStyle(materials: RoomStyleMaterials, style: RoomStyle): void {
  for (const surface of surfaces) materials[surface].color.set(roomPresets[style].colors[surface])
}
