import { Sofa } from 'lucide-react'
import ChoreRoomWorld from './ChoreRoomWorld.tsx'
import type { ChoreRoomConfig, ChoreRoomWorldProps } from './ChoreRoomWorld.tsx'
import { buildLivingRoomModel, livingRoomFocusForRequest, livingRoomFraming, livingRoomLabels, livingRoomLampPosition, livingRoomTargets, livingRoomTourFraming } from './livingRoomModel.ts'
import type { LivingRoomTarget } from './livingRoomModel.ts'
import { livingRoomTargetSlots } from './roomComponentScene.ts'
import { roomCameraZoom } from './camera.ts'

const livingRoomConfig: ChoreRoomConfig<LivingRoomTarget> = {
  roomId: 'living-room',
  targets: livingRoomTargets,
  targetSlots: livingRoomTargetSlots,
  targetKinds: {
    sofa: 'sofa', surfaces: 'coffee-table', plants: 'plant', bins: 'bins',
    chores: 'cleaning-caddy', supplies: 'supply-shelf',
  },
  labels: livingRoomLabels,
  targetKey: 'livingRoomTarget',
  choresTarget: 'chores',
  suppliesTarget: 'supplies',
  focusForRequest: livingRoomFocusForRequest,
  getTargetArea: (target) => target === 'sofa' ? 'seating' : target === 'chores' || target === 'supplies' ? null : target,
  buildModel: buildLivingRoomModel,
  framing: livingRoomFraming,
  cameraZoom: roomCameraZoom,
  tourFraming: livingRoomTourFraming,
  minimumFocusHalfHeight: 2.05,
  lampPosition: livingRoomLampPosition,
  lampSlot: 'living-room-floor-lamp',
  icon: Sofa,
  copy: {
    name: 'living room',
    room: 'The living room',
    preview: 'Interactive living room preview. Select an object to explore its household chores or supplies.',
    interactive: 'Interactive living room. Object plus markers open chores. Select the window to change lighting or the supply shelf to restock. Drag to turn 360 degrees, scroll or pinch to zoom.',
    editing: 'Living room editing preview. Use the Components menu to edit objects. Drag to turn 360 degrees, scroll or pinch to zoom.',
    objects: 'Objects in your living room',
    unavailable: 'The 3D living room is unavailable.',
    restockHint: 'Restock living room supplies',
    lighting: 'Living room lighting',
  },
}

export type LivingRoomWorldProps = ChoreRoomWorldProps<LivingRoomTarget>

export default function LivingRoomWorld(props: LivingRoomWorldProps) {
  return <ChoreRoomWorld config={livingRoomConfig} {...props} />
}
