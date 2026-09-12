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

const neutralArchitecture = {
  wall: '#faf7ee', trim: '#ded9ce', floor: '#f4f4ee', floorAlternate: '#e2e3db',
} as const

export const roomPresets: Record<RoomStyle, {
  name: string
  description: string
  colors: Record<Surface, string>
}> = {
  original: {
    name: 'Original',
    description: 'Warm neutrals, gentle sage furniture and honey wood.',
    colors: {
      ...neutralArchitecture,
      fridge: '#8fad9a', fridgeDoor: '#b7cec0', fridgeEdge: '#718e7b',
      cabinet: '#75917e', cabinetPanel: '#9fb7a7', counter: '#fffdf7',
      wood: '#ba9164', lightWood: '#e4bf88', woodGrain: '#c5a375',
    },
  },
  sage: {
    name: 'Sage',
    description: 'Soft sage cabinetry, ivory furniture and honey oak against neutral walls.',
    colors: {
      ...neutralArchitecture,
      fridge: '#e7e9df', fridgeDoor: '#f6f7ee', fridgeEdge: '#b2b9a7',
      cabinet: '#667f6d', cabinetPanel: '#8ca18d', counter: '#fcfaf4',
      wood: '#a27c51', lightWood: '#d0ab73', woodGrain: '#856644',
    },
  },
  clay: {
    name: 'Clay',
    description: 'Dusty-clay furniture and warm wood, with neutral walls and stone floors.',
    colors: {
      ...neutralArchitecture,
      fridge: '#b68b7a', fridgeDoor: '#d8b3a2', fridgeEdge: '#947768',
      cabinet: '#aa8973', cabinetPanel: '#cfb197', counter: '#fffaf0',
      wood: '#af815b', lightWood: '#dcba87', woodGrain: '#8e6848',
    },
  },
  linen: {
    name: 'Linen',
    description: 'Ivory furniture, quiet stone surfaces and natural walnut wood.',
    colors: {
      ...neutralArchitecture,
      fridge: '#e0dcd0', fridgeDoor: '#f1eee4', fridgeEdge: '#b7b09f',
      cabinet: '#ddd8cb', cabinetPanel: '#f0ece2', counter: '#57564b',
      wood: '#4e3528', lightWood: '#6a4834', woodGrain: '#a17751',
    },
  },
  // Accent family: https://coolors.co/palette/a6bbc6-5f8195-70968f-b9cbd0-eeeae0-b7a184
  coastal: {
    name: 'Coastal',
    description: 'Muted ocean and sea-green furniture, sandy oak and a neutral room.',
    colors: {
      ...neutralArchitecture,
      fridge: '#7c9592', fridgeDoor: '#a1b8b0', fridgeEdge: '#627b75',
      cabinet: '#687f88', cabinetPanel: '#94a8ad', counter: '#eeeae0',
      wood: '#8c7157', lightWood: '#b7a184', woodGrain: '#705b47',
    },
  },
  // Accent family: https://coolors.co/palette/afa0ba-725879-a48faf-b4a2bb-eee7e7-b69d90
  lavender: {
    name: 'Lavender',
    description: 'Restrained lilac furniture and rosewood, with warm neutral walls and floors.',
    colors: {
      ...neutralArchitecture,
      fridge: '#9b8d9f', fridgeDoor: '#c0b3c5', fridgeEdge: '#817385',
      cabinet: '#85738c', cabinetPanel: '#ad9fb4', counter: '#f4f1ed',
      wood: '#8b726b', lightWood: '#b69d90', woodGrain: '#6e5954',
    },
  },
  // Accent family: https://coolors.co/palette/c5be9c-879367-d3bd85-b6bd92-f0eadb-b29c79
  citrus: {
    name: 'Citrus',
    description: 'Soft olive and butter-yellow furniture, honey wood and neutral surroundings.',
    colors: {
      ...neutralArchitecture,
      fridge: '#b7b083', fridgeDoor: '#d9d0a8', fridgeEdge: '#989373',
      cabinet: '#879172', cabinetPanel: '#abb394', counter: '#f5f1e6',
      wood: '#8c7657', lightWood: '#b29c79', woodGrain: '#6f5e45',
    },
  },
  // Accent family: https://coolors.co/palette/c6acb0-986b7a-c7969b-d4b9ba-eee6df-8f7467
  rose: {
    name: 'Rose',
    description: 'Dusty rose furniture and walnut wood, with calm neutral walls and floors.',
    colors: {
      ...neutralArchitecture,
      fridge: '#b3979d', fridgeDoor: '#d5bdc0', fridgeEdge: '#927a82',
      cabinet: '#957f88', cabinetPanel: '#baa5ae', counter: '#f5f1ec',
      wood: '#6f5851', lightWood: '#8f7467', woodGrain: '#574741',
    },
  },
}

export function applyRoomStyle(materials: RoomStyleMaterials, style: RoomStyle): void {
  for (const surface of surfaces) materials[surface].color.set(roomPresets[style].colors[surface])
}
