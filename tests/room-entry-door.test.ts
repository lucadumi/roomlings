import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Box3, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Raycaster, Triangle, Vector3 } from 'three'
import type { Object3D } from 'three'
import { defaultRoomComponents } from '../shared/roomComponents.ts'
import { roomIds } from '../shared/rooms.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { createRoomCutaway, roomWallSide } from '../src/roomCutaway.ts'
import { isSceneObjectVisible, visibleRoomBounds } from '../src/roomComponentScene.ts'
import { componentPlacements, roomEntryDoors, roomShellBounds, roomShellLayout } from '../src/roomLayout.ts'
import { buildRoomWalls } from '../src/roomShell.ts'
import { completeRoomLayout } from './room-layout-fixture.ts'

function meshBounds(root: Object3D): Box3[] {
  const result: Box3[] = []
  root.traverseVisible((object) => {
    if (object instanceof Mesh) result.push(new Box3().setFromObject(object, true))
  })
  return result
}

function meshTriangles(root: Object3D): Triangle[] {
  const result: Triangle[] = []
  root.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return
    const positions = object.geometry.getAttribute('position')
    const index = object.geometry.getIndex()
    for (let start = 0; start < (index?.count ?? positions.count); start += 3) {
      const vertex = (corner: number) => new Vector3().fromBufferAttribute(positions, index?.getX(start + corner) ?? start + corner)
        .applyMatrix4(object.matrixWorld)
      result.push(new Triangle(vertex(0), vertex(1), vertex(2)))
    }
  })
  return result
}

function overlaps(a: Box3, b: Box3): boolean {
  const overlap = a.clone().intersect(b)
  return !overlap.isEmpty() && overlap.getSize(new Vector3()).toArray().every((size) => size > 0.008)
}

for (const roomId of roomIds) {
  test(`${roomId} door casing does not overlap wall surfaces and its handle is attached`, (t) => {
    const room = new Group()
    const material = new MeshStandardMaterial()
    const walls = buildRoomWalls(room, roomId, {
      name: roomId, centerY: 2.2, wall: material, trim: material, lowerPanel: material,
      entryDoor: { panel: material, frame: material, hardware: material },
    })
    t.after(() => {
      room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
      material.dispose()
    })
    room.updateMatrixWorld(true)
    const front = walls.get('front')!
    const structure = front.children.filter((object): object is Mesh => object instanceof Mesh)
    const doorway = front.getObjectByName(`${roomId} entry doorway`)
    assert.ok(doorway instanceof Group)
    const casing = doorway.children.filter((object): object is Mesh =>
      object instanceof Mesh && object.name !== 'Entry door threshold')
    for (const frame of casing) for (const wall of structure) {
      const overlap = new Box3().setFromObject(frame, true).intersect(new Box3().setFromObject(wall, true))
      assert.equal(!overlap.isEmpty() && overlap.getSize(new Vector3()).toArray().every((size) => size > 0.000001), false,
        `${frame.name} must not share volume or exposed reveal faces with ${wall.name}`)
    }
    const panel = doorway.getObjectByName('Entry door panel')!
    const plate = doorway.getObjectByName('Entry door handle plate')!
    const handle = doorway.getObjectByName('Entry door handle')!
    const plateBounds = new Box3().setFromObject(plate, true)
    assert.ok(plateBounds.intersectsBox(new Box3().setFromObject(panel, true)), 'The handle plate must meet the leaf')
    assert.ok(plateBounds.intersectsBox(new Box3().setFromObject(handle, true)), 'The lever must meet its plate')
  })

  test(`${roomId} has a real front doorway without changing its room or component identities`, (t) => {
    const components = defaultRoomComponents()
    const saved = JSON.stringify(components)
    const preview = createConfiguredRoomPreview(roomId, 'original', components)
    t.after(() => preview.dispose())
    const walls: Group[] = []
    preview.room.traverse((object) => {
      if (object instanceof Group && roomWallSide(object) === 'front') walls.push(object)
    })
    assert.equal(walls.length, 1)
    const wall = walls[0]
    const door = wall.getObjectByName(`${roomId} entry doorway`)
    const leaf = door?.getObjectByName('Entry door leaf')
    assert.ok(door instanceof Group && leaf instanceof Group)
    assert.equal(door.userData.roomEntryDoor, true)
    assert.equal(leaf.rotation.y, 0)
    const layout = roomEntryDoors[roomId]
    const { inner } = roomShellLayout(roomId)
    wall.visible = true
    leaf.visible = false
    preview.room.updateMatrixWorld(true)
    const hitsAt = (x: number, y: number) => {
      const ray = new Raycaster(new Vector3(x, y, inner.front + 1), new Vector3(0, 0, -1))
      return ray.intersectObject(wall, true).filter(({ object }) => isSceneObjectVisible(object, preview.room))
    }
    for (const y of [0.07, 0.8, 1.5, 2.8]) assert.equal(hitsAt(layout.centerX, y).length, 0)
    assert.ok(hitsAt(layout.centerX - layout.width / 2 - 0.3, 1.6).length)
    assert.ok(hitsAt(layout.centerX, layout.height + 0.3).length)
    leaf.visible = true
    assert.ok(hitsAt(layout.centerX, 1.6).length)
    const physicalBounds = visibleRoomBounds(preview.room)
    const envelope = roomShellBounds(roomId)
    assert.ok(physicalBounds.min.x >= envelope.min.x - 0.000001)
    assert.ok(physicalBounds.max.x <= envelope.max.x + 0.000001)
    assert.ok(physicalBounds.max.z <= envelope.max.z + 0.000001)
    const camera = new OrthographicCamera(-8, 8, 6, -6, 0.1, 100)
    const cutaway = createRoomCutaway(preview.room)
    for (const [z, visible] of [[10, false], [-10, true]] as const) {
      camera.position.set(0, 6, z)
      camera.lookAt(0, 1.5, 0)
      camera.updateMatrixWorld(true)
      cutaway.update(camera)
      assert.equal(isSceneObjectVisible(leaf, preview.room), visible)
      assert.equal(cutaway.update(camera).shadowsChanged, false)
      assert.deepEqual(visibleRoomBounds(preview.room), physicalBounds)
    }
    assert.equal(JSON.stringify(components), saved)
    assert.deepEqual([...preview.componentScene.actors.keys()], components.filter((item) => item.roomId === roomId).map((item) => item.id))
  })

  test(`${roomId} entry leaf clears the fully equipped room throughout its inward swing`, (t) => {
    const preview = createConfiguredRoomPreview(roomId, 'original', completeRoomLayout())
    t.after(() => preview.dispose())
    const leaf = preview.room.getObjectByName('Entry door leaf')
    assert.ok(leaf instanceof Group)
    // Batches can span empty space between separate objects, so inspect their actual triangles.
    const blockers = [...preview.componentScene.actors].map(([id, actor]) => ({ id, triangles: meshTriangles(actor) }))
    const direction = roomEntryDoors[roomId].hinge === 'right' ? -1 : 1
    for (let degrees = 0; degrees <= 90; degrees += 5) {
      leaf.rotation.y = direction * degrees * Math.PI / 180
      leaf.updateWorldMatrix(true, true)
      const parts = meshBounds(leaf)
      for (const blocker of blockers) {
        assert.equal(parts.some((part) => blocker.triangles.some((triangle) => part.intersectsTriangle(triangle))), false,
          `${roomId} door at ${degrees} degrees must clear ${blocker.id}`)
      }
    }
  })
}

test('the optional bathroom ironing-board pose leaves the central entry lane open', (t) => {
  assert.deepEqual(componentPlacements['bathroom-ironing-board']?.position, [2.12, 0.02, 1.55])
  assert.equal(componentPlacements['bathroom-ironing-board']?.rotation, Math.PI / 2)
  const preview = createConfiguredRoomPreview('bathroom', 'original', completeRoomLayout())
  t.after(() => preview.dispose())
  const lane = new Box3(new Vector3(0.4, 0.08, -1), new Vector3(1.1, 3.55, roomShellLayout('bathroom').inner.front))
  for (const [id, actor] of preview.componentScene.actors) {
    assert.equal(meshBounds(actor).some((part) => overlaps(part, lane)), false, `${id} must leave the entrance clear`)
  }
})
