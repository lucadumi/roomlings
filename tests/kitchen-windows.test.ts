import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Box3, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Vector3 } from 'three'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { createRoomCutaway } from '../src/roomCutaway.ts'
import { createRoomComponentScene } from '../src/roomComponentScene.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { createRoomComponent, defaultRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import { roomShellLayout } from '../src/roomLayout.ts'
import { createRoomMaterial } from '../src/surfaceMaterials.ts'
import { buildWindowLandscape } from '../src/windowLandscape.ts'

function fixture(t: TestContext) {
  const room = new Group()
  const model = buildKitchenModel(room)
  room.updateMatrixWorld(true)
  t.after(() => {
    const geometries = new Set<Mesh['geometry']>()
    room.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  })
  return { room, model }
}

test('the matching side window shares lighting and the existing curtain component', (t) => {
  const { room, model } = fixture(t)
  const back = room.getObjectByName('Kitchen window cutaway')
  const left = room.getObjectByName('Kitchen left window cutaway')
  const side = room.getObjectByName('Left kitchen window')
  const curtainBinding = model.scenery.componentBindings.get('kitchen-curtains')
  assert.ok(back && left && side && curtainBinding)
  assert.equal(side.parent, model.scenery.actors.get('light'))
  const backBounds = new Box3().setFromObject(back, true).getSize(new Vector3())
  const sideBounds = new Box3().setFromObject(left, true).getSize(new Vector3())
  assert.ok(Math.abs(backBounds.x - sideBounds.z) < 1e-6)
  assert.ok(Math.abs(backBounds.y - sideBounds.y) < 1e-6)
  assert.equal(side.getWorldPosition(new Vector3()).x, roomShellLayout('kitchen').inner.left + 0.04)
  assert.equal(side.getWorldPosition(new Vector3()).z, 2)
  assert.deepEqual(curtainBinding.anchor, [2.07, 3.9, -2.94])
  assert.ok(curtainBinding.root.getObjectByName('Left kitchen window curtains'))
  const cloudPositions: number[][][] = []
  for (const pane of [back, left]) {
    const meshes: Mesh[] = []
    pane.traverse((object) => { if (object instanceof Mesh) meshes.push(object) })
    assert.ok(meshes.some((mesh) => mesh.material === model.scenery.sky))
    assert.equal(meshes.filter((mesh) => mesh.material === model.scenery.windowDisc).length, pane === left ? 1 : 0)
    assert.equal(meshes.filter((mesh) => mesh.name === 'Distant window hills').length, 1)
    assert.equal(meshes.filter((mesh) => mesh.name === 'Distant window trees').length, 1)
    assert.equal(meshes.filter((mesh) => mesh.name === 'Distant window cloud').length, 2)
    cloudPositions.push(meshes.filter((mesh) => mesh.name === 'Distant window cloud').map((mesh) => {
      mesh.geometry.computeBoundingBox()
      assert.ok(mesh.geometry.boundingBox)
      return mesh.geometry.boundingBox.getCenter(new Vector3()).toArray()
    }))
  }
  assert.equal(back.getObjectByName('Flat kitchen sun'), undefined)
  assert.ok(left.getObjectByName('Flat left kitchen sun'))
  for (let index = 0; index < 2; index++) assert.notDeepEqual(cloudPositions[0][index], cloudPositions[1][index])
  const scene = createRoomComponentScene(room, 'kitchen', {
    bindings: model.scenery.componentBindings, fixtures: model.scenery.componentFixtures, styleMaterials: model.styleMaterials,
  })
  t.after(() => scene.dispose())
  const components = defaultRoomComponents()
  const changed = components.map((component) => component.kind === 'curtains' && component.roomId === 'kitchen'
    ? { ...component, finish: 'tomato' as const } : component)
  scene.update(changed, 'original')
  const curtains = scene.actors.get('default-kitchen-curtains')!
  const colors = new Set<string>()
  curtains.traverse((object) => {
    if (object instanceof Mesh) {
      assert.ok(object.material instanceof MeshStandardMaterial)
      colors.add(object.material.color.getHexString())
    }
  })
  assert.deepEqual(colors, new Set(['e07a5f']))
  assert.equal(scene.actors.size, components.filter((component) => component.roomId === 'kitchen').length)
})

test('the side window clears existing wall objects, plants and the full fridge-door motion', (t) => {
  const { room, model } = fixture(t)
  const window = room.getObjectByName('Left kitchen window')!
  const curtains = room.getObjectByName('Left kitchen window curtains')!
  const windowBounds = new Box3().setFromObject(window, true)
  const windowParts: Box3[] = []
  for (const root of [window, curtains]) {
    root.traverse((object) => { if (object instanceof Mesh) windowParts.push(new Box3().setFromObject(object, true)) })
  }
  for (const id of ['kitchen-plant-floor', 'kitchen-supply-shelf'] as const) {
    const binding = model.scenery.componentBindings.get(id)!
    const bounds = new Box3().setFromObject(binding.root, true)
    assert.ok(windowParts.every((part) => !part.intersectsBox(bounds)), `${id} must not be moved for the window`)
  }
  for (const kind of roomSlots.find((slot) => slot.id === 'kitchen-left-wall')!.kinds) {
    const placed = buildRoomComponentModel(createRoomComponent(kind, 'kitchen-left-wall', `window-${kind}`), 'original')
    try {
      const bounds = new Box3().setFromObject(placed.root, true)
      assert.ok(!bounds.intersectsBox(windowBounds), `${kind} keeps its authored wall position`)
    } finally {
      placed.root.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
      placed.materials.forEach((material) => material.dispose())
    }
  }
  for (let step = 0; step <= 40; step++) {
    model.doors.forEach((door, index) => { door.rotation.y = (index ? -1.72 : -1.97) * step / 40 })
    room.updateMatrixWorld(true)
    for (const door of model.doors) {
      door.traverse((object) => {
        if (!(object instanceof Mesh)) return
        const bounds = new Box3().setFromObject(object, true)
        assert.ok(windowParts.every((part) => !part.intersectsBox(bounds)), 'Opening the fridge must clear the new sill and curtains')
      })
    }
  }
})

test('each kitchen window follows its own wall cutaway without moving the room', (t) => {
  const { room } = fixture(t)
  const cutaway = createRoomCutaway(room)
  const transform = room.matrixWorld.clone()
  const camera = new OrthographicCamera(-8, 8, 6, -6, 0.1, 100)
  for (const [x, z] of [[9, 13], [-9, 13], [-9, -13], [9, -13]]) {
    camera.position.set(x, 8, z)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    cutaway.update(camera)
    for (const [side, name] of [['back', 'Kitchen window cutaway'], ['left', 'Kitchen left window cutaway']]) {
      assert.equal(room.getObjectByName(name)!.visible, room.getObjectByName(`Kitchen ${side} wall`)!.visible)
    }
    assert.equal(cutaway.update(camera).shadowsChanged, false)
    assert.ok(room.matrixWorld.equals(transform))
  }
})

test('the shared landscape fits different window sizes with separated opaque layers', (t) => {
  const materials = {
    cloud: createRoomMaterial('#fcf9f1', 1, 'light'),
    hills: createRoomMaterial('#b0d0bd', 1, 'light'),
    trees: createRoomMaterial('#81b29a', 1, 'light'),
  }
  t.after(() => Object.values(materials).forEach((material) => material.dispose()))
  for (const view of [
    { left: -2.65, right: 1.55, bottom: 2.14, top: 4.08, z: -3.387 },
    { left: -1.05, right: 1.05, bottom: -0.815, top: 0.815, z: 0.1, layerDepth: 0.004 },
    { left: -1.05, right: 1.05, bottom: -0.815, top: 0.815, z: 0.1, layerDepth: 0.004,
      clouds: [[0.74, 1.42, 0.68], [2.22, 1.08, 0.5]] as const },
  ]) {
    const root = new Group()
    buildWindowLandscape(root, view, materials)
    t.after(() => root.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() }))
    assert.equal(root.children.length, 4)
    for (const child of root.children) {
      assert.ok(child instanceof Mesh)
      assert.ok(child.material instanceof MeshStandardMaterial)
      assert.ok(Object.values(materials).includes(child.material))
      assert.equal(child.castShadow, false)
      assert.equal(child.receiveShadow, false)
      const bounds = new Box3().setFromObject(child, true)
      assert.ok(bounds.min.x >= view.left - 1e-6 && bounds.max.x <= view.right + 1e-6)
      assert.ok(bounds.min.y >= view.bottom - 1e-6 && bounds.max.y <= view.top + 1e-6)
    }
    assert.ok(root.getObjectByName('Distant window trees')!.position.z > root.getObjectByName('Distant window hills')!.position.z)
  }
  assert.throws(() => buildWindowLandscape(new Group(), { left: 1, right: 0, bottom: 0, top: 1, z: 0 }, materials), /finite bounds/)
  assert.throws(() => buildWindowLandscape(new Group(), {
    left: 0, right: 1, bottom: 0, top: 1, z: 0, clouds: [[0, 1, 2]],
  }, materials), /artwork bounds/)
})
