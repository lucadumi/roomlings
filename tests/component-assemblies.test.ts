import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Box3, CylinderGeometry, LatheGeometry, Mesh, Raycaster, Vector3 } from 'three'
import type { Object3D } from 'three'
import { createRoomComponent, roomSlots } from '../shared/roomComponents.ts'
import type { ComponentKind } from '../shared/roomComponents.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'

function fixture(t: TestContext, kind: ComponentKind) {
  const slot = roomSlots.find((slot) => slot.kinds.includes(kind))
  assert.ok(slot)
  const model = buildRoomComponentModel(createRoomComponent(kind, slot.id, `assembly-${kind}`), 'original')
  model.root.updateMatrixWorld(true)
  t.after(() => {
    const geometries = new Set<Mesh['geometry']>()
    model.root.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  })
  return model.root
}

function named(root: Object3D, name: string): Mesh {
  const mesh = root.getObjectByName(name)
  assert.ok(mesh instanceof Mesh, `Missing ${name}`)
  return mesh
}

function cylinderEnd(mesh: Mesh, side: -1 | 1): Vector3 {
  assert.ok(mesh.geometry instanceof CylinderGeometry)
  return new Vector3(0, side * mesh.geometry.parameters.height / 2, 0)
    .applyQuaternion(mesh.quaternion).add(mesh.position)
}

test('horizontal lids, contents and record labels are not standing on edge', (t) => {
  for (const [kind, part] of [
    ['spice-rack', 'Spice jar lid'], ['cereal-dispenser', 'Cereal dispenser lid'],
    ['record-player', 'Record label'], ['toilet-brush', 'Toilet brush holder lid'],
    ['storage-jars', 'Jar contents'],
  ] as const) {
    const root = fixture(t, kind)
    const mesh = named(root, part)
    assert.ok(mesh.geometry instanceof CylinderGeometry)
    assert.ok(new Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).distanceTo(new Vector3(0, 1, 0)) < 0.000001)
  }
  const cereal = named(fixture(t, 'cereal-dispenser'), 'Cereal dispenser lid')
  assert.ok(Math.abs(cylinderEnd(cereal, -1).y - 0.38) < 0.000001)
  const record = named(fixture(t, 'record-player'), 'Record label')
  assert.ok(Math.abs(cylinderEnd(record, -1).y - 0.08) < 0.000001)
})

test('the simplified speaker assembly has no separate top control', (t) => {
  const speaker = fixture(t, 'speaker')
  assert.equal(speaker.getObjectByName('Speaker top control'), undefined)
})

test('watering-can and hair-dryer outlets stay joined and aligned with their bodies', (t) => {
  const can = fixture(t, 'watering-can')
  const spout = named(can, 'Watering can spout')
  const rose = named(can, 'Watering can rose')
  assert.ok(spout.quaternion.angleTo(rose.quaternion) < 0.000001)
  assert.ok(cylinderEnd(spout, 1).distanceTo(cylinderEnd(rose, -1)) < 0.0011)
  assert.ok(cylinderEnd(spout, -1).distanceTo(new Vector3(0.13, 0.12, 0)) < 0.000001)

  const dryer = fixture(t, 'hair-dryer')
  const barrel = named(dryer, 'Hair dryer barrel')
  const nozzle = named(dryer, 'Hair dryer nozzle')
  assert.ok(barrel.quaternion.angleTo(nozzle.quaternion) < 0.000001)
  assert.ok(cylinderEnd(barrel, 1).distanceTo(cylinderEnd(nozzle, -1)) < 0.000001)
})

test('bowl interiors do not contain opaque top caps hiding their contents', (t) => {
  for (const kind of ['fruit-bowl', 'stand-mixer', 'egg-basket'] as const) {
    const root = fixture(t, kind)
    const bowls: Mesh[] = []
    root.traverse((object) => {
      if (object instanceof Mesh && object.geometry instanceof LatheGeometry) bowls.push(object)
    })
    assert.ok(bowls.length)
    const bowl = bowls[0]
    bowl.geometry.computeBoundingBox()
    const top = bowl.geometry.boundingBox!.max.y
    const isolated = new Mesh(bowl.geometry, bowl.material)
    isolated.updateMatrixWorld(true)
    const hits = new Raycaster(new Vector3(0.03, top + 0.1, 0), new Vector3(0, -1, 0)).intersectObject(isolated)
    assert.ok(hits.length)
    assert.ok(hits[0].point.y < top / 2, `${kind}: its opening must reach the interior floor.`)
  }
})

test('knife handles stay exposed while blades seat inside the block', (t) => {
  const root = fixture(t, 'knife-block')
  const blades: Mesh[] = []
  const handles: Mesh[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    if (object.name === 'Knife blade seated in block') blades.push(object)
    if (object.name === 'Knife handle') handles.push(object)
  })
  assert.equal(blades.length, 5)
  assert.equal(handles.length, 5)
  for (let index = 0; index < blades.length; index++) {
    assert.ok(blades[index].position.y < 0.34)
    assert.ok(handles[index].position.y > 0.34)
    assert.ok(new Box3().setFromObject(blades[index], true).intersectsBox(new Box3().setFromObject(handles[index], true)))
  }
})

test('wall hanging loops face the same plane as their mounted objects', (t) => {
  for (const [kind, part] of [
    ['wall-calendar', 'Calendar hanging loop'], ['key-hooks', 'Hanging key ring'],
    ['shower-squeegee', 'Squeegee hanging loop'],
  ] as const) {
    const mesh = named(fixture(t, kind), part)
    assert.ok(new Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).distanceTo(new Vector3(0, 0, 1)) < 0.000001)
  }
})

test('cup handles sit outside their cavities and hanging mugs point toward their pegs', (t) => {
  const root = fixture(t, 'mug-tree')
  const handles: Mesh[] = []
  root.traverse((object) => { if (object instanceof Mesh && object.name === 'Cup handle') handles.push(object) })
  assert.equal(handles.length, 4)
  for (const handle of handles) {
    const cup = handle.parent
    assert.ok(cup)
    const inward = new Vector3(-cup.position.x, 0, -cup.position.z).normalize()
    const direction = new Vector3(1, 0, 0).applyQuaternion(cup.quaternion)
    assert.ok(direction.distanceTo(inward) < 0.000001)
    assert.ok(handle.position.x > 0.048)
  }
})
