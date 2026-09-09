import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { Box3, BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three'
import type { Object3D } from 'three'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'
import { buildGardenModel } from '../src/landing/gardenModel.ts'
import type { GardenSide } from '../src/landing/gardenModel.ts'
import { roomAccents, roomPresets } from '../src/roomStyles.ts'

function garden(t: TestContext, side: GardenSide) {
  const model = buildGardenModel(side)
  t.after(() => model.dispose())
  return model
}

function meshes(root: Object3D) {
  const result: Mesh[] = []
  root.traverse((object) => { if (object instanceof Mesh) result.push(object) })
  return result
}

function appearance(root: Object3D) {
  const hash = createHash('sha256')
  root.traverse((object) => {
    hash.update(JSON.stringify({
      type: object.type, children: object.children.length, visible: object.visible,
      position: object.position.toArray(), rotation: object.rotation.toArray(), scale: object.scale.toArray(),
    }))
    if (!(object instanceof Mesh)) return
    assert.ok(object.material instanceof MeshStandardMaterial)
    hash.update(JSON.stringify({
      color: object.material.color.toArray(), roughness: object.material.roughness,
      metalness: object.material.metalness, opacity: object.material.opacity,
      flatShading: object.material.flatShading, cast: object.castShadow, receive: object.receiveShadow,
    }))
    const geometry: BufferGeometry = object.geometry
    for (const [name, attribute] of Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))) {
      hash.update(JSON.stringify([name, attribute.itemSize, attribute.normalized]))
      hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength))
    }
    const index = geometry.index
    if (index) hash.update(Buffer.from(index.array.buffer, index.array.byteOffset, index.array.byteLength))
  })
  return hash.digest('hex')
}

for (const side of ['left', 'right'] as const) {
  test(`${side} garden has a finite, narrow composition without scene infrastructure or a ground slab`, (t) => {
    const model = garden(t, side)
    assert.ok(model.root instanceof Group)
    assert.equal(model.root.parent, null)
    assert.deepEqual(model.root.position.toArray(), [0, 0, 0])
    assert.deepEqual(model.root.rotation.toArray().slice(0, 3), [0, 0, 0])
    assert.deepEqual(model.root.scale.toArray(), [1, 1, 1])
    assert.ok(!model.bounds.isEmpty())
    assert.ok([...model.bounds.min.toArray(), ...model.bounds.max.toArray()].every(Number.isFinite))
    const size = model.bounds.getSize(new Vector3())
    assert.ok(size.x > 1.5 && size.x < 3.6, 'The garden should be a narrow edge cluster')
    assert.ok(size.y > 3.5 && size.y < 5.5, 'A tall tree or shrub should anchor the composition')
    assert.ok(size.z > 0.8 && size.z < 3.6)
    assert.ok(model.bounds.min.x >= -1.8 && model.bounds.max.x <= 1.8)
    assert.ok(model.bounds.min.z >= -1.8 && model.bounds.max.z <= 1.8)
    assert.ok(model.bounds.min.y >= -0.01)
    const measured = new Box3().setFromObject(model.root, true)
    assert.ok(model.bounds.min.distanceTo(measured.min) < 0.000001)
    assert.ok(model.bounds.max.distanceTo(measured.max) < 0.000001)
    const padded = model.bounds.clone().expandByScalar(0.000001)
    model.root.traverse((object) => {
      assert.ok(object instanceof Group || object instanceof Mesh, 'Models must not own lights or cameras')
      if (!(object instanceof Mesh)) return
      assert.ok(padded.containsBox(new Box3().setFromObject(object, true)))
      assert.notEqual(object.geometry.type, 'PlaneGeometry')
      assert.notEqual(object.geometry.type, 'BoxGeometry')
    })
  })

  test(`${side} garden is deterministic and uses the complete opaque shared-palette material registry`, (t) => {
    const first = garden(t, side)
    const second = garden(t, side)
    assert.equal(appearance(first.root), appearance(second.root))
    assert.deepEqual(first.bounds, second.bounds)
    assert.deepEqual(first.foliage.map(({ restRotation, amplitude, phase }) => ({ restRotation, amplitude, phase })),
      second.foliage.map(({ restRotation, amplitude, phase }) => ({ restRotation, amplitude, phase })))
    const palette = new Set([...Object.values(roomAccents), ...Object.values(roomPresets.original.colors)]
      .map((color) => color.slice(1)))
    const used = new Set<MeshStandardMaterial>()
    for (const object of meshes(first.root)) {
      assert.ok(object.material instanceof MeshStandardMaterial)
      used.add(object.material)
      assert.ok(first.materials.includes(object.material))
      assert.equal(object.receiveShadow, true)
    }
    assert.deepEqual(used, new Set(first.materials))
    assert.equal(first.materials.length, new Set(first.materials).size)
    const colors = new Map(first.materials.map((material) => [material.name, material.color.getHexString()]))
    const finishes = {
      'Garden leaves': roomAccents.leaf,
      'Fresh leaf tips': roomAccents.leafLight,
      'Shaded leaves and stems': roomAccents.leafDark,
      'Tomato petals': roomAccents.tomato,
      'Sunflower yellow': roomAccents.gold,
      'Terracotta pots': roomAccents.terracotta,
      'Sky blue pot bands': roomAccents.sky,
      'Garden branches': roomPresets.original.colors.wood,
      'Warm garden soil': roomAccents.tomatoDark,
      'Cream pebbles': roomPresets.original.colors.counter,
    }
    for (const [name, color] of Object.entries(finishes)) {
      assert.equal(colors.get(name), color.slice(1), `${name} should inherit its central palette finish`)
    }
    for (const material of first.materials) {
      assert.ok(material.name)
      assert.ok(palette.has(material.color.getHexString()))
      assert.equal(material.flatShading, true)
      assert.equal(material.transparent, false)
      assert.equal(material.opacity, 1)
      assert.equal(material.depthWrite, true)
      assert.equal(material.metalness, 0)
      assert.ok(material.roughness >= 0.85 && material.roughness <= 1)
      assert.ok(!Object.values(material).some((value) => value instanceof Texture))
    }
  })

  test(`${side} garden batches static details within a small low-poly geometry budget`, (t) => {
    const model = garden(t, side)
    const pieces = meshes(model.root)
    assert.ok(pieces.length >= 15 && pieces.length <= 64, `${pieces.length} garden draw calls`)
    assert.ok(pieces.some((mesh) => mesh.name === 'Static room details'), 'Static siblings should already be batched')
    const animated = new Set(model.foliage.map(({ object }) => object))
    model.root.traverse((parent) => {
      const siblings = new Set<string>()
      for (const object of parent.children) {
        if (!(object instanceof Mesh) || animated.has(object)) continue
        assert.ok(object.material instanceof MeshStandardMaterial)
        const key = [object.material.uuid, object.castShadow, object.receiveShadow].join(':')
        assert.ok(!siblings.has(key), 'Compatible static siblings should share a draw call')
        siblings.add(key)
      }
    })
    let triangles = 0
    let vertices = 0
    for (const object of pieces) {
      const position = object.geometry.getAttribute('position')
      const normal = object.geometry.getAttribute('normal')
      assert.ok(position.count > 0 && position.count <= 2400)
      assert.equal(normal.count, position.count)
      vertices += position.count
      triangles += (object.geometry.index?.count ?? position.count) / 3
      for (let index = 0; index < position.count; index++) {
        assert.ok([position.getX(index), position.getY(index), position.getZ(index),
          normal.getX(index), normal.getY(index), normal.getZ(index)].every(Number.isFinite))
      }
    }
    assert.ok(triangles > 500 && triangles <= 4000, `${triangles} triangles should remain very low-poly`)
    assert.ok(vertices <= 12000, `${vertices} stored vertices`)
  })

  test(`${side} garden keeps foliage hinges, rest poses and independent movement after batching`, (t) => {
    const model = garden(t, side)
    assert.ok(model.foliage.length >= 4 && model.foliage.length <= 18)
    assert.equal(new Set(model.foliage.map(({ object }) => object)).size, model.foliage.length)
    assert.ok(new Set(model.foliage.map(({ phase }) => phase)).size > 1)
    assert.ok(model.foliage.some(({ restRotation }) => Math.abs(restRotation) > 0.01))
    const references = model.foliage.map((entry) => ({
      ...entry, parent: entry.object.parent, position: entry.object.position.clone(),
      geometry: entry.object instanceof Mesh ? entry.object.geometry : undefined,
    }))
    const beforeCount = meshes(model.root).length
    batchStaticMeshes(model.root, new Set(model.foliage.map(({ object }) => object)))
    assert.equal(meshes(model.root).length, beforeCount)
    for (const { object, parent, position, geometry, restRotation, amplitude, phase } of references) {
      assert.equal(model.root.getObjectById(object.id), object)
      assert.equal(object.parent, parent)
      assert.deepEqual(object.position, position)
      assert.equal(object.rotation.z, restRotation)
      if (object instanceof Mesh) assert.equal(object.geometry, geometry)
      assert.ok(Number.isFinite(restRotation) && Number.isFinite(phase))
      assert.ok(amplitude >= 0.012 && amplitude <= 0.025)
      const descendants = meshes(object)
      assert.ok(descendants.length > 0)
      assert.ok(descendants.every((mesh) => mesh.castShadow))
      const moving = descendants[0]
      moving.geometry.computeBoundingBox()
      const local = moving.geometry.boundingBox!.getCenter(new Vector3())
      model.root.updateMatrixWorld(true)
      const before = local.clone().applyMatrix4(moving.matrixWorld)
      const origin = object.getWorldPosition(new Vector3())
      const fixed = meshes(model.root).find((mesh) => !descendants.includes(mesh))!
      const fixedMatrix = fixed.matrixWorld.clone()
      object.rotation.z = restRotation + amplitude
      model.root.updateMatrixWorld(true)
      assert.ok(local.clone().applyMatrix4(moving.matrixWorld).distanceTo(before) > 0.00001)
      assert.ok(object.getWorldPosition(new Vector3()).distanceTo(origin) < 0.000001, 'The stem base should stay planted')
      assert.ok(fixed.matrixWorld.equals(fixedMatrix), 'Wind must not move another planter or the trunk')
      object.rotation.z = restRotation
    }
    for (const direction of [-1, 1]) {
      for (const { object, restRotation, amplitude } of model.foliage) object.rotation.z = restRotation + direction * amplitude
      model.root.updateMatrixWorld(true)
      assert.ok(model.bounds.clone().expandByScalar(0.1).containsBox(new Box3().setFromObject(model.root, true)),
        'Gentle sway should need no more than a small camera margin')
    }
    for (const { object, restRotation } of model.foliage) object.rotation.z = restRotation
  })

  test(`${side} garden owns its resources and disposes retained and batched geometry only once`, (t) => {
    const disposed = new Map<BufferGeometry, number>()
    const originalDispose = BufferGeometry.prototype.dispose
    t.mock.method(BufferGeometry.prototype, 'dispose', function (this: BufferGeometry) {
      disposed.set(this, (disposed.get(this) ?? 0) + 1)
      originalDispose.call(this)
    })
    const first = garden(t, side)
    const second = garden(t, side)
    const firstGeometry = new Set(meshes(first.root).map((mesh) => mesh.geometry))
    const secondGeometry = new Set(meshes(second.root).map((mesh) => mesh.geometry))
    assert.ok(firstGeometry.size < meshes(first.root).length, 'Shared primitives should be deduplicated on disposal')
    for (const geometry of firstGeometry) {
      assert.ok(!secondGeometry.has(geometry), 'Separate garden instances must not share GPU resources')
      assert.equal(disposed.get(geometry), undefined, 'Batching must retain geometry still in use')
    }
    const materialDisposals = new Map<MeshStandardMaterial, number>()
    for (const material of [...first.materials, ...second.materials]) {
      material.addEventListener('dispose', () => {
        materialDisposals.set(material, (materialDisposals.get(material) ?? 0) + 1)
      })
    }
    assert.ok(first.materials.every((material) => !second.materials.includes(material)))
    meshes(first.root)[0].removeFromParent()
    first.dispose()
    first.dispose()
    for (const geometry of firstGeometry) assert.equal(disposed.get(geometry), 1)
    for (const geometry of secondGeometry) assert.equal(disposed.get(geometry), undefined)
    for (const material of first.materials) assert.equal(materialDisposals.get(material), 1)
    for (const material of second.materials) assert.equal(materialDisposals.get(material), undefined)
    second.dispose()
    second.dispose()
    for (const geometry of secondGeometry) assert.equal(disposed.get(geometry), 1)
    assert.ok([...disposed.values()].every((count) => count === 1), 'Retired batching inputs must not be disposed twice')
    assert.ok([...materialDisposals.values()].every((count) => count === 1))
  })
}

test('left and right gardens have distinct geometry rather than duplicated edge decorations', (t) => {
  const left = garden(t, 'left')
  const right = garden(t, 'right')
  assert.notEqual(appearance(left.root), appearance(right.root))
  assert.ok(left.root.getObjectByName('Faceted tree crown'))
  assert.ok(right.foliage.some(({ object }) => object instanceof Mesh), 'The upright shrub should have individual broad leaves')
  assert.ok(left.root.getObjectByName('Tomato flower'))
  assert.ok(right.root.getObjectByName('Sunflower'))
})
