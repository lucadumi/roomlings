import { createRoomComponent, defaultRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import type { ComponentKind, RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import { Mesh, Raycaster, Triangle, Vector3 } from 'three'
import type { Group, Object3D } from 'three'
import { baseCameraOffset } from '../src/camera.ts'
import { isSceneObjectVisible } from '../src/roomComponentScene.ts'

export function worldTriangles(root: Object3D): Triangle[] {
  root.updateWorldMatrix(true, true)
  const triangles: Triangle[] = []
  root.traverseVisible((object) => {
    if (!(object instanceof Mesh) || object.userData.componentContact || object.userData.roomTransient) return
    const positions = object.geometry.getAttribute('position')
    const indices = object.geometry.getIndex()
    const vertex = (index: number) => new Vector3()
      .fromBufferAttribute(positions, indices ? indices.getX(index) : index).applyMatrix4(object.matrixWorld)
    for (let index = 0; index < (indices?.count ?? positions.count); index += 3) {
      triangles.push(new Triangle(vertex(index), vertex(index + 1), vertex(index + 2)))
    }
  })
  return triangles
}

export function pickablePoint(room: Group, root: Object3D, identifies: (object: Object3D) => boolean, rotation = 0): Vector3 | null {
  const raycaster = new Raycaster()
  const direction = new Vector3(...baseCameraOffset).applyAxisAngle(new Vector3(0, 1, 0), -rotation).normalize()
  for (const triangle of worldTriangles(root)) {
    const point = triangle.getMidpoint(new Vector3())
    raycaster.set(point.clone().addScaledVector(direction, 40), direction.clone().negate())
    const hit = raycaster.intersectObject(room, true).find(({ object }) => isSceneObjectVisible(object, room))
    if (hit && identifies(hit.object)) return point
  }
  return null
}

const preferred: Partial<Record<RoomSlotId, ComponentKind>> = {
  'kitchen-small-appliance': 'microwave',
  'kitchen-vacuum': 'vacuum',
  'kitchen-table-center': 'fruit-bowl',
  'kitchen-windowsill': 'storage-jars',
  'kitchen-left-wall': 'wall-calendar',
  'bathroom-vanity-accessory': 'toothbrush-holder',
  'bathroom-floor-storage': 'bathroom-scales',
}

export function completeRoomLayout(): RoomComponent[] {
  return [
    ...defaultRoomComponents(),
    ...roomSlots.filter((slot) => !slot.defaultKind).map((slot) =>
      createRoomComponent(preferred[slot.id] ?? slot.kinds[0], slot.id, `layout-${slot.id}`)),
  ]
}
