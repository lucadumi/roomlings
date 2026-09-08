import { describe, it } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { Box3, Camera, Group, Light, Mesh, MeshStandardMaterial, PointLight, Vector3 } from 'three'
import type { BufferGeometry, Object3D } from 'three'
import type { Category, RoomStyle } from '../shared/domain.ts'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { applyRoomStyle, roomPresets } from '../src/roomStyles.ts'

function modelFor(context: TestContext, style: RoomStyle = 'original') {
  const room = new Group()
  const model = buildKitchenModel(room, style)
  room.updateMatrixWorld(true)
  context.after(() => {
    const geometries = new Set<BufferGeometry>()
    room.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  })
  return { room, ...model }
}

function meshCount(root: Object3D) {
  let count = 0
  root.traverse((object) => { if (object instanceof Mesh) count++ })
  return count
}

function closeTo(actual: Vector3, expected: [number, number, number]) {
  assert.ok(actual.distanceTo(new Vector3(...expected)) < 0.000001, `${actual.toArray()} differs from ${expected}`)
}

describe('shared kitchen model', () => {
  for (const style of ['original', 'sage', 'clay', 'linen'] as const) {
    it(`keeps ${style} finishes when the kitchen model is shared with the landing`, (context) => {
      const { styleMaterials, foodMaterials, room } = modelFor(context, style)
      const groceries = foodMaterials.produce.color.getHexString()
      const pieces = meshCount(room)
      for (const surface of ['fridge', 'fridgeDoor', 'fridgeEdge', 'wall', 'floor', 'cabinet', 'wood'] as const) {
        assert.equal(styleMaterials[surface].color.getHexString(), roomPresets[style].colors[surface].slice(1))
      }
      applyRoomStyle(styleMaterials, 'linen')
      assert.equal(styleMaterials.fridge.color.getHexString(), roomPresets.linen.colors.fridge.slice(1))
      assert.equal(foodMaterials.produce.color.getHexString(), groceries)
      assert.equal(meshCount(room), pieces)
    })
  }

  it('retains the original fridge, ice tray and interior light without batching or scene effects', (context) => {
    const { room, kitchen, iceTray, interiorLight, scenery } = modelFor(context)
    assert.equal(kitchen.parent, room)
    assert.deepEqual(kitchen.userData, { action: 'fridge' })
    closeTo(kitchen.position, [-2.7, 0.025, -2.25])
    assert.equal(meshCount(kitchen), 95)
    const bounds = new Box3().setFromObject(kitchen, true)
    closeTo(bounds.min, [-3.8, 0.055, -3.1])
    closeTo(bounds.max, [-1.6, 3.78, -1.13])

    assert.ok(iceTray instanceof Group)
    assert.equal(iceTray.parent, kitchen)
    assert.equal(meshCount(iceTray), 7)
    const iceBounds = new Box3().setFromObject(iceTray, true)
    closeTo(iceBounds.min, [-2.89, 2.725, -2.525])
    closeTo(iceBounds.max, [-2.11, 2.895, -1.975])
    iceTray.traverse((object) => {
      if (object instanceof Mesh) {
        assert.equal(object.castShadow, true)
        assert.equal(object.receiveShadow, true)
      }
    })

    assert.ok(interiorLight instanceof PointLight)
    assert.equal(interiorLight.parent, kitchen)
    closeTo(interiorLight.position, [0, 3.4, 0.4])
    assert.equal(interiorLight.color.getHexString(), 'fff6d4')
    assert.equal(interiorLight.intensity, 0.6)
    assert.equal(interiorLight.distance, 3)
    const lights: Light[] = []
    room.traverse((object) => {
      assert.ok(!(object instanceof Camera))
      if (object instanceof Light) lights.push(object)
    })
    assert.deepEqual(new Set(lights), new Set([interiorLight, scenery.light]))
  })

  it('keeps exactly two independent door hinges and carries the lower door groceries with them', (context) => {
    const { room, kitchen, doors, foods } = modelFor(context)
    assert.equal(doors.length, 2)
    const [lower, upper] = doors
    assert.notEqual(lower, upper)
    for (const door of doors) {
      assert.ok(door instanceof Group)
      assert.equal(door.parent, kitchen)
      assert.equal(door.rotation.y, 0)
    }
    closeTo(lower.position, [-1.1, 1.5, 0.88])
    closeTo(upper.position, [-1.1, 3.19, 0.88])
    const lowerBounds = new Box3().setFromObject(lower, true)
    closeTo(lowerBounds.min, [-3.8, 0.39, -1.815])
    closeTo(lowerBounds.max, [-1.6, 2.66, -1.13])
    const upperBounds = new Box3().setFromObject(upper, true)
    closeTo(upperBounds.min, [-3.8, 2.73, -1.515])
    closeTo(upperBounds.max, [-1.6, 3.7, -1.13])

    const doorFoods = foods.filter(({ group }) => group.parent === lower)
    assert.deepEqual(doorFoods.map(({ category }) => category).sort(), ['drinks', 'pantry'])
    const grocery = doorFoods[0].group.children[0]
    room.updateMatrixWorld(true)
    const upperBefore = upper.matrixWorld.clone()
    const groceryBefore = grocery.getWorldPosition(new Vector3())
    lower.rotation.y = -1.97
    room.updateMatrixWorld(true)
    assert.ok(upper.matrixWorld.equals(upperBefore))
    assert.ok(grocery.getWorldPosition(new Vector3()).distanceTo(groceryBefore) > 0.1)
  })

  it('retains every category group, grocery piece, shelf position and visibility index', (context) => {
    const { kitchen, doors, foods } = modelFor(context)
    const expected: Record<Category, { positions: [number, number, number][]; indices: number[]; pieces: number[] }> = {
      produce: {
        positions: [[-0.62, 0.94, -0.26], [-0.07, 0.94, -0.26], [0.48, 0.94, -0.26], [-0.62, 0.94, 0.25], [-0.07, 0.94, 0.25], [0.48, 0.94, 0.25]],
        indices: [0, 0, 0, 1, 1, 1], pieces: [2, 2, 2, 2, 2, 2],
      },
      dairy: {
        positions: [[-0.63, 2.1, -0.08], [-0.15, 2.1, -0.08], [0.33, 2.1, -0.08], [0.58, 1.43, 0.35]],
        indices: [0, 1, 2, 0], pieces: [4, 4, 4, 5],
      },
      pantry: {
        positions: [[0, 0, 0], [-0.65, 1.43, -0.15], [-0.22, 1.43, -0.15], [0.21, 1.43, -0.15]],
        indices: [0, 0, 1, 2], pieces: [3, 3, 3, 3],
      },
      drinks: {
        positions: [[0, 0, 0], [0.58, 2.1, -0.3], [0.58, 2.1, 0.04], [0.58, 2.1, 0.38]],
        indices: [0, 0, 1, 2], pieces: [1, 3, 3, 3],
      },
      other: {
        positions: [[-0.57, 2.7, 0], [-0.02, 2.7, 0], [0.53, 2.7, 0]],
        indices: [0, 1, 2], pieces: [2, 2, 2],
      },
    }
    const seen: Record<Category, number> = { produce: 0, dairy: 0, pantry: 0, drinks: 0, other: 0 }
    assert.equal(foods.length, 21)
    for (const { group, category, baseline, index } of foods) {
      const occurrence = seen[category]++
      const layout = expected[category]
      assert.ok(group instanceof Group)
      assert.deepEqual(group.userData, { category })
      closeTo(group.position, layout.positions[occurrence])
      assert.equal(baseline, layout.positions[occurrence][1])
      assert.equal(index, layout.indices[occurrence])
      assert.equal(meshCount(group), layout.pieces[occurrence])
      assert.equal(group.parent, baseline === 0 ? doors[0] : kitchen)
      assert.equal(group.visible, true)
      closeTo(group.scale, [1, 1, 1])
    }
    assert.deepEqual(seen, { produce: 6, dairy: 4, pantry: 4, drinks: 4, other: 3 })
    const categoryGroups = new Set<Object3D>()
    kitchen.traverse((object) => { if (object.userData.category) categoryGroups.add(object) })
    assert.equal(categoryGroups.size, 21)
    assert.deepEqual(categoryGroups, new Set(foods.map(({ group }) => group)))
  })

  it('returns the complete scenery actors and independently animated household details', (context) => {
    const { room, scenery } = modelFor(context)
    assert.deepEqual([...scenery.actors.keys()].sort(), ['brew', 'budget', 'ledger', 'light', 'roommates', 'settle', 'stock'])
    for (const [action, actor] of scenery.actors) {
      assert.ok(actor instanceof Group)
      assert.deepEqual(actor.userData, { action })
      assert.equal(room.getObjectById(actor.id), actor)
      assert.ok(meshCount(actor) > 0)
    }
    assert.equal(scenery.coins.length, 12)
    assert.equal(scenery.portraits.length, 12)
    assert.equal(scenery.receipts.length, 10)
    assert.equal(scenery.steam.length, 3)
    assert.equal(scenery.plants.length, 2)
    assert.equal(scenery.contacts.length, 9)
    for (const coin of scenery.coins) assert.equal(coin.parent, scenery.actors.get('budget'))
    for (const portrait of scenery.portraits) assert.equal(portrait.parent, scenery.actors.get('roommates'))
    for (const receipt of scenery.receipts) assert.equal(receipt.parent, scenery.actors.get('ledger'))
    for (const puff of scenery.steam) assert.equal(puff.parent, scenery.actors.get('brew'))
    assert.equal(scenery.receiptLines.parent, scenery.actors.get('ledger'))
    assert.equal(scenery.kettleLid.parent, scenery.actors.get('brew'))
    assert.ok(scenery.hourHand.parent)
    assert.equal(scenery.hourHand.parent, scenery.minuteHand.parent)
    assert.equal(scenery.light.parent, room)
  })

  it('keeps all returned scene references, metadata and bounds valid with the existing preserved set', (context) => {
    const { room, kitchen, scenery, doors, foods, iceTray, interiorLight } = modelFor(context)
    doors.forEach((door, index) => { door.rotation.y = index ? -1.72 : -1.97 })
    room.rotation.y = 0.35
    const references = [
      room, kitchen, ...doors, ...foods.map(({ group }) => group), iceTray, interiorLight,
      ...scenery.actors.values(), ...scenery.coins, ...scenery.portraits, ...scenery.receipts,
      scenery.receiptLines, ...scenery.steam, ...scenery.plants, scenery.light,
      scenery.hourHand, scenery.minuteHand, scenery.kettleLid,
    ]
    const before = references.map((object) => ({
      object, parent: object.parent, metadata: { ...object.userData },
      bounds: new Box3().setFromObject(object, true),
      geometry: object instanceof Mesh ? object.geometry : null,
    }))
    const unbatchedCount = meshCount(room)
    batchStaticMeshes(room, new Set([
      ...scenery.coins, ...scenery.receipts, ...scenery.steam, scenery.kettleLid,
    ]))
    assert.ok(meshCount(room) < unbatchedCount)
    for (const { object, parent, metadata, bounds, geometry } of before) {
      assert.equal(room.getObjectById(object.id), object)
      assert.equal(object.parent, parent)
      assert.deepEqual(object.userData, metadata)
      if (object instanceof Mesh) assert.equal(object.geometry, geometry)
      const after = new Box3().setFromObject(object, true)
      assert.equal(after.isEmpty(), bounds.isEmpty())
      if (!bounds.isEmpty()) {
        closeTo(after.min, bounds.min.toArray())
        closeTo(after.max, bounds.max.toArray())
      }
    }
    scenery.coins[0].visible = false
    scenery.receipts[0].visible = false
    foods[0].group.visible = false
    assert.equal(scenery.coins[1].visible, true)
    assert.equal(scenery.receipts[1].visible, true)
    assert.equal(foods[1].group.visible, true)
  })

  it('returns a complete flat-shaded material registry and the same grocery palette instances', (context) => {
    const { room, foods, materials, scenery, foodMaterials } = modelFor(context)
    const registry = new Set(materials)
    assert.equal(registry.size, materials.length)
    room.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const used = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of used) {
        assert.ok(material instanceof MeshStandardMaterial)
        assert.ok(registry.has(material))
        assert.equal(material.flatShading, true)
        assert.equal(material.map, null)
      }
    })
    for (const material of [scenery.sky, scenery.windowDisc, scenery.bulb]) assert.ok(registry.has(material))
    const palette: { category: Category; color: string }[] = [
      { category: 'produce', color: 'd35739' },
      { category: 'dairy', color: 'f8f3de' },
      { category: 'pantry', color: 'e0bb5a' },
      { category: 'drinks', color: '72979b' },
      { category: 'other', color: '9b677b' },
    ]
    for (const { category, color } of palette) {
      const material = foodMaterials[category]
      assert.ok(registry.has(material))
      assert.equal(material.color.getHexString(), color)
      let sharedWithFood = false
      for (const { group, category: foodCategory } of foods) {
        if (foodCategory !== category) continue
        group.traverse((object) => { if (object instanceof Mesh && object.material === material) sharedWithFood = true })
      }
      assert.ok(sharedWithFood)
    }
  })
})
