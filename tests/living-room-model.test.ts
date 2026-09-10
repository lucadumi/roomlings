import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Box3, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Raycaster, Vector3 } from 'three'
import type { BufferGeometry, Object3D } from 'three'
import { componentCatalog, createRoomComponent, defaultRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import type { RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'
import { baseCameraOffset, cameraProjection, fitRoomBounds } from '../src/camera.ts'
import { livingRoomLampPosition, livingRoomPlacements, livingRoomWindow } from '../src/livingRoomComponentModels.ts'
import {
  buildLivingRoomModel, livingRoomFocusForRequest, livingRoomFraming, livingRoomLabels,
  livingRoomTargets, livingRoomTourFraming,
} from '../src/livingRoomModel.ts'
import type { LivingRoomFocus, LivingRoomTarget } from '../src/livingRoomModel.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { createRoomComponentScene, isSceneObjectVisible } from '../src/roomComponentScene.ts'
import { applyRoomStyle, roomAccents, roomPresets } from '../src/roomStyles.ts'
import { roomShellBounds } from '../src/roomLayout.ts'

function meshes(root: Object3D): Mesh[] {
  const result: Mesh[] = []
  root.traverse((object) => { if (object instanceof Mesh) result.push(object) })
  return result
}

function cleanup(t: TestContext, room: Group, materials: readonly MeshStandardMaterial[]) {
  t.after(() => {
    new Set<BufferGeometry>(meshes(room).map((mesh) => mesh.geometry)).forEach((geometry) => geometry.dispose())
    new Set(materials).forEach((material) => material.dispose())
  })
}

function lounge(t: TestContext) {
  const room = new Group()
  const model = buildLivingRoomModel(room)
  cleanup(t, room, model.materials)
  return { room, model }
}

function componentModel(t: TestContext, component: RoomComponent) {
  const model = buildRoomComponentModel(component, 'original')
  cleanup(t, model.root, model.materials)
  return model
}

const targetSlots = {
  sofa: 'living-room-sofa', surfaces: 'living-room-coffee-table', plants: 'living-room-plant',
  bins: 'living-room-bins', chores: 'living-room-cleaning-caddy', supplies: 'living-room-supply-shelf',
} as const

test('living room focus requests retain lounge and shared utility targets only', () => {
  for (const target of livingRoomTargets) assert.equal(livingRoomFocusForRequest(target), target)
  for (const target of ['room', 'fridge', 'brew', 'sink', 'counters', 'stock', 'ledger', 'budget', 'roommates', 'settle'] as const) {
    assert.equal(livingRoomFocusForRequest(target), 'room')
  }
  assert.deepEqual(livingRoomLabels, {
    sofa: 'Sofa chores', surfaces: 'Surface chores', plants: 'Plant care', floor: 'Floor chores',
    bins: 'Bin chores', chores: 'Cleaning caddy', supplies: 'Supply shelf',
  })
})

test('living room actors are the original component roots with attached measured labels', (t) => {
  const { room, model } = lounge(t)
  assert.deepEqual([...model.actors.keys()].sort(), [...livingRoomTargets].sort())
  assert.deepEqual([...model.anchors.keys()].sort(), [...livingRoomTargets].sort())
  assert.equal(new Set(model.actors.values()).size, livingRoomTargets.length)
  for (const target of livingRoomTargets) {
    const actor = model.actors.get(target)!
    const anchor = model.anchors.get(target)!
    assert.equal(actor.parent, room)
    assert.equal(actor.userData.livingRoomTarget, target)
    assert.equal(anchor.parent, actor)
    assert.ok(meshes(actor).length > 0)
    const point = anchor.getWorldPosition(new Vector3())
    assert.ok(point.toArray().every(Number.isFinite))
    assert.ok(model.actorBounds.get(target)!.containsPoint(point))
    if (target !== 'floor') {
      const binding = model.componentBindings.get(targetSlots[target])!
      assert.equal(actor, binding.root)
      assert.ok(point.distanceTo(new Vector3(...binding.anchor!)) < 1e-10)
    }
  }
  assert.equal(model.contacts.length, [...model.componentBindings.values()].flatMap((binding) => binding.contacts ?? []).length)
  assert.equal(model.componentFixtures.size, 0, 'Vacant accessory zones must not contain substitute objects')
})

test('the original lounge and thumbnail factory use exactly the same component geometry', (t) => {
  const { model } = lounge(t)
  const components = defaultRoomComponents().filter((component) => component.roomId === 'living-room')
  assert.equal(model.componentBindings.size, components.length)
  for (const component of components) {
    const original = model.componentBindings.get(component.slotId)!.root
    const generated = componentModel(t, component).root
    assert.deepEqual(original.position.toArray(), generated.position.toArray())
    assert.deepEqual(original.rotation.toArray(), generated.rotation.toArray())
    assert.deepEqual(original.scale.toArray(), generated.scale.toArray())
    const originalMeshes = meshes(original)
    const generatedMeshes = meshes(generated)
    assert.equal(originalMeshes.length, generatedMeshes.length)
    for (const [index, mesh] of originalMeshes.entries()) {
      const thumbnail = generatedMeshes[index]
      assert.deepEqual(mesh.geometry.getAttribute('position').array, thumbnail.geometry.getAttribute('position').array)
      assert.deepEqual(mesh.position.toArray(), thumbnail.position.toArray())
      assert.deepEqual(mesh.rotation.toArray(), thumbnail.rotation.toArray())
      assert.deepEqual(mesh.scale.toArray(), thumbnail.scale.toArray())
      assert.ok(mesh.material instanceof MeshStandardMaterial && thumbnail.material instanceof MeshStandardMaterial)
      assert.equal(mesh.material.color.getHexString(), thumbnail.material.color.getHexString())
    }
  }
})

test('all lounge geometry is finite, low-poly, opaque and covered by one material owner', (t) => {
  const { room, model } = lounge(t)
  const bounds = new Box3().setFromObject(room)
  assert.deepEqual(bounds, model.bounds)
  assert.ok(bounds.min.x >= -5.1 && bounds.max.x <= 5.1)
  assert.ok(bounds.min.y >= -0.3 && bounds.max.y <= 4.6)
  assert.ok(bounds.min.z >= -3.5 && bounds.max.z <= roomShellBounds('living-room').max.z + 0.0001)
  assert.equal(new Set(model.materials).size, model.materials.length)
  assert.deepEqual(Object.keys(model.styleMaterials).sort(), Object.keys(roomPresets.original.colors).sort())
  for (const mesh of meshes(room)) {
    assert.ok(mesh.visible, 'Do not add invisible pickable proxy geometry')
    const positions = mesh.geometry.getAttribute('position')
    assert.ok(positions.count < 2000, `${mesh.geometry.type} must retain low segment counts`)
    for (let i = 0; i < positions.count; i++) {
      assert.ok([positions.getX(i), positions.getY(i), positions.getZ(i)].every(Number.isFinite))
    }
    assert.ok(mesh.material instanceof MeshStandardMaterial)
    assert.ok(model.materials.includes(mesh.material))
    assert.equal(mesh.material.flatShading, true)
    assert.equal(mesh.material.transparent, false)
    assert.equal(mesh.material.opacity, 1)
    assert.equal(mesh.material.depthWrite, true)
    assert.ok(mesh.material.name)
  }
  for (const binding of model.componentBindings.values()) {
    for (const material of binding.finishes) assert.ok(model.materials.includes(material))
    for (const mesh of meshes(binding.root)) {
      const source = mesh.material as MeshStandardMaterial
      if (Object.hasOwn(model.styleMaterials, source.name)) {
        assert.equal(source, model.styleMaterials[source.name as keyof typeof model.styleMaterials])
      }
    }
  }
})

test('replaced and unused component materials are retired exactly once rather than leaked', (t) => {
  const retired = new Map<MeshStandardMaterial, number>()
  const dispose = MeshStandardMaterial.prototype.dispose
  MeshStandardMaterial.prototype.dispose = function () {
    retired.set(this, (retired.get(this) ?? 0) + 1)
    dispose.call(this)
  }
  try {
    const { model } = lounge(t)
    assert.ok(retired.size > 50)
    for (const count of retired.values()) assert.equal(count, 1)
    for (const material of model.materials) assert.equal(retired.has(material), false)
    for (const binding of model.componentBindings.values()) {
      for (const source of binding.finishes) assert.equal(retired.has(source), false)
    }
  } finally {
    MeshStandardMaterial.prototype.dispose = dispose
  }
})

test('the window is an opening through the wall with a recessed opaque daylight view and a real sill', (t) => {
  const { room, model } = lounge(t)
  const walls = room.getObjectByName('Walls around the open window')!
  const window = room.getObjectByName('Recessed lounge window')!
  assert.equal(window.userData.roomLightSwitch, true)
  assert.ok(model.materials.includes(model.windowMaterials.sky))
  assert.ok(model.materials.includes(model.windowMaterials.disc))
  const ray = new Raycaster(new Vector3(-0.95, 3.55, 0), new Vector3(0, 0, -1))
  assert.equal(ray.intersectObject(walls, true).length, 0)
  const daylight = ray.intersectObject(window, true)[0]
  assert.ok(daylight && daylight.point.z < livingRoomWindow.wallZ - 0.1)
  ray.set(new Vector3(-0.95, 1.9, 0), new Vector3(0, 0, -1))
  assert.ok(ray.intersectObject(walls, true).length > 0)
  const ledge = livingRoomPlacements['living-room-windowsill'].position
  ray.set(new Vector3(ledge[0], ledge[1] + 0.1, ledge[2]), new Vector3(0, -1, 0))
  assert.ok(Math.abs(ray.intersectObject(window, true)[0].point.y - 2.14) < 0.000001)
  assert.ok(new Box3().setFromObject(model.componentBindings.get('living-room-curtains')!.root).min.y > 2.14)
})

test('the reading lamp uses its physical bulb position and the TV is genuinely off', (t) => {
  const { model } = lounge(t)
  const lamp = model.componentBindings.get('living-room-floor-lamp')!
  const bulb = meshes(lamp.root).find((mesh) => mesh.material === model.lampMaterial)!
  assert.ok(bulb)
  assert.ok(bulb.getWorldPosition(new Vector3()).distanceTo(new Vector3(...livingRoomLampPosition)) < 1e-10)
  const tv = componentModel(t, createRoomComponent('tv', 'living-room-tv', 'tv'))
  assert.equal(tv.indicator, undefined)
  const screen = tv.materials.find((material) => material.name === 'TV off screen')!
  assert.ok(meshes(tv.root).some((mesh) => mesh.material === screen))
  assert.equal(screen.color.getHexString(), roomAccents.ink.slice(1))
  assert.equal(screen.emissive.getHex(), 0)
})

test('batching keeps the lounge interaction boundaries, labels, lamp and complete silhouette', (t) => {
  const { room, model } = lounge(t)
  const before = new Box3().setFromObject(room)
  const beforeCount = meshes(room).length
  const actors = new Map(model.actors)
  const anchors = new Map(model.anchors)
  batchStaticMeshes(room, model.preserved)
  room.updateMatrixWorld(true)
  const after = new Box3().setFromObject(room)
  assert.ok(meshes(room).length < beforeCount * 0.5)
  assert.ok(before.min.distanceTo(after.min) < 0.00001)
  assert.ok(before.max.distanceTo(after.max) < 0.00001)
  for (const target of livingRoomTargets) {
    assert.equal(model.actors.get(target), actors.get(target))
    assert.equal(model.anchors.get(target), anchors.get(target))
    assert.equal(anchors.get(target)!.parent, actors.get(target))
    assert.ok(meshes(actors.get(target)!).length > 0)
  }
  assert.ok(meshes(model.componentBindings.get('living-room-floor-lamp')!.root)
    .some((mesh) => mesh.material === model.lampMaterial))
})

test('every lounge chore target remains physically reachable from the open corner', (t) => {
  const { room, model } = lounge(t)
  batchStaticMeshes(room, model.preserved)
  room.updateMatrixWorld(true)
  const points: Record<LivingRoomTarget, [number, number, number]> = {
    sofa: [-0.4, 1.15, -2.05], surfaces: [-1.6, 0.89, 0.65], plants: [3, 1.1, 1.13],
    floor: [-1.25, 0.02, 2.48], bins: [4.2, 0.59, 2.23],
    chores: [2.55, 0.26, 2.94], supplies: [4.16, 2.12, 0.25],
  }
  for (const target of livingRoomTargets) {
    const offset = new Vector3(...baseCameraOffset)
    const ray = new Raycaster(new Vector3(...points[target]).add(offset), offset.negate().normalize())
    let object: Object3D | undefined = ray.intersectObject(room, true).find(({ object }) => isSceneObjectVisible(object, room))?.object
    while (object && object !== room && !object.userData.livingRoomTarget) object = object.parent ?? undefined
    assert.equal(object?.userData.livingRoomTarget, target, `${target} must not be hidden behind another fixture`)
  }
})

test('all designed lounge slots and advertised variants have bounded physical models', (t) => {
  const slots = roomSlots.filter((slot) => slot.roomId === 'living-room')
  assert.deepEqual(Object.keys(livingRoomPlacements).sort(), slots.map((slot) => slot.id).sort())
  for (const slot of slots) {
    for (const kind of slot.kinds) for (const variant of componentCatalog[kind].variants) {
      const component = { ...createRoomComponent(kind, slot.id, `check-${slot.id}`), variant: variant.id }
      const model = componentModel(t, component)
      const bounds = new Box3().setFromObject(model.root)
      assert.ok(!bounds.isEmpty(), `${slot.id} ${variant.id}`)
      assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite))
      assert.ok(bounds.min.x >= -5.1 && bounds.max.x <= 5.1, `${slot.id} must fit the room width`)
      assert.ok(bounds.min.z >= -3.5 && bounds.max.z <= 3.4, `${slot.id} must fit the room depth`)
      assert.ok(bounds.min.y >= 0 && bounds.max.y < 4.6, `${slot.id} must fit the room height`)
      assert.ok(model.finishes.some((finish) => meshes(model.root).some((mesh) => mesh.material === finish)))
      for (const mesh of meshes(model.root)) {
        assert.ok(mesh.material instanceof MeshStandardMaterial)
        assert.equal(mesh.material.transparent, false)
        assert.equal(mesh.material.flatShading, true)
      }
    }
  }
})

test('corner and straight sofas and round and rectangular tables have meaningfully different geometry', (t) => {
  const sofa = createRoomComponent('sofa', 'living-room-sofa', 'sofa')
  const corner = componentModel(t, sofa)
  const straight = componentModel(t, { ...sofa, variant: 'straight' })
  const cornerSize = new Box3().setFromObject(corner.root).getSize(new Vector3())
  const straightSize = new Box3().setFromObject(straight.root).getSize(new Vector3())
  assert.ok(cornerSize.z > straightSize.z + 0.8)
  assert.ok(Math.abs(cornerSize.x - straightSize.x) < 0.000001)
  assert.ok(meshes(corner.root).length > meshes(straight.root).length)
  const table = createRoomComponent('coffee-table', 'living-room-coffee-table', 'table')
  const rectangular = componentModel(t, table)
  const round = componentModel(t, { ...table, variant: 'round' })
  const rectangleBounds = new Box3().setFromObject(rectangular.root)
  const roundBounds = new Box3().setFromObject(round.root)
  const rectangleSize = rectangleBounds.getSize(new Vector3())
  const roundSize = roundBounds.getSize(new Vector3())
  assert.ok(rectangleSize.x > rectangleSize.z * 1.5)
  assert.ok(Math.abs(roundSize.x - roundSize.z) < 0.000001)
  assert.ok(Math.abs(rectangleBounds.max.y - roundBounds.max.y) < 0.000001, 'Both table variants support the same accessories')
})

test('the TV, table and shelf accessories have permanent supports and separate clear zones', (t) => {
  const { model } = lounge(t)
  const heightAt = (slotId: RoomSlotId, x: number, z: number) => {
    const root = model.componentBindings.get(slotId)!.root
    return new Raycaster(new Vector3(x, 5, z), new Vector3(0, -1, 0)).intersectObject(root, true)[0]?.point.y
  }
  for (const [accessory, support] of [
    ['living-room-tv', 'living-room-media-unit'], ['living-room-media-accessory', 'living-room-media-unit'],
    ['living-room-table-top', 'living-room-coffee-table'],
  ] as const) {
    const [x, y, z] = livingRoomPlacements[accessory].position
    assert.ok(Math.abs(heightAt(support, x, z)! - y) < 0.004, `${accessory} needs a surface directly underneath`)
    assert.equal(roomSlots.find((slot) => slot.id === support)!.removable, false)
  }
  const television = new Box3().setFromObject(model.componentBindings.get('living-room-tv')!.root)
  for (const kind of ['record-player', 'speaker', 'plant'] as const) {
    const accessory = componentModel(t, createRoomComponent(kind, 'living-room-media-accessory', `media-${kind}`))
    assert.equal(television.intersectsBox(new Box3().setFromObject(accessory.root)), false)
  }
  const shelf = model.componentBindings.get('living-room-bookshelf')!.root
  for (const kind of ['board-game', 'speaker', 'plant'] as const) {
    const accessory = componentModel(t, createRoomComponent(kind, 'living-room-shelf-accessory', `shelf-${kind}`))
    const bounds = new Box3().setFromObject(accessory.root)
    for (const mesh of meshes(shelf)) {
      assert.equal(new Box3().setFromObject(mesh).intersectsBox(bounds), false, `${kind} needs a vacant shelf bay`)
    }
    const [x, y, z] = livingRoomPlacements['living-room-shelf-accessory'].position
    const support = new Raycaster(new Vector3(x, y + 0.001, z), new Vector3(0, -1, 0)).intersectObject(shelf, true)[0]
    assert.ok(support && y - support.point.y < 0.004)
  }
})

test('removing the rug leaves both coffee table variants grounded and every contact inside the floor', (t) => {
  const { model } = lounge(t)
  const floor = new Box3().setFromObject(model.actors.get('floor')!)
  const table = createRoomComponent('coffee-table', 'living-room-coffee-table', 'table')
  for (const variant of ['original', 'round']) {
    const generated = componentModel(t, { ...table, variant })
    const bounds = new Box3().setFromObject(generated.root)
    assert.ok(Math.abs(bounds.min.y - floor.max.y) < 0.025)
  }
  for (const contact of model.contacts) {
    assert.ok(contact.position[0] - contact.size[0] / 2 >= -5)
    assert.ok(contact.position[0] + contact.size[0] / 2 <= 5)
    assert.ok(contact.position[2] - contact.size[1] / 2 >= -3.3)
    assert.ok(contact.position[2] + contact.size[1] / 2 <= 3.3)
  }
})

test('room presets reach original component sources and component finishes cannot tint neighboring objects', (t) => {
  const { room, model } = lounge(t)
  const initialMeshes = meshes(room)
  const initialGeometries = initialMeshes.map((mesh) => mesh.geometry)
  const finishes = new Set(Object.values(model.styleMaterials))
  const unchanged = model.materials.filter((material) => !finishes.has(material))
    .map((material) => ({ material, color: material.color.getHexString() }))
  for (const style of ['sage', 'clay', 'linen', 'original'] as const) {
    applyRoomStyle(model.styleMaterials, style)
    for (const key of Object.keys(model.styleMaterials) as (keyof typeof model.styleMaterials)[]) {
      assert.equal(model.styleMaterials[key].color.getHexString(), roomPresets[style].colors[key].slice(1))
    }
    for (const { material, color } of unchanged) assert.equal(material.color.getHexString(), color)
    assert.deepEqual(meshes(room), initialMeshes)
    assert.deepEqual(meshes(room).map((mesh) => mesh.geometry), initialGeometries)
  }
  const scene = createRoomComponentScene(room, 'living-room', {
    bindings: model.componentBindings, fixtures: model.componentFixtures, styleMaterials: model.styleMaterials,
  })
  try {
    const defaults = defaultRoomComponents()
    scene.update(defaults, 'original')
    const sofa = model.componentBindings.get('living-room-sofa')!.root
    const table = model.componentBindings.get('living-room-coffee-table')!.root
    const tableColors = meshes(table).map((mesh) => (mesh.material as MeshStandardMaterial).color.getHexString())
    const changed = defaults.map((component) => component.slotId === 'living-room-sofa' ? { ...component, finish: 'tomato' as const } : component)
    assert.equal(scene.update(changed, 'original').shadowsChanged, false)
    assert.equal(model.styleMaterials.fridge.color.getHexString(), roomPresets.original.colors.fridge.slice(1))
    assert.ok(meshes(sofa).some((mesh) => (mesh.material as MeshStandardMaterial).color.getHexString() === roomAccents.tomato.slice(1)))
    assert.deepEqual(meshes(table).map((mesh) => (mesh.material as MeshStandardMaterial).color.getHexString()), tableColors)
    scene.update(changed, 'linen')
    assert.ok(meshes(sofa).some((mesh) => (mesh.material as MeshStandardMaterial).color.getHexString() === roomAccents.tomato.slice(1)))
    scene.update(defaults, 'linen')
    assert.ok(meshes(sofa).some((mesh) => (mesh.material as MeshStandardMaterial).color.getHexString() === roomPresets.linen.colors.fridge.slice(1)))
    const tv = model.componentBindings.get('living-room-tv')!.root
    scene.update(defaults.filter((component) => component.slotId !== 'living-room-tv'), 'linen')
    assert.equal(isSceneObjectVisible(tv, room), false)
    assert.equal(scene.componentForObject(meshes(tv)[0]), null)
    assert.equal(model.componentBindings.get('living-room-media-unit')!.root.visible, true)
  } finally {
    scene.dispose()
  }
})

test('measured living room framing fits wide, tall, constrained and offset CSS scene areas', (t) => {
  const { model } = lounge(t)
  const layouts = [
    { width: 320, height: 844, area: { x: 12, y: 180, width: 264, height: 450 } },
    { width: 390, height: 844, area: { x: 12, y: 270, width: 312, height: 250 } },
    { width: 768, height: 1024, area: { x: 12, y: 140, width: 680, height: 700 } },
    { width: 844, height: 390, area: { x: 12, y: 110, width: 768, height: 160 } },
    { width: 1440, height: 960, area: { x: 12, y: 100, width: 884, height: 680 } },
    { width: 320, height: 360, area: { x: 12, y: 70, width: 264, height: 44 } },
  ]
  for (const { width, height, area } of layouts) {
    for (const bounds of [model.bounds, ...model.actorBounds.values()]) {
      for (const rotation of [-0.75, 0, 0.75]) for (const pitch of [-1.7, 0, 3]) for (const closeRoom of [false, true]) {
        const framing = livingRoomFraming(area.width, area.height, bounds, rotation, pitch, { closeRoom })
        const projection = cameraProjection(width, height, area, framing.halfHeight, 1)
        const camera = new OrthographicCamera(projection.left, projection.right, projection.top, projection.bottom, 0.1, 100)
        const center = new Vector3(...framing.center)
        camera.position.copy(center).add(new Vector3(baseCameraOffset[0], baseCameraOffset[1] + pitch, baseCameraOffset[2]))
        camera.lookAt(center)
        camera.updateMatrixWorld(true)
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const corner = new Vector3(x, y, z).applyAxisAngle(new Vector3(0, 1, 0), rotation).project(camera)
            const screenX = (corner.x * 0.5 + 0.5) * width
            const screenY = (-corner.y * 0.5 + 0.5) * height
            assert.ok(screenX >= area.x && screenX <= area.x + area.width, 'Fit the measured scene width')
            assert.ok(screenY >= area.y && screenY <= area.y + area.height, 'Fit the measured scene height')
          }
        }
      }
    }
  }
})

test('living room tours ease between measured stops and fit the actual room rather than kitchen bounds', (t) => {
  const { model } = lounge(t)
  const stops: LivingRoomFocus[] = ['sofa', 'surfaces', 'plants', 'room']
  const frame = (progress: number) => livingRoomTourFraming(390, 440, progress, model.bounds, model.actorBounds, stops)
  const sofa = livingRoomFraming(390, 440, model.actorBounds.get('sofa')!)
  const table = livingRoomFraming(390, 440, model.actorBounds.get('surfaces')!)
  assert.deepEqual(frame(-1), sofa)
  assert.deepEqual(frame(1 / 3), table)
  assert.deepEqual(frame(2), fitRoomBounds(390, 440, model.bounds))
  const eased = 0.25 * 0.25 * (3 - 2 * 0.25)
  const between = frame(0.25 / 3)
  assert.ok(Math.abs(between.halfHeight - (sofa.halfHeight + (table.halfHeight - sofa.halfHeight) * eased)) < 1e-10)
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(between.center[axis] - (sofa.center[axis] + (table.center[axis] - sofa.center[axis]) * eased)) < 1e-10)
  }
  const larger = model.bounds.clone().expandByVector(new Vector3(2, 1, 2))
  const largeRoom = livingRoomTourFraming(390, 440, 1, larger, model.actorBounds, ['sofa', 'room'])
  assert.deepEqual(largeRoom, livingRoomFraming(390, 440, larger))
  assert.ok(largeRoom.halfHeight > frame(1).halfHeight)
})

test('living room framing and tours reject invalid dimensions, bounds, angles, progress and missing stops', () => {
  const bounds = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1))
  const actors = new Map<LivingRoomTarget, Box3>([['sofa', bounds]])
  for (const [width, height] of [[0, 100], [100, 0], [-1, 100], [NaN, 100], [100, Infinity]]) {
    assert.throws(() => livingRoomFraming(width, height, bounds), /positive scene dimensions/)
    assert.throws(() => livingRoomTourFraming(width, height, 0, bounds, actors, ['sofa', 'room']), /positive scene dimensions/)
  }
  for (const [rotation, pitch] of [[NaN, 0], [0, Infinity]]) {
    assert.throws(() => livingRoomFraming(320, 400, bounds, rotation, pitch), /finite bounds/)
  }
  assert.throws(() => livingRoomFraming(320, 400, new Box3()), /finite bounds/)
  assert.throws(() => livingRoomTourFraming(320, 400, NaN, bounds, actors, ['sofa', 'room']), /finite progress/)
  assert.throws(() => livingRoomTourFraming(320, 400, 0, bounds, actors, ['room']), /at least two stops/)
  assert.throws(() => livingRoomTourFraming(320, 400, 0, new Box3(), actors, ['sofa', 'room']), /valid bounds/)
  assert.throws(() => livingRoomTourFraming(320, 400, 0, bounds, actors, ['sofa', 'room', 'plants']), /missing its measured bounds/)
  actors.set('plants', new Box3())
  assert.throws(() => livingRoomTourFraming(320, 400, 0, bounds, actors, ['sofa', 'room', 'plants']), /finite bounds/)
})
