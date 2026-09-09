import type { MeshStandardMaterial } from 'three'
import type { RoomStyle } from '../shared/domain.ts'

const surfaces = [
  'wall', 'trim', 'floor', 'floorAlternate', 'fridge', 'fridgeDoor', 'fridgeEdge',
  'cabinet', 'cabinetPanel', 'counter', 'wood', 'lightWood', 'woodGrain',
] as const
type Surface = typeof surfaces[number]
export type RoomStyleMaterials = Record<Surface, MeshStandardMaterial>

export const roomAccents = {
  tomato: '#d96d4b',
  tomatoDark: '#a7543e',
  gold: '#e1bf62',
  leaf: '#608e56',
  leafLight: '#a3c277',
  leafDark: '#416f46',
  terracotta: '#cc9067',
  blue: '#659fb5',
  sky: '#a6cfd8',
  water: '#9fcbbf',
  orange: '#dda660',
  berry: '#ad7896',
  cream: '#f5edda',
  paper: '#fff6e4',
  linen: '#e9dcc1',
  ink: '#53604d',
  metal: '#d5d9c9',
} as const

export const roomPresets: Record<RoomStyle, {
  name: string
  description: string
  colors: Record<Surface, string>
}> = {
  original: {
    name: 'Original',
    description: 'Warm cream, soft leafy tiles, a sage-green fridge and honey wood.',
    colors: {
      wall: '#f4e9d2', trim: '#d8c7a1', floor: '#eef0dc', floorAlternate: '#bed6a5',
      fridge: '#8ab27a', fridgeDoor: '#acd09a', fridgeEdge: '#6b8b60',
      cabinet: '#588d74', cabinetPanel: '#7eb48f', counter: '#f8f0dd',
      wood: '#c9975e', lightWood: '#dfbd7e', woodGrain: '#bd9462',
    },
  },
  sage: {
    name: 'Sage',
    description: 'Forest cabinets, sage walls, ivory finishes and honey oak.',
    colors: {
      wall: '#a3b792', trim: '#7a9468', floor: '#f3e9d2', floorAlternate: '#8c9f7c',
      fridge: '#e4dcc2', fridgeDoor: '#f8efd4', fridgeEdge: '#b7ad90',
      cabinet: '#3e6349', cabinetPanel: '#608764', counter: '#f6edd9',
      wood: '#a57a4e', lightWood: '#caa36d', woodGrain: '#805c3b',
    },
  },
  clay: {
    name: 'Clay',
    description: 'Burnt-clay cabinets, a tomato fridge and bold sand-and-clay tiles.',
    colors: {
      wall: '#f3e1c8', trim: '#cba57d', floor: '#efd5ae', floorAlternate: '#b97c59',
      fridge: '#b65a45', fridgeDoor: '#d67a59', fridgeEdge: '#914d3d',
      cabinet: '#b77250', cabinetPanel: '#d19466', counter: '#f8edd7',
      wood: '#a5754b', lightWood: '#cfa574', woodGrain: '#87563b',
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
