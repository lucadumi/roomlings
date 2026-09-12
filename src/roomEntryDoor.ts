import { CylinderGeometry, Group, Mesh } from 'three'
import type { MeshStandardMaterial } from 'three'
import type { RoomId } from '../shared/rooms.ts'
import { roomEntryDoors, roomShellLayout } from './roomLayout.ts'
import { createRoomBoxGeometry, roomRadialSegments } from './roomGeometry.ts'

export type EntryDoorMaterials = {
  panel: MeshStandardMaterial
  frame: MeshStandardMaterial
  hardware: MeshStandardMaterial
}

export const entryDoorFrame = { width: 0.1, head: 0.12, projection: 0.06 } as const

export function buildRoomEntryDoor(parent: Group, roomId: RoomId, materials: EntryDoorMaterials): Group {
  const { centerX, width, height, hinge } = roomEntryDoors[roomId]
  const { inner, thickness } = roomShellLayout(roomId)
  const root = new Group()
  root.name = `${roomId} entry doorway`
  root.userData.roomEntryDoor = true
  parent.add(root)
  const box = (group: Group, size: [number, number, number], position: [number, number, number],
    material: MeshStandardMaterial, name: string, radius = 0) => {
    const mesh = new Mesh(createRoomBoxGeometry(size, radius), material)
    mesh.name = name
    mesh.position.set(...position)
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }
  const frameWidth = entryDoorFrame.width
  const frameZ = inner.front + (thickness - entryDoorFrame.projection) / 2
  const frameDepth = thickness + entryDoorFrame.projection
  for (const side of [-1, 1]) {
    box(root, [frameWidth, height, frameDepth],
      [centerX + side * (width + frameWidth) / 2, height / 2, frameZ], materials.frame, 'Entry door jamb')
  }
  box(root, [width + frameWidth * 2, entryDoorFrame.head, frameDepth],
    [centerX, height + entryDoorFrame.head / 2, frameZ], materials.frame, 'Entry door frame top')
  box(root, [width, 0.035, thickness], [centerX, 0.0175, inner.front + thickness / 2], materials.hardware, 'Entry door threshold')

  const direction = hinge === 'right' ? -1 : 1
  const leaf = new Group()
  leaf.name = 'Entry door leaf'
  leaf.position.set(centerX - direction * (width / 2 - 0.025), 0, inner.front + 0.06)
  root.add(leaf)
  const leafWidth = width - 0.06
  const leafHeight = height - 0.1
  box(leaf, [leafWidth, leafHeight, 0.07], [direction * leafWidth / 2, 0.08 + leafHeight / 2, 0],
    materials.panel, 'Entry door panel', 0.018)
  const handleX = direction * (leafWidth - 0.16)
  const rose = new Mesh(new CylinderGeometry(0.065, 0.065, 0.03, roomRadialSegments(0.065)), materials.hardware)
  rose.name = 'Entry door handle plate'
  rose.rotation.x = Math.PI / 2
  rose.position.set(handleX, 1.65, -0.0495)
  rose.castShadow = rose.receiveShadow = true
  leaf.add(rose)
  box(leaf, [0.22, 0.045, 0.05], [handleX - direction * 0.08, 1.65, -0.0875],
    materials.hardware, 'Entry door handle', 0.012)
  for (const y of [0.75, 2.75]) {
    const pin = new Mesh(new CylinderGeometry(0.023, 0.023, 0.17, roomRadialSegments(0.023)), materials.hardware)
    pin.name = 'Entry door hinge'
    pin.position.set(0, y, 0)
    pin.castShadow = pin.receiveShadow = true
    leaf.add(pin)
  }
  return root
}
