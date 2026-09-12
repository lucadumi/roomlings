import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial, Raycaster, TorusGeometry, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createRoomBasinGeometry, createRoomBoxGeometry, createRoomCupGeometry, createRoomLoafGeometry, createRoomTorusGeometry, roomRadialSegments } from '../src/roomGeometry.ts'

function extent(geometry: BufferGeometry) {
  geometry.computeBoundingBox()
  assert.ok(geometry.boundingBox)
  return [geometry.boundingBox.min.toArray(), geometry.boundingBox.max.toArray()]
}

test('sharp boxes and thin details retain their existing geometry', (t) => {
  const size = [0.8, 0.011, 0.6] as const
  for (const radius of [0, 0.01]) {
    const geometry = createRoomBoxGeometry(size, radius)
    const before = radius ? new RoundedBoxGeometry(...size, 1, radius) : new BoxGeometry(...size)
    t.after(() => { geometry.dispose(); before.dispose() })
    assert.deepEqual(geometry.getAttribute('position').array, before.getAttribute('position').array)
    assert.deepEqual(geometry.getAttribute('normal').array, before.getAttribute('normal').array)
    assert.deepEqual(geometry.index?.array, before.index?.array)
  }
})

test('visible box corners gain real curved geometry without inflating their dimensions', (t) => {
  for (const size of [[1.3, 1.46, 1.2], [0.54, 0.5, 0.24], [4.45, 0.32, 1.44]] as const) {
    const before = new RoundedBoxGeometry(...size, 1, 0.055)
    const geometry = createRoomBoxGeometry(size, 0.055)
    t.after(() => { before.dispose(); geometry.dispose() })
    assert.equal(geometry.type, 'RoundedBoxGeometry')
    assert.deepEqual(extent(geometry), extent(before))
    const positions = geometry.getAttribute('position')
    assert.ok(positions.count > before.getAttribute('position').count * 3)
    assert.ok(positions.count < 2000, 'Rounded furniture must keep the existing per-mesh budget.')
    const normalDirections = (source: BufferGeometry) =>
      new Set(Array.from(source.getAttribute('normal').array, (value) => value.toFixed(4)))
    assert.ok(normalDirections(geometry).size > normalDirections(before).size)
    const normals = geometry.getAttribute('normal')
    assert.ok(Array.from({ length: normals.count }, (_, index) => normals.getY(index)).includes(1),
      'Broad faces retain their planar normals.')
  }
})

test('rounding stays within narrow handles and never produces non-finite vertices', (t) => {
  const size = [0.22, 0.045, 0.05] as const
  const geometry = createRoomBoxGeometry(size, 0.2)
  t.after(() => geometry.dispose())
  const [minimum, maximum] = extent(geometry)
  for (let axis = 0; axis < size.length; axis++) {
    assert.ok(Math.abs(maximum[axis] - minimum[axis] - size[axis]) < 0.000001)
  }
  for (const attribute of Object.values(geometry.attributes)) {
    assert.ok(Array.from(attribute.array).every(Number.isFinite))
  }
})

test('circular silhouettes use bounded detail while preserving nominal radii and height', (t) => {
  for (const [radius, expected] of [[0.035, 16], [0.2, 24], [1.79, 32]]) {
    assert.equal(roomRadialSegments(radius), expected)
    const geometry = new CylinderGeometry(radius, radius, 0.3, roomRadialSegments(radius))
    t.after(() => geometry.dispose())
    const [minimum, maximum] = extent(geometry)
    assert.ok(Math.abs(maximum[0] - minimum[0] - radius * 2) < 0.000001)
    assert.ok(Math.abs(maximum[2] - minimum[2] - radius * 2) < 0.000001)
    assert.ok(Math.abs(maximum[1] - minimum[1] - 0.3) < 0.000001)
    assert.ok(geometry.getAttribute('position').count < 2000)
  }
})

test('handles gain smoother tubes and arcs without changing their placement envelope', (t) => {
  const before = new TorusGeometry(0.19, 0.035, 4, 8, Math.PI)
  const geometry = createRoomTorusGeometry(0.19, 0.035, Math.PI)
  t.after(() => { before.dispose(); geometry.dispose() })
  assert.deepEqual(extent(geometry), extent(before))
  assert.ok(geometry.getAttribute('position').count > before.getAttribute('position').count)
  assert.ok(geometry.getAttribute('position').count < 2000)
})

test('invalid shape dimensions fail explicitly', () => {
  for (const invalid of [0, -1, NaN, Infinity]) {
    assert.throws(() => createRoomBoxGeometry([1, invalid, 1]), RangeError)
    assert.throws(() => roomRadialSegments(invalid), RangeError)
    assert.throws(() => createRoomTorusGeometry(0.2, invalid), RangeError)
    assert.throws(() => createRoomBasinGeometry([1, invalid, 0.7], 0.03), RangeError)
    assert.throws(() => createRoomLoafGeometry([1, invalid, 0.7]), RangeError)
  }
  assert.throws(() => createRoomBoxGeometry([1, 1, 1], -0.01), RangeError)
  assert.throws(() => createRoomTorusGeometry(0.2, 0.03, Math.PI * 3), RangeError)
  assert.throws(() => createRoomCupGeometry(0.1, 0.12, 0.2, 0.08), RangeError)
  assert.throws(() => createRoomBasinGeometry([1, 0.3, 0.7], 0.1), RangeError)
})

test('vessels have a real open cavity and a closed floor within their original dimensions', (t) => {
  const geometry = createRoomCupGeometry(0.09, 0.105, 0.15, 0.012)
  const material = new MeshStandardMaterial()
  const vessel = new Mesh(geometry, material)
  t.after(() => { geometry.dispose(); material.dispose() })
  vessel.updateMatrixWorld(true)
  const hits = new Raycaster(new Vector3(0.03, 0.3, 0), new Vector3(0, -1, 0)).intersectObject(vessel)
  assert.ok(hits.length, 'The cup needs an interior floor.')
  assert.ok(Math.abs(hits[0].point.y - 0.012) < 0.000001, 'The mouth must not be covered by an opaque top cap.')
  const [minimum, maximum] = extent(geometry)
  assert.ok(Math.abs(minimum[1]) < 0.000001)
  assert.ok(Math.abs(maximum[1] - 0.15) < 0.000001)
  assert.ok(Math.abs(maximum[0] - minimum[0] - 0.21) < 0.000001)
})

test('rounded rectangular basins have one continuous closed shell around an open cavity', (t) => {
  const geometry = createRoomBasinGeometry([1.13, 0.305, 0.78], 0.035)
  const material = new MeshStandardMaterial()
  const basin = new Mesh(geometry, material)
  t.after(() => { geometry.dispose(); material.dispose() })
  basin.updateMatrixWorld(true)
  const [minimum, maximum] = extent(geometry)
  for (const [actual, expected] of [[minimum[1], 0], [maximum[1], 0.305], [maximum[0] - minimum[0], 1.13], [maximum[2] - minimum[2], 0.78]]) {
    assert.ok(Math.abs(actual - expected) < 0.000001)
  }
  for (const x of [-0.2, 0, 0.2]) for (const z of [-0.1, 0, 0.1]) {
    const hit = new Raycaster(new Vector3(x, 0.5, z), new Vector3(0, -1, 0)).intersectObject(basin)[0]
    assert.ok(hit && Math.abs(hit.point.y - 0.035) < 0.000001, 'the basin opening must lead down to its solid floor')
  }
  const index = geometry.getIndex()
  assert.ok(index)
  const positions = geometry.getAttribute('position')
  const vertexKey = (i: number) => new Vector3().fromBufferAttribute(positions, i).toArray()
    .map((value) => Math.round(value * 1e6)).join(',')
  const edges = new Map<string, number>()
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const vertices = [index.getX(triangle), index.getX(triangle + 1), index.getX(triangle + 2)]
    for (let edge = 0; edge < 3; edge++) {
      const a = vertices[edge]
      const b = vertices[(edge + 1) % 3]
      const key = [vertexKey(a), vertexKey(b)].sort().join('|')
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  assert.ok([...edges.values()].every((count) => count === 2), 'the rim and bowl must share edges without disconnected corner seams')
  assert.ok(geometry.getAttribute('position').count < 1000)
  for (const attribute of Object.values(geometry.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite))
})

test('sink normals keep the rim and floor flat and shade every rounded corner symmetrically', (t) => {
  const geometry = createRoomBasinGeometry([1.13, 0.305, 0.78], 0.035)
  t.after(() => geometry.dispose())
  const points = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const mirrored = new Map<string, Vector3[]>()
  const key = (x: number, y: number, z: number) => [x, y, z].map((value) => Math.round(value * 1e6)).join(',')
  for (let i = 0; i < points.count; i++) {
    const normal = new Vector3().fromBufferAttribute(normals, i)
    assert.ok(Math.abs(normal.length() - 1) < 0.000001)
    if (Math.abs(points.getY(i) - 0.305) < 0.000001 || Math.abs(points.getY(i) - 0.035) < 0.000001) {
      assert.ok(normal.distanceTo(new Vector3(0, 1, 0)) < 0.000001, 'flat surfaces must not inherit corner triangle gradients')
    }
    const position = key(points.getX(i), points.getY(i), points.getZ(i))
    mirrored.set(position, [...(mirrored.get(position) ?? []), normal])
  }
  for (let i = 0; i < points.count; i++) {
    const matches = mirrored.get(key(-points.getX(i), points.getY(i), -points.getZ(i)))
    assert.ok(matches)
    assert.ok(matches.some((normal) => normal.distanceTo(new Vector3(-normals.getX(i), normals.getY(i), -normals.getZ(i))) < 0.000001))
  }
})

test('whole loaves keep a broad, lightly rounded base beneath a softer crown', (t) => {
  const geometry = createRoomLoafGeometry([0.36, 0.12, 0.2])
  t.after(() => geometry.dispose())
  const [minimum, maximum] = extent(geometry)
  for (const [actual, expected] of [
    [maximum[0] - minimum[0], 0.36], [maximum[1], 0.12], [minimum[1], 0], [maximum[2] - minimum[2], 0.2],
  ]) assert.ok(Math.abs(actual - expected) < 0.000001)
  const points = geometry.getAttribute('position')
  const widthAt = (height: number) => {
    const xs = Array.from({ length: points.count }, (_, i) => i)
      .filter((i) => Math.abs(points.getY(i) - height) < 0.000001).map((i) => points.getX(i))
    return Math.max(...xs) - Math.min(...xs)
  }
  assert.ok(widthAt(0) > 0.33, 'the base should not pinch inward like a fully rounded pillow')
  assert.ok(widthAt(0.12) < 0.27, 'the shoulders should round inward toward the crown')
  for (const attribute of Object.values(geometry.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite))
})
