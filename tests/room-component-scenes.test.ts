import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { componentCatalog, createRoomComponent, defaultRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'
import { roomIds } from '../shared/rooms.ts'
import { roomModels } from '../src/roomModels.ts'
import { componentPlacements } from '../src/roomComponentModels.ts'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { createContactShadowTexture } from '../src/lighting.ts'
import { componentAccessibleName, createRoomComponentScene, installedRoomComponents, isSceneObjectVisible, visibleRoomBounds } from '../src/roomComponentScene.ts'
import { roomAccents, roomPresets } from '../src/roomStyles.ts'
import { kitchenLayout, roomShellBounds } from '../src/roomLayout.ts'

function meshes(root: Object3D) {
  const result: Mesh[] = []
  root.traverse((object) => { if (object instanceof Mesh) result.push(object) })
  return result
}

function materials(root: Object3D): Material[] {
  return [...new Set(meshes(root).flatMap((mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]))]
}

function fixture(t: TestContext, roomId: RoomId, withContacts = false) {
  const room = new Group()
  const model = roomModels[roomId](room)
  const componentModel = 'scenery' in model ? model.scenery : model
  const shadowTexture = withContacts ? createContactShadowTexture() : undefined
  const scene = createRoomComponentScene(room, roomId, {
    bindings: componentModel.componentBindings, fixtures: componentModel.componentFixtures, styleMaterials: model.styleMaterials, shadowTexture,
  })
  t.after(() => {
    scene.dispose()
    new Set(meshes(room).map((mesh) => mesh.geometry)).forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
    shadowTexture?.dispose()
  })
  return { room, model, scene, componentModel }
}

function changed(components: readonly RoomComponent[], id: string, change: Partial<RoomComponent>): RoomComponent[] {
  return components.map((component) => component.id === id ? { ...component, ...change } : component)
}

test('reed diffusers stand on their designed surfaces instead of sinking a vertical base into them', (t) => {
  for (const slotId of ['kitchen-drinks', 'living-room-table-top', 'living-room-windowsill'] as const) {
    const component = createRoomComponent('reed-diffuser', slotId, `diffuser-${slotId}`)
    const { scene } = fixture(t, component.roomId)
    scene.update([...defaultRoomComponents().filter((item) => item.slotId !== slotId), component], 'original')
    assert.ok(Math.abs(scene.getBounds(component.id)!.min.y - componentPlacements[slotId]!.position[1]) < 0.000001)
  }
})

for (const roomId of roomIds) {
  test(`${roomId} defaults retain every visible primitive, transform and original finish`, (t) => {
    const room = new Group()
    const model = roomModels[roomId](room)
    const componentModel = 'scenery' in model ? model.scenery : model
    room.updateMatrixWorld(true)
    const before: { mesh: Mesh; geometry: BufferGeometry; transform: number[]; color: string }[] = []
    room.traverseVisible((object) => {
      if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) before.push({
        mesh: object, geometry: object.geometry, transform: object.matrixWorld.toArray(), color: object.material.color.getHexString(),
      })
    })
    const scene = createRoomComponentScene(room, roomId, {
      bindings: componentModel.componentBindings, fixtures: componentModel.componentFixtures, styleMaterials: model.styleMaterials,
    })
    t.after(() => {
      scene.dispose()
      new Set(meshes(room).map((mesh) => mesh.geometry)).forEach((geometry) => geometry.dispose())
      model.materials.forEach((material) => material.dispose())
    })
    scene.update(undefined, 'original')
    room.updateMatrixWorld(true)
    const visible: Mesh[] = []
    room.traverseVisible((object) => { if (object instanceof Mesh) visible.push(object) })
    assert.deepEqual(visible, before.map(({ mesh }) => mesh))
    for (const { mesh, geometry, transform, color } of before) {
      assert.equal(mesh.geometry, geometry)
      assert.deepEqual(mesh.matrixWorld.toArray(), transform)
      assert.ok(mesh.material instanceof MeshStandardMaterial)
      assert.equal(mesh.material.color.getHexString(), color)
    }
    const defaults = installedRoomComponents(undefined, roomId)
    assert.equal(scene.actors.size, defaults.length)
    assert.equal(new Set(defaults.map((component) => componentAccessibleName(component, defaults))).size, defaults.length)
    assert.equal(new Set(scene.actors.values()).size, defaults.length)
    assert.equal(new Set(scene.anchors.values()).size, defaults.length)
    for (const component of defaults) {
      const actor = scene.actors.get(component.id)!
      assert.equal(scene.anchors.get(component.id)?.parent, actor)
      assert.equal(scene.componentForObject(meshes(actor).find((mesh) => isSceneObjectVisible(mesh))!)?.id, component.id)
    }
  })

  test(`every ${roomId} slot and advertised variant has a bounded, pickable model`, (t) => {
    const { scene } = fixture(t, roomId)
    const defaults = defaultRoomComponents()
    for (const slot of roomSlots.filter((slot) => slot.roomId === roomId)) {
      for (const kind of slot.kinds) for (const variant of componentCatalog[kind].variants) {
        const component = { ...createRoomComponent(kind, slot.id, `check-${slot.id}`), variant: variant.id }
        scene.update([...defaults.filter((item) => item.slotId !== slot.id), component], 'original')
        const actor = scene.actors.get(component.id)
        assert.ok(actor, `${slot.id} ${variant.id} must have one actor`)
        assert.ok(meshes(actor).length, `${kind} must have recognizable physical geometry`)
        assert.equal(scene.componentForObject(meshes(actor).find((mesh) => isSceneObjectVisible(mesh))!)?.id, component.id)
        const bounds = scene.getBounds(component.id)!
        assert.ok(!bounds.isEmpty())
        assert.ok(bounds.min.toArray().every(Number.isFinite) && bounds.max.toArray().every(Number.isFinite))
        const footprint = roomShellBounds(roomId).expandByScalar(0.02)
        assert.ok(bounds.min.x >= footprint.min.x && bounds.max.x <= footprint.max.x, `${slot.id} must stay inside the room`)
        assert.ok(bounds.min.z >= footprint.min.z && bounds.max.z <= footprint.max.z, `${slot.id} must stay inside the room`)
        assert.ok(bounds.min.y >= -0.3 && bounds.max.y < 5.2, `${slot.id} must fit the existing light envelope`)
        for (const mesh of meshes(actor)) {
          const positions = mesh.geometry.getAttribute('position')
          assert.ok(positions.count < 10_000, `${kind} must keep its low-poly mesh budget`)
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            assert.ok(material instanceof MeshStandardMaterial)
            assert.equal(material.flatShading, true)
          }
        }
      }
    }
  })

  test(`every ${roomId} object has a visible finish surface without invalidating shadows`, (t) => {
    const { scene } = fixture(t, roomId)
    const defaults = defaultRoomComponents()
    const kinds = new Set(roomSlots.filter((slot) => slot.roomId === roomId).flatMap((slot) => slot.kinds))
    for (const kind of kinds) {
      const slot = roomSlots.find((slot) => slot.roomId === roomId && slot.kinds.includes(kind))!
      const component = { ...createRoomComponent(kind, slot.id, `finish-${slot.id}`), finish: 'walnut' as const }
      const layout = [...defaults.filter((item) => item.slotId !== slot.id), component]
      scene.update(layout, 'original')
      const actor = scene.actors.get(component.id)!
      const before = materials(actor).filter((material) => material instanceof MeshStandardMaterial).map((material) => material.color.getHexString())
      const result = scene.update(layout.map((item) => item.id === component.id ? { ...item, finish: 'cream' } : item), 'original')
      const after = materials(actor).filter((material) => material instanceof MeshStandardMaterial).map((material) => material.color.getHexString())
      assert.notDeepEqual(after, before, `${kind}'s finish must change its rendered object`)
      assert.equal(result.shadowsChanged, false, `${kind}'s color must reuse the shadow map`)
    }
  })
}

test('finishes are isolated across shared source materials and survive preset changes without rebuilding', (t) => {
  const { scene, room, model } = fixture(t, 'kitchen')
  let components = defaultRoomComponents()
  scene.update(components, 'original')
  batchStaticMeshes(room, 'scenery' in model ? model.scenery.preserved : new Set())
  const fridge = scene.actors.get('default-kitchen-fridge')!
  const counterPlant = scene.actors.get('default-kitchen-plant-counter')!
  const plantColors = materials(counterPlant).map((material) => (material as MeshStandardMaterial).color.getHexString())
  const children = meshes(fridge)
  const geometry = children.map((mesh) => mesh.geometry)
  const anchor = scene.anchors.get('default-kitchen-fridge')
  components = changed(components, 'default-kitchen-fridge', { finish: 'tomato', name: 'Our cool corner' })
  components = changed(components, 'default-kitchen-plant-floor', { finish: 'walnut' })
  assert.deepEqual(scene.update(components, 'original'), { changed: true, shadowsChanged: false })
  assert.equal(scene.actors.get('default-kitchen-fridge'), fridge)
  assert.equal(scene.anchors.get('default-kitchen-fridge'), anchor)
  assert.equal(fridge.name, 'Our cool corner')
  assert.deepEqual(meshes(fridge), children)
  assert.deepEqual(meshes(fridge).map((mesh) => mesh.geometry), geometry)
  assert.deepEqual(materials(counterPlant).map((material) => (material as MeshStandardMaterial).color.getHexString()), plantColors)
  assert.ok(materials(fridge).some((material) => (material as MeshStandardMaterial).color.getHexString() === roomAccents.tomato.slice(1)))
  assert.deepEqual(scene.update(components, 'linen'), { changed: true, shadowsChanged: false })
  assert.ok(materials(fridge).some((material) => (material as MeshStandardMaterial).color.getHexString() === roomAccents.tomato.slice(1)))
  components = changed(components, 'default-kitchen-fridge', { finish: 'room' })
  scene.update(components, 'linen')
  assert.ok(materials(fridge).some((material) => (material as MeshStandardMaterial).color.getHexString() === roomPresets.linen.colors.fridge.slice(1)))
  assert.deepEqual(scene.update(components, 'linen', 'default-kitchen-fridge'), { changed: true, shadowsChanged: false })
  assert.deepEqual(meshes(fridge).map((mesh) => mesh.geometry), geometry)
})

test('cabinet, table and fridge finishes leave nested actors, neighbors and every food material unchanged', (t) => {
  const { scene, room, model } = fixture(t, 'kitchen')
  assert.ok('scenery' in model)
  const defaults = defaultRoomComponents()
  scene.update(defaults, 'original')
  batchStaticMeshes(room, model.scenery.preserved)
  const colors = (root: Object3D) => materials(root).map((material) => (material as MeshStandardMaterial).color.getHexString())
  const unaffected = [
    ...model.foods.map(({ group }) => group),
    scene.actors.get('default-kitchen-kettle')!, scene.actors.get('default-kitchen-hob')!,
    scene.actors.get('default-kitchen-sink')!, scene.actors.get('default-kitchen-shopping-bag')!,
    scene.actors.get('default-kitchen-receipt-book')!, scene.actors.get('default-kitchen-house-pot')!,
  ].map((root) => ({ root, materials: materials(root), colors: colors(root) }))
  let components = changed(defaults, 'default-kitchen-counters', { finish: 'tomato' })
  components = changed(components, 'default-kitchen-fridge', { finish: 'walnut' })
  components = changed(components, 'default-kitchen-table', { finish: 'cream' })
  assert.deepEqual(scene.update(components, 'original'), { changed: true, shadowsChanged: false })
  for (const saved of unaffected) {
    assert.deepEqual(materials(saved.root), saved.materials)
    assert.deepEqual(colors(saved.root), saved.colors)
  }
  const groceries = model.foods.map(({ group }) => colors(group))
  scene.update(components, 'sage')
  assert.deepEqual(model.foods.map(({ group }) => colors(group)), groceries)
})

test('optional appliance replacement retires each generated geometry and material exactly once', (t) => {
  const { scene } = fixture(t, 'kitchen')
  const defaults = defaultRoomComponents()
  const microwave = createRoomComponent('microwave', 'kitchen-small-appliance', 'counter-appliance')
  scene.update([...defaults, microwave], 'original')
  const original = scene.actors.get(microwave.id)!
  const resources = [...new Set(meshes(original).map((mesh) => mesh.geometry)), ...materials(original)]
  const disposed = new Map(resources.map((resource) => [resource, 0]))
  for (const resource of resources) resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource)! + 1))
  const toaster = createRoomComponent('toaster', 'kitchen-small-appliance', microwave.id)
  const result = scene.update([...defaults, toaster], 'original')
  assert.equal(result.shadowsChanged, true)
  assert.notEqual(scene.actors.get(toaster.id), original)
  assert.equal(original.parent, null)
  for (const count of disposed.values()) assert.equal(count, 1)
  const replacement = scene.actors.get(toaster.id)!
  assert.equal(scene.componentForObject(meshes(replacement)[0])?.kind, 'toaster')
  scene.update(defaults, 'original')
  assert.equal(scene.actors.has(toaster.id), false)
  assert.equal(scene.anchors.has(toaster.id), false)
  assert.equal(replacement.parent, null)
  scene.dispose()
  scene.dispose()
  for (const count of disposed.values()) assert.equal(count, 1)
})

test('removed originals have no active actor, label, contact shadow or picking target and restore in place', (t) => {
  const { room, scene, model } = fixture(t, 'kitchen', true)
  const defaults = defaultRoomComponents()
  scene.update(defaults, 'original')
  assert.ok('scenery' in model)
  const kettle = model.scenery.actors.get('brew')!
  const lid = model.scenery.kettleLid
  const plant = scene.actors.get('default-kitchen-plant-floor')!
  const contacts = () => meshes(room).filter((mesh) => mesh.userData.componentContact)
  const originalContacts = contacts()
  const plantContact = originalContacts.find((mesh) => mesh.position.x === kitchenLayout.plant[0] && mesh.position.z === kitchenLayout.plant[2])!
  assert.ok(plantContact)
  const before = new Box3().setFromObject(plant)
  const without = defaults.map((component) => component.slotId === 'kitchen-kettle' || component.slotId === 'kitchen-plant-floor'
    ? { ...component, installed: false } : component)
  assert.equal(scene.update(without, 'original').shadowsChanged, true)
  assert.equal(kettle.visible, false)
  assert.equal(plant.visible, false)
  assert.equal(scene.actors.has('default-kitchen-kettle'), false)
  assert.equal(scene.anchors.has('default-kitchen-kettle'), false)
  assert.equal(scene.componentForObject(lid), null)
  assert.equal(scene.componentForObject(meshes(plant)[0]), null)
  assert.equal(room.getObjectById(plantContact.id), undefined)
  assert.deepEqual(contacts(), originalContacts.filter((mesh) => mesh !== plantContact))
  assert.equal(scene.update(defaults, 'original').shadowsChanged, true)
  assert.equal(scene.actors.get('default-kitchen-kettle'), kettle)
  assert.equal(scene.actors.get('default-kitchen-plant-floor'), plant)
  assert.equal(lid.parent, kettle)
  assert.deepEqual(new Box3().setFromObject(plant), before)
  assert.equal(contacts().length, originalContacts.length)
  assert.ok(contacts().some((mesh) => mesh.position.equals(plantContact.position)))
  assert.ok(visibleRoomBounds(room).containsPoint(new Vector3(kitchenLayout.plant[0], 0.5, kitchenLayout.plant[2])))
})

for (const [roomId, kind, slotId] of [
  ['kitchen', 'bins', 'kitchen-bins'],
  ['bathroom', 'washing-machine', 'bathroom-laundry'],
] as const) {
  test(`${roomId} optional contact blobs disappear with their component and restore without retiring shared resources`, (t) => {
    const { room, scene } = fixture(t, roomId, true)
    const defaults = defaultRoomComponents()
    const component = createRoomComponent(kind, slotId, `contact-${roomId}`)
    const contacts = () => meshes(room).filter((mesh) => mesh.userData.componentContact)
    scene.update(defaults, 'original')
    const originalContacts = contacts()
    scene.update([...defaults, component], 'original')
    const added = contacts().filter((mesh) => !originalContacts.includes(mesh))
    assert.equal(added.length, 1)
    let geometryDisposals = 0
    added[0].geometry.addEventListener('dispose', () => { geometryDisposals++ })
    assert.equal(scene.update([...defaults, { ...component, installed: false }], 'original').shadowsChanged, true)
    assert.deepEqual(contacts(), originalContacts)
    assert.equal(room.getObjectById(added[0].id), undefined)
    assert.equal(scene.actors.has(component.id), false)
    assert.equal(scene.anchors.has(component.id), false)
    assert.equal(geometryDisposals, 0)
    scene.update([...defaults, component], 'original')
    assert.equal(contacts().length, originalContacts.length + 1)
    assert.equal(geometryDisposals, 0)
    scene.dispose()
    assert.equal(geometryDisposals, 1)
  })
}

test('the fitted appliance bay swaps its cabinet front and carcass back on removal', (t) => {
  const { scene, componentModel } = fixture(t, 'kitchen')
  const defaults = defaultRoomComponents()
  const fixtureBay = componentModel.componentFixtures.get('kitchen-undercounter')!
  scene.update(defaults, 'original')
  assert.ok(fixtureBay.vacant.every((object) => object.visible))
  assert.ok(fixtureBay.occupied.every((object) => !object.visible))
  const dishwasher = createRoomComponent('dishwasher', 'kitchen-undercounter', 'dishwasher')
  scene.update([...defaults, dishwasher], 'sage')
  assert.ok(fixtureBay.vacant.every((object) => !object.visible))
  assert.ok(fixtureBay.occupied.every((object) => object.visible))
  scene.update(defaults, 'sage')
  assert.ok(fixtureBay.vacant.every((object) => object.visible))
  assert.ok(fixtureBay.occupied.every((object) => !object.visible))
})

test('manual everyday states invalidate shadows only when visible geometry changes', (t) => {
  const { scene } = fixture(t, 'bathroom')
  const defaults = defaultRoomComponents()
  const washer = createRoomComponent('washing-machine', 'bathroom-laundry', 'washer')
  scene.update([...defaults, washer], 'original')
  const actor = scene.actors.get(washer.id)!
  const stateGroup = actor.getObjectByName('Manual everyday state')!
  assert.equal(stateGroup.visible, false)
  assert.equal(scene.update([...defaults, { ...washer, state: 'running' }], 'original').shadowsChanged, true)
  assert.equal(stateGroup.visible, true)
  assert.equal(scene.update([...defaults, { ...washer, state: 'ready-to-unload' }], 'original').shadowsChanged, false)
  assert.equal(scene.actors.get(washer.id), actor)
  assert.equal(scene.update([...defaults, { ...washer, state: 'idle' }], 'original').shadowsChanged, true)
  assert.equal(stateGroup.visible, false)
})

test('both household preview builders reflect saved components without changing curated defaults', (t) => {
  const originalDefaults = defaultRoomComponents()
  let saved = changed(originalDefaults, 'default-kitchen-plant-floor', { variant: 'cactus', finish: 'tomato', name: 'Kitchen cactus' })
  saved = changed(saved, 'default-bathroom-bath', { variant: 'shower' })
  saved = [...saved, createRoomComponent('coffee-machine', 'kitchen-coffee', 'coffee'), createRoomComponent('dryer', 'bathroom-laundry', 'dryer')]
  const input = JSON.stringify(saved)
  for (const roomId of ['kitchen', 'bathroom'] as const) {
    const preview = createConfiguredRoomPreview(roomId, 'linen', saved)
    const curated = createConfiguredRoomPreview(roomId, 'original')
    t.after(() => { preview.dispose(); curated.dispose() })
    assert.equal(preview.componentScene.actors.size, installedRoomComponents(saved, roomId).length)
    assert.equal(curated.componentScene.actors.size, installedRoomComponents(undefined, roomId).length)
    assert.equal(curated.componentScene.actors.has(roomId === 'kitchen' ? 'coffee' : 'dryer'), false)
    assert.equal(preview.componentScene.actors.has(roomId === 'kitchen' ? 'coffee' : 'dryer'), true)
    const selected = roomId === 'kitchen' ? 'default-kitchen-plant-floor' : 'default-bathroom-bath'
    const mesh = meshes(preview.componentScene.actors.get(selected)!)[0]
    assert.equal(preview.componentScene.componentForObject(mesh)?.variant, roomId === 'kitchen' ? 'cactus' : 'shower')
    assert.equal(curated.componentScene.componentForObject(meshes(curated.componentScene.actors.get(selected)!)[0])?.variant, 'original')
  }
  assert.equal(JSON.stringify(saved), input)
  assert.deepEqual(defaultRoomComponents(), originalDefaults)
})
