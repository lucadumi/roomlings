import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Box3, Group, Mesh, OrthographicCamera, Raycaster, Vector3 } from 'three'
import type { Intersection, Object3D } from 'three'
import {
  componentCatalog, componentKinds, createRoomComponent, defaultRoomComponents, roomComponentLimit, roomComponentSchema, roomSlots, validateRoomComponents,
} from '../shared/roomComponents.ts'
import type { RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { baseCameraOffset, cameraProjection, fitRoomBounds } from '../src/camera.ts'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { buildBathroomModel } from '../src/bathroomModel.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'
import { createRoomComponentScene, isSceneObjectVisible, visibleRoomBounds } from '../src/roomComponentScene.ts'
import { componentPlacements, kitchenApplianceBays, kitchenLayout, kitchenShelves, kitchenWorktops, roomFootprints } from '../src/roomLayout.ts'
import { completeRoomLayout } from './room-layout-fixture.ts'

function configured(t: TestContext, roomId: RoomId, components = completeRoomLayout()) {
  const preview = createConfiguredRoomPreview(roomId, 'original', components)
  t.after(() => preview.dispose())
  return { ...preview, components: components.filter((component) => component.roomId === roomId) }
}

function pickablePoint(room: Group, root: Object3D, identifies: (object: Object3D) => boolean, rotation = 0) {
  const raycaster = new Raycaster()
  const direction = new Vector3(...baseCameraOffset).applyAxisAngle(new Vector3(0, 1, 0), -rotation).normalize()
  const meshes: Mesh[] = []
  root.traverseVisible((object) => { if (object instanceof Mesh) meshes.push(object) })
  for (const mesh of meshes) {
    const positions = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.index
    for (let triangle = 0; triangle < (index?.count ?? positions.count); triangle += 3) {
      const point = new Vector3()
      for (let vertex = 0; vertex < 3; vertex++) {
        point.add(new Vector3().fromBufferAttribute(positions, index?.getX(triangle + vertex) ?? triangle + vertex))
      }
      point.divideScalar(3).applyMatrix4(mesh.matrixWorld)
      raycaster.set(point.clone().addScaledVector(direction, 40), direction.clone().negate())
      const hit = raycaster.intersectObject(room, true).find(({ object }) => isSceneObjectVisible(object, room))
      if (hit && identifies(hit.object)) return point
    }
  }
  return null
}

test('all compatible catalog kinds coexist without changing the original installed defaults or object limit', () => {
  const original = defaultRoomComponents()
  const complete = completeRoomLayout()
  assert.equal(original.length, 39)
  assert.equal(complete.length, 118)
  assert.ok(complete.length < roomComponentLimit)
  assert.deepEqual(new Set(complete.map((component) => component.kind)), new Set(componentKinds))
  assert.equal(validateRoomComponents(complete), null)
  for (const component of complete) assert.equal(roomComponentSchema.safeParse(component).success, true)
  assert.deepEqual(complete.filter((component) => component.id.startsWith('default-')), original)
  assert.equal(original.filter((component) => component.roomId === 'kitchen').length, 20)
  assert.equal(original.filter((component) => component.roomId === 'bathroom').length, 6)
  assert.equal(original.filter((component) => component.roomId === 'living-room').length, 13)
  for (const roomId of ['kitchen', 'bathroom'] as const) {
    const allowed = new Set(roomSlots.filter((slot) => slot.roomId === roomId).flatMap((slot) => slot.kinds))
    assert.deepEqual(new Set(complete.filter((component) => component.roomId === roomId).map((component) => component.kind)), allowed)
  }
  assert.deepEqual(defaultRoomComponents(), original)
  assert.ok(roomFootprints.kitchen.width * roomFootprints.kitchen.depth < 10.5 * 6.7 * 1.2)
  assert.ok(roomFootprints.bathroom.width * roomFootprints.bathroom.depth < 9.4 * 6.4 * 1.2)
  assert.equal(kitchenWorktops.length, 2, 'Keep one working run and its connected return, not separate cabinet blocks')
})

for (const roomId of ['kitchen', 'bathroom'] as const) {
  test(`alternative ${roomId} objects clear each other and the low shelves using their actual mesh parts`, (t) => {
    const room = new Group()
    const model = roomId === 'kitchen' ? buildKitchenModel(room) : buildBathroomModel(room)
    const bindings = 'scenery' in model ? model.scenery.componentBindings : model.componentBindings
    t.after(() => {
      const geometries = new Set<Mesh['geometry']>()
      room.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
      geometries.forEach((geometry) => geometry.dispose())
      model.materials.forEach((material) => material.dispose())
    })
    const choices: { component: RoomComponent; bounds: Box3; parts: Box3[] }[] = []
    for (const slot of roomSlots.filter((slot) => slot.roomId === roomId)) {
      for (const kind of slot.kinds) for (const variant of componentCatalog[kind].variants) {
        if (['counters', 'table', 'seating', 'rug', 'bath', 'sink', 'toilet'].includes(kind)) continue
        const component = { ...createRoomComponent(kind, slot.id, `alternative-${slot.id}`), variant: variant.id }
        const generated = slot.defaultKind === kind && variant.id === 'original' ? undefined : buildRoomComponentModel(component, 'original')
        const root = generated?.root ?? bindings.get(slot.id)!.root
        generated?.stateObjects?.forEach(({ root }) => { root.visible = true })
        root.updateWorldMatrix(true, true)
        const parts: Box3[] = []
        root.traverseVisible((object) => {
          if (!(object instanceof Mesh)) return
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          if (materials.every((material) => material.opacity === 0)) return
          parts.push(new Box3().setFromObject(object, true))
        })
        const bounds = parts.reduce((bounds, part) => bounds.union(part), new Box3())
        choices.push({ component, bounds, parts })
        if (generated) {
          const geometries = new Set<Mesh['geometry']>()
          generated.root.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
          geometries.forEach((geometry) => geometry.dispose())
          generated.materials.forEach((material) => material.dispose())
        }
      }
    }
    const intersects = (left: Box3, right: Box3) => {
      const overlap = left.clone().intersect(right)
      return !overlap.isEmpty() && overlap.getSize(new Vector3()).toArray().every((size) => size >= 0.008)
    }
    for (let i = 0; i < choices.length; i++) for (let j = i + 1; j < choices.length; j++) {
      const a = choices[i]
      const b = choices[j]
      if (a.component.slotId === b.component.slotId || !intersects(a.bounds, b.bounds)) continue
      assert.equal(a.parts.some((left) => b.parts.some((right) => intersects(left, right))), false,
        `${a.component.slotId} (${a.component.kind}, ${a.component.variant}) must clear ${b.component.slotId} (${b.component.kind}, ${b.component.variant})`)
    }
    if (roomId === 'kitchen') for (const choice of choices) {
      if (componentPlacements[choice.component.slotId]?.surface !== 'floor') continue
      for (const shelf of kitchenShelves) {
        const bounds = new Box3(new Vector3(shelf.position[0] - shelf.width / 2, shelf.top - 0.07, shelf.position[2] - shelf.depth / 2),
          new Vector3(shelf.position[0] + shelf.width / 2, shelf.top, shelf.position[2] + shelf.depth / 2))
        assert.equal(choice.parts.some((part) => intersects(part, bounds)), false,
          `${choice.component.slotId} (${choice.component.kind}) must not clip through ${shelf.name}`)
      }
    }
  })

  test(`every object in the fully equipped ${roomId} remains physically pickable from the available room angles`, (t) => {
    const { room, componentScene, components } = configured(t, roomId)
    const input = JSON.stringify(components)
    room.updateMatrixWorld(true)
    for (const component of components) {
      const root = componentScene.actors.get(component.id)!
      assert.equal(componentScene.anchors.get(component.id)?.parent, root)
      // The return opens inward, so its fitted appliances are reached by turning the room.
      const placement = componentPlacements[component.slotId]
      const rotation = placement?.surface === 'fitted' && placement.rotation === -Math.PI / 2 ? 0.75 : 0
      assert.ok(pickablePoint(room, root, (object) => componentScene.componentForObject(object)?.id === component.id, rotation),
        `${component.slotId} must stay reachable with its own attached anchor`)
    }
    assert.equal(JSON.stringify(components), input)
    assert.equal(componentScene.actors.size, components.length)
  })

  test(`the fully equipped ${roomId} and every focus view fit measured areas after turning and tilting`, (t) => {
    const { room, componentScene, components } = configured(t, roomId)
    const bounds = componentScene.bounds
    const footprint = roomFootprints[roomId]
    assert.ok(Math.abs(bounds.getSize(new Vector3()).x - footprint.width) < 0.001)
    assert.ok(bounds.max.z <= footprint.centerZ + footprint.depth / 2 + 0.001)
    const rotations = [-0.75, 0, 0.75]
    const axis = new Vector3(0, 1, 0)
    const layouts = [
      { width: 1440, height: 960, area: { x: 12, y: 100, width: 884, height: 680 } },
      { width: 390, height: 844, area: { x: 12, y: 90, width: 366, height: 255 } },
      { width: 844, height: 390, area: { x: 12, y: 110, width: 768, height: 160 } },
      { width: 320, height: 360, area: { x: 12, y: 70, width: 264, height: 44 } },
    ]
    for (const box of [bounds, ...components.map((component) => componentScene.getBounds(component.id)!)]) {
      for (const rotation of rotations) for (const pitch of [-1.7, 3]) for (const layout of layouts) {
        const frame = fitRoomBounds(layout.area.width, layout.area.height, box, rotation, pitch)
        const projection = cameraProjection(layout.width, layout.height, layout.area, frame.halfHeight, 1)
        const camera = new OrthographicCamera(projection.left, projection.right, projection.top, projection.bottom, 0.1, 100)
        const center = new Vector3(...frame.center)
        camera.position.copy(center).add(new Vector3(baseCameraOffset[0], baseCameraOffset[1] + pitch, baseCameraOffset[2]))
        camera.lookAt(center)
        camera.updateMatrixWorld(true)
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const point = new Vector3(x, y, z).applyAxisAngle(axis, rotation).project(camera)
          const screenX = (point.x * 0.5 + 0.5) * layout.width
          const screenY = (-point.y * 0.5 + 0.5) * layout.height
          assert.ok(screenX > layout.area.x && screenX < layout.area.x + layout.area.width)
          assert.ok(screenY > layout.area.y && screenY < layout.area.y + layout.area.height)
          assert.ok(Math.abs(point.z) < 1)
        }
      }
    }
    const originalAnchor = componentScene.anchors.get(components[0].id)!
    room.rotation.y = 0.5
    room.updateMatrixWorld(true)
    assert.ok(componentScene.getBounds(components[0].id)!.containsPoint(room.worldToLocal(originalAnchor.getWorldPosition(new Vector3()))))
  })

  test(`the fully equipped ${roomId} keeps separate optional objects clear of one another`, (t) => {
    const { room, componentScene, components } = configured(t, roomId)
    const loose = components.filter((component) => !['counters', 'table', 'seating', 'rug', 'bath', 'sink', 'toilet'].includes(component.kind))
    for (let i = 0; i < loose.length; i++) for (let j = i + 1; j < loose.length; j++) {
      const a = loose[i]
      const b = loose[j]
      const overlap = visibleRoomBounds(room, componentScene.actors.get(a.id)!)
        .intersect(visibleRoomBounds(room, componentScene.actors.get(b.id)!))
      assert.ok(overlap.isEmpty() || overlap.getSize(new Vector3()).toArray().some((size) => size < 0.008),
        `${a.slotId} must not intersect ${b.slotId}`)
    }
  })

  test(`every optional ${roomId} position supports its alternative kinds and variants beside the complete catalog`, (t) => {
    const { room, componentScene: scene } = configured(t, roomId)
    const complete = completeRoomLayout()
    for (const slot of roomSlots.filter((slot) => slot.roomId === roomId && !slot.defaultKind)) {
      for (const kind of slot.kinds) for (const variant of componentCatalog[kind].variants) {
        const component = { ...createRoomComponent(kind, slot.id, `alternative-${slot.id}`), variant: variant.id }
        const layout = complete.map((other) => other.slotId === slot.id ? component : other)
        scene.update(layout, 'original')
        const bounds = visibleRoomBounds(room, scene.actors.get(component.id)!)
        for (const other of layout.filter((other) => other.roomId === roomId && other.id !== component.id
          && !['counters', 'table', 'seating', 'rug', 'bath', 'sink', 'toilet'].includes(other.kind))) {
          const overlap = bounds.clone().intersect(visibleRoomBounds(room, scene.actors.get(other.id)!))
          assert.ok(overlap.isEmpty() || overlap.getSize(new Vector3()).toArray().some((size) => size < 0.008),
            `${slot.id} (${kind}, ${variant.id}) must not intersect ${other.slotId}`)
        }
      }
    }
  })
}

test('the kitchen joins its sink run and right-wall return with one flush L-shaped worktop', (t) => {
  const { room } = configured(t, 'kitchen')
  const [rear, side] = kitchenWorktops
  const corner = rear.position[2] + rear.depth / 2
  const inside = side.position[0] - side.width / 2
  const right = rear.position[0] + rear.width / 2
  assert.ok(Math.abs(side.position[2] - side.depth / 2 - corner) < 0.0001)
  assert.equal(side.top, rear.top)
  assert.ok(Math.abs(side.position[0] + side.width / 2 - right) < 0.0001)
  assert.ok(roomFootprints.kitchen.width / 2 - right < 0.11)
  const worktop = room.getObjectByName('Continuous L-shaped worktop')
  assert.ok(worktop instanceof Mesh)
  assert.equal(worktop.geometry.type, 'ExtrudeGeometry')
  const ray = new Raycaster()
  for (const x of [inside + 0.1, right - 0.1]) for (const z of [corner - 0.01, corner, corner + 0.01]) {
    ray.set(new Vector3(x, 3, z), new Vector3(0, -1, 0))
    const hit: Intersection | undefined = ray.intersectObject(worktop)[0]
    assert.ok(hit && Math.abs(hit.point.y - rear.top) < 0.0001, 'The corner must have no seam, gap or height step')
  }
  ray.set(new Vector3(inside - 0.1, 3, corner + 0.1), new Vector3(0, -1, 0))
  assert.equal(ray.intersectObject(worktop).length, 0, 'The inside elbow must remain open')
})

test('the kitchen keeps its sink-side runner, supported work surfaces and a clear dining aisle', (t) => {
  const { room, componentScene, components } = configured(t, 'kitchen')
  const [rear, side] = kitchenWorktops
  const table = componentScene.actors.get('default-kitchen-table')!
  assert.ok(side.position[0] - side.width / 2 - (table.position.x + 1.79) > 1.3,
    'The round table must leave a working aisle along the return')
  const rug = visibleRoomBounds(room, componentScene.actors.get('default-kitchen-rug')!)
  assert.equal(rug.getCenter(new Vector3()).x, kitchenLayout.rug[0])
  assert.ok(rug.min.z > rear.position[2] + rear.depth / 2)
  assert.ok(rug.max.z < table.position.z - 0.93)
  assert.ok(rug.min.x < 3.5 && rug.max.x > 3.5, 'The runner must cover the standing spot in front of the sink')
  assert.ok(rug.max.x < side.position[0] - side.width / 2)
  const oven = componentPlacements['kitchen-oven']!
  assert.equal(oven.position[0], kitchenLayout.hob[0])
  assert.equal(oven.position[2], kitchenLayout.hob[2])
  assert.equal(oven.rotation, -Math.PI / 2)
  for (const component of components) {
    const placement = componentPlacements[component.slotId]
    if (!placement || !['counter', 'table'].includes(placement.surface)) continue
    const [x, y, z] = placement.position
    if (y === 2.36) {
      assert.ok(x > -0.45 && x < 2.32 && z > -3.26 && z < -2.36, component.slotId)
    } else if (placement.surface === 'table') {
      assert.ok(Math.abs(x - table.position.x) < 1.79 && Math.abs(z - table.position.z) < 0.93)
      assert.equal(y, 1.495)
    } else {
      assert.ok([...kitchenWorktops, ...kitchenShelves].some((top) => Math.abs(x - top.position[0]) < top.width / 2
        && Math.abs(z - top.position[2]) < top.depth / 2 && Math.abs(y - top.top) < 0.03), component.slotId)
    }
  }
})

test('the fitted kitchen appliances leave clear space in front of their inward-facing doors', (t) => {
  const { room, componentScene: scene, components } = configured(t, 'kitchen')
  for (const { slotId, rotation } of kitchenApplianceBays) {
    const component = scene.componentAtSlot(slotId)!
    const bounds = visibleRoomBounds(room, scene.actors.get(component.id)!)
    const approach = rotation
      ? new Box3(new Vector3(bounds.min.x - 1.15, 0.15, bounds.min.z), new Vector3(bounds.min.x - 0.03, 1.3, bounds.max.z))
      : new Box3(new Vector3(bounds.min.x, 0.15, bounds.max.z + 0.03), new Vector3(bounds.max.x, 1.3, bounds.max.z + 1.15))
    for (const other of components.filter((other) => other.id !== component.id && other.kind !== 'counters')) {
      assert.equal(visibleRoomBounds(room, scene.actors.get(other.id)!).intersectsBox(approach), false,
        `${other.slotId} must leave the ${slotId} door and standing area clear`)
    }
  }
})

test('bathroom laundry faces into the room from the left-wall corner and leaves fixture access clear', (t) => {
  const { room, componentScene, components } = configured(t, 'bathroom')
  const boundsFor = (kind: RoomComponent['kind']) => visibleRoomBounds(room, componentScene.actors.get(components.find((component) => component.kind === kind)!.id)!)
  const washer = boundsFor('washing-machine')
  const dryer = boundsFor('dryer')
  assert.ok(Math.abs(washer.min.x - dryer.min.x) < 0.001)
  assert.ok(Math.abs(washer.min.z - dryer.min.z) < 0.001)
  assert.ok(dryer.min.y - washer.max.y > 0.1)
  assert.ok(washer.min.x > roomFootprints.bathroom.leftX + 0.07
    && washer.min.x < roomFootprints.bathroom.leftX + 0.17, 'Laundry must sit against the inner left wall')
  const front = roomFootprints.bathroom.centerZ + roomFootprints.bathroom.depth / 2
  assert.ok(washer.max.z > front - 0.25 && washer.max.z < front - 0.08, 'Laundry must be tucked into the front-left corner')
  for (const slotId of ['bathroom-laundry', 'bathroom-dryer'] as const) {
    assert.equal(componentPlacements[slotId]!.rotation, Math.PI / 2)
  }
  const frame = room.getObjectByName('Wall-backed laundry stacking frame')!
  assert.equal(frame.rotation.y, Math.PI / 2)
  assert.equal(frame.position.x, componentPlacements['bathroom-laundry']!.position[0])
  assert.equal(frame.position.z, componentPlacements['bathroom-laundry']!.position[2])
  assert.ok(boundsFor('ironing-board').min.x - boundsFor('drying-rack').max.x > 0.45)
  const aisle = new Box3(new Vector3(-0.4, 0.15, -0.2), new Vector3(2.8, 1.3, 1.35))
  for (const component of components) {
    assert.equal(visibleRoomBounds(room, componentScene.actors.get(component.id)!).intersectsBox(aisle), false, component.slotId)
  }
  const approaches = [
    new Box3(new Vector3(washer.max.x + 0.03, 0.01, washer.min.z), new Vector3(washer.max.x + 1, 1.3, washer.max.z)),
    new Box3(new Vector3(-1.92, 0.15, -1.55), new Vector3(-0.43, 1.3, -0.45)),
    new Box3(new Vector3(-0.9, 0.15, -1.56), new Vector3(1.4, 1.3, -0.4)),
    new Box3(new Vector3(1.57, 0.15, -1), new Vector3(2.97, 1.3, 0.2)),
    new Box3(new Vector3(-3.4, 0.15, 0.25), new Vector3(-2.1, 1.3, 1.15)),
    new Box3(new Vector3(2.55, 0.15, 0.2), new Vector3(3.55, 1.3, front)),
  ]
  for (const component of components) for (const approach of approaches) {
    assert.equal(visibleRoomBounds(room, componentScene.actors.get(component.id)!).intersectsBox(approach), false,
      `${component.slotId} must leave the washer, basin, toilet and bath approaches clear`)
  }
})

test('bathroom additions are sized against the vanity rather than a miniature generic corner', (t) => {
  const { room, componentScene } = configured(t, 'bathroom')
  const size = (slotId: RoomSlotId) => {
    const component = componentScene.componentAtSlot(slotId)!
    return visibleRoomBounds(room, componentScene.actors.get(component.id)!).getSize(new Vector3())
  }
  const vanityWidth = size('bathroom-sink').x
  const vanityTop = componentPlacements['bathroom-vanity-accessory']!.position[1]
  assert.ok(size('bathroom-vanity-accessory').y >= vanityTop * 0.22, 'Toothbrushes must not be shrunk to the countertop plant scale')
  assert.ok(size('bathroom-first-aid').x >= vanityWidth * 0.18, 'The first-aid kit must read as a household kit')
  assert.ok(size('bathroom-tissue-box').x >= vanityWidth * 0.16, 'The tissue box must be proportional to the vanity')
  assert.ok(size('bathroom-storage-jars').x >= vanityWidth * 0.19, 'The storage jars must not be miniature')
  assert.ok(size('bathroom-hair-dryer').z >= vanityWidth * 0.25, 'The hair dryer must keep a usable handheld size')
  assert.ok(size('bathroom-toilet-accessory').y >= vanityTop * 0.43, 'The toilet brush must reach a normal size beside the fixtures')
  assert.ok(size('bathroom-stool').y >= vanityTop * 0.3, 'The step stool must not look like a miniature')
  assert.ok(size('bathroom-air-purifier').y >= vanityTop * 0.6)
  assert.ok(size('bathroom-ironing-board').x > size('bathroom-bath').x)
})

test('bathroom accessories keep their full model size in shared and dedicated positions', (t) => {
  const { room, componentScene: scene } = configured(t, 'bathroom', defaultRoomComponents())
  for (const [kind, dedicated] of [
    ['soap-dispenser', 'bathroom-soap-dispenser'],
    ['hair-dryer', 'bathroom-hair-dryer'],
    ['storage-jars', 'bathroom-storage-jars'],
    ['tissue-box', 'bathroom-tissue-box'],
    ['first-aid-kit', 'bathroom-first-aid'],
    ['reed-diffuser', 'bathroom-diffuser'],
  ] as const) {
    const corner = createRoomComponent(kind, 'bathroom-vanity-accessory', 'corner-copy')
    const full = createRoomComponent(kind, dedicated, 'dedicated-copy')
    scene.update([...defaultRoomComponents(), corner, full], 'original')
    const cornerSize = visibleRoomBounds(room, scene.actors.get(corner.id)!).getSize(new Vector3())
    const dedicatedSize = visibleRoomBounds(room, scene.actors.get(full.id)!).getSize(new Vector3())
    assert.ok(cornerSize.distanceTo(dedicatedSize) < 0.000001, `${kind} must not shrink when placed in the vanity corner`)
  }
})

test('laundry furniture has working-height surfaces rather than tiny legs beneath oversized details', (t) => {
  const vanityTop = componentPlacements['bathroom-vanity-accessory']!.position[1]
  for (const [kind, slotId, surfaceName] of [
    ['ironing-board', 'bathroom-ironing-board', 'Ironing board cover'],
    ['drying-rack', 'bathroom-drying-rack', 'Drying rack top rail'],
  ] as const) {
    const model = buildRoomComponentModel(createRoomComponent(kind, slotId, 'height-check'), 'original')
    t.after(() => {
      model.root.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
      model.materials.forEach((material) => material.dispose())
    })
    const surface = model.root.getObjectByName(surfaceName)
    assert.ok(surface)
    model.root.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(surface)
    assert.ok(bounds.min.y >= vanityTop * 0.85, `${kind}'s actual working surface must be proportional to the vanity`)
    assert.ok(bounds.max.y <= vanityTop * 1.05)
    assert.ok(bounds.getSize(new Vector3()).y < 0.08, 'The working surface must stay thin and level')
  }
})

test('optional bathroom floor objects clear the full-size fixtures and shelf parts', (t) => {
  const room = new Group()
  const model = buildBathroomModel(room)
  const scene = createRoomComponentScene(room, 'bathroom', {
    bindings: model.componentBindings, fixtures: model.componentFixtures, styleMaterials: model.styleMaterials,
  })
  t.after(() => {
    scene.dispose()
    room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
    model.materials.forEach((material) => material.dispose())
  })
  const complete = completeRoomLayout()
  const slots = roomSlots.filter((slot) => slot.roomId === 'bathroom' && !slot.defaultKind
    && ['floor', 'fitted'].includes(componentPlacements[slot.id]?.surface ?? ''))
  for (const { id: slotId, kinds } of slots) for (const kind of kinds) {
    for (const variant of componentCatalog[kind].variants) {
      scene.update(complete.map((component) => component.slotId === slotId
        ? { ...createRoomComponent(kind, slotId, component.id), variant: variant.id } : component), 'original')
      const component = scene.componentAtSlot(slotId)!
      const bounds = visibleRoomBounds(room, scene.actors.get(component.id)!)
      for (const target of ['bath', 'sink', 'mirror', 'toilet', 'supplies', 'chores'] as const) model.actors.get(target)!.traverseVisible((object) => {
        if (!(object instanceof Mesh)) return
        const overlap = new Box3().setFromObject(object).intersect(bounds)
        assert.ok(overlap.isEmpty() || overlap.getSize(new Vector3()).toArray().some((size) => size < 0.005),
          `${slotId} (${kind}, ${variant.id}) must not intersect a physical ${target} part`)
      })
    }
  }
})

test('optional laundry and shelf supports appear only when needed and never install additional catalog objects', (t) => {
  const { room, componentScene: scene } = configured(t, 'bathroom', defaultRoomComponents())
  const defaults = defaultRoomComponents()
  const complete = completeRoomLayout()
  const dryer = complete.find((component) => component.slotId === 'bathroom-dryer')!
  const washer = complete.find((component) => component.slotId === 'bathroom-laundry')!
  const frame = room.getObjectByName('Wall-backed laundry stacking frame')!
  const lower = room.getObjectByName('Laundry cabinet below a standalone dryer')!
  assert.equal(frame.visible, false)
  assert.equal(scene.update([...defaults, dryer], 'original').shadowsChanged, true)
  assert.equal(frame.visible, true)
  assert.equal(lower.visible, true)
  assert.equal(scene.componentAtSlot('bathroom-laundry'), undefined)
  scene.update([...defaults, dryer, washer], 'original')
  assert.equal(frame.visible, true)
  assert.equal(lower.visible, false)
  scene.update([...defaults, washer], 'original')
  assert.equal(frame.visible, false)
  assert.equal(scene.componentAtSlot('bathroom-dryer'), undefined)
  assert.equal(scene.actors.size, 7)
})

test('a shared accessory ledge remains supported until its last installed object is removed', (t) => {
  const { room, componentScene: scene } = configured(t, 'kitchen', defaultRoomComponents())
  const defaults = defaultRoomComponents()
  const objects = completeRoomLayout().filter((component) => ['kitchen-speaker', 'kitchen-record-player'].includes(component.slotId))
  const shelf = room.getObjectByName('Listening shelf')!
  assert.equal(shelf.visible, false)
  scene.update([...defaults, ...objects], 'original')
  assert.equal(shelf.visible, true)
  scene.update([...defaults, objects[1]], 'original')
  assert.equal(shelf.visible, true)
  scene.update(defaults, 'original')
  assert.equal(shelf.visible, false)
  assert.equal(scene.actors.size, 20)
})

test('independent fitted appliance bays preserve their visibility controls after batching and removal', (t) => {
  const room = new Group()
  const model = buildKitchenModel(room)
  const scene = createRoomComponentScene(room, 'kitchen', {
    bindings: model.scenery.componentBindings, fixtures: model.scenery.componentFixtures, styleMaterials: model.styleMaterials,
  })
  t.after(() => {
    scene.dispose()
    const geometries = new Set<Mesh['geometry']>()
    room.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  })
  let components = completeRoomLayout()
  scene.update(components, 'original')
  batchStaticMeshes(room, model.scenery.preserved)
  for (const { slotId, x, z, rotation } of kitchenApplianceBays) {
    const fixture = model.scenery.componentFixtures.get(slotId)!
    const component = components.find((component) => component.slotId === slotId)!
    const appliance = visibleRoomBounds(room, scene.actors.get(component.id)!)
    assert.ok(appliance.min.y >= 0.234, 'Fitted appliances must rest above the cabinet plinth')
    assert.ok(appliance.max.y < 1.585, 'Fitted appliances must clear the underside of the worktop')
    const horizontal = rotation ? 'z' : 'x'
    const center = rotation ? z : x
    assert.ok(appliance.min[horizontal] > center - 0.69 && appliance.max[horizontal] < center + 0.69,
      'Fitted appliances must clear the bay sides along the cabinet face')
    assert.ok(fixture.vacant.every((object) => !object.visible))
    assert.ok(fixture.occupied.every((object) => object.visible))
    assert.ok(fixture.vacant.every((object) => room.getObjectById(object.id) === object))
    components = components.map((component) => component.slotId === slotId ? { ...component, installed: false } : component)
    assert.equal(scene.update(components, 'original').shadowsChanged, true)
    assert.ok(fixture.vacant.every((object) => object.visible))
    assert.ok(fixture.occupied.every((object) => !object.visible))
  }
})

test('the round table and shower retain all compatible objects without installing a forbidden bath tray', (t) => {
  const defaults = defaultRoomComponents()
  const components = completeRoomLayout().map((component) => component.kind === 'table' ? { ...component, variant: 'round' }
    : component.kind === 'bath' ? { ...component, variant: 'shower' }
      : component.kind === 'bath-tray' ? { ...component, installed: false } : component)
  assert.equal(validateRoomComponents(components), null)
  for (const roomId of ['kitchen', 'bathroom'] as const) {
    const { componentScene } = configured(t, roomId, components)
    assert.equal(componentScene.actors.size, roomId === 'kitchen' ? 66 : 33)
    assert.equal(componentScene.actors.has('layout-bathroom-bath-tray'), false)
  }
  assert.deepEqual(defaultRoomComponents(), defaults)
})
