import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BoxGeometry, DataTexture, DoubleSide, FrontSide, Group, Mesh, NoColorSpace, SRGBColorSpace } from 'three'
import {
  cloneRoomMaterial, createRoomMaterial, createRoomMaterialVariant, prepareRoomSurfaceGeometry,
  roomMaterialSurface, setRoomMaterialSurface,
} from '../src/surfaceMaterials.ts'
import type { RoomSurface } from '../src/surfaceMaterials.ts'

const surfaces = ['paint', 'ceramic', 'fabric', 'glass', 'clear-glass', 'metal', 'wood', 'paper', 'clay', 'foliage', 'rubber', 'food', 'plaster', 'tile', 'light'] as const satisfies readonly RoomSurface[]

test('room surface maps retain palette colors and use color/data spaces correctly', () => {
  const wood = createRoomMaterial('#ba9164', 0.82, 'wood')
  const paper = createRoomMaterial('#fffaf1', 0.98, 'paper')
  const fabric = createRoomMaterial('#81b29a', 0.98, 'fabric')
  try {
    assert.equal(wood.color.getHexString(), 'ba9164')
    assert.equal(paper.color.getHexString(), 'fffaf1')
    assert.equal(wood.map?.colorSpace, SRGBColorSpace)
    assert.equal(wood.bumpMap?.colorSpace, NoColorSpace)
    assert.equal(wood.roughnessMap, wood.bumpMap)
    assert.equal(paper.map, null)
    assert.equal(fabric.map?.colorSpace, SRGBColorSpace)
    assert.equal(paper.bumpMap?.generateMipmaps, true)
    assert.equal(wood.flatShading, false)
    assert.equal(paper.flatShading, false)
  } finally { wood.dispose(); paper.dispose(); fabric.dispose() }
})

test('surface recipes distinguish soft shading from deliberately faceted materials', () => {
  for (const surface of surfaces) {
    const material = createRoomMaterial('#81b29a', 0.8, surface)
    try {
      assert.equal(roomMaterialSurface(material), surface)
      assert.equal(material.flatShading, ['foliage', 'plaster', 'tile', 'light'].includes(surface))
      assert.equal(material.transparent, surface === 'clear-glass')
      assert.equal(material.opacity, surface === 'clear-glass' ? 0.28 : 1)
      assert.equal(material.depthWrite, surface !== 'clear-glass')
    } finally { material.dispose() }
  }
})

test('every surface stays matte after roughness-map multiplication, including metal and transparent glass', () => {
  for (const surface of surfaces) for (const requested of [0, 0.35, 0.8, 1]) {
    const material = createRoomMaterial('#bec5c7', requested, surface)
    try {
      assert.ok(material.roughness >= 0.98 && material.roughness <= 1, `${surface} must not regain glossy highlights`)
      assert.equal(material.color.getHexString(), 'bec5c7')
      assert.equal(material.metalness, surface === 'metal' ? 0.9 : 0)
      let minimum = 1
      const texture = material.roughnessMap
      if (texture) {
        assert.ok(texture instanceof DataTexture)
        const data = texture.image.data
        assert.ok(data instanceof Uint8Array)
        for (let index = 1; index < data.length; index += 4) minimum = Math.min(minimum, data[index] / 255)
        assert.ok(minimum >= 0.98, `${surface} detail maps must not create polished patches`)
      }
      assert.ok(material.roughness * minimum >= 0.96, `${surface} must remain matte in the actual shader`)
      assert.equal(material.transparent, surface === 'clear-glass')
      assert.equal(material.opacity, surface === 'clear-glass' ? 0.28 : 1)
    } finally { material.dispose() }
  }
})

test('clear vessel glass stays distinct from opaque screens and restores opacity when its role changes', () => {
  const vessel = createRoomMaterial('#e0eae8', 0.18, 'clear-glass')
  const copy = cloneRoomMaterial(vessel)
  try {
    assert.equal(vessel.side, DoubleSide)
    assert.equal(copy.transparent, true)
    assert.equal(copy.depthWrite, false)
    assert.equal(copy.opacity, 0.28)
    setRoomMaterialSurface(copy, 'glass')
    assert.equal(copy.transparent, false)
    assert.equal(copy.opacity, 1)
    assert.equal(copy.depthWrite, true)
    assert.equal(copy.side, FrontSide)
    assert.equal(vessel.transparent, true)
  } finally { vessel.dispose(); copy.dispose() }
})

test('material clones share textures until their last owner is disposed', () => {
  const source = createRoomMaterial('#ba9164', 0.82, 'wood')
  const clone = cloneRoomMaterial(source)
  const other = createRoomMaterial('#e4bf88', 0.78, 'wood')
  const detail = source.bumpMap!
  const tint = source.map!
  let released = 0
  detail.addEventListener('dispose', () => { released++ })
  tint.addEventListener('dispose', () => { released++ })
  assert.equal(clone.bumpMap, detail)
  assert.equal(other.bumpMap, detail)
  assert.notEqual(clone.color, source.color)
  clone.color.set('#e07a5f')
  assert.equal(source.color.getHexString(), 'ba9164')
  source.dispose()
  source.dispose()
  assert.equal(released, 0)
  clone.dispose()
  assert.equal(released, 0)
  other.dispose()
  assert.equal(released, 2)
})

test('changing a physical role does not change color or leak its old texture lease', () => {
  const source = createRoomMaterial('#81b29a', 0.65, 'paint')
  const clone = cloneRoomMaterial(source)
  const oldTexture = source.bumpMap!
  let released = 0
  oldTexture.addEventListener('dispose', () => { released++ })
  try {
    setRoomMaterialSurface(clone, 'fabric')
    assert.notEqual(clone.bumpMap, source.bumpMap)
    assert.equal(clone.color.getHexString(), '81b29a')
    assert.equal(clone.roughness, 1)
    assert.equal(roomMaterialSurface(source), 'paint')
    assert.equal(released, 0)
    source.dispose()
    assert.equal(released, 1)
  } finally { source.dispose(); clone.dispose() }
})

test('physical variants follow their palette source while instance clones keep private colors', () => {
  const source = createRoomMaterial('#ba9164', 0.82, 'wood')
  const paper = createRoomMaterialVariant(source, 'paper')
  const instance = cloneRoomMaterial(paper)
  try {
    assert.equal(paper.color, source.color)
    assert.notEqual(paper.bumpMap, source.bumpMap)
    source.color.set('#4e3528')
    assert.equal(paper.color.getHexString(), '4e3528')
    assert.equal(instance.color.getHexString(), 'ba9164')
    instance.color.set('#e07a5f')
    assert.equal(paper.color.getHexString(), '4e3528')
    assert.equal(roomMaterialSurface(paper), 'paper')
    assert.equal(roomMaterialSurface(instance), 'paper')
  } finally { source.dispose(); paper.dispose(); instance.dispose() }
})

test('texture coordinates follow physical box dimensions without remodeling it', () => {
  const geometry = new BoxGeometry(4, 1, 2)
  const material = createRoomMaterial('#ba9164', 0.8, 'wood')
  const room = new Group()
  room.add(new Mesh(geometry, material))
  const positions = geometry.getAttribute('position').array.slice()
  const normals = geometry.getAttribute('normal').array.slice()
  const indices = geometry.getIndex()!.array.slice()
  const before = geometry.getAttribute('uv').array.slice()
  try {
    prepareRoomSurfaceGeometry(room)
    assert.notDeepEqual(geometry.getAttribute('uv').array, before)
    assert.deepEqual(geometry.getAttribute('position').array, positions)
    assert.deepEqual(geometry.getAttribute('normal').array, normals)
    assert.deepEqual(geometry.getIndex()!.array, indices)
    const prepared = geometry.getAttribute('uv').array.slice()
    prepareRoomSurfaceGeometry(room)
    assert.deepEqual(geometry.getAttribute('uv').array, prepared)
  } finally { geometry.dispose(); material.dispose() }
})
