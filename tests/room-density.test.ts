import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { householdSchema } from '../shared/domain.ts'
import { applyRoomComponentPatch, RoomComponentError, setRoomComponentState } from '../shared/componentChanges.ts'
import {
  availableComponentSlots, createRoomComponent, defaultRoomComponents, getRoomComponents, roomSlots, validateRoomComponents,
} from '../shared/roomComponents.ts'
import type { ComponentKind, RoomComponent, RoomComponentChange, RoomSlotId } from '../shared/roomComponents.ts'
import { componentSurfaces, componentZonePlacementReason, roomZoneCapacities, roomZoneLabels, roomZoneUsage } from '../shared/roomZones.ts'
import { componentPlacements } from '../src/roomLayout.ts'

const now = '2026-09-11T20:00:00.000Z'
const make = (kind: ComponentKind, slotId: RoomSlotId) => createRoomComponent(kind, slotId, randomUUID())
function home(components = defaultRoomComponents()) {
  return householdSchema.parse({
    id: randomUUID(), name: 'Density fixture', currency: 'EUR', budget: 45000, inviteCode: 'density-fixture', version: 0,
    members: [{ id: randomUUID(), name: 'Ada', color: '#8da48a' }], expenses: [], settlements: [], roomComponents: components,
  })
}
function change(component: RoomComponent, overrides: Partial<RoomComponentChange> = {}): RoomComponentChange {
  const { version, state: _state, stateChangedAt: _at, stateChangedBy: _by, ...fields } = component
  return { ...fields, componentVersion: version, ...overrides }
}
const atCounterCap = () => [
  ...defaultRoomComponents(),
  make('coffee-machine', 'kitchen-coffee'), make('microwave', 'kitchen-small-appliance'),
  make('toaster', 'kitchen-toaster'), make('blender', 'kitchen-blender'), make('paper-towel-holder', 'kitchen-paper-towels'),
]
const zoneConflict = (operation: () => unknown) => assert.throws(operation,
  (error) => error instanceof RoomComponentError && error.status === 409 && /Make room first/.test(error.message))

describe('shared surface metadata and density', () => {
  it('uses exactly the existing authored tags and the approved labels and capacities', () => {
    assert.deepEqual(componentSurfaces, Object.fromEntries(Object.entries(componentPlacements).map(([slot, placement]) => [slot, placement.surface])))
    assert.equal(Object.keys(componentSurfaces).length, 96)
    assert.ok(Object.keys(componentSurfaces).every((slotId) => roomSlots.some((slot) => slot.id === slotId)))
    assert.deepEqual(roomZoneLabels, { floor: 'Floor', counter: 'Counter', table: 'Table', wall: 'Wall', fitted: 'Fitted', bath: 'Bath' })
    assert.deepEqual(roomZoneCapacities, {
      kitchen: { floor: 4, counter: 6, table: 1, wall: 3, fitted: 3 },
      bathroom: { floor: 5, counter: 4, wall: 3, fitted: 1, bath: 1 },
      'living-room': { floor: 10, counter: 3, table: 1, wall: 3 },
    })
  })

  it('counts displayed records once, includes tagged required fixtures, and excludes untagged built-ins and storage', () => {
    const components = defaultRoomComponents()
    const counts = (roomId: 'kitchen' | 'bathroom' | 'living-room') =>
      Object.fromEntries(roomZoneUsage(components, roomId).map((zone) => [zone.surface, zone.used]))
    assert.deepEqual(counts('kitchen'), { floor: 2, counter: 1, table: 0, wall: 0, fitted: 0 })
    assert.deepEqual(counts('bathroom'), { floor: 1, counter: 0, wall: 0, fitted: 0, bath: 0 })
    assert.deepEqual(counts('living-room'), { floor: 9, counter: 0, table: 1, wall: 2 })
    assert.equal(componentSurfaces['kitchen-fridge'], undefined)
    assert.equal(componentSurfaces['bathroom-sink'], undefined)
    components.push({ ...make('coffee-machine', 'kitchen-coffee'), installed: false })
    assert.equal(counts('kitchen').counter, 1)
    components.push(make('bath-tray', 'bathroom-bath-tray'))
    assert.equal(counts('bathroom').bath, 1)
    assert.equal(counts('bathroom').floor, 1)
  })

  it('extends existing slot eligibility with zone, moving-object and capacity context without mutating inputs', () => {
    const components = atCounterCap()
    const before = structuredClone(components)
    assert.deepEqual(availableComponentSlots(components, 'kitchen', 'air-fryer'), [])
    assert.ok(availableComponentSlots(components, 'kitchen', 'air-fryer', { ignoreZoneCapacity: true }).length > 0)
    const coffee = components.find((component) => component.kind === 'coffee-machine')!
    assert.equal(availableComponentSlots(components, 'kitchen', coffee.kind, { movingComponentId: coffee.id })
      .some((slot) => slot.id === 'kitchen-drinks'), false)
    assert.ok(availableComponentSlots(components, 'kitchen', coffee.kind, { movingComponentId: coffee.id })
      .some((slot) => slot.id === coffee.slotId))
    assert.ok(availableComponentSlots(components, 'kitchen', 'plant', { surface: 'floor' }).length > 0)
    assert.ok(availableComponentSlots(components, 'kitchen', 'plant', { surface: 'floor' })
      .every((slot) => componentSurfaces[slot.id] === 'floor'))
    assert.deepEqual(availableComponentSlots(components, 'kitchen', 'plant', { surface: 'counter' }), [])
    assert.equal(componentZonePlacementReason(components, 'kitchen', 'kitchen-coffee'), 'Counter 6 of 6. Make room first.')
    assert.equal(componentZonePlacementReason(components, 'kitchen', 'kitchen-coffee', coffee.id), null)
    assert.deepEqual(components, before)
  })
})

describe('atomic placement budgets', () => {
  it('keeps over-cap saved homes readable and editable without blocking other zones or ordinary removals', () => {
    const household = home([
      ...atCounterCap(), make('water-filter', 'kitchen-water-filter'), make('tea-set', 'kitchen-tea-set'),
    ])
    assert.equal(validateRoomComponents(getRoomComponents(household)), null)
    const original = structuredClone(household)
    assert.deepEqual(householdSchema.parse(JSON.parse(JSON.stringify(household))), household)
    const coffee = getRoomComponents(household).find((component) => component.kind === 'coffee-machine')!
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(coffee, { name: 'Our coffee', finish: 'tomato' })] }, now)
    setRoomComponentState(household, coffee.id, { componentVersion: coffee.version + 1, state: 'ready' }, household.members[0].id, now)
    const bowls = make('pet-bowls', 'kitchen-pet-bowls')
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(bowls, { componentVersion: null })] }, now)
    const toaster = getRoomComponents(household).find((component) => component.kind === 'toaster')!
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(toaster, { installed: false, linkedChores: 'pause' })] }, now)
    assert.equal(roomZoneUsage(getRoomComponents(household), 'kitchen').find((zone) => zone.surface === 'counter')?.used, 7)
    assert.doesNotThrow(() => householdSchema.parse(household))
    for (const key of ['chores', 'shopping', 'expenses', 'settlements', 'members'] as const) assert.deepEqual(household[key], original[key])
  })

  it('rejects new, moved and restored placements into an over-cap zone without partial changes', () => {
    const components = [...atCounterCap(), make('water-filter', 'kitchen-water-filter')]
    const stored = { ...make('tea-set', 'kitchen-tea-set'), installed: false }
    const household = home([...components, stored])
    const floorPlant = getRoomComponents(household).find((component) => component.slotId === 'kitchen-plant-floor')!
    const coffee = getRoomComponents(household).find((component) => component.kind === 'coffee-machine')!
    const fresh = make('air-fryer', 'kitchen-air-fryer')
    const before = structuredClone(household)
    for (const attempted of [
      change(fresh, { componentVersion: null }),
      change(stored, { installed: true }),
      change(floorPlant, { slotId: 'kitchen-windowsill' }),
    ]) {
      zoneConflict(() => applyRoomComponentPatch(household, {
        roomId: 'kitchen', changes: [change(coffee, { name: 'Should not save' }), attempted],
      }, now))
      assert.deepEqual(household, before)
    }
    const paper = getRoomComponents(household).find((component) => component.kind === 'paper-towel-holder')!
    zoneConflict(() => applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(paper, { slotId: 'kitchen-dish-rack' })] }, now))
    assert.deepEqual(household, before)
  })

  it('evaluates full-cap store-and-place swaps against the final patch in either order', () => {
    for (const reverse of [false, true]) {
      const household = home(atCounterCap())
      const coffee = getRoomComponents(household).find((component) => component.kind === 'coffee-machine')!
      const replacement = make('air-fryer', 'kitchen-coffee')
      const changes = [change(replacement, { componentVersion: null }), change(coffee, { installed: false, linkedChores: 'pause' })]
      applyRoomComponentPatch(household, { roomId: 'kitchen', changes: reverse ? changes.toReversed() : changes }, now)
      assert.equal(roomZoneUsage(getRoomComponents(household), 'kitchen').find((zone) => zone.surface === 'counter')?.used, 6)
      assert.equal(getRoomComponents(household).find((component) => component.id === coffee.id)?.installed, false)
      assert.equal(getRoomComponents(household).filter((component) => component.installed && component.slotId === coffee.slotId).length, 1)
      assert.doesNotThrow(() => householdSchema.parse(household))
    }
  })

  it('does not count moves within a full zone twice and supports two occupied-position swaps', () => {
    const household = home(atCounterCap())
    const coffee = getRoomComponents(household).find((component) => component.kind === 'coffee-machine')!
    const microwave = getRoomComponents(household).find((component) => component.kind === 'microwave')!
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [
      change(coffee, { slotId: microwave.slotId }), change(microwave, { slotId: coffee.slotId }),
    ] }, now)
    const paper = getRoomComponents(household).find((component) => component.kind === 'paper-towel-holder')!
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(paper, { slotId: 'kitchen-dish-rack' })] }, now)
    assert.equal(roomZoneUsage(getRoomComponents(household), 'kitchen').find((zone) => zone.surface === 'counter')?.used, 6)
    assert.equal(getRoomComponents(household).find((component) => component.id === coffee.id)?.slotId, microwave.slotId)
    assert.equal(getRoomComponents(household).find((component) => component.id === microwave.id)?.slotId, coffee.slotId)
  })

  it('supports moves across full zones atomically and moves out of a still-over-cap source zone', () => {
    const household = home([
      ...defaultRoomComponents(), make('vacuum', 'kitchen-vacuum'), make('pet-bowls', 'kitchen-pet-bowls'),
      make('plant', 'kitchen-table-center'),
    ])
    const floorPlant = getRoomComponents(household).find((component) => component.slotId === 'kitchen-plant-floor')!
    const tablePlant = getRoomComponents(household).find((component) => component.slotId === 'kitchen-table-center')!
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [
      change(floorPlant, { slotId: tablePlant.slotId }), change(tablePlant, { slotId: floorPlant.slotId }),
    ] }, now)
    assert.equal(roomZoneUsage(getRoomComponents(household), 'kitchen').find((zone) => zone.surface === 'floor')?.used, 4)
    assert.equal(roomZoneUsage(getRoomComponents(household), 'kitchen').find((zone) => zone.surface === 'table')?.used, 1)
    const tea = make('tea-set', 'kitchen-tea-set')
    const overCap = home([...atCounterCap(), make('water-filter', 'kitchen-water-filter'), tea])
    applyRoomComponentPatch(overCap, { roomId: 'kitchen', changes: [change(tea, { slotId: 'kitchen-table-center' })] }, now)
    assert.equal(roomZoneUsage(getRoomComponents(overCap), 'kitchen').find((zone) => zone.surface === 'counter')?.used, 7)
    assert.equal(roomZoneUsage(getRoomComponents(overCap), 'kitchen').find((zone) => zone.surface === 'table')?.used, 1)
  })

  it('requires enough room even for a replacement in an over-cap zone', () => {
    const household = home([...atCounterCap(), make('water-filter', 'kitchen-water-filter')])
    const coffee = getRoomComponents(household).find((component) => component.kind === 'coffee-machine')!
    const microwave = getRoomComponents(household).find((component) => component.kind === 'microwave')!
    const replacement = make('air-fryer', coffee.slotId)
    const swap = [change(replacement, { componentVersion: null }), change(coffee, { installed: false, linkedChores: 'pause' })]
    const before = structuredClone(household)
    zoneConflict(() => applyRoomComponentPatch(household, { roomId: 'kitchen', changes: swap }, now))
    assert.deepEqual(household, before)
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [...swap, change(microwave, { installed: false, linkedChores: 'pause' })] }, now)
    assert.equal(roomZoneUsage(getRoomComponents(household), 'kitchen').find((zone) => zone.surface === 'counter')?.used, 6)
  })

  it('restores the same owned record once space is available and retains object-version conflicts', () => {
    const stored = { ...make('tea-set', 'kitchen-tea-set'), installed: false, name: 'Our tea tray', finish: 'sage' as const, version: 4 }
    const household = home([...atCounterCap(), stored])
    const before = structuredClone(household)
    zoneConflict(() => applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(stored, { installed: true })] }, now))
    assert.deepEqual(household, before)
    const toaster = getRoomComponents(household).find((component) => component.kind === 'toaster')!
    const swap = [change(stored, { installed: true }), change(toaster, { installed: false, linkedChores: 'pause' })]
    assert.throws(() => applyRoomComponentPatch(household, {
      roomId: 'kitchen', changes: [swap[0], { ...swap[1], componentVersion: 99 }],
    }, now), (error) => error instanceof RoomComponentError && error.status === 409 && /changed/.test(error.message))
    assert.deepEqual(household, before)
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: swap }, now)
    assert.deepEqual(getRoomComponents(household).find((component) => component.id === stored.id), { ...stored, installed: true, version: 5 })
    assert.equal(getRoomComponents(household).filter((component) => component.id === stored.id).length, 1)
  })
})
