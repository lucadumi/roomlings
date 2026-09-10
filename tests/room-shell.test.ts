import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Box3, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import { roomIds } from '../shared/rooms.ts'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { roomFootprints, roomShellLayout } from '../src/roomLayout.ts'
import { buildRoomWalls } from '../src/roomShell.ts'

for (const roomId of roomIds) {
  test(`${roomId} uses the same solid wall, skirting and top structure on all four sides`, (t) => {
    const room = new Group()
    const material = new MeshStandardMaterial()
    const trim = new MeshStandardMaterial()
    const footprint = roomFootprints[roomId]
    const walls = buildRoomWalls(room, roomId, { name: roomId, centerY: footprint.wallHeight / 2, wall: material, trim })
    t.after(() => {
      room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
      material.dispose()
      trim.dispose()
    })
    room.updateMatrixWorld(true)
    for (const [side, wall] of walls) {
      const solid = wall.getObjectByName('Solid wall')
      assert.ok(solid instanceof Mesh)
      const size = new Box3().setFromObject(solid).getSize(new Vector3())
      const thickness = side === 'left' || side === 'right' ? size.x : size.z
      assert.ok(Math.abs(thickness - footprint.wallThickness) < 0.000001)
      assert.ok(Math.abs(size.y - footprint.wallHeight) < 0.000001)
      assert.ok(wall.getObjectByName('Wall skirting'))
      assert.ok(wall.getObjectByName('Wall top trim'))
    }
    const { inner, outer } = roomShellLayout(roomId)
    for (const [rect, thickness, name, y] of [
      [outer, footprint.wallThickness, 'Solid wall', footprint.wallHeight + 1],
      [inner, 0.045, 'Wall skirting', 0.2],
    ] as const) {
      const surfaces = [...walls.values()].map((wall) => wall.getObjectByName(name)!)
      for (const [x, z] of [
        [rect.left + thickness * 0.25, rect.back + thickness * 0.75],
        [rect.left + thickness * 0.75, rect.back + thickness * 0.25],
        [rect.right - thickness * 0.25, rect.front - thickness * 0.75],
        [rect.right - thickness * 0.75, rect.front - thickness * 0.25],
      ]) {
        const ray = new Raycaster(new Vector3(x, y, z), new Vector3(0, -1, 0))
        const hits = new Set(ray.intersectObjects(surfaces).map(({ object }) => object))
        assert.equal(hits.size, 1, 'Mitred joins must not leave overlapping, flickering top faces')
      }
    }
  })
}

test('the fridge top cover does not share a rear plane with the differently colored case', (t) => {
  const room = new Group()
  const model = buildKitchenModel(room)
  t.after(() => {
    room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
    model.materials.forEach((material) => material.dispose())
  })
  room.updateMatrixWorld(true)
  const cover = model.kitchen.getObjectByName('Fridge top cover')
  const back = model.kitchen.getObjectByName('Fridge back panel')
  assert.ok(cover && back)
  const coverBounds = new Box3().setFromObject(cover)
  const backBounds = new Box3().setFromObject(back)
  assert.ok(coverBounds.min.z - backBounds.min.z > 0.009, 'Separate the rear planes instead of masking z-fighting with the camera')
})
