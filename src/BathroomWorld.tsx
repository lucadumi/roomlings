import { Bath } from 'lucide-react'
import ChoreRoomWorld from './ChoreRoomWorld.tsx'
import type { ChoreRoomConfig, ChoreRoomWorldProps } from './ChoreRoomWorld.tsx'
import { bathroomFocusForRequest, bathroomFraming, bathroomLabels, bathroomTargets, bathroomTourFraming, buildBathroomModel } from './bathroomModel.ts'
import type { BathroomTarget } from './bathroomModel.ts'
import { fitRoomBounds } from './camera.ts'
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
  tourFraming: bathroomTourFraming,
  reducedTourFraming: fitRoomBounds,
  lampPosition: [bathroomLayout.mirror[0], 3.9, bathroomLayout.mirror[2] + 0.35],
  icon: Bath,
  copy: {
    name: 'bathroom',
    room: 'The bathroom',
    preview: 'Interactive bathroom preview. Select a fixture to explore its household chores or supplies.',
    interactive: 'Interactive low-poly shared bathroom. Select the sink, mirror, toilet, bath or floor for chores, the cleaning caddy for room chores, or the shelf to restock supplies. Drag to turn, scroll or pinch to zoom.',
    editing: 'Bathroom editing preview. Select an object to edit its settings in its fixed position, or use the room objects list. Drag to turn, scroll or pinch to zoom.',
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
