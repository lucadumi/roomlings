import { Bath } from 'lucide-react'
import ChoreRoomWorld from './ChoreRoomWorld.tsx'
import type { ChoreRoomConfig, ChoreRoomWorldProps } from './ChoreRoomWorld.tsx'
import { bathroomFocusForRequest, bathroomFraming, bathroomLabels, bathroomTargets, bathroomTourFraming, buildBathroomModel } from './bathroomModel.ts'
import type { BathroomTarget } from './bathroomModel.ts'
import { fitRoomBounds, roomCameraZoom } from './camera.ts'
import { bathroomLayout } from './roomLayout.ts'
import { bathroomTargetSlots } from './roomComponentScene.ts'

const bathroomConfig: ChoreRoomConfig<BathroomTarget> = {
  roomId: 'bathroom',
  targets: bathroomTargets,
  targetSlots: bathroomTargetSlots,
  labels: bathroomLabels,
  targetKey: 'bathroomTarget',
  choresTarget: 'chores',
  suppliesTarget: 'supplies',
  focusForRequest: bathroomFocusForRequest,
  getTargetLabel: (target, component) => target === 'bath' && component?.variant === 'shower' ? 'Shower chores' : bathroomLabels[target],
  getTargetArea: (target) => target === 'chores' || target === 'supplies' ? null : target,
  buildModel: buildBathroomModel,
  framing: bathroomFraming,
  cameraZoom: roomCameraZoom,
  tourFraming: bathroomTourFraming,
  reducedTourFraming: fitRoomBounds,
  lampPosition: [bathroomLayout.mirror[0], 3.9, bathroomLayout.mirror[2] + 0.35],
  icon: Bath,
  copy: {
    name: 'bathroom',
    room: 'The bathroom',
    preview: 'Interactive bathroom preview. Select a fixture to explore its household chores or supplies.',
    interactive: 'Interactive bathroom. Object plus markers open chores. Select the supply shelf to restock. Drag to turn 360 degrees, scroll or pinch to zoom.',
    editing: 'Bathroom editing preview. Use the Components menu to edit objects. Drag to turn 360 degrees, scroll or pinch to zoom.',
    objects: 'Objects in your bathroom',
    unavailable: 'The 3D bathroom is unavailable.',
    restockHint: 'Restock bathroom supplies',
    lighting: 'Bathroom lighting',
  },
}

export type BathroomWorldProps = ChoreRoomWorldProps<BathroomTarget>

export default function BathroomWorld(props: BathroomWorldProps) {
  return <ChoreRoomWorld config={bathroomConfig} {...props} />
}
