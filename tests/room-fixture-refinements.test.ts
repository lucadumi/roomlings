import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Box3, Group, Mesh, MeshStandardMaterial } from 'three'
import type { BufferGeometry, Object3D } from 'three'
import { createRoomComponent } from '../shared/roomComponents.ts'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { livingRoomPlacements } from '../src/livingRoomComponentModels.ts'
import { buildLivingRoomModel } from '../src/livingRoomModel.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { roomShellLayout } from '../src/roomLayout.ts'

function meshes(root: Object3D): Mesh[] {
  const result: Mesh[] = []
  root.traverse((object) => { if (object instanceof Mesh) result.push(object) })
  return result
}

function cleanup(t: TestContext, root: Object3D, materials: readonly MeshStandardMaterial[]) {
  t.after(() => {
    new Set<BufferGeometry>(meshes(root).map((mesh) => mesh.geometry)).forEach((geometry) => geometry.dispose())
    new Set(materials).forEach((material) => material.dispose())
  })
}

test('living room TV uses a shallow wall mount instead of furniture feet', (t) => {
  const model = buildRoomComponentModel(createRoomComponent('tv', 'living-room-tv', 'tv'), 'original')
  cleanup(t, model.root, model.materials)
  const bounds = new Box3().setFromObject(model.root)
  const { inner } = roomShellLayout('living-room')
  assert.ok(bounds.min.x >= inner.left - 0.000001, 'The mounted TV must not intersect the left wall')
  assert.ok(bounds.min.x <= inner.left + 0.01, 'The rear wall plate should sit close to the wall')
  assert.ok(bounds.max.x - bounds.min.x < 0.21, 'The wall-mounted TV should remain shallow')
  assert.ok(meshes(model.root).every((mesh) => mesh.position.y > 0.75), 'The TV model must not include table feet or a tabletop stand')
  assert.equal(livingRoomPlacements['living-room-tv'].position[1], 1.55)
})

test('living room keeps legacy bin placement but omits the bin from original room bindings', (t) => {
  const room = new Group()
  const model = buildLivingRoomModel(room)
  cleanup(t, room, model.materials)
  assert.equal(model.componentBindings.has('living-room-bins'), false)
  assert.ok(livingRoomPlacements['living-room-bins'], 'Legacy living-room bin records still need a designed placement')
})

test('window suns are flat room graphics in living room and kitchen scenes', (t) => {
  const livingRoom = new Group()
  const living = buildLivingRoomModel(livingRoom)
  cleanup(t, livingRoom, living.materials)
  const livingSun = livingRoom.getObjectByName('Flat living room sun')
  assert.ok(livingSun instanceof Mesh)
  assert.equal(livingSun.geometry.type, 'CircleGeometry')
  assert.equal(livingSun.material, living.windowMaterials.disc)
  assert.equal(livingSun.castShadow, false)

  const kitchenRoom = new Group()
  const kitchen = buildKitchenModel(kitchenRoom)
  cleanup(t, kitchenRoom, kitchen.materials)
  const kitchenSun = kitchenRoom.getObjectByName('Flat left kitchen sun')
  assert.ok(kitchenSun instanceof Mesh)
  assert.equal(kitchenSun.geometry.type, 'CircleGeometry')
  assert.equal(kitchenSun.material, kitchen.scenery.windowDisc)
  assert.equal(kitchenSun.castShadow, false)
})
