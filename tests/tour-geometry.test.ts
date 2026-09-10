import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Group, Mesh, OrthographicCamera, Vector3 } from 'three'
import { baseCameraOffset } from '../src/camera.ts'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { bathroomTourFraming, buildBathroomModel } from '../src/bathroomModel.ts'
import { visibleRoomBounds } from '../src/roomComponentScene.ts'
import { tourCameraFraming } from '../src/landing/tourCamera.ts'
import { measureKitchenTourBounds, sharedTourOverviewBounds } from '../src/landing/tourGeometry.ts'

test('public tour bounds follow actual room objects without changing their resting state', () => {
  const room = new Group()
  const model = buildKitchenModel(room)
  try {
    model.doors[0].rotation.y = -0.4
    model.scenery.receipts[0].visible = false
    const before = {
      doors: model.doors.map((door) => door.rotation.y),
      receipts: model.scenery.receipts.map((receipt) => [receipt.position.y, receipt.rotation.y, receipt.visible]),
    }
    const first = measureKitchenTourBounds(room, model)
    assert.deepEqual(model.doors.map((door) => door.rotation.y), before.doors)
    assert.deepEqual(model.scenery.receipts.map((receipt) => [receipt.position.y, receipt.rotation.y, receipt.visible]), before.receipts)
    for (const volume of Object.values(first)) {
      assert.ok(!volume.isEmpty())
      assert.ok([...volume.min.toArray(), ...volume.max.toArray()].every(Number.isFinite))
    }
    model.scenery.actors.get('ledger')!.position.x += 3
    const moved = measureKitchenTourBounds(room, model)
    assert.ok(moved.receipts.getCenter(new Vector3()).distanceTo(first.receipts.getCenter(new Vector3())) > 2)
  } finally {
    const geometries = new Set(room.getObjectsByProperty('isMesh', true).filter((object) => object instanceof Mesh).map((mesh) => mesh.geometry))
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  }
})

test('every public kitchen chapter fits its measured volume and reduced motion keeps the overview still', () => {
  const room = new Group()
  const model = buildKitchenModel(room)
  try {
    const bounds = measureKitchenTourBounds(room, model)
    const chapters = [bounds.room, bounds.groceries, bounds.receipts, bounds.budget, bounds.room]
    for (const [width, height] of [[760, 430], [300, 240], [250, 600], [950, 180]]) {
      const still = tourCameraFraming(0, width, height, true, bounds)
      for (let index = 0; index < chapters.length; index++) {
        const frame = tourCameraFraming(index / 4, width, height, false, bounds)
        const halfWidth = frame.halfHeight * width / height
        const camera = new OrthographicCamera(-halfWidth, halfWidth, frame.halfHeight, -frame.halfHeight, 0.1, 150)
        camera.position.set(...frame.center).add(new Vector3(...baseCameraOffset))
        camera.lookAt(...frame.center)
        camera.updateMatrixWorld(true)
        const volume = chapters[index]
        for (const x of [volume.min.x, volume.max.x]) for (const y of [volume.min.y, volume.max.y]) for (const z of [volume.min.z, volume.max.z]) {
          const point = new Vector3(x, y, z).project(camera)
          assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1, `Chapter ${index} must fit at ${width}x${height}`)
        }
        assert.deepEqual(tourCameraFraming(index / 4, width, height, true, bounds), still)
      }
    }
  } finally {
    const geometries = new Set(room.getObjectsByProperty('isMesh', true).filter((object) => object instanceof Mesh).map((mesh) => mesh.geometry))
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  }
})

test('public rooms share a measured overview scale without changing their own fixture bounds', (t) => {
  const kitchenRoom = new Group()
  const kitchen = buildKitchenModel(kitchenRoom)
  const bathroomRoom = new Group()
  const bathroom = buildBathroomModel(bathroomRoom)
  t.after(() => {
    for (const [room, model] of [[kitchenRoom, kitchen], [bathroomRoom, bathroom]] as const) {
      const geometries = new Set(room.getObjectsByProperty('isMesh', true).filter((object) => object instanceof Mesh).map((mesh) => mesh.geometry))
      geometries.forEach((geometry) => geometry.dispose())
      model.materials.forEach((material) => material.dispose())
    }
  })
  const overview = sharedTourOverviewBounds()
  const kitchenBounds = measureKitchenTourBounds(kitchenRoom, kitchen)
  assert.ok(overview.containsBox(kitchenBounds.room))
  assert.ok(overview.containsBox(visibleRoomBounds(bathroomRoom)))
  const fixtures = new Map([...bathroom.actorBounds].map(([target, bounds]) => [target, bounds.clone()]))
  for (const [width, height] of [[650, 400], [300, 240], [950, 180]]) {
    const kitchenFrame = tourCameraFraming(0, width, height, true, { ...kitchenBounds, room: overview })
    const bathroomFrame = bathroomTourFraming(width, height, 0, overview, bathroom.actorBounds, ['room', 'sink', 'room'])
    assert.deepEqual(kitchenFrame, bathroomFrame)
  }
  assert.deepEqual(bathroom.actorBounds, fixtures)
  overview.makeEmpty()
  assert.equal(sharedTourOverviewBounds().isEmpty(), false, 'Callers must not mutate the cached overview')
})
