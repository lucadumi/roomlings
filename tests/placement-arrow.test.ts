import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Box3, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3, BoxGeometry } from 'three'
import { createPlacementArrow, placementPreviewCenter, placementPreviewSize } from '../src/placementArrow.ts'
import { createRoomHologram } from '../src/roomHologram.ts'
import { visibleRoomBounds } from '../src/roomComponentScene.ts'
import { roomAccents } from '../src/roomStyles.ts'

const bounds = () => new Box3(new Vector3(-0.5, 0, -0.6), new Vector3(0.5, 2, 0.6))

test('placement space follows the real projected size rather than normalizing each object', () => {
  const target = bounds()
  const before = target.clone()
  for (const rotation of [-0.75, 0, 0.75]) for (const pitch of [-1.7, 0, 3]) {
    const normal = placementPreviewSize(target, 390, 844, 1, rotation, pitch)
    const zoomed = placementPreviewSize(target, 390, 844, 1.5, rotation, pitch)
    assert.ok(normal.width > 0 && normal.height > 0)
    assert.ok(Math.abs((zoomed.width - 4) / (normal.width - 4) - 1.5) < 0.000001)
    assert.ok(Math.abs((zoomed.height - 4) / (normal.height - 4) - 1.5) < 0.000001)
  }
  assert.deepEqual(target, before)
  for (const zoom of [0, -1, NaN, Infinity]) {
    assert.throws(() => placementPreviewSize(target, 390, 844, zoom), /positive finite zoom/)
  }
})

test('placement framing centers the real object and the full triangle motion without changing their size', (t) => {
  const room = new Group()
  const arrow = createPlacementArrow(room)
  room.add(arrow.object)
  t.after(() => arrow.dispose())
  for (const candidate of [bounds(), bounds().translate(new Vector3(4, 1.7, -2))]) {
    const before = candidate.clone()
    const center = new Vector3()
    assert.equal(placementPreviewCenter(candidate, center), center)
    arrow.update(candidate, 400, true)
    const top = new Box3().setFromObject(arrow.object).max.y
    assert.ok(Math.abs(top - center.y - (center.y - candidate.min.y)) < 0.000001)
    assert.equal(center.x, candidate.getCenter(new Vector3()).x)
    assert.equal(center.z, candidate.getCenter(new Vector3()).z)
    for (const time of [0, 400, 1200, 1600]) {
      arrow.update(candidate, time, true)
      assert.deepEqual(placementPreviewCenter(candidate, new Vector3()), center)
    }
    assert.deepEqual(candidate, before)
  }
  assert.throws(() => placementPreviewCenter(new Box3(), new Vector3()), /finite object bounds/)
})

test('the low-poly marker is a downward triangle without a shaft, shadow or picking target', (t) => {
  const scene = new Group()
  const room = new Group()
  scene.add(room)
  const candidate = new Mesh(new BoxGeometry(1, 2, 1.2), new MeshStandardMaterial())
  candidate.position.y = 1
  room.add(candidate)
  const arrow = createPlacementArrow(room)
  scene.add(arrow.object)
  const hologram = createRoomHologram(room)
  t.after(() => {
    hologram.dispose()
    arrow.dispose()
    candidate.geometry.dispose()
    candidate.material.dispose()
  })
  const before = visibleRoomBounds(room)
  assert.equal(arrow.object.visible, false)
  assert.equal(arrow.update(bounds(), 0, false), false)
  assert.equal(arrow.object.visible, true)
  assert.ok(arrow.object.material.flatShading)
  assert.equal(arrow.object.material.color.getHexString(), roomAccents.tomato.slice(1))
  assert.equal(arrow.object.castShadow, false)
  assert.equal(arrow.object.receiveShadow, false)
  assert.equal(arrow.object.userData.roomTransient, true)
  const arrowBounds = new Box3().setFromObject(arrow.object)
  assert.ok(arrowBounds.min.y > 2.25)
  assert.ok(Math.abs(arrowBounds.getSize(new Vector3()).y - 0.26) < 0.000001)
  assert.equal(arrowBounds.getCenter(new Vector3()).x, 0)
  const vertices = arrow.object.geometry.getAttribute('position')
  assert.ok(vertices.count < 200)
  const corners = new Set(Array.from({ length: vertices.count }, (_, index) =>
    `${vertices.getX(index).toFixed(3)},${vertices.getY(index).toFixed(3)}`))
  assert.deepEqual(corners, new Set(['0.000,-0.140', '-0.150,0.120', '0.150,0.120']))
  const lowest = Array.from({ length: vertices.count }, (_, index) => index).filter((index) => vertices.getY(index) < -0.13)
  assert.ok(lowest.length > 0)
  assert.ok(lowest.every((index) => Math.abs(vertices.getX(index)) < 0.001))
  assert.deepEqual(new Raycaster(new Vector3(0, 2.5, 5), new Vector3(0, 0, -1)).intersectObject(arrow.object), [])
  assert.deepEqual(visibleRoomBounds(room), before)
  const material = arrow.object.material
  hologram.update(candidate, [candidate])
  assert.equal(arrow.object.material, material)
  assert.equal(arrow.object.material.transparent, false)
})

test('the triangle has a gentle bounded bob and becomes stationary when motion is disabled', (t) => {
  const room = new Group()
  const arrow = createPlacementArrow(room)
  t.after(() => arrow.dispose())
  const target = bounds()
  const before = target.clone()
  assert.equal(arrow.update(target, 0, true), true)
  const resting = arrow.object.position.clone()
  arrow.update(target, 400, true)
  assert.ok(Math.abs(arrow.object.position.y - resting.y - 0.065) < 0.000001)
  arrow.update(target, 1200, true)
  assert.ok(Math.abs(arrow.object.position.y - resting.y + 0.065) < 0.000001)
  arrow.update(target, 1600, true)
  assert.ok(arrow.object.position.distanceTo(resting) < 0.000001)
  for (const time of [100, 400, 1200, 10_000]) {
    assert.equal(arrow.update(target, time, false), false)
    assert.deepEqual(arrow.object.position, resting)
  }
  assert.deepEqual(target, before)
})

test('the triangle follows room transforms and candidate changes without retaining a discarded placement', (t) => {
  const scene = new Group()
  scene.position.set(2, 0.3, -1)
  scene.rotation.y = 0.2
  const room = new Group()
  room.position.set(-1, 0.2, 3)
  room.rotation.y = 0.75
  scene.add(room)
  const arrow = createPlacementArrow(room)
  scene.add(arrow.object)
  t.after(() => arrow.dispose())
  for (const target of [bounds(), bounds().translate(new Vector3(4, 1.7, -2))]) {
    arrow.update(target, 0, false)
    const expected = target.getCenter(new Vector3()).setY(target.max.y + 0.46)
    room.localToWorld(expected)
    assert.ok(arrow.object.getWorldPosition(new Vector3()).distanceTo(expected) < 0.000001)
  }
  assert.equal(arrow.update(null, 0, true), false)
  assert.equal(arrow.object.visible, false)
})

test('triangle resources are retired once and invalid geometry is not silently accepted', () => {
  const room = new Group()
  const scene = new Group()
  scene.add(room)
  const arrow = createPlacementArrow(room)
  scene.add(arrow.object)
  let geometries = 0
  let materials = 0
  arrow.object.geometry.addEventListener('dispose', () => { geometries++ })
  arrow.object.material.addEventListener('dispose', () => { materials++ })
  assert.throws(() => arrow.update(new Box3(), 0, true), /finite object bounds/)
  assert.throws(() => arrow.update(bounds(), NaN, true), /animation time/)
  arrow.dispose()
  arrow.dispose()
  assert.equal(arrow.object.parent, null)
  assert.equal(geometries, 1)
  assert.equal(materials, 1)
  assert.throws(() => arrow.update(bounds(), 0, true), /disposed placement triangle/)
})
