import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Mesh, Vector3 } from 'three'
import { createRoomComponent, defaultRoomComponents } from '../shared/roomComponents.ts'
import type { ComponentKind, RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { visibleRoomBounds } from '../src/roomComponentScene.ts'
import { completeRoomLayout } from './room-layout-fixture.ts'

function configured(t: TestContext, roomId: RoomId, components: RoomComponent[]) {
  const preview = createConfiguredRoomPreview(roomId, 'original', components)
  t.after(() => preview.dispose())
  const baseLayout = completeRoomLayout()
  const sizeAtSlot = (slotId: RoomSlotId) => {
    const component = preview.componentScene.componentAtSlot(slotId)
    assert.ok(component, `${slotId} must be installed for sizing`)
    return visibleRoomBounds(preview.room, preview.componentScene.actors.get(component.id)!).getSize(new Vector3())
  }
  const measure = (slotId: RoomSlotId, kind: ComponentKind, variant = 'original') => {
    const layout = baseLayout.map((component) => component.slotId === slotId
      ? { ...createRoomComponent(kind, slotId, component.id), variant } : component)
    preview.componentScene.update(layout, 'original')
    return sizeAtSlot(slotId)
  }
  return { sizeAtSlot, measure }
}

function disposeModel(component: RoomComponent) {
  const model = buildRoomComponentModel(component, 'original')
  const scale = model.root.scale.clone()
  const geometries = new Set<Mesh['geometry']>()
  model.root.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
  geometries.forEach((geometry) => geometry.dispose())
  model.materials.forEach((material) => material.dispose())
  return scale
}

function scaleAt(kind: ComponentKind, slotId: RoomSlotId) {
  return disposeModel(createRoomComponent(kind, slotId, `${slotId}-${kind}`)).x
}

function sortedFootprint(size: Vector3) {
  return [size.x, size.z].sort((left, right) => left - right).map((value) => +value.toFixed(3))
}

function maxFootprint(size: Vector3) {
  return Math.max(size.x, size.z)
}

function roundedSize(size: Vector3) {
  return size.toArray().map((value) => +value.toFixed(3))
}

function assertSamePhysicalSize(left: Vector3, right: Vector3, label: string) {
  assert.deepEqual(sortedFootprint(left), sortedFootprint(right), `${label} footprint`)
  assert.ok(Math.abs(left.y - right.y) < 0.000001, `${label} height`)
}

test('kitchen shared placements keep real household sizes instead of slot-specific miniatures', (t) => {
  const kitchen = configured(t, 'kitchen', completeRoomLayout())
  assert.ok(kitchen.measure('kitchen-soap-dispenser', 'soap-dispenser').y >= 0.3)
  assert.ok(kitchen.measure('kitchen-waffle-maker', 'waffle-maker').y >= 0.27)
  assert.ok(kitchen.measure('kitchen-cereal-dispenser', 'cereal-dispenser').y >= 0.47)
  assert.ok(maxFootprint(kitchen.measure('kitchen-record-player', 'record-player')) >= 0.74)
  assert.ok(maxFootprint(kitchen.measure('kitchen-first-aid', 'first-aid-kit')) >= 0.48)
  assert.ok(maxFootprint(kitchen.measure('kitchen-tissue-box', 'tissue-box')) >= 0.43)

  for (const [kind, shared, dedicated] of [
    ['egg-basket', 'kitchen-table-center', 'kitchen-egg-basket'],
    ['record-player', 'kitchen-table-center', 'kitchen-record-player'],
    ['tissue-box', 'kitchen-table-center', 'kitchen-tissue-box'],
    ['first-aid-kit', 'kitchen-table-center', 'kitchen-first-aid'],
    ['cereal-dispenser', 'kitchen-table-center', 'kitchen-cereal-dispenser'],
    ['tea-set', 'kitchen-table-center', 'kitchen-tea-set'],
    ['reed-diffuser', 'kitchen-table-center', 'kitchen-diffuser'],
    ['board-game', 'kitchen-table-center', 'kitchen-board-game'],
  ] as const) {
    assertSamePhysicalSize(kitchen.measure(shared, kind), kitchen.measure(dedicated, kind), `${kind} in ${shared}`)
  }

  assert.ok(scaleAt('plant', 'kitchen-table-center') < scaleAt('record-player', 'kitchen-table-center'))
  assert.ok(scaleAt('plant', 'kitchen-windowsill') < scaleAt('reed-diffuser', 'kitchen-windowsill'))
})

test('living-room shared surfaces keep full-size accessories and floor-care objects', (t) => {
  const kitchen = configured(t, 'kitchen', completeRoomLayout())
  const lounge = configured(t, 'living-room', completeRoomLayout())

  const mediaRecord = lounge.measure('living-room-media-accessory', 'record-player')
  assert.ok(maxFootprint(mediaRecord) >= 0.74)
  assert.ok(mediaRecord.y >= 0.17)
  assertSamePhysicalSize(mediaRecord, kitchen.measure('kitchen-record-player', 'record-player'), 'living-room media record player')

  const shelfGame = lounge.measure('living-room-shelf-accessory', 'board-game')
  assertSamePhysicalSize(shelfGame, kitchen.measure('kitchen-board-game', 'board-game'), 'living-room shelf board game')

  const shelfDiffuser = lounge.measure('living-room-shelf-accessory', 'reed-diffuser')
  assertSamePhysicalSize(shelfDiffuser, kitchen.measure('kitchen-diffuser', 'reed-diffuser'), 'living-room shelf diffuser')

  const tableGame = lounge.measure('living-room-table-top', 'board-game')
  assertSamePhysicalSize(tableGame, kitchen.measure('kitchen-board-game', 'board-game'), 'living-room table board game')

  const tableTissue = lounge.measure('living-room-table-top', 'tissue-box')
  assertSamePhysicalSize(tableTissue, kitchen.measure('kitchen-tissue-box', 'tissue-box'), 'living-room table tissue box')

  const floorVacuum = lounge.measure('living-room-cleaning-station', 'vacuum')
  assertSamePhysicalSize(floorVacuum, kitchen.measure('kitchen-vacuum', 'vacuum'), 'living-room cleaning-station vacuum')
  assertSamePhysicalSize(lounge.measure('living-room-cleaning-station', 'air-purifier'),
    kitchen.measure('kitchen-air-purifier', 'air-purifier'), 'living-room cleaning-station air purifier')

  const sillDiffuser = lounge.measure('living-room-windowsill', 'reed-diffuser')
  assert.ok(sillDiffuser.y >= 0.68 * kitchen.measure('kitchen-diffuser', 'reed-diffuser').y)

  assert.ok(scaleAt('plant', 'living-room-table-top') < scaleAt('tissue-box', 'living-room-table-top'))
  assert.ok(scaleAt('plant', 'living-room-media-accessory') < scaleAt('record-player', 'living-room-media-accessory'))
  assert.ok(scaleAt('plant', 'living-room-shelf-accessory') < scaleAt('reed-diffuser', 'living-room-shelf-accessory'))
  assert.ok(scaleAt('plant', 'living-room-windowsill') < scaleAt('reed-diffuser', 'living-room-windowsill'))
})

test('fitted furniture keeps its authored sizes with the attached stereo pair', (t) => {
  const kitchen = configured(t, 'kitchen', defaultRoomComponents())
  assert.deepEqual(roundedSize(kitchen.sizeAtSlot('kitchen-table')), [3.58, 1.445, 1.86])
  assert.deepEqual(roundedSize(kitchen.sizeAtSlot('kitchen-kettle')), [0.44, 0.62, 0.587])

  const bathroom = configured(t, 'bathroom', defaultRoomComponents())
  assert.deepEqual(roundedSize(bathroom.sizeAtSlot('bathroom-bath')), [2.05, 1.712, 3.04])
  assert.deepEqual(roundedSize(bathroom.sizeAtSlot('bathroom-sink')), [2.45, 2.283, 1.382])
  assert.deepEqual(roundedSize(bathroom.sizeAtSlot('bathroom-toilet')), [1.625, 1.927, 1.95])

  const lounge = configured(t, 'living-room', defaultRoomComponents())
  assert.deepEqual(roundedSize(lounge.sizeAtSlot('living-room-sofa')), [4.56, 1.595, 2.525])
  assert.deepEqual(roundedSize(lounge.sizeAtSlot('living-room-coffee-table')), [2.45, 0.83, 1.38])
  assert.deepEqual(roundedSize(lounge.sizeAtSlot('living-room-media-unit')), [1.004, 1.59, 3.4])
})
