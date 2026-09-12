import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import type { BufferGeometry } from 'three'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'
import { createRoomBoxGeometry } from '../src/roomGeometry.ts'

describe('static room geometry batching', () => {
  it('indexes rounded batches without changing triangles, normals or texture seams', (t) => {
    const room = new Group()
    const material = new MeshStandardMaterial()
    const expected = new Map<string, number[]>()
    for (const x of [-1, 1]) {
      const mesh = new Mesh(createRoomBoxGeometry([1.3, 0.7, 0.3], 0.08), material)
      mesh.position.x = x
      mesh.rotation.y = x * 0.2
      room.add(mesh)
      mesh.updateMatrix()
      const transformed = mesh.geometry.clone().applyMatrix4(mesh.matrix)
      for (const [name, attribute] of Object.entries(transformed.attributes)) {
        expected.set(name, [...(expected.get(name) ?? []), ...attribute.array])
      }
      transformed.dispose()
    }
    batchStaticMeshes(room, new Set())
    t.after(() => {
      room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
      material.dispose()
    })
    assert.equal(room.children.length, 1)
    const combined = room.children[0]
    assert.ok(combined instanceof Mesh)
    const geometry: BufferGeometry = combined.geometry
    const indices = geometry.getIndex()
    assert.ok(indices)
    assert.equal(indices.count, expected.get('position')!.length / 3)
    assert.ok(geometry.getAttribute('position').count < indices.count / 2)
    for (const [name, values] of expected) {
      const attribute = geometry.getAttribute(name)
      for (let index = 0; index < indices.count; index++) {
        for (let component = 0; component < attribute.itemSize; component++) {
          assert.ok(Math.abs(attribute.array[indices.getX(index) * attribute.itemSize + component]
            - values[index * attribute.itemSize + component]) < 0.000001, `${name} must retain its triangle-corner values`)
        }
      }
    }
  })

  it('combines sibling primitives while preserving their world bounds and material', () => {
    const room = new Group()
    room.position.set(2, 3, -1)
    room.rotation.y = 0.35
    const material = new MeshStandardMaterial({ flatShading: true })
    const a = new Mesh(new BoxGeometry(1, 2, 1), material)
    a.position.set(-2, 1, 0)
    const b = new Mesh(new CylinderGeometry(0.5, 0.7, 1, 6).toNonIndexed(), material)
    b.position.set(2, 0.5, 1)
    b.rotation.z = 0.3
    room.add(a, b)
    const before = new Box3().setFromObject(room, true)
    batchStaticMeshes(room, new Set())
    assert.equal(room.children.length, 1)
    const combined = room.children[0]
    assert.ok(combined instanceof Mesh)
    assert.equal(combined.material, material)
    const after = new Box3().setFromObject(room, true)
    assert.ok(before.min.distanceTo(after.min) < 0.000001)
    assert.ok(before.max.distanceTo(after.max) < 0.000001)
  })

  it('keeps animated groups and their picking metadata intact', () => {
    const room = new Group()
    const door = new Group()
    door.userData.action = 'fridge'
    const material = new MeshStandardMaterial()
    const panel = new Mesh(new BoxGeometry(1, 1, 0.1), material)
    const handle = new Mesh(new BoxGeometry(0.1, 0.5, 0.1), material)
    handle.position.set(0.3, 0, 0.1)
    door.add(panel, handle)
    room.add(door)
    batchStaticMeshes(room, new Set())
    assert.equal(room.children[0], door)
    assert.equal(door.children.length, 1)
    door.position.y = 2
    room.updateMatrixWorld(true)
    const hits = new Raycaster(new Vector3(0, 2, 3), new Vector3(0, 0, -1)).intersectObjects(room.children, true)
    assert.ok(hits.length)
    assert.equal(hits[0].object.parent, door)
    assert.equal(hits[0].object.parent?.userData.action, 'fridge')
  })

  it('leaves individually animated, tagged, and transparent meshes untouched', () => {
    const room = new Group()
    const opaque = new MeshStandardMaterial()
    const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.3 })
    const fixed = [new Mesh(new BoxGeometry(), opaque), new Mesh(new BoxGeometry(), opaque)]
    const coin = new Mesh(new CylinderGeometry(), opaque)
    const tagged = new Mesh(new BoxGeometry(), opaque)
    tagged.userData.action = 'budget'
    const windows = [new Mesh(new BoxGeometry(), glass), new Mesh(new BoxGeometry(), glass)]
    room.add(...fixed, coin, tagged, ...windows)
    batchStaticMeshes(room, new Set([coin]))
    assert.equal(room.children.length, 5)
    for (const mesh of [coin, tagged, ...windows]) assert.ok(room.children.includes(mesh))
    coin.scale.setScalar(0.4)
    assert.equal(coin.scale.x, 0.4)
  })

  it('does not combine meshes with different shadow or rendering behavior', () => {
    const room = new Group()
    const material = new MeshStandardMaterial()
    const meshes = Array.from({ length: 4 }, () => new Mesh(new BoxGeometry(), material))
    meshes[1].castShadow = true
    meshes[2].receiveShadow = true
    meshes[3].renderOrder = 2
    room.add(...meshes)
    batchStaticMeshes(room, new Set())
    assert.deepEqual(room.children, meshes)
  })

  it('does not dispose geometry still used by an individually animated mesh', () => {
    const room = new Group()
    const geometry = new BoxGeometry()
    const material = new MeshStandardMaterial()
    const fixed = [new Mesh(geometry, material), new Mesh(geometry, material)]
    const animated = new Mesh(geometry, material)
    let disposed = 0
    geometry.addEventListener('dispose', () => { disposed++ })
    room.add(...fixed, animated)
    batchStaticMeshes(room, new Set([animated]))
    assert.equal(disposed, 0)
    assert.ok(room.children.includes(animated))
    assert.equal(room.children.length, 2)
  })

  it('releases retired shared geometry only once', () => {
    const room = new Group()
    const geometry = new BoxGeometry()
    const material = new MeshStandardMaterial()
    let disposed = 0
    geometry.addEventListener('dispose', () => { disposed++ })
    room.add(new Mesh(geometry, material), new Mesh(geometry, material))
    batchStaticMeshes(room, new Set())
    assert.equal(disposed, 1)
  })
})
