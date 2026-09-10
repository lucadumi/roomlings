import { Group, Quaternion, Vector3 } from 'three'
import type { Camera, Object3D } from 'three'

const wallSides = ['back', 'left', 'front', 'right'] as const
export type RoomWallSide = typeof wallSides[number]
const normals: Record<RoomWallSide, [number, number, number]> = {
  back: [0, 0, -1], left: [-1, 0, 0], front: [0, 0, 1], right: [1, 0, 0],
}

export function roomWallSide(object: Object3D): RoomWallSide | undefined {
  if (!(object instanceof Group)) return undefined
  return wallSides.find((side) => side === object.userData.roomWallSide)
}

export function createRoomWallGroup(parent: Group, side: RoomWallSide, name: string): Group {
  const group = new Group()
  group.name = name
  group.userData.roomWallSide = side
  group.visible = side === 'back' || side === 'left'
  parent.add(group)
  return group
}

export function createRoomCutaway(room: Group) {
  const walls: { object: Object3D; side: RoomWallSide; normal: Vector3 }[] = []
  room.traverse((object) => {
    const side = roomWallSide(object)
    if (side) walls.push({ object, side, normal: new Vector3(...normals[side]) })
  })
  const direction = new Vector3()
  const rotation = new Quaternion()

  return {
    update(camera: Camera) {
      camera.getWorldDirection(direction).negate()
      room.getWorldQuaternion(rotation).invert()
      direction.applyQuaternion(rotation)
      if (!direction.toArray().every(Number.isFinite)) throw new Error('Room cutaways need a finite camera direction.')
      let shadowsChanged = false
      const hidden = new Set<RoomWallSide>()
      for (const { object, side, normal } of walls) {
        const visible = direction.dot(normal) <= 0.000001
        shadowsChanged ||= object.visible !== visible
        object.visible = visible
        if (!visible) hidden.add(side)
      }
      return { shadowsChanged, hiddenSides: wallSides.filter((side) => hidden.has(side)).join(',') }
    },
  }
}
