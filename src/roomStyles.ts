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
      wall: '#e0af89', trim: '#c28f6e', floor: '#f7e3c5', floorAlternate: '#ca9676',
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
  // Coolors: https://coolors.co/palette/a6bbc6-5f8195-70968f-b9cbd0-eeeae0-b7a184
  coastal: {
    name: 'Coastal',
    description: 'Muted ocean cabinets, soft teal appliances, blue-grey tiles and sandy oak.',
    colors: {
      wall: '#a6bbc6', trim: '#7d9ca5', floor: '#5f8195', floorAlternate: '#b9cbd0',
      fridge: '#5c7b77', fridgeDoor: '#70968f', fridgeEdge: '#45635f',
      cabinet: '#466271', cabinetPanel: '#5f8195', counter: '#eeeae0',
      wood: '#8c7157', lightWood: '#b7a184', woodGrain: '#705b47',
    },
  },
  // Coolors: https://coolors.co/palette/afa0ba-725879-a48faf-b4a2bb-eee7e7-b69d90
  lavender: {
    name: 'Lavender',
    description: 'Dusty plum cabinets, soft lilac appliances, muted lavender tiles and rosewood.',
    colors: {
      wall: '#afa0ba', trim: '#88758f', floor: '#a48faf', floorAlternate: '#b4a2bb',
      fridge: '#8c7894', fridgeDoor: '#a48faf', fridgeEdge: '#6d5a75',
      cabinet: '#59445f', cabinetPanel: '#725879', counter: '#eee7e7',
      wood: '#8b726b', lightWood: '#b69d90', woodGrain: '#6e5954',
    },
  },
  // Coolors: https://coolors.co/palette/c5be9c-879367-d3bd85-b6bd92-f0eadb-b29c79
  citrus: {
    name: 'Citrus',
    description: 'Soft olive cabinets, butter-yellow appliances, warm oat walls and honey wood.',
    colors: {
      wall: '#c5be9c', trim: '#9fa17c', floor: '#dbd4b8', floorAlternate: '#b6bd92',
      fridge: '#b7a36e', fridgeDoor: '#d3bd85', fridgeEdge: '#8f8056',
      cabinet: '#6a7651', cabinetPanel: '#879367', counter: '#f0eadb',
      wood: '#8c7657', lightWood: '#b29c79', woodGrain: '#6f5e45',
    },
  },
  // Coolors: https://coolors.co/palette/c6acb0-986b7a-c7969b-d4b9ba-eee6df-8f7467
  rose: {
    name: 'Rose',
    description: 'Dusty berry cabinets, muted rose appliances, blush-grey tiles and walnut wood.',
    colors: {
      wall: '#c6acb0', trim: '#9c7e87', floor: '#c7969b', floorAlternate: '#d4b9ba',
      fridge: '#a87985', fridgeDoor: '#c7969b', fridgeEdge: '#835d68',
      cabinet: '#785260', cabinetPanel: '#986b7a', counter: '#eee6df',
      wood: '#6f5851', lightWood: '#8f7467', woodGrain: '#574741',
    },
  },
}

export function applyRoomStyle(materials: RoomStyleMaterials, style: RoomStyle): void {
  for (const surface of surfaces) materials[surface].color.set(roomPresets[style].colors[surface])
}
