import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial } from 'three'
import type { Object3D } from 'three'
import { createRoomGrime } from '../src/roomGrime.ts'
import { visibleRoomBounds } from '../src/roomComponentScene.ts'

function scene() {
  const room = new Group()
  const object = new Group()
  const counter = new Mesh(new BoxGeometry(1.2, 0.9, 0.6), new MeshStandardMaterial())
  counter.position.y = 0.45
  const shelf = new Group()
  const nested = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshStandardMaterial())
  nested.position.set(0.3, 1.1, 0)
  shelf.add(nested)
  object.add(counter, shelf)
  room.add(object)
  const accepts = (item: Object3D) => {
    for (let current: Object3D | null = item; current; current = current.parent) if (current === shelf) return false
    return true
  }
  return { room, target: { root: object, accepts } }
}

function dirt(room: Group) {
  const group = room.children.find((child) => child.name === 'Overdue chore dirt')
  const specks = group?.children.find((child) => child instanceof InstancedMesh) as InstancedMesh | undefined
  return { group, specks: specks?.count ?? 0, stains: group?.children.filter((child) => child.name === 'Overdue chore stain').length ?? 0 }
}

describe('overdue chore dirt layer', () => {
  it('adds more crumbs and stains at each level without affecting room bounds or picking', () => {
    const { room, target } = scene()
    const grime = createRoomGrime(room)
    const before = visibleRoomBounds(room)
    const counts = ([1, 2, 3] as const).map((level) => {
      assert.equal(grime.update('sink', target, { level, overdueDays: level }, ''), true)
      return dirt(room)
    })
    assert.ok(counts[0].specks > 0 && counts[0].stains > 0)
    assert.ok(counts[1].specks > counts[0].specks && counts[1].stains > 0)
    assert.ok(counts[2].specks > counts[1].specks && counts[2].stains > counts[1].stains)
    assert.deepEqual(visibleRoomBounds(room), before)
    counts[2].group!.traverse((child) => {
      assert.equal(child.userData.roomTransient, true)
      assert.equal(child.castShadow, false)
    })
    grime.dispose()
  })

  it('rests crumbs on the object top, skips nested objects and clears when the chore is done', () => {
    const { room, target } = scene()
    const grime = createRoomGrime(room)
    grime.update('sink', target, { level: 3, overdueDays: 9 }, '')
    const specks = dirt(room).group!.children.find((child) => child instanceof InstancedMesh) as InstancedMesh
    const matrix = specks.instanceMatrix.array
    for (let index = 0; index < specks.count; index++) {
      const y = matrix[index * 16 + 13]
      assert.ok(y > 0.9 && y < 0.95, `crumb ${index} sits on the counter top at ${y}`)
    }
    assert.equal(grime.update('sink', target, { level: 3, overdueDays: 10 }, ''), false)
    assert.equal(grime.update('sink', target, undefined, ''), true)
    assert.equal(dirt(room).group, undefined)
    grime.dispose()
  })
})
