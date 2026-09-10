import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Group, Mesh } from 'three'
import { buildBathroomModel, bathroomTourFraming } from '../src/bathroomModel.ts'
import { cameraFraming, fitRoomBounds } from '../src/camera.ts'
import { tourCameraFraming } from '../src/landing/tourCamera.ts'
import { bathroomChapters } from '../src/landing/roomTourChapters.ts'

test('room exploration fits each room and keeps continuous measured camera transitions', (context) => {
  const room = new Group()
  const model = buildBathroomModel(room)
  context.after(() => {
    room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
    model.materials.forEach((material) => material.dispose())
  })
  const stops = bathroomChapters.map((chapter) => chapter.target)
  for (const [width, height] of [[1440, 430], [320, 240], [844, 280]]) {
    const overview = cameraFraming(width, height, 'room', true)
    assert.deepEqual(tourCameraFraming(0, width, height), overview)
    assert.deepEqual(bathroomTourFraming(width, height, 0, model.bounds, model.actorBounds, stops), fitRoomBounds(width, height, model.bounds))
    for (let index = 0; index <= 100; index++) {
      const progress = index / 100
      for (const frame of [
        tourCameraFraming(progress, width, height),
        bathroomTourFraming(width, height, progress, model.bounds, model.actorBounds, stops),
      ]) {
        assert.ok([...frame.center, frame.halfHeight].every(Number.isFinite))
        assert.ok(frame.halfHeight > 0)
      }
      assert.deepEqual(tourCameraFraming(progress, width, height, true), overview)
    }
    for (let index = 1; index < stops.length - 1; index++) {
      const progress = index / (stops.length - 1)
      const before = bathroomTourFraming(width, height, progress - 0.00001, model.bounds, model.actorBounds, stops)
      const after = bathroomTourFraming(width, height, progress + 0.00001, model.bounds, model.actorBounds, stops)
      assert.ok(Math.abs(before.halfHeight - after.halfHeight) < 0.001)
      assert.ok(before.center.every((value, axis) => Math.abs(value - after.center[axis]) < 0.001))
    }
  }
  assert.throws(() => tourCameraFraming(NaN, 640, 430), /finite progress/)
  assert.throws(() => bathroomTourFraming(640, 430, 0, model.bounds, model.actorBounds, []), /two stops/)
})
