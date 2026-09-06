import type { MeshStandardMaterial } from 'three'
import type { RoomStyle } from '../shared/domain.ts'

const surfaces = ['wall', 'trim', 'floor', 'floorAlternate', 'fridge', 'fridgeDoor', 'fridgeEdge'] as const
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
    },
  },
  sage: {
    name: 'Sage',
    description: 'Soft sage walls, cream checker tiles and an ivory fridge.',
    colors: {
      wall: '#cad6bd', trim: '#aebd9e', floor: '#f0e7d5', floorAlternate: '#ded3bc',
      fridge: '#e9e2cd', fridgeDoor: '#f5eedc', fridgeEdge: '#c9c1aa',
    },
  },
  clay: {
    name: 'Clay',
    description: 'Warm cream walls, sand-and-clay checker tiles and a terracotta fridge.',
    colors: {
      wall: '#f0dfc5', trim: '#d9bea0', floor: '#e4caaa', floorAlternate: '#c89b7c',
      fridge: '#bb8066', fridgeDoor: '#d19a7d', fridgeEdge: '#98694f',
    },
  },
  linen: {
    name: 'Linen',
    description: 'Oat walls, pale stone checker tiles and a cream fridge.',
    colors: {
      wall: '#dfd4be', trim: '#c6b9a0', floor: '#e6e3d7', floorAlternate: '#cfcec1',
      fridge: '#e1d3b4', fridgeDoor: '#f0e4ca', fridgeEdge: '#b8aa8b',
    },
  },
}

export function applyRoomStyle(materials: RoomStyleMaterials, style: RoomStyle): void {
  for (const surface of surfaces) materials[surface].color.set(roomPresets[style].colors[surface])
}
