import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Raycaster, Vector3 } from 'three'
import { defaultRoomComponents } from '../shared/roomComponents.ts'
import { roomIds } from '../shared/rooms.ts'
import { baseCameraOffset } from '../src/camera.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { isSceneObjectVisible, visibleRoomBounds } from '../src/roomComponentScene.ts'
import { createRoomCutaway, createRoomWallGroup, roomWallSide } from '../src/roomCutaway.ts'
import { createRoomHologram } from '../src/roomHologram.ts'

function cameraAt(position: Vector3, target = new Vector3()) {
  const camera = new OrthographicCamera(-8, 8, 6, -6, 0.1, 100)
  camera.position.copy(position)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
  return camera
}

test('all four walls show on the far side and hide on the camera side', () => {
  const room = new Group()
  const back = createRoomWallGroup(room, 'back', 'Back')
  const left = createRoomWallGroup(room, 'left', 'Left')
  const front = createRoomWallGroup(room, 'front', 'Front')
  const right = createRoomWallGroup(room, 'right', 'Right')
  const cutaway = createRoomCutaway(room)
  for (const [position, hidden, visible] of [
    [new Vector3(10, 5, 0), right, left],
    [new Vector3(-10, 5, 0), left, right],
    [new Vector3(0, 5, 10), front, back],
    [new Vector3(0, 5, -10), back, front],
  ] as const) {
    const camera = cameraAt(position)
    cutaway.update(camera)
    assert.equal(hidden.visible, false)
    assert.equal(visible.visible, true)
    assert.equal(cutaway.update(camera).shadowsChanged, false)
  }
})

test('cutaways use view direction rather than camera position or zoom', () => {
  const parent = new Group()
  parent.rotation.y = 0.35
  const room = new Group()
  room.position.set(2, 0, -3)
  room.rotation.y = 0.7
  parent.add(room)
  const left = createRoomWallGroup(room, 'left', 'Left')
  const right = createRoomWallGroup(room, 'right', 'Right')
  const cutaway = createRoomCutaway(room)
  const target = room.getWorldPosition(new Vector3())
  const camera = cameraAt(room.localToWorld(new Vector3(10, 5, 0)), target)
  cutaway.update(camera)
  assert.equal(left.visible, true)
  assert.equal(right.visible, false)
  const pan = new Vector3(-100, 20, 60)
  camera.position.add(pan)
  camera.lookAt(target.add(pan))
  camera.zoom = 1.5
  camera.updateProjectionMatrix()
  assert.equal(cutaway.update(camera).shadowsChanged, false)
  assert.equal(left.visible, true)
  assert.equal(right.visible, false)
})

test('hidden walls retain physical bounds but cannot intercept object picking', (t) => {
  const room = new Group()
  const wall = createRoomWallGroup(room, 'left', 'Left')
  const geometry = new BoxGeometry(1, 1, 1)
  const material = new MeshStandardMaterial()
  t.after(() => { geometry.dispose(); material.dispose() })
  const wallMesh = new Mesh(geometry, material)
  wallMesh.position.x = -3
  wallMesh.scale.set(0.1, 4, 5)
  wall.add(wallMesh)
  const actor = new Mesh(geometry, material)
  room.add(actor)
  const hiddenObject = new Mesh(geometry, material)
  hiddenObject.position.x = 100
  hiddenObject.visible = false
  room.add(hiddenObject)
  const bounds = visibleRoomBounds(room)
  assert.ok(bounds.max.x < 1)
  const cutaway = createRoomCutaway(room)
  assert.equal(cutaway.update(cameraAt(new Vector3(-10, 0, 0))).shadowsChanged, true)
  assert.equal(wall.visible, false)
  assert.deepEqual(visibleRoomBounds(room), bounds)
  const ray = new Raycaster(new Vector3(-10, 0, 0), new Vector3(1, 0, 0))
  const picked = ray.intersectObject(room, true).find(({ object }) => isSceneObjectVisible(object, room))
  assert.equal(picked?.object, actor)
})

for (const roomId of roomIds) {
  test(`${roomId} keeps four independent walls, stable bounds and interactive objects through full rotations`, (t) => {
    const components = defaultRoomComponents()
    const before = JSON.stringify(components)
    const model = createConfiguredRoomPreview(roomId, 'original', components)
    const hologram = createRoomHologram(model.room)
    t.after(() => { hologram.dispose(); model.dispose() })
    const cutaway = createRoomCutaway(model.room)
    const camera = cameraAt(new Vector3(...baseCameraOffset))
    const walls: Group[] = []
    model.room.traverse((object) => { if (object instanceof Group && roomWallSide(object)) walls.push(object) })
    assert.deepEqual(new Set(walls.map(roomWallSide)), new Set(['back', 'left', 'front', 'right']))
    assert.ok(walls.every((wall) => wall.children.length > 0))
    const bounds = model.componentScene.bounds.clone()
    const originalActors = [...model.componentScene.actors.values()].map((actor) => ({
      actor, parent: actor.parent, position: actor.position.clone(), scale: actor.scale.clone(), quaternion: actor.quaternion.clone(),
    }))
    const candidate = originalActors[0].actor
    for (const [angle, hidden] of [
      [0, 'front,right'], [Math.PI / 2, 'left,front'], [Math.PI, 'back,left'],
      [-Math.PI / 2, 'back,right'], [Math.PI * 2, 'front,right'], [Math.PI * 4, 'front,right'],
    ] as const) {
      model.room.rotation.y = angle
      cutaway.update(camera)
      assert.equal(cutaway.update(camera).hiddenSides, hidden)
      assert.equal(cutaway.update(camera).shadowsChanged, false)
      const next = visibleRoomBounds(model.room)
      assert.ok(next.min.distanceTo(bounds.min) < 0.000001)
      assert.ok(next.max.distanceTo(bounds.max) < 0.000001)
      hologram.update(candidate, model.componentScene.actors.values())
      const visibility = walls.map((wall) => wall.visible)
      hologram.prepareUpdate()
      model.componentScene.update(components, 'sage')
      hologram.update(candidate, model.componentScene.actors.values())
      hologram.update(null)
      assert.deepEqual(walls.map((wall) => wall.visible), visibility)
      assert.ok(model.componentScene.bounds.min.distanceTo(bounds.min) < 0.000001)
      assert.ok(model.componentScene.bounds.max.distanceTo(bounds.max) < 0.000001)
      for (const saved of originalActors) {
        assert.equal(saved.actor.parent, saved.parent)
        assert.deepEqual(saved.actor.position, saved.position)
        assert.deepEqual(saved.actor.scale, saved.scale)
        assert.ok(saved.actor.quaternion.equals(saved.quaternion))
        assert.equal(isSceneObjectVisible(saved.actor, model.room), true)
      }
    }
    assert.equal(JSON.stringify(components), before)
  })
}
