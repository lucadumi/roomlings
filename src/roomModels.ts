import type { Group, MeshStandardMaterial } from 'three'
import type { RoomStyle } from '../shared/domain.ts'
import type { RoomId } from '../shared/rooms.ts'
import { buildBathroomModel } from './bathroomModel.ts'
import { buildKitchenModel } from './kitchenModel.ts'
import { buildLivingRoomModel } from './livingRoomModel.ts'
import type { RoomStyleMaterials } from './roomStyles.ts'

export const roomModels = {
  kitchen: buildKitchenModel,
  bathroom: buildBathroomModel,
  'living-room': buildLivingRoomModel,
} satisfies Record<RoomId, (room: Group, style?: RoomStyle) => {
  materials: MeshStandardMaterial[]; styleMaterials: RoomStyleMaterials
}>
