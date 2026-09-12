import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Box3, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { Object3D } from 'three'
import { createRoomComponent } from '../shared/roomComponents.ts'
import type { ComponentKind, RoomSlotId } from '../shared/roomComponents.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { componentMaterialColors } from '../src/componentMaterials.ts'
import { roomMaterialSurface } from '../src/surfaceMaterials.ts'

function fixture(t: TestContext, kind: ComponentKind, slotId: RoomSlotId) {
  const model = buildRoomComponentModel(createRoomComponent(kind, slotId, `refinement-${kind}`), 'original')
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

function namedAll(root: Object3D, name: string): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse((object) => { if (object instanceof Mesh && object.name === name) meshes.push(object) })
  return meshes
}

function bounds(object: Object3D): Box3 {
  return new Box3().setFromObject(object, true)
}

function size(object: Object3D): Vector3 {
  return bounds(object).getSize(new Vector3())
}

test('fruit-bowl fruit sits down inside the open bowl instead of floating above it', (t) => {
  const root = fixture(t, 'fruit-bowl', 'kitchen-table-center')
  const bowl = named(root, 'Open fruit bowl')
  assert.ok(bowl.geometry instanceof LatheGeometry)
  const bowlBounds = bounds(bowl)
  const bowlCenter = bowlBounds.getCenter(new Vector3())
  const fruits = namedAll(root, 'Fruit nestled in bowl')
  assert.equal(fruits.length, 4)
  for (const fruit of fruits) {
    const fruitBounds = bounds(fruit)
    const fruitCenter = fruitBounds.getCenter(new Vector3())
    assert.ok(fruitBounds.min.y < bowlBounds.max.y - 0.015, 'fruit bottom must drop below the rim')
    assert.ok(fruitBounds.max.y > bowlBounds.max.y + 0.025, 'fruit must remain visible above the rim')
    assert.ok(Math.hypot(fruitCenter.x - bowlCenter.x, fruitCenter.z - bowlCenter.z) < 0.3, 'fruit stays inside the bowl footprint')
  }
})

test('spice-rack bottles rest on shelves carried by a wall back panel', (t) => {
  const root = fixture(t, 'spice-rack', 'kitchen-spice-rack')
  const back = bounds(named(root, 'Wall mounting back panel'))
  const shelves = namedAll(root, 'Spice shelf').map(bounds)
  const jars = namedAll(root, 'Spice jar seated on shelf').map(bounds)
  assert.equal(shelves.length, 2)
  assert.equal(jars.length, 7)
  assert.ok(back.getSize(new Vector3()).z < 0.05, 'wall back panel stays thin')
  assert.ok(Math.min(...shelves.map((shelf) => shelf.min.z)) > back.min.z, 'shelves project out from the mounting plane')
  for (const jar of jars) {
    const center = jar.getCenter(new Vector3())
    const supportingShelf = shelves.find((shelf) => shelf.min.x <= center.x && shelf.max.x >= center.x
      && shelf.min.z <= center.z && shelf.max.z >= center.z && Math.abs(jar.min.y - shelf.max.y) < 0.003)
    assert.ok(supportingShelf, 'each jar bottom must contact a real shelf')
  }
})

test('bread-box holds one whole loaf between semicircular side walls', (t) => {
  const root = fixture(t, 'bread-box', 'kitchen-bread-box')
  assert.ok(size(root).y < 0.33, 'bread box should be shorter than the previous tall cuboid')
  assert.ok(named(root, 'Bread box visible interior'))
  const base = bounds(named(root, 'Bread box open base'))
  const loaves = namedAll(root, 'Bread loaf visible through opening')
  assert.equal(loaves.length, 1)
  assert.equal(namedAll(root, 'Bread slice stacked in open bread box').length, 0)
  assert.equal(namedAll(root, 'Bread slice crumb face').length, 0)
  const loaf = bounds(loaves[0])
  assert.ok(Math.abs(loaf.min.y - base.max.y) < 0.002, 'the whole loaf rests on the bread-box base')
  assert.ok(loaf.getSize(new Vector3()).x > 0.3)
  assert.ok(loaf.max.y < base.max.y + 0.14, 'the loaf fits below the open roll-top')
  const sides = namedAll(root, 'Bread box semicircular side')
  assert.equal(sides.length, 2)
  for (const side of sides) {
    assert.ok(side.geometry instanceof ExtrudeGeometry)
    const sideSize = size(side)
    assert.ok(Math.abs(sideSize.z / sideSize.y - 2) < 0.03, 'each side is a semicircle rather than a rounded rectangle')
    assert.ok(Math.abs(bounds(side).min.y - base.max.y) < 0.002)
  }
  const openingProbe = root.localToWorld(new Vector3(0, 0.13, 0.17))
  const blockers = sides
    .concat(namedAll(root, 'Bread box back'), namedAll(root, 'Bread box open base'), namedAll(root, 'Open roll-top bread-box slat'))
    .filter((mesh) => bounds(mesh).containsPoint(openingProbe))
  assert.equal(blockers.length, 0, 'front opening must not be covered by an opaque panel')
})

test('pet bowls have a readable floor-scale footprint without sinking into the floor', (t) => {
  const root = fixture(t, 'pet-bowls', 'kitchen-pet-bowls')
  assert.equal(namedAll(root, 'Pet bowl').length, 2)
  assert.ok(size(root).x >= 0.95)
  assert.ok(size(root).z >= 0.55)
  assert.ok(bounds(root).min.y >= 0 && bounds(root).min.y < 0.03)
})

test('the left cutting board has darker wood while the right board keeps its light finish', (t) => {
  const root = fixture(t, 'cutting-boards', 'kitchen-cutting-boards')
  const left = named(root, 'Left cutting board')
  const right = named(root, 'Right cutting board')
  assert.ok(left.material instanceof MeshStandardMaterial)
  assert.ok(right.material instanceof MeshStandardMaterial)
  assert.equal(roomMaterialSurface(left.material), 'wood')
  assert.equal(roomMaterialSurface(right.material), 'wood')
  assert.equal(left.material.color.getHexString(), componentMaterialColors.coffee.slice(1))
  const brightness = (material: MeshStandardMaterial) => material.color.r * 0.2126 + material.color.g * 0.7152 + material.color.b * 0.0722
  assert.ok(brightness(left.material) < brightness(right.material) * 0.5)
})

test('paper-towel-holder uses a circular foot, not a square platform', (t) => {
  const root = fixture(t, 'paper-towel-holder', 'kitchen-paper-towels')
  const foot = named(root, 'Paper towel round foot')
  assert.ok(foot.geometry instanceof CylinderGeometry)
  assert.ok(new Vector3(0, 1, 0).applyQuaternion(foot.quaternion).distanceTo(new Vector3(0, 1, 0)) < 0.000001)
  const lowSquarePlatforms: Mesh[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.geometry.type.includes('Box')) return
    const objectBounds = bounds(object)
    const objectSize = objectBounds.getSize(new Vector3())
    if (objectBounds.min.y < root.position.y + 0.04 && objectSize.x > 0.12 && objectSize.z > 0.12) {
      lowSquarePlatforms.push(object)
    }
  })
  assert.deepEqual(lowSquarePlatforms, [])
  const rectangularFlaps: Mesh[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.geometry.type.includes('Box')) return
    const objectSize = bounds(object).getSize(new Vector3())
    if (objectSize.y > 0.1 && objectSize.z > 0.08) rectangularFlaps.push(object)
  })
  assert.deepEqual(rectangularFlaps, [])
  assert.equal(root.getObjectByName('Hanging paper towel sheet'), undefined)
})
