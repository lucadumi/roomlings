import { describe, it } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { Box3, Camera, Group, Light, Mesh, MeshStandardMaterial, PointLight, Raycaster, Vector3 } from 'three'
import type { BufferGeometry, Object3D } from 'three'
import type { Category, RoomStyle } from '../shared/domain.ts'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { applyRoomStyle, roomAccents, roomPresets } from '../src/roomStyles.ts'
import { kitchenUtilityAnchors } from '../src/room.ts'
import { kitchenLayout, kitchenWorktops, kitchenShelves } from '../src/roomLayout.ts'
import { visibleRoomBounds } from '../src/roomComponentScene.ts'
import { assertRoomSurface } from './surface-fixture.ts'
import { componentMaterialColors } from '../src/componentMaterials.ts'

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
  it('keeps kettle framing stable while steam rises and fades', (context) => {
    const { room, scenery } = modelFor(context)
    const kettle = scenery.actors.get('brew')!
    const before = visibleRoomBounds(room, kettle)
    for (const puff of scenery.steam) {
      puff.visible = true
      puff.position.y += 1
      puff.scale.setScalar(2)
    }
    assert.deepEqual(visibleRoomBounds(room, kettle), before)
  })

  it('moves the kettle lid and its knob together without lifting the kettle base', (context) => {
    const { room, scenery } = modelFor(context)
    const kettle = scenery.actors.get('brew')!
    const lid = scenery.kettleLid
    const knob = lid.getObjectByName('Kettle lid knob')!
    assert.ok(lid instanceof Group)
    assert.equal(knob.parent, lid)
    assert.ok(scenery.preserved.has(lid))
    batchStaticMeshes(room, scenery.preserved)
    const base = kettle.getWorldPosition(new Vector3())
    const start = knob.getWorldPosition(new Vector3())
    lid.position.y += 0.02
    room.updateMatrixWorld(true)
    assert.ok(Math.abs(knob.getWorldPosition(new Vector3()).y - start.y - 0.02) < 0.000001)
    assert.ok(kettle.getWorldPosition(new Vector3()).distanceTo(base) < 0.000001)
    assert.equal(lid.parent, kettle)
  })

  it('places the stove on the right-hand return and rests the kettle directly on a burner', (context) => {
    const { scenery } = modelFor(context)
    const hob = scenery.componentBindings.get('kitchen-hob')!.root
    const kettle = scenery.actors.get('brew')!
    const hobBounds = new Box3().setFromObject(hob)
    const kettleBounds = new Box3().setFromObject(kettle)
    const side = kitchenWorktops[1]
    assert.ok(hobBounds.min.x >= side.position[0] - side.width / 2)
    assert.ok(hobBounds.max.x <= side.position[0] + side.width / 2)
    assert.ok(hobBounds.min.z >= side.position[2] - side.depth / 2)
    assert.ok(hobBounds.max.z <= side.position[2] + side.depth / 2)
    closeTo(hob.getWorldPosition(new Vector3()), kitchenLayout.hob)
    closeTo(kettle.getWorldPosition(new Vector3()), kitchenLayout.kettle)
    assert.equal(hob.rotation.y, -Math.PI / 2)
    const ray = new Raycaster(new Vector3(kitchenLayout.kettle[0], kettleBounds.min.y + 0.2, kitchenLayout.kettle[2]), new Vector3(0, -1, 0))
    const burner = ray.intersectObject(hob, true)[0]
    assert.ok(burner?.object instanceof Mesh)
    assert.equal(burner.object.geometry.type, 'CylinderGeometry')
    assert.ok(Math.abs(burner.point.y - kettleBounds.min.y) < 0.0001, 'The kettle must touch the burner rather than float above it')
    assert.ok(!hobBounds.intersectsBox(new Box3().setFromObject(scenery.utilityActors.get('sink')!)))
  })

  it('keeps chore fixtures and supply objects interactive after static batching', (context) => {
    const { room, scenery } = modelFor(context)
    assert.deepEqual([...scenery.utilityActors.keys()].sort(), ['chores', 'counters', 'floor', 'sink', 'supplies'])
    const references = [...scenery.utilityActors].map(([utility, group]) => ({
      utility, group, parent: group.parent, bounds: new Box3().setFromObject(group, true),
    }))
    batchStaticMeshes(room, new Set([...scenery.coins, ...scenery.receipts, ...scenery.steam, scenery.kettleLid]))
    for (const { utility, group, parent, bounds } of references) {
      assert.equal(room.getObjectById(group.id), group)
      assert.equal(group.parent, parent)
      assert.deepEqual(group.userData, { utility })
      assert.ok(meshCount(group) > 0)
      const after = new Box3().setFromObject(group, true)
      closeTo(after.min, bounds.min.toArray())
      closeTo(after.max, bounds.max.toArray())
    }
    for (const anchor of kitchenUtilityAnchors) {
      assert.ok(scenery.utilityActors.has(anchor.utility))
      assert.ok(anchor.position.every(Number.isFinite))
    }
  })

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
    closeTo(kitchen.position, [-3.2, 0.025, -2.25])
    assert.equal(meshCount(kitchen), 95)
    const bounds = new Box3().setFromObject(kitchen, true)
    closeTo(bounds.min, [-4.3, 0.055, -3.1])
    closeTo(bounds.max, [-2.1, 3.78, -1.13])

    assert.ok(iceTray instanceof Group)
    assert.equal(iceTray.parent, kitchen)
    assert.equal(meshCount(iceTray), 7)
    const iceBounds = new Box3().setFromObject(iceTray, true)
    closeTo(iceBounds.min, [-3.39, 2.725, -2.525])
    closeTo(iceBounds.max, [-2.61, 2.895, -1.975])
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
    closeTo(lowerBounds.min, [-4.3, 0.39, -1.815])
    closeTo(lowerBounds.max, [-2.1, 2.66, -1.13])
    const upperBounds = new Box3().setFromObject(upper, true)
    closeTo(upperBounds.min, [-4.3, 2.73, -1.515])
    closeTo(upperBounds.max, [-2.1, 3.7, -1.13])

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

  it('leaves the complete fridge door sweep clear of the L counter, shelves and cleaning caddy', (context) => {
    const { room, scenery, doors } = modelFor(context)
    const obstacles = [...kitchenWorktops.slice(1), ...kitchenShelves].map((top) => new Box3(
      new Vector3(top.position[0] - top.width / 2, 0, top.position[2] - top.depth / 2),
      new Vector3(top.position[0] + top.width / 2, top.top, top.position[2] + top.depth / 2),
    ))
    obstacles.push(new Box3().setFromObject(scenery.utilityActors.get('chores')!))
    room.updateMatrixWorld(true)
    for (const door of doors) {
      let radius = 0
      door.traverse((object) => {
        if (!(object instanceof Mesh)) return
        const points = object.geometry.getAttribute('position')
        for (let index = 0; index < points.count; index++) {
          const point = door.worldToLocal(new Vector3().fromBufferAttribute(points, index).applyMatrix4(object.matrixWorld))
          radius = Math.max(radius, Math.hypot(point.x, point.z))
        }
      })
      const hinge = door.getWorldPosition(new Vector3())
      for (const obstacle of obstacles) {
        const x = Math.max(obstacle.min.x, Math.min(obstacle.max.x, hinge.x))
        const z = Math.max(obstacle.min.z, Math.min(obstacle.max.z, hinge.z))
        assert.ok(Math.hypot(x - hinge.x, z - hinge.z) > radius + 0.1,
          'Fitted furniture must clear the actual hinge radius, not just the closed and fully open door poses')
      }
    }
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
    assert.equal(scenery.contacts.length, 10)
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

  it('returns a complete surface-material registry and the same grocery palette instances', (context) => {
    const { room, foods, materials, scenery, foodMaterials } = modelFor(context)
    const registry = new Set(materials)
    assert.equal(registry.size, materials.length)
    room.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const used = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of used) {
        assert.ok(material instanceof MeshStandardMaterial)
        assert.ok(registry.has(material))
        assertRoomSurface(material)
      }
    })
    for (const material of [scenery.sky, scenery.windowDisc, scenery.bulb]) assert.ok(registry.has(material))
    const palette: { category: Category; color: string }[] = [
      { category: 'produce', color: componentMaterialColors.apple.slice(1) },
      { category: 'dairy', color: 'f8f3de' },
      { category: 'pantry', color: roomAccents.gold.slice(1) },
      { category: 'drinks', color: roomAccents.blue.slice(1) },
      { category: 'other', color: roomAccents.berry.slice(1) },
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
