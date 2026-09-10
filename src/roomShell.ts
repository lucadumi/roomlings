import { BoxGeometry, ExtrudeGeometry, Mesh, Shape } from 'three'
import type { Group, MeshStandardMaterial } from 'three'
import type { RoomId } from '../shared/rooms.ts'
import { roomFootprints, roomShellLayout } from './roomLayout.ts'
import { createRoomWallGroup } from './roomCutaway.ts'
import type { RoomWallSide } from './roomCutaway.ts'

type Rect = { left: number; right: number; back: number; front: number }
type Point = [number, number]

function wallFootprints(outer: Rect, inner: Rect): Record<RoomWallSide, Point[]> {
  return {
    back: [[outer.left, outer.back], [outer.right, outer.back], [inner.right, inner.back], [inner.left, inner.back]],
    right: [[outer.right, outer.back], [outer.right, outer.front], [inner.right, inner.front], [inner.right, inner.back]],
    front: [[outer.right, outer.front], [outer.left, outer.front], [inner.left, inner.front], [inner.right, inner.front]],
    left: [[outer.left, outer.front], [outer.left, outer.back], [inner.left, inner.back], [inner.left, inner.front]],
  }
}

function inset(rect: Rect, amount: number): Rect {
  return { left: rect.left + amount, right: rect.right - amount, back: rect.back + amount, front: rect.front - amount }
}

export function buildRoomWalls(room: Group, roomId: RoomId, options: {
  name: string
  centerY: number
  wall: MeshStandardMaterial
  trim: MeshStandardMaterial
  lowerPanel?: MeshStandardMaterial
  opening?: { left: number; right: number; bottom: number; top: number }
}) {
  const footprint = roomFootprints[roomId]
  const { inner, outer } = roomShellLayout(roomId)
  const bottom = options.centerY - footprint.wallHeight / 2
  const top = options.centerY + footprint.wallHeight / 2
  const faces = wallFootprints(outer, inner)
  const trimFaces = wallFootprints(inner, inset(inner, 0.045))
  const lowerFaces = wallFootprints(inner, inset(inner, 0.012))
  const groups = new Map<RoomWallSide, Group>()
  const add = (group: Group, points: Point[], y: number, height: number, material: MeshStandardMaterial, name: string) => {
    const shape = new Shape()
    shape.moveTo(points[0][0], -points[0][1])
    for (const [x, z] of points.slice(1)) shape.lineTo(x, -z)
    shape.closePath()
    const geometry = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 1 })
    geometry.rotateX(-Math.PI / 2)
    const mesh = new Mesh(geometry, material)
    mesh.name = name
    mesh.position.y = y
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }
  for (const side of ['back', 'left', 'front', 'right'] as const) {
    const group = createRoomWallGroup(room, side, `${options.name} ${side} wall`)
    groups.set(side, group)
    const opening = side === 'back' ? options.opening : undefined
    if (opening) {
      if (opening.left <= inner.left || opening.right >= inner.right || opening.left >= opening.right
        || opening.bottom <= bottom || opening.top >= top || opening.bottom >= opening.top) {
        throw new Error('The room window opening must fit inside its wall.')
      }
      add(group, faces.back, bottom, opening.bottom - bottom, options.wall, 'Wall below window')
      add(group, faces.back, opening.top, top - opening.top, options.wall, 'Wall above window')
      add(group, [[outer.left, outer.back], [opening.left, outer.back], [opening.left, inner.back], [inner.left, inner.back]],
        opening.bottom, opening.top - opening.bottom, options.wall, 'Wall beside window')
      add(group, [[opening.right, outer.back], [outer.right, outer.back], [inner.right, inner.back], [opening.right, inner.back]],
        opening.bottom, opening.top - opening.bottom, options.wall, 'Wall beside window')
    } else add(group, faces[side], bottom, footprint.wallHeight, options.wall, 'Solid wall')
    add(group, trimFaces[side], 0, 0.13, options.trim, 'Wall skirting')
    add(group, trimFaces[side], top - 0.08, 0.08, options.trim, 'Wall top trim')
    if (options.lowerPanel) {
      add(group, lowerFaces[side], 0.13, 1.35, options.lowerPanel, 'Lower wall panel')
      add(group, trimFaces[side], 1.48, 0.08, options.trim, 'Wall panel trim')
      const horizontal = side === 'back' || side === 'front'
      const start = horizontal ? inner.left : inner.back
      const length = horizontal ? inner.right - inner.left : inner.front - inner.back
      const count = Math.max(1, Math.round(length / 0.76))
      for (let index = 1; index < count; index++) {
        const along = start + length * index / count
        const line = new Mesh(new BoxGeometry(horizontal ? 0.014 : 0.004, 1.3, horizontal ? 0.004 : 0.014), options.trim)
        line.name = 'Wall tile joint'
        line.position.set(horizontal ? along : side === 'left' ? inner.left + 0.016 : inner.right - 0.016,
          0.805, horizontal ? side === 'back' ? inner.back + 0.016 : inner.front - 0.016 : along)
        line.receiveShadow = true
        group.add(line)
      }
    }
  }
  return groups
}
