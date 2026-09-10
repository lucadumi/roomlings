import type { Group, MeshStandardMaterial, Object3D } from 'three'
import type { RoomSlotId } from '../shared/roomComponents.ts'
import type { ContactShadow } from './lighting.ts'
import type { RoomStyleMaterials } from './roomStyles.ts'

export type ComponentBinding = {
  root: Group
  finishes: readonly MeshStandardMaterial[]
  contacts?: readonly ContactShadow[]
  anchor?: [number, number, number]
}

export type ComponentFixture = {
  vacant: readonly Object3D[]
  occupied: readonly Object3D[]
  occupiedBy?: readonly RoomSlotId[]
}

export type ComponentModel = ComponentBinding & {
  materials: readonly MeshStandardMaterial[]
  styleSurfaces: ReadonlyMap<MeshStandardMaterial, keyof RoomStyleMaterials>
  indicator?: MeshStandardMaterial
  stateObjects?: readonly { root: Group; states: readonly string[] }[]
}

export type ComponentBindings = Map<RoomSlotId, ComponentBinding>
export type ComponentFixtures = Map<RoomSlotId, ComponentFixture>
