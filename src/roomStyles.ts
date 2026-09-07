import type { MeshStandardMaterial } from 'three'
import type { RoomStyle } from '../shared/domain.ts'

const surfaces = [
  'wall', 'trim', 'floor', 'floorAlternate', 'fridge', 'fridgeDoor', 'fridgeEdge',
  'cabinet', 'cabinetPanel', 'counter', 'wood', 'lightWood', 'woodGrain',
] as const
type Surface = typeof surfaces[number]
export type RoomStyleMaterials = Record<Surface, MeshStandardMaterial>

export const roomPresets: Record<RoomStyle, {
  name: string
  description: string
  colors: Record<Surface, string>
}> = {
  original: {
    name: 'Original',
    description: 'Cream walls, sage checker tiles and the original green fridge.',
    colors: {
      wall: '#efe3c8', trim: '#ded0b0', floor: '#e4e7d9', floorAlternate: '#d3dcc6',
      fridge: '#9eb399', fridgeDoor: '#b1c4a7', fridgeEdge: '#8b9d82',
      cabinet: '#879f91', cabinetPanel: '#94ac9b', counter: '#f1e9d7',
      wood: '#bb895c', lightWood: '#d7ad78', woodGrain: '#c69c6b',
    },
  },
  sage: {
    name: 'Sage',
    description: 'Forest cabinets, sage walls, ivory finishes and honey oak.',
    colors: {
      wall: '#90a681', trim: '#657f59', floor: '#f1e6cb', floorAlternate: '#859677',
      fridge: '#e4ddc6', fridgeDoor: '#fff0d1', fridgeEdge: '#b8ad92',
      cabinet: '#385c42', cabinetPanel: '#4c7954', counter: '#f3ead4',
      wood: '#966238', lightWood: '#c18b4e', woodGrain: '#754627',
    },
  },
  clay: {
    name: 'Clay',
    description: 'Burnt-clay cabinets, a tomato fridge and bold sand-and-clay tiles.',
    colors: {
      wall: '#f2debe', trim: '#ca9d73', floor: '#efcfa2', floorAlternate: '#ac5c3b',
      fridge: '#ad422d', fridgeDoor: '#d25635', fridgeEdge: '#823d2d',
      cabinet: '#af6440', cabinetPanel: '#ce8051', counter: '#fff0d4',
      wood: '#945832', lightWood: '#c68d51', woodGrain: '#734124',
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
