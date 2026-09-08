import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { Box3, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Raycaster, Vector3 } from 'three'
import type { BufferGeometry, Object3D } from 'three'
import { bathroomFocusForRequest, bathroomFraming, bathroomTargets, buildBathroomModel } from '../src/bathroomModel.ts'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'
import { baseCameraOffset, cameraFraming, cameraProjection } from '../src/camera.ts'
import { applyRoomStyle, roomPresets } from '../src/roomStyles.ts'

function bathroom(t: TestContext) {
  const room = new Group()
  const model = buildBathroomModel(room)
  t.after(() => {
    const geometries = new Set<BufferGeometry>()
    room.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  })
  return { room, model }
}

function meshes(room: Group) {
  const result: Mesh[] = []
  room.traverse((object) => { if (object instanceof Mesh) result.push(object) })
  return result
}

test('parent focus requests map shared utilities to bathroom objects and kitchen-only targets to the room', () => {
  for (const target of ['sink', 'floor', 'chores', 'supplies'] as const) {
    assert.equal(bathroomFocusForRequest(target), target)
  }
  for (const target of ['room', 'fridge', 'brew', 'counters', 'stock', 'ledger', 'budget', 'roommates', 'settle'] as const) {
    assert.equal(bathroomFocusForRequest(target), 'room')
  }
})

test('bathroom fixtures have distinct, pickable actor groups and attached label anchors', (t) => {
  const { room, model } = bathroom(t)
  assert.deepEqual([...model.actors.keys()].sort(), [...bathroomTargets].sort())
  assert.deepEqual([...model.anchors.keys()].sort(), [...bathroomTargets].sort())
  assert.equal(new Set(model.actors.values()).size, bathroomTargets.length)
  for (const target of bathroomTargets) {
    const actor = model.actors.get(target)!
    const anchor = model.anchors.get(target)!
    assert.ok(actor instanceof Group)
    assert.equal(actor.parent, room)
    assert.equal(actor.userData.bathroomTarget, target)
    assert.equal(anchor.parent, actor)
    assert.ok(meshes(actor).length > 0, `${target} needs physical geometry`)
    const position = anchor.getWorldPosition(new Vector3())
    assert.ok(position.toArray().every(Number.isFinite))
    assert.ok(model.actorBounds.get(target)!.containsPoint(position))
  }
  assert.equal(model.contacts.length, 5)
})

test('bathroom geometry stays inside the existing room lighting envelope', (t) => {
  const { room, model } = bathroom(t)
  const bounds = new Box3().setFromObject(room)
  const size = bounds.getSize(new Vector3())
  assert.ok(size.x > 9 && size.x < 10)
  assert.ok(size.y > 4 && size.y < 5)
  assert.ok(size.z > 6 && size.z < 7)
  assert.ok(bounds.min.x >= -5 && bounds.max.x <= 5)
  assert.ok(bounds.min.y >= -0.3 && bounds.max.y <= 4.6)
  assert.ok(bounds.min.z >= -3.4 && bounds.max.z <= 3.4)
  assert.deepEqual(bounds, model.bounds)
  assert.ok(meshes(room).filter((mesh) => mesh.geometry.type === 'LatheGeometry').length >= 4)
  for (const mesh of meshes(room)) {
    const positions = mesh.geometry.getAttribute('position')
    assert.ok(positions.count < 2000, `${mesh.geometry.type} should keep low segment counts`)
    for (let i = 0; i < positions.count; i++) {
      assert.ok([positions.getX(i), positions.getY(i), positions.getZ(i)].every(Number.isFinite))
    }
  }
})

test('all bathroom surfaces use registered flat-shaded, opaque materials', (t) => {
  const { room, model } = bathroom(t)
  assert.equal(new Set(model.materials).size, model.materials.length)
  assert.deepEqual(Object.keys(model.styleMaterials).sort(), Object.keys(roomPresets.original.colors).sort())
  for (const mesh of meshes(room)) {
    assert.ok(mesh.material instanceof MeshStandardMaterial)
    assert.ok(model.materials.includes(mesh.material))
    assert.equal(mesh.material.flatShading, true)
    assert.equal(mesh.material.transparent, false)
    assert.equal(mesh.material.opacity, 1)
    assert.equal(mesh.material.depthWrite, true)
    assert.ok(mesh.material.name)
  }
  assert.equal(model.materials.find((material) => material.name === 'Opaque mirror')?.envMap, null)
})

test('batching combines static siblings without losing bathroom interaction or anchor identity', (t) => {
  const { room, model } = bathroom(t)
  const originalActors = new Map(model.actors)
  const originalAnchors = new Map(model.anchors)
  const beforeCount = meshes(room).length
  const beforeBounds = new Box3().setFromObject(room)
  batchStaticMeshes(room, new Set())
  assert.ok(meshes(room).length < beforeCount * 0.65)
  const afterBounds = new Box3().setFromObject(room)
  assert.ok(afterBounds.min.distanceTo(beforeBounds.min) < 0.00001)
  assert.ok(afterBounds.max.distanceTo(beforeBounds.max) < 0.00001)
  for (const target of bathroomTargets) {
    const actor = model.actors.get(target)!
    assert.equal(actor, originalActors.get(target))
    assert.equal(model.anchors.get(target), originalAnchors.get(target))
    assert.equal(actor.parent, room)
    assert.equal(actor.userData.bathroomTarget, target)
    assert.equal(model.anchors.get(target)!.parent, actor)
    for (const mesh of meshes(actor)) {
      let parent = mesh.parent
      while (parent && parent !== actor) parent = parent.parent
      assert.equal(parent, actor)
    }
  }
  assert.ok(meshes(model.actors.get('floor')!).some((mesh) => mesh.name === 'Static room details'))
})

test('each bathroom object remains physically reachable from the open corner after batching', (t) => {
  const { room } = bathroom(t)
  batchStaticMeshes(room, new Set())
  room.updateMatrixWorld(true)
  const points = {
    sink: [0.15, 1.9, -2.22], mirror: [0.15, 3.06, -2.98], toilet: [2.2, 1.1, -1.92],
    bath: [-2.85, 1.16, -1.3], floor: [-1.35, 0.07, 1.42], chores: [0.93, 0.3, 1.15], supplies: [3.92, 2.78, -2.4],
  }
  for (const target of bathroomTargets) {
    const point = new Vector3().fromArray(points[target])
    const offset = new Vector3(...baseCameraOffset)
    const ray = new Raycaster(point.clone().add(offset), offset.negate().normalize())
    let object: Object3D | undefined = ray.intersectObject(room, true)[0]?.object
    while (object && object !== room && !object.userData.bathroomTarget) object = object.parent ?? undefined
    assert.equal(object?.userData.bathroomTarget, target, `${target} must not be hidden behind another fixture`)
  }
})

test('room styles recolor existing bathroom materials while keeping every actor and geometry', (t) => {
  const { room, model } = bathroom(t)
  batchStaticMeshes(room, new Set())
  const originalChildren = [...room.children]
  const originalMeshes = meshes(room)
  const originalGeometry = originalMeshes.map((mesh) => mesh.geometry)
  const finishes = Object.values(model.styleMaterials)
  const unchanged = model.materials.filter((material) => !finishes.includes(material))
    .map((material) => ({ material, color: material.color.getHexString() }))
  for (const style of ['original', 'sage', 'clay', 'linen'] as const) {
    applyRoomStyle(model.styleMaterials, style)
    for (const surface of Object.keys(model.styleMaterials) as (keyof typeof model.styleMaterials)[]) {
      assert.equal(model.styleMaterials[surface].color.getHexString(), roomPresets[style].colors[surface].slice(1))
    }
    assert.deepEqual(room.children, originalChildren)
    assert.deepEqual(meshes(room), originalMeshes)
    assert.deepEqual(meshes(room).map((mesh) => mesh.geometry), originalGeometry)
    for (const { material, color } of unchanged) assert.equal(material.color.getHexString(), color)
  }
  const linenRoom = new Group()
  const linenModel = buildBathroomModel(linenRoom, 'linen')
  t.after(() => {
    meshes(linenRoom).forEach((mesh) => mesh.geometry.dispose())
    linenModel.materials.forEach((material) => material.dispose())
  })
  assert.equal(linenModel.styleMaterials.wall.color.getHexString(), roomPresets.linen.colors.wall.slice(1))
})

test('bathroom framing contains the room and selected actors in measured scene areas', (t) => {
  const { model } = bathroom(t)
  const layouts = [
    { width: 320, height: 844, area: { x: 12, y: 180, width: 264, height: 450 } },
    { width: 390, height: 844, area: { x: 12, y: 270, width: 312, height: 250 } },
    { width: 768, height: 1024, area: { x: 12, y: 140, width: 680, height: 700 } },
    { width: 844, height: 390, area: { x: 12, y: 110, width: 768, height: 160 } },
    { width: 1440, height: 960, area: { x: 12, y: 100, width: 884, height: 680 } },
    { width: 320, height: 844, area: { x: 12, y: 140, width: 264, height: 150 } },
    { width: 320, height: 360, area: { x: 12, y: 70, width: 264, height: 44 } },
  ]
  for (const { width, height, area } of layouts) {
    for (const bounds of [model.bounds, ...model.actorBounds.values()]) {
      for (const rotation of [-0.75, 0, 0.75]) for (const pitch of [-1.7, 0, 3]) {
        const framing = bathroomFraming(area.width, area.height, bounds, rotation, pitch)
        assert.ok(framing.halfHeight > 0 && Number.isFinite(framing.halfHeight))
        assert.ok(framing.center.every(Number.isFinite))
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
            assert.ok(screenX >= area.x && screenX <= area.x + area.width, 'Object must fit the actual scene width')
            assert.ok(screenY >= area.y && screenY <= area.y + area.height, 'Object must fit the actual scene height')
          }
        }
      }
    }
  }
})

test('bathroom framing rejects invalid bounds and scene sizes', () => {
  const bounds = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1))
  for (const [width, height] of [[0, 100], [100, 0], [-1, 100], [NaN, 100], [100, Infinity]]) {
    assert.throws(() => bathroomFraming(width, height, bounds), /positive scene dimensions/)
  }
  assert.throws(() => bathroomFraming(320, 400, new Box3()), /finite bounds/)
  assert.throws(() => bathroomFraming(320, 400, bounds, NaN), /finite bounds/)
  assert.throws(() => bathroomFraming(320, 400, bounds, 0, Infinity), /finite bounds/)
})

test('the toilet sits against the rear wall with clearance from the vanity and shelf', (t) => {
  const { model } = bathroom(t)
  const toilet = new Box3().setFromObject(model.actors.get('toilet')!)
  const sink = new Box3().setFromObject(model.actors.get('sink')!)
  const shelf = new Box3().setFromObject(model.actors.get('supplies')!)
  assert.ok(toilet.min.z > -3.09 && toilet.min.z < -2.94)
  assert.ok(toilet.max.z < -1)
  assert.ok(toilet.min.x > sink.max.x)
  assert.ok(toilet.max.x < shelf.min.x)
})

test('the default bathroom view uses the kitchen zoom scale while whole-room framing stays available', (t) => {
  const { model } = bathroom(t)
  for (const [width, height] of [[390, 550], [320, 360], [768, 800], [1440, 778]]) {
    const kitchen = cameraFraming(width, height, 'room', false)
    const bathroom = bathroomFraming(width, height, model.bounds, 0, 0, { closeRoom: true })
    assert.deepEqual(bathroom, kitchen)
    assert.ok(bathroomFraming(width, height, model.bounds).halfHeight > 0)
  }
  assert.ok(bathroomFraming(390, 550, model.bounds).halfHeight > bathroomFraming(390, 550, model.bounds, 0, 0, { closeRoom: true }).halfHeight)
})
