import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Box3, CylinderGeometry, Group, LatheGeometry, Mesh, MeshStandardMaterial, Raycaster, ShapeGeometry, Vector3 } from 'three'
import type { Object3D } from 'three'
import { createRoomComponent, defaultRoomComponents } from '../shared/roomComponents.ts'
import type { ComponentKind, RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'
import { buildComponentThumbnail, clearComponentThumbnails } from '../src/componentThumbnail.ts'
import { createRoomComponentScene } from '../src/roomComponentScene.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { roomModels } from '../src/roomModels.ts'

function fixture(t: TestContext, kind: ComponentKind, slotId: RoomSlotId, overrides: Partial<RoomComponent> = {}) {
  const model = buildRoomComponentModel({ ...createRoomComponent(kind, slotId, `refinement-${kind}`), ...overrides }, 'original')
  model.root.updateMatrixWorld(true)
  t.after(() => {
    const geometries = new Set<Mesh['geometry']>()
    model.root.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  })
  return model.root
}

function named<T extends Object3D = Object3D>(root: Object3D, name: string): T {
  const object = root.getObjectByName(name)
  assert.ok(object, `Missing ${name}`)
  return object as T
}

function namedAll(root: Object3D, name: string): Object3D[] {
  const objects: Object3D[] = []
  root.traverse((object) => { if (object.name === name) objects.push(object) })
  return objects
}

function bounds(object: Object3D): Box3 {
  object.updateMatrixWorld(true)
  return new Box3().setFromObject(object, true)
}

function size(object: Object3D): Vector3 {
  return bounds(object).getSize(new Vector3())
}

function color(object: Object3D): string {
  assert.ok(object instanceof Mesh)
  assert.ok(object.material instanceof MeshStandardMaterial)
  return object.material.color.getHexString()
}

function assertSameBounds(actual: Object3D, expected: Object3D) {
  const actualBounds = bounds(actual)
  const expectedBounds = bounds(expected)
  assert.ok(actualBounds.min.distanceTo(expectedBounds.min) < 0.00001)
  assert.ok(actualBounds.max.distanceTo(expectedBounds.max) < 0.00001)
}

function assertNoSoapSupport(root: Object3D) {
  assert.equal(root.getObjectByName('Soap dispenser label'), undefined)
  const lowBlocks: Mesh[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh) || object.geometry instanceof CylinderGeometry) return
    const objectBounds = bounds(object)
    const objectSize = objectBounds.getSize(new Vector3())
    if (objectBounds.max.y < 0.09 && objectSize.x > 0.05 && objectSize.z > 0.05) lowBlocks.push(object)
  })
  assert.equal(lowBlocks.length, 0)
}

function assertFeetReachUnderside(root: Object3D, bodyName: string, footName: string) {
  const body = named<Mesh>(root, bodyName)
  const feet = namedAll(root, footName)
  assert.equal(feet.length, 4)
  const bodyBounds = bounds(body)
  for (const foot of feet) {
    const footBounds = bounds(foot)
    const center = footBounds.getCenter(new Vector3())
    const hits = new Raycaster(
      new Vector3(center.x, bodyBounds.min.y - 0.2, center.z),
      new Vector3(0, 1, 0),
    ).intersectObject(body)
    assert.ok(hits.length, `${footName} at ${center.x}, ${center.z} must sit below the appliance body`)
    assert.ok(footBounds.max.y >= hits[0].point.y - 0.001, `${footName} must reach the rounded underside`)
  }
}

function actualRoomActor(t: TestContext, roomId: RoomId, slotId: RoomSlotId, component?: RoomComponent) {
  const room = new Group()
  const model = roomModels[roomId](room, 'original')
  const scenery = 'scenery' in model ? model.scenery : model
  const scene = createRoomComponentScene(room, roomId, {
    bindings: scenery.componentBindings, fixtures: scenery.componentFixtures, styleMaterials: model.styleMaterials,
  })
  scene.update(component ? [...defaultRoomComponents(), component] : defaultRoomComponents(), 'original')
  const id = component?.id ?? `default-${slotId}`
  const actor = scene.actors.get(id)
  assert.ok(actor, `${slotId} actual room actor should exist`)
  t.after(() => {
    scene.dispose()
    const geometries = new Set<Mesh['geometry']>()
    room.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  })
  return { actor, room }
}

test('air fryer door is a rounded front appliance door with separated handle', (t) => {
  const root = fixture(t, 'air-fryer', 'kitchen-air-fryer')
  const frame = named<Mesh>(root, 'Air fryer round door frame')
  const window = named<Mesh>(root, 'Air fryer round door window')
  const handle = named(root, 'Air fryer basket handle')
  assert.ok(frame.geometry instanceof CylinderGeometry)
  assert.ok(window.geometry instanceof CylinderGeometry)
  assert.equal(namedAll(root, 'Air fryer small foot').length, 4)
  assert.ok(frame.scale.y > 1.1)
  assert.ok(window.scale.y > 1.1)
  assert.ok(bounds(handle).min.z > bounds(window).max.z)
  const body = named<Mesh>(root, 'Air fryer body')
  assert.equal(color(frame), color(body), 'the bezel should blend into the main housing')
  for (let step = 0; step < 16; step++) {
    const angle = step / 16 * Math.PI * 2
    const edge = frame.localToWorld(new Vector3(
      Math.cos(angle) * frame.geometry.parameters.radiusTop * 0.98,
      -frame.geometry.parameters.height / 2,
      Math.sin(angle) * frame.geometry.parameters.radiusTop * 0.98,
    ))
    const hit = new Raycaster(new Vector3(edge.x, edge.y, bounds(body).max.z + 0.2), new Vector3(0, 0, -1))
      .intersectObject(body)[0]
    assert.ok(hit && hit.point.z >= edge.z - 0.001, 'the entire round bezel must meet the housing without a floating lower edge')
  }
  const mounts = namedAll(root, 'Air fryer handle mount')
  assert.equal(mounts.length, 2)
  for (const mount of mounts) {
    assert.ok(bounds(mount).intersectsBox(bounds(frame)))
    assert.ok(bounds(mount).intersectsBox(bounds(handle)))
  }
  assert.ok(bounds(named(root, 'Air fryer inset controls')).intersectsBox(bounds(body)))
})

test('toaster has a narrower body on small feet with slots and controls', (t) => {
  const root = fixture(t, 'toaster', 'kitchen-toaster')
  assert.equal(namedAll(root, 'Toaster small foot').length, 4)
  assert.equal(namedAll(root, 'Toaster toast slot').length, 2)
  assert.ok(size(root).x < 0.56)
  assert.ok(bounds(named(root, 'Toaster narrow body')).min.y > 0.025)
})

test('air fryer and toaster feet reach their rounded undersides at every foot position', (t) => {
  assertFeetReachUnderside(fixture(t, 'air-fryer', 'kitchen-air-fryer'), 'Air fryer body', 'Air fryer small foot')
  assertFeetReachUnderside(fixture(t, 'toaster', 'kitchen-toaster'), 'Toaster narrow body', 'Toaster small foot')
})

test('dish rack is an open rack with seated visible plates', (t) => {
  const root = fixture(t, 'dish-rack', 'kitchen-dish-rack', { state: 'dishes-drying' })
  const plates = namedAll(root, 'Dish rack seated plate')
  const rackBounds = bounds(root)
  const rackCenter = rackBounds.getCenter(new Vector3())
  assert.equal(plates.length, 4)
  for (const plate of plates) {
    const plateBounds = bounds(plate)
    assert.ok(plateBounds.min.y - rackBounds.min.y < 0.085, 'plate bottoms should sit in the rack cradles')
    assert.ok(plateBounds.max.y - rackBounds.min.y > 0.29, 'plates should read as upright dishes')
    assert.ok(Math.abs(plateBounds.getCenter(new Vector3()).x - rackCenter.x) < 0.02)
  }
  assert.ok(namedAll(root, 'Dish rack drying cup').length === 1)
})

test('soap dispenser model has neither a square support block nor a square label', (t) => {
  const root = fixture(t, 'soap-dispenser', 'kitchen-soap-dispenser')
  assertNoSoapSupport(root)
})

test('kitchen soap stays clear of the sink rim without overlapping its countertop neighbors', (t) => {
  const kitchen = actualRoomActor(t, 'kitchen', 'kitchen-sink')
  const soap = fixture(t, 'soap-dispenser', 'kitchen-soap-dispenser')
  const basin = named(kitchen.actor, 'Kitchen sink seamless basin')
  assert.ok(bounds(soap).max.z < bounds(basin).min.z - 0.025, 'leave a visible gap between the dispenser and sink rim')
})

test('vacuum is a low canister with wheels, hose, wand and floor head', (t) => {
  const root = fixture(t, 'vacuum', 'kitchen-vacuum')
  assert.ok(named(root, 'Canister vacuum body'))
  assert.ok(namedAll(root, 'Canister vacuum wheel').length >= 2)
  assert.ok(namedAll(root, 'Canister vacuum hose').length >= 3)
  assert.ok(named(root, 'Canister vacuum wand'))
  assert.ok(named(root, 'Canister vacuum floor head'))
  const modelSize = size(root)
  assert.ok(modelSize.y < 0.7)
  assert.ok(modelSize.x < 0.95)
  assert.ok(modelSize.z < 0.75)
})

test('bin lids match their bodies and sit joined to the top', (t) => {
  for (const variant of ['rubbish', 'recycling', 'compost']) {
    const root = fixture(t, 'bins', 'kitchen-bins', { variant })
    const body = named(root, 'Bin body')
    const lid = named(root, 'Bin joined lid')
    assert.equal(color(lid), color(body))
    assert.ok(bounds(lid).min.y <= bounds(body).max.y + 0.002)
  }
})

test('kitchen and bathroom sink fixtures have open basin depth without counter fill', (t) => {
  const kitchen = actualRoomActor(t, 'kitchen', 'kitchen-sink')
  const water = named(kitchen.actor, 'Kitchen sink visible basin depth')
  const dishMeshes = namedAll(kitchen.actor, 'Kitchen sink dish')
  const dishes = dishMeshes.map((dish) => bounds(dish))
    .sort((a, b) => a.min.y - b.min.y)
  assert.equal(dishes.length, 5)
  const dishCenter = dishes[0].getCenter(new Vector3())
  const basinBase = named<Mesh>(kitchen.actor, 'Kitchen sink seamless basin')
  assert.equal(namedAll(kitchen.actor, 'Kitchen sink seamless basin').length, 1)
  assert.equal(namedAll(kitchen.actor, 'Kitchen sink rim').length, 0)
  assert.equal(namedAll(kitchen.actor, 'Kitchen sink basin wall').length, 0)
  const baseHit = new Raycaster(new Vector3(dishCenter.x, dishes[0].min.y + 0.02, dishCenter.z), new Vector3(0, -1, 0))
    .intersectObject(basinBase)[0]
  assert.ok(baseHit)
  assert.ok(Math.abs(dishes[0].min.y - baseHit.point.y) < 0.002, 'bottom dish must rest on the solid basin, not float on water')
  assert.ok(bounds(water).max.y < dishes.at(-1)!.max.y, 'the dishes should remain visible above the shallow water')
  const visibleKitchenMeshes: Mesh[] = []
  kitchen.room.traverseVisible((object) => { if (object instanceof Mesh) visibleKitchenMeshes.push(object) })
  const visibleDish = new Raycaster(new Vector3(dishCenter.x, 3, dishCenter.z), new Vector3(0, -1, 0))
    .intersectObjects(visibleKitchenMeshes)[0]
  assert.equal(visibleDish?.object.name, 'Kitchen sink dish', 'neither countertop nor cabinet fill may hide the actual-room dishes')
  const centers = dishes.map((dish) => dish.getCenter(new Vector3()))
  assert.ok(Math.max(...centers.map((center) => center.x)) - Math.min(...centers.map((center) => center.x)) > 0.35)
  assert.ok(Math.max(...centers.map((center) => center.z)) - Math.min(...centers.map((center) => center.z)) > 0.12)
  for (const dish of dishMeshes) {
    const box = bounds(dish)
    const center = box.getCenter(new Vector3())
    const supports = [basinBase, ...dishMeshes.filter((other) => other !== dish && bounds(other).max.y <= box.min.y + 0.001)]
    const hit = new Raycaster(new Vector3(center.x, box.min.y + 0.01, center.z), new Vector3(0, -1, 0))
      .intersectObjects(supports)[0]
    assert.ok(hit && Math.abs(hit.point.y - box.min.y) < 0.002, 'each scattered dish must rest on the basin or another dish')
  }
  const worktop = named<Mesh>(kitchen.room, 'Continuous L-shaped worktop')
  const worktopHit = (x: number, z: number) =>
    new Raycaster(new Vector3(x, 2.1, z), new Vector3(0, -1, 0)).intersectObject(worktop).length
  for (const x of [3.1, 3.5, 3.9]) for (const z of [-2.805, -2.56, -2.315]) {
    assert.equal(worktopHit(x, z), 0, `the rectangular basin opening must stay empty at ${x}, ${z}, including its corners`)
  }
  for (const [x, z] of [
    [2.88, -2.56], [4.12, -2.56], [3.5, -3.04], [3.5, -2.08],
    [1.0, -2.56], [5.35, -1.2], [5.35, 0.55],
  ]) {
    assert.ok(worktopHit(x, z) > 0, `worktop should remain present at ${x}, ${z}`)
  }

  const bathroom = actualRoomActor(t, 'bathroom', 'bathroom-sink')
  const bathroomBasin = named(bathroom.actor, 'Bathroom sink open basin')
  assert.ok(bathroom.actor.getObjectByName('Bathroom sink visible basin depth'))
  const bathroomCounter = named(bathroom.actor, 'Bathroom vanity worktop')
  assert.ok(bounds(bathroomCounter).max.y <= bounds(bathroomBasin).min.y, 'the vessel basin must sit above the continuous vanity counter')
  const basinCenter = bathroom.actor.localToWorld(new Vector3(0, 3, 0.04))
  const basinHit = new Raycaster(basinCenter, new Vector3(0, -1, 0)).intersectObject(bathroom.actor, true)[0]
  assert.ok(basinHit && basinHit.point.y < bounds(bathroomBasin).max.y - 0.25, 'the full sink opening must expose a genuinely deep interior')
  for (const [x, z] of [[-0.74, 0], [0.74, 0], [0, -0.6], [0, 0.6]]) {
    const origin = bathroom.actor.localToWorld(new Vector3(x, 3, z))
    assert.ok(new Raycaster(origin, new Vector3(0, -1, 0)).intersectObject(bathroomCounter).length,
      'the vanity counter must not expose cabinet-colored gaps around the vessel basin')
  }
  assert.equal(named(bathroom.actor, 'Bathroom sink soap dispenser').children.length, 3, 'the built-in soap dispenser must also omit its square label')
})

test('component menu previews include the open fitted sink basins', (t) => {
  t.after(clearComponentThumbnails)
  for (const [kind, slotId, parts] of [
    ['sink', 'kitchen-sink', ['Kitchen sink seamless basin', 'Kitchen sink visible basin depth', 'Kitchen sink dish']],
    ['sink', 'bathroom-sink', ['Bathroom sink open basin', 'Bathroom sink visible basin depth']],
  ] as const) {
    const thumbnail = buildComponentThumbnail(createRoomComponent(kind, slotId, `sink-menu-${slotId}`), 'original')
    try {
      for (const part of parts) assert.ok(thumbnail.root.getObjectByName(part), `${slotId} menu preview should include ${part}`)
    } finally { thumbnail.dispose() }
  }
})

test('laundry basket has a hollow deep interior', (t) => {
  const root = fixture(t, 'laundry-basket', 'bathroom-laundry-basket')
  const basket = named<Mesh>(root, 'Laundry basket hollow body')
  assert.ok(basket.geometry instanceof LatheGeometry)
  const interior = named<Mesh>(root, 'Laundry basket deep interior')
  assert.ok(interior.geometry instanceof CylinderGeometry)
  const profile = basket.geometry.parameters.points
  const innerBase = profile.at(-2)!
  const innerRim = profile.at(-3)!
  for (const [height, radius] of [
    [interior.position.y - interior.geometry.parameters.height / 2, interior.geometry.parameters.radiusBottom],
    [interior.position.y + interior.geometry.parameters.height / 2, interior.geometry.parameters.radiusTop],
  ]) {
    const cavityRadius = innerBase.x + (innerRim.x - innerBase.x) * (height - innerBase.y) / (innerRim.y - innerBase.y)
    assert.ok(height >= innerBase.y - 0.001 && radius <= cavityRadius + 0.001, 'the light liner must stay inside the hollow basket walls')
  }
  const top = bounds(basket).max.y
  const center = bounds(interior).getCenter(new Vector3())
  const visibleMeshes: Mesh[] = []
  root.traverseVisible((object) => { if (object instanceof Mesh) visibleMeshes.push(object) })
  const hits = new Raycaster(new Vector3(center.x, top + 0.1, center.z), new Vector3(0, -1, 0)).intersectObjects(visibleMeshes)
  assert.ok(hits.length)
  assert.equal(hits[0].object.name, 'Laundry basket deep interior')
  assert.ok(hits[0].point.y < top - 0.45, 'basket opening should lead down into the body')
})

test('wall art paint uses organic flat splashes and droplets on the canvas', (t) => {
  for (const variant of ['botanical', 'geometric']) {
    const root = fixture(t, 'wall-art', 'kitchen-wall-art', { variant })
    const canvas = bounds(named(root, 'Wall art flat canvas'))
    const splashes = namedAll(root, 'Organic paint splash on canvas')
    const droplets = namedAll(root, 'Paint splash droplet on canvas')
    assert.equal(splashes.length, 3)
    assert.ok(droplets.length >= 4)
    for (const splash of splashes) {
      assert.ok(splash instanceof Mesh)
      assert.ok(splash.geometry instanceof ShapeGeometry)
      assert.ok(splash.geometry.getAttribute('position').count > 8, 'splash silhouettes should be organic polygons, not rectangles')
      const splashBounds = bounds(splash)
      assert.ok(splashBounds.min.x >= canvas.min.x - 0.001 && splashBounds.max.x <= canvas.max.x + 0.001)
      assert.ok(splashBounds.min.y >= canvas.min.y - 0.001 && splashBounds.max.y <= canvas.max.y + 0.001)
      assert.ok(splashBounds.max.z <= canvas.max.z + 0.006, 'paint should sit flat on the canvas, not protrude as decor')
    }
  }
})

test('component menu thumbnails use the corrected generated model parts', (t) => {
  t.after(clearComponentThumbnails)
  for (const [kind, slotId, overrides, parts] of [
    ['air-fryer', 'kitchen-air-fryer', {}, ['Air fryer round door frame', 'Air fryer basket handle']],
    ['toaster', 'kitchen-toaster', {}, ['Toaster narrow body', 'Toaster small foot', 'Toaster toast slot']],
    ['dish-rack', 'kitchen-dish-rack', { state: 'dishes-drying' }, ['Dish rack seated plate', 'Dish rack drying cup']],
    ['soap-dispenser', 'kitchen-soap-dispenser', {}, ['Soap dispenser bottle', 'Soap dispenser pump spout']],
    ['laundry-basket', 'bathroom-laundry-basket', {}, ['Laundry basket hollow body', 'Laundry basket deep interior']],
    ['wall-art', 'kitchen-wall-art', {}, ['Wall art flat canvas', 'Organic paint splash on canvas', 'Paint splash droplet on canvas']],
    ['vacuum', 'kitchen-vacuum', {}, ['Canister vacuum body', 'Canister vacuum hose', 'Canister vacuum wand', 'Canister vacuum floor head']],
    ['bins', 'kitchen-bins', {}, ['Bin body', 'Bin joined lid']],
  ] as const) {
    const component = { ...createRoomComponent(kind, slotId, `menu-${kind}`), ...overrides }
    const thumbnail = buildComponentThumbnail(component, 'original')
    try {
      for (const part of parts) assert.ok(thumbnail.root.getObjectByName(part), `${kind} menu preview should include ${part}`)
    } finally {
      thumbnail.dispose()
    }
  }
})

test('actual room scenes use the corrected generated factory bounds', () => {
  for (const [kind, slotId, overrides] of [
    ['air-fryer', 'kitchen-air-fryer', {}],
    ['toaster', 'kitchen-toaster', {}],
    ['dish-rack', 'kitchen-dish-rack', { state: 'dishes-drying' }],
    ['soap-dispenser', 'kitchen-soap-dispenser', {}],
    ['soap-dispenser', 'bathroom-soap-dispenser', {}],
    ['laundry-basket', 'bathroom-laundry-basket', {}],
    ['wall-art', 'kitchen-wall-art', {}],
    ['vacuum', 'kitchen-vacuum', {}],
    ['vacuum', 'bathroom-vacuum', {}],
    ['bins', 'kitchen-bins', {}],
    ['bins', 'bathroom-bins', {}],
  ] as const) {
    const component = { ...createRoomComponent(kind, slotId, `room-${slotId}`), ...overrides }
    const room = new Group()
    const model = roomModels[component.roomId](room, 'original')
    const scenery = 'scenery' in model ? model.scenery : model
    const scene = createRoomComponentScene(room, component.roomId, {
      bindings: scenery.componentBindings, fixtures: scenery.componentFixtures, styleMaterials: model.styleMaterials,
    })
    scene.update([...defaultRoomComponents(), component], 'original')
    const actor = scene.actors.get(component.id)
    assert.ok(actor, `${slotId} actual room actor should exist`)
    const expected = buildRoomComponentModel(component, 'original')
    assertSameBounds(actor, expected.root)
    if (kind === 'soap-dispenser') assertNoSoapSupport(actor)
    expected.materials.forEach((material) => material.dispose())
    scene.dispose()
    room.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose()
    })
    model.materials.forEach((material) => material.dispose())
  }
})
