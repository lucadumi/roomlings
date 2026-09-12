import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { balances, choreInputSchema, householdSchema } from '../shared/domain.ts'
import type { Chore, Household } from '../shared/domain.ts'
import { completeChore } from '../shared/chores.ts'
import {
  applyRoomComponentPatch, choreComponentFields, RoomComponentError, setRoomComponentState,
} from '../shared/componentChanges.ts'
import {
  availableComponentSlots, componentAllowedInRoom, componentCatalog, componentChoreArea, componentChoreIsPaused, componentChoreMatches, componentIsRetired, componentKinds, componentPositionOffered, createRoomComponent, defaultRoomComponents,
  getRoomComponents, retiredComponentKinds, roomComponentSchema, roomComponentsPatchSchema, roomSlots, suggestedComponentSupplies, validateRoomComponents,
} from '../shared/roomComponents.ts'
import type { RoomComponent, RoomComponentChange } from '../shared/roomComponents.ts'

const now = '2026-09-08T20:00:00.000Z'
function home(): Household {
  const memberId = randomUUID()
  return householdSchema.parse({
    id: randomUUID(), name: 'A modular home', currency: 'EUR', budget: 45000, inviteCode: 'existing-invitation', version: 0,
    members: [{ id: memberId, name: 'Ada', color: '#8da48a' }], expenses: [], settlements: [],
  })
}
function change(component: RoomComponent, overrides: Partial<RoomComponentChange> = {}): RoomComponentChange {
  const { state: _state, stateChangedAt: _at, stateChangedBy: _by, version, ...configuration } = component
  return { ...configuration, componentVersion: version, ...overrides }
}
function dishwasher(household: Household): RoomComponent {
  const component = createRoomComponent('dishwasher', 'kitchen-undercounter', randomUUID())
  applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(component, { componentVersion: null })] }, now)
  household.version++
  return component
}
function linkedChore(household: Household, component: RoomComponent): Chore {
  return {
    id: randomUUID(), title: 'Empty the dishwasher', notes: '', roomId: component.roomId, area: null,
    componentId: component.id, componentName: component.name, dueDate: '2026-09-08', repeatDays: 1,
    rotation: [household.members[0].id], turn: 0, createdBy: household.members[0].id,
    createdAt: now, updatedAt: now, version: 0, occurrence: 0, archived: false,
  }
}
const throwsStatus = (operation: () => unknown, status: number) =>
  assert.throws(operation, (error) => error instanceof RoomComponentError && error.status === status)

describe('reversible component storage', () => {
  it('pauses linked care without changing the object configuration, schedule, supplies, shopping or history', () => {
    const household = home()
    const coffee = createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID())
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(coffee, {
      componentVersion: null, name: 'Our morning coffee', variant: 'capsule', finish: 'sage',
      supplies: [{ id: 'our-capsules', name: 'Our coffee capsules', quantity: '3 boxes' }],
    })] }, now)
    setRoomComponentState(household, coffee.id, { componentVersion: 0, state: 'needs-cleaning' }, household.members[0].id, now)
    const configured = getRoomComponents(household).find((component) => component.id === coffee.id)!
    const result = completeChore({ ...linkedChore(household, configured), title: 'Clean the coffee machine' },
      household.members, household.members[0].id, randomUUID(), now, '2026-09-08')
    household.chores.items = [result.chore]
    household.chores.history = [result.completion]
    household.shopping.items.push({
      id: randomUUID(), name: 'Our coffee capsules', quantity: '3 boxes', notes: 'Keep the existing order',
      createdBy: household.members[0].id, createdAt: now, updatedAt: now, version: 2,
      claimedBy: household.members[0].id, pickedUp: true,
      componentSources: [{ componentId: configured.id, componentName: configured.name, roomId: configured.roomId, supplyId: 'our-capsules' }],
    })
    const before = structuredClone(household)
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(configured, { installed: false, linkedChores: 'pause' })] }, now)
    const stored = getRoomComponents(household).find((component) => component.id === coffee.id)!
    assert.deepEqual(stored, { ...configured, installed: false, version: configured.version + 1 })
    assert.equal(componentChoreIsPaused(household.chores.items[0], getRoomComponents(household)), true)
    assert.deepEqual(household.chores, before.chores)
    assert.deepEqual(household.shopping, before.shopping)
    assert.deepEqual(householdSchema.parse(JSON.parse(JSON.stringify(household))), household)
    throwsStatus(() => choreComponentFields(household, household.chores.items[0]), 409)
    throwsStatus(() => setRoomComponentState(household, stored.id, { componentVersion: stored.version, state: 'ready' }, household.members[0].id, now), 409)

    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(stored, { installed: true })] }, now)
    assert.deepEqual(getRoomComponents(household).find((component) => component.id === coffee.id), { ...configured, version: configured.version + 2 })
    assert.equal(componentChoreIsPaused(household.chores.items[0], getRoomComponents(household)), false)
    assert.equal(getRoomComponents(household).filter((component) => component.id === coffee.id).length, 1)
    for (const key of ['chores', 'shopping', 'expenses', 'settlements', 'members'] as const) assert.deepEqual(household[key], before[key])
  })

  it('never turns a generic room chore into an object link or pauses unrelated care', () => {
    const household = home()
    const rug = getRoomComponents(household).find((component) => component.slotId === 'living-room-rug')!
    const explicit = { ...linkedChore(household, rug), title: 'Wash this rug', area: 'floor' as const }
    const generic = { ...linkedChore(household, rug), title: 'Clean the room floor', area: 'floor' as const, componentId: null, componentName: undefined }
    household.chores.items = [explicit, generic]
    const before = structuredClone(household.chores)
    assert.equal(componentChoreMatches(generic, rug), true)
    applyRoomComponentPatch(household, { roomId: 'living-room', changes: [change(rug, { installed: false, linkedChores: 'pause' })] }, now)
    const components = getRoomComponents(household)
    assert.deepEqual(household.chores, before)
    assert.equal(componentChoreIsPaused(explicit, components), true)
    assert.equal(componentChoreIsPaused(generic, components), false)
    assert.equal(componentChoreIsPaused({ ...generic, componentId: undefined }, components), false)
    assert.equal(componentChoreIsPaused({ ...explicit, archived: true }, components), false)
    assert.equal(componentChoreIsPaused({ ...explicit, componentId: 'unknown-object' }, components), false)
    assert.doesNotThrow(() => householdSchema.parse(household))
  })

  it('keeps retired stored objects and their links readable without allowing restoration', () => {
    const household = home()
    const speaker = createRoomComponent('speaker', 'kitchen-speaker', randomUUID())
    household.roomComponents = [...defaultRoomComponents(), speaker]
    household.chores.items = [linkedChore(household, speaker)]
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(speaker, { installed: false, linkedChores: 'pause' })] }, now)
    const stored = getRoomComponents(household).find((component) => component.id === speaker.id)!
    const before = structuredClone(household)
    throwsStatus(() => applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(stored, { installed: true })] }, now), 400)
    assert.deepEqual(household, before)
    assert.equal(componentChoreIsPaused(household.chores.items[0], getRoomComponents(household)), true)
    assert.deepEqual(householdSchema.parse(JSON.parse(JSON.stringify(household))), household)
  })

  it('does not use storage to bypass required fixtures or create unsaved history records', () => {
    const household = home()
    const fitted = getRoomComponents(household).find((component) => component.slotId === 'kitchen-table')!
    const before = structuredClone(household)
    assert.equal(roomComponentsPatchSchema.safeParse({
      roomId: 'kitchen', changes: [change(fitted, { installed: false, linkedChores: 'pause' })],
    }).success, false)
    const fresh = createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID())
    throwsStatus(() => applyRoomComponentPatch(household, {
      roomId: 'kitchen', changes: [change(fresh, { installed: false, componentVersion: null, linkedChores: 'pause' })],
    }, now), 400)
    assert.deepEqual(household, before)
  })
})

describe('room component catalog and legacy defaults', () => {
  it('retires the approved extras without removing their historical kinds or positions', () => {
    assert.equal(retiredComponentKinds.length, 31)
    assert.equal(new Set(retiredComponentKinds).size, 31)
    assert.equal(componentKinds.length, 86)
    assert.equal(componentKinds.filter((kind) => !componentIsRetired(kind)).length, 55)
    assert.ok(defaultRoomComponents().every((component) => !componentIsRetired(component.kind)))
    assert.equal(componentIsRetired('wall-art'), false)
    for (const roomId of ['kitchen', 'bathroom', 'living-room'] as const) {
      assert.equal(componentAllowedInRoom('wall-art', roomId), true)
      for (const kind of retiredComponentKinds) {
        assert.equal(componentAllowedInRoom(kind, roomId), false)
        assert.deepEqual(availableComponentSlots(defaultRoomComponents(), roomId, kind), [])
      }
    }
    for (const kind of retiredComponentKinds) {
      const slot = roomSlots.find((slot) => slot.kinds.includes(kind))!
      assert.equal(roomComponentSchema.safeParse(createRoomComponent(kind, slot.id, randomUUID())).success, true)
    }
  })

  it('offers new spice racks only on walls and bins only in the kitchen or bathroom', () => {
    const components = defaultRoomComponents()
    assert.deepEqual(availableComponentSlots(components, 'kitchen', 'spice-rack').map((slot) => slot.id).sort(),
      ['kitchen-left-wall', 'kitchen-spice-rack', 'kitchen-wall-art'])
    assert.equal(componentPositionOffered('spice-rack', 'kitchen-dish-rack'), false)
    assert.equal(componentPositionOffered('dish-rack', 'kitchen-dish-rack'), true)
    assert.equal(componentAllowedInRoom('bins', 'living-room'), false)
    assert.deepEqual(availableComponentSlots(components, 'living-room', 'bins'), [])
    assert.equal(components.some((component) => component.slotId === 'living-room-bins'), false)
    for (const roomId of ['kitchen', 'bathroom'] as const) {
      assert.equal(componentAllowedInRoom('bins', roomId), true)
      assert.ok(availableComponentSlots(components, roomId, 'bins').length > 0)
    }
  })

  it('offers cooking objects only in kitchens and new laundry objects only in bathrooms', () => {
    const components = defaultRoomComponents()
    for (const kind of ['washing-machine', 'dryer'] as const) {
      assert.equal(componentAllowedInRoom(kind, 'kitchen'), false)
      assert.equal(componentAllowedInRoom(kind, 'bathroom'), true)
      assert.deepEqual(availableComponentSlots(components, 'kitchen', kind), [])
      assert.ok(availableComponentSlots(components, 'bathroom', kind).length > 0)
    }
    assert.equal(componentAllowedInRoom('coffee-machine', 'bathroom'), false)
    assert.equal(componentAllowedInRoom('toilet', 'kitchen'), false)
    assert.equal(componentAllowedInRoom('plant', 'kitchen'), true)
    assert.equal(componentAllowedInRoom('plant', 'bathroom'), true)
  })

  it('keeps current and retired catalog records schema-valid at their registered positions', () => {
    assert.ok(componentKinds.length >= 80)
    assert.deepEqual(Object.keys(componentCatalog), [...componentKinds])
    for (const kind of componentKinds) {
      const slots = roomSlots.filter((slot) => slot.kinds.includes(kind))
      assert.ok(slots.length, `${kind} needs a designed position`)
      assert.ok(componentCatalog[kind].description)
      for (const slot of slots) {
        for (const variant of componentCatalog[kind].variants) {
          const component = createRoomComponent(kind, slot.id, randomUUID())
          assert.equal(roomComponentSchema.safeParse({ ...component, variant: variant.id }).success, true)
        }
      }
    }
  })

  it('resolves old households to independent stable defaults without rewriting their data', () => {
    const household = home()
    const before = structuredClone(household)
    const first = getRoomComponents(household)
    const second = defaultRoomComponents()
    assert.deepEqual(first, second)
    assert.equal(household.roomComponents, undefined)
    assert.deepEqual(household, before)
    assert.ok(first.every((component) => component.installed && component.finish === 'room'))
    assert.equal(first.some((component) => component.kind === 'dishwasher'), false)
    assert.equal(validateRoomComponents(first), null)
    first[0].name = 'A local draft'
    assert.equal(defaultRoomComponents()[0].name, 'Fridge')
    const sink = second.find((component) => component.slotId === 'bathroom-sink')!
    assert.deepEqual(sink.supplies.map((supply) => supply.name), ['Hand soap'])
  })

  it('validates model compatibility, supplies, fixed positions and required fixtures', () => {
    const component = createRoomComponent('dishwasher', 'kitchen-undercounter', randomUUID())
    for (const invalid of [
      { ...component, roomId: 'bathroom' },
      { ...component, slotId: 'kitchen-table' },
      { ...component, variant: 'unknown' },
      { ...component, finish: '#ffffff' },
      { ...component, supplies: [{ id: 'one', name: 'Soap', quantity: '1' }, { id: 'two', name: '\uff33\uff2f\uff21\uff30', quantity: '1' }] },
      { ...component, state: 'automatically-detected' },
    ]) assert.equal(roomComponentSchema.safeParse(invalid).success, false)
    const defaults = defaultRoomComponents()
    assert.equal(roomComponentSchema.safeParse({ ...defaults[0], installed: false }).success, false)
    assert.match(validateRoomComponents(defaults.filter((entry) => entry.id !== defaults[0].id))!, /fitted objects/)
    assert.match(validateRoomComponents([...defaults, component, { ...component, id: randomUUID() }])!, /same designed position/)
    assert.match(validateRoomComponents([...defaults, defaults[0]])!, /distinct identifiers/)
  })

  it('adds the living room to saved two-room layouts once without resetting any object', () => {
    const household = home()
    const oldComponents = defaultRoomComponents().filter((component) => component.roomId !== 'living-room')
      .map((component) => component.slotId === 'kitchen-plant-floor'
        ? { ...component, installed: false, name: 'Our old planter', version: 3, finish: 'tomato' as const }
        : component)
    const before = structuredClone(oldComponents)
    const restored = householdSchema.parse({ ...household, roomComponents: oldComponents })
    assert.deepEqual(oldComponents, before)
    assert.deepEqual(restored.roomComponents?.filter((component) => component.roomId !== 'living-room'), before)
    assert.deepEqual(restored.roomComponents?.filter((component) => component.roomId === 'living-room'),
      defaultRoomComponents().filter((component) => component.roomId === 'living-room'))
    assert.equal(restored.version, household.version)
    assert.deepEqual(balances(restored), balances(household))
    const television = getRoomComponents(restored).find((component) => component.kind === 'tv')!
    applyRoomComponentPatch(restored, { roomId: 'living-room', changes: [change(television, { installed: false, name: 'Our screen' })] }, now)
    const reloaded = householdSchema.parse(JSON.parse(JSON.stringify(restored)))
    assert.deepEqual(reloaded, restored)
    assert.equal(getRoomComponents(reloaded).find((component) => component.id === television.id)?.installed, false)
    assert.equal(getRoomComponents(reloaded).filter((component) => component.kind === 'tv').length, 1)
  })

  it('keeps layouts at the former saved-object limit readable when adding the new defaults', () => {
    const components = defaultRoomComponents().filter((component) => component.roomId !== 'living-room')
    while (components.length < 120) {
      components.push({ ...createRoomComponent('plant', 'kitchen-plant-floor', randomUUID()), installed: false })
    }
    const restored = householdSchema.parse({ ...home(), roomComponents: components })
    assert.equal(restored.roomComponents?.length, 120 + defaultRoomComponents().filter((component) => component.roomId === 'living-room').length)
    assert.deepEqual(restored.roomComponents?.slice(0, 120), components)
  })

  it('links living room care and supplies to the right areas without changing other rooms', () => {
    const household = home()
    for (const kind of ['sofa', 'coffee-table', 'tv', 'media-unit', 'bookshelf', 'floor-lamp', 'plant', 'rug', 'bins'] as const) {
      const slot = roomSlots.find((slot) => slot.roomId === 'living-room' && slot.kinds.includes(kind))!
      const component = createRoomComponent(kind, slot.id, `default-${slot.id}`)
      const area = componentChoreArea(component)
      assert.ok(area)
      assert.equal(choreInputSchema.safeParse({
        title: 'Living room care', roomId: 'living-room', area, componentId: component.id,
        dueDate: '2026-09-08', repeatDays: 7, rotation: [household.members[0].id],
      }).success, true)
      assert.equal(componentChoreMatches({ roomId: 'living-room', area }, component), true)
      assert.equal(componentChoreMatches({ roomId: 'bathroom', area }, component), false)
    }
    assert.equal(componentChoreArea({ kind: 'plant', roomId: 'kitchen' }), null)
    assert.deepEqual(suggestedComponentSupplies({ kind: 'supply-shelf', roomId: 'living-room', variant: 'original' }).map((supply) => supply.name),
      ['Floor cleaner', 'Dusting cloths', 'Rubbish bags'])
    assert.equal(choreInputSchema.safeParse({
      title: 'Wrong room area', roomId: 'living-room', area: 'toilet',
      dueDate: '2026-09-08', repeatDays: 7, rotation: [household.members[0].id],
    }).success, false)
  })

  it('keeps room filters and legacy fixture chores compatible with object identities', () => {
    const sink = defaultRoomComponents().find((component) => component.slotId === 'kitchen-sink')!
    assert.equal(componentChoreMatches({ roomId: 'kitchen', area: 'sink' }, sink), true)
    assert.equal(componentChoreMatches({ roomId: 'bathroom', area: 'sink' }, sink), false)
    assert.equal(componentChoreMatches({ roomId: 'kitchen', area: null }, sink), false)
    assert.equal(componentChoreMatches({ roomId: 'kitchen', area: 'sink', componentId: 'other' }, sink), false)
  })

  it('offers supplies appropriate to the chosen appliance model without overwriting a custom list', () => {
    const coffee = createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID())
    const original = structuredClone(coffee)
    assert.deepEqual(suggestedComponentSupplies({ ...coffee, variant: 'capsule' }).map((supply) => supply.name), ['Coffee capsules', 'Descaler'])
    assert.deepEqual(suggestedComponentSupplies({ ...coffee, variant: 'filter' }).map((supply) => supply.name), ['Ground coffee', 'Coffee filters', 'Descaler'])
    assert.deepEqual(coffee, original)
  })
})

describe('room component changes', () => {
  it('preserves a saved countertop spice rack but restricts new, moved and restored placements to walls', () => {
    const household = home()
    const legacy = createRoomComponent('spice-rack', 'kitchen-dish-rack', randomUUID())
    household.roomComponents = [...defaultRoomComponents(), legacy]
    const chore = linkedChore(household, legacy)
    household.chores.items.push(chore)
    const original = structuredClone(household)
    const fresh = createRoomComponent('spice-rack', 'kitchen-dish-rack', randomUUID())
    throwsStatus(() => applyRoomComponentPatch(household, {
      roomId: 'kitchen', changes: [change(fresh, { componentVersion: null })],
    }, now), 400)
    assert.deepEqual(household, original)
    applyRoomComponentPatch(household, {
      roomId: 'kitchen', changes: [change(legacy, { name: 'Our seasonings', finish: 'sage' })],
    }, now)
    const edited = getRoomComponents(household).find((component) => component.id === legacy.id)!
    assert.equal(edited.slotId, 'kitchen-dish-rack')
    assert.deepEqual(householdSchema.parse(JSON.parse(JSON.stringify(household))), household)
    applyRoomComponentPatch(household, {
      roomId: 'kitchen', changes: [change(edited, { slotId: 'kitchen-spice-rack' })],
    }, now)
    const moved = getRoomComponents(household).find((component) => component.id === legacy.id)!
    assert.equal(moved.slotId, 'kitchen-spice-rack')
    assert.equal(moved.name, 'Our seasonings')
    assert.deepEqual(household.chores.items, [chore])
    throwsStatus(() => applyRoomComponentPatch(household, {
      roomId: 'kitchen', changes: [change(moved, { slotId: 'kitchen-dish-rack' })],
    }, now), 400)
    applyRoomComponentPatch(household, {
      roomId: 'kitchen', changes: [change(moved, { installed: false, linkedChores: 'keep' })],
    }, now)
    const removed = getRoomComponents(household).find((component) => component.id === legacy.id)!
    throwsStatus(() => applyRoomComponentPatch(household, {
      roomId: 'kitchen', changes: [change(removed, { installed: true, slotId: 'kitchen-dish-rack' })],
    }, now), 400)
    applyRoomComponentPatch(household, {
      roomId: 'kitchen', changes: [change(removed, { installed: true, slotId: 'kitchen-left-wall' })],
    }, now)
    assert.equal(getRoomComponents(household).find((component) => component.id === legacy.id)?.slotId, 'kitchen-left-wall')
    for (const key of ['expenses', 'settlements', 'shopping', 'members'] as const) assert.deepEqual(household[key], original[key])
  })

  it('keeps a legacy living-room bin and its care editable without offering another or restoring it', () => {
    const household = home()
    const legacy = createRoomComponent('bins', 'living-room-bins', randomUUID())
    household.roomComponents = [...defaultRoomComponents(), legacy]
    const chore = linkedChore(household, legacy)
    household.chores.items.push(chore)
    assert.deepEqual(householdSchema.parse(JSON.parse(JSON.stringify(household))), household)
    const original = structuredClone(household)
    throwsStatus(() => applyRoomComponentPatch(household, {
      roomId: 'living-room', changes: [change({ ...legacy, id: randomUUID() }, { componentVersion: null })],
    }, now), 400)
    assert.deepEqual(household, original)
    applyRoomComponentPatch(household, {
      roomId: 'living-room', changes: [change(legacy, { name: 'Our saved bin' })],
    }, now)
    const edited = getRoomComponents(household).find((component) => component.id === legacy.id)!
    assert.equal(edited.installed, true)
    assert.deepEqual(household.chores.items, [chore])
    applyRoomComponentPatch(household, {
      roomId: 'living-room', changes: [change(edited, { installed: false, linkedChores: 'keep' })],
    }, now)
    const removed = getRoomComponents(household).find((component) => component.id === legacy.id)!
    throwsStatus(() => applyRoomComponentPatch(household, {
      roomId: 'living-room', changes: [change(removed, { installed: true })],
    }, now), 400)
    assert.equal(household.chores.items[0].componentId, null)
    assert.equal(household.chores.items[0].archived, false)
    for (const key of ['expenses', 'settlements', 'shopping', 'members'] as const) assert.deepEqual(household[key], original[key])
  })

  it('keeps retired objects editable and their linked care intact while rejecting new placements', () => {
    for (const kind of retiredComponentKinds) {
      const household = home()
      const slot = roomSlots.find((slot) => slot.kinds.includes(kind))!
      const legacy = createRoomComponent(kind, slot.id, randomUUID())
      household.roomComponents = [...defaultRoomComponents().filter((item) => item.slotId !== slot.id), legacy]
      const chore = linkedChore(household, legacy)
      household.chores.items.push(chore)
      const before = structuredClone(household)
      const fresh = { ...legacy, id: randomUUID() }
      assert.throws(() => applyRoomComponentPatch(household, {
        roomId: slot.roomId, changes: [change(fresh, { componentVersion: null })],
      }, now), (error) => error instanceof RoomComponentError && error.status === 400 && /no longer offered/.test(error.message))
      assert.deepEqual(household, before)
      applyRoomComponentPatch(household, {
        roomId: slot.roomId, changes: [change(legacy, { name: 'Our saved object', finish: 'tomato' })],
      }, now)
      const edited = getRoomComponents(household).find((item) => item.id === legacy.id)!
      assert.equal(edited.name, 'Our saved object')
      assert.equal(edited.finish, 'tomato')
      assert.equal(edited.installed, true)
      assert.deepEqual(household.chores.items, [chore])
      assert.deepEqual(householdSchema.parse(JSON.parse(JSON.stringify(household))), household)

      const otherSlot = roomSlots.find((position) => position.roomId === slot.roomId
        && position.id !== slot.id && position.kinds.includes(kind))
      if (otherSlot) throwsStatus(() => applyRoomComponentPatch(household, {
        roomId: slot.roomId, changes: [change(edited, { slotId: otherSlot.id })],
      }, now), 400)
      applyRoomComponentPatch(household, {
        roomId: slot.roomId, changes: [change(edited, { installed: false, linkedChores: 'keep' })],
      }, now)
      const removed = getRoomComponents(household).find((item) => item.id === legacy.id)!
      assert.equal(removed.installed, false)
      assert.equal(household.chores.items[0].componentId, null)
      assert.equal(household.chores.items[0].archived, false)
      throwsStatus(() => applyRoomComponentPatch(household, {
        roomId: slot.roomId, changes: [change(removed, { installed: true })],
      }, now), 400)
    }
  })

  it('preserves legacy kitchen laundry but rejects new, moved and restored kitchen laundry placements', () => {
    const household = home()
    const legacy = createRoomComponent('washing-machine', 'kitchen-washing-machine', randomUUID())
    household.roomComponents = [...defaultRoomComponents(), legacy]
    assert.doesNotThrow(() => householdSchema.parse(household))
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(legacy, { finish: 'teal', name: 'Our existing washer' })] }, now)
    const edited = getRoomComponents(household).find((component) => component.id === legacy.id)!
    assert.equal(edited.finish, 'teal')
    const before = structuredClone(household)
    throwsStatus(() => applyRoomComponentPatch(household, { roomId: 'kitchen',
      changes: [change(edited, { slotId: 'kitchen-undercounter' })],
    }, now), 400)
    const fresh = createRoomComponent('dryer', 'kitchen-dryer', randomUUID())
    throwsStatus(() => applyRoomComponentPatch(household, { roomId: 'kitchen',
      changes: [change(fresh, { componentVersion: null })],
    }, now), 400)
    assert.deepEqual(household, before)
    setRoomComponentState(household, edited.id, { componentVersion: edited.version, state: 'running' }, household.members[0].id, now)
    const running = getRoomComponents(household).find((component) => component.id === legacy.id)!
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(running, { installed: false })] }, now)
    const removed = getRoomComponents(household).find((component) => component.id === legacy.id)!
    assert.equal(removed.installed, false)
    assert.equal(removed.state, 'running')
    throwsStatus(() => applyRoomComponentPatch(household, { roomId: 'kitchen',
      changes: [change(removed, { installed: true })],
    }, now), 400)
    const bathroomWasher = createRoomComponent('washing-machine', 'bathroom-laundry', randomUUID())
    applyRoomComponentPatch(household, { roomId: 'bathroom',
      changes: [change(bathroomWasher, { componentVersion: null })],
    }, now)
    assert.equal(getRoomComponents(household).find((component) => component.id === bathroomWasher.id)?.installed, true)
    for (const key of ['expenses', 'settlements', 'shopping', 'chores', 'members'] as const) assert.deepEqual(household[key], before[key])
  })

  it('installs and customizes without making a shopping item, chore, expense or debt', () => {
    const household = home()
    const before = structuredClone(household)
    const component = dishwasher(household)
    assert.equal(getRoomComponents(household).find((entry) => entry.id === component.id)?.installed, true)
    assert.deepEqual(availableComponentSlots(getRoomComponents(household), 'kitchen', 'washing-machine'), [])
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(component, { name: 'Our dishwasher', finish: 'tomato', supplies: component.supplies.slice(0, 1) })] }, now)
    household.version++
    assert.deepEqual(household.shopping, before.shopping)
    assert.deepEqual(household.chores, before.chores)
    assert.deepEqual(household.expenses, before.expenses)
    assert.deepEqual(balances(household), balances(before))
    assert.doesNotThrow(() => householdSchema.parse(household))
  })

  it('rejects stale objects, cross-room changes, identity replacement and occupied slots atomically', () => {
    const household = home()
    const component = dishwasher(household)
    const before = structuredClone(household)
    throwsStatus(() => applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(component, { componentVersion: 9 })] }, now), 409)
    assert.equal(roomComponentsPatchSchema.safeParse({ roomId: 'bathroom', changes: [change(component)] }).success, false)
    throwsStatus(() => applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(component, { kind: 'washing-machine' })] }, now), 400)
    const competing = createRoomComponent('oven', 'kitchen-undercounter', randomUUID())
    throwsStatus(() => applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(competing, { componentVersion: null })] }, now), 409)
    assert.deepEqual(household, before)
  })

  it('requires an explicit connected-chore decision and preserves shopping and history on removal', () => {
    for (const linkedChores of ['archive', 'keep'] as const) {
      const household = home()
      const component = dishwasher(household)
      const chore = linkedChore(household, component)
      const completed = completeChore(chore, household.members, household.members[0].id, randomUUID(), now, '2026-09-08')
      household.chores.items = [completed.chore]
      household.chores.history = [completed.completion]
      const snapshot = structuredClone(household)
      throwsStatus(() => applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(component, { installed: false })] }, now), 400)
      assert.deepEqual(household, snapshot)
      applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(component, { installed: false, linkedChores })] }, now)
      household.version++
      assert.equal(household.chores.items[0].archived, linkedChores === 'archive')
      assert.equal(household.chores.items[0].componentId, linkedChores === 'archive' ? component.id : null)
      assert.deepEqual(household.chores.history, snapshot.chores.history)
      assert.deepEqual(household.shopping, snapshot.shopping)
      assert.equal(getRoomComponents(household).find((entry) => entry.id === component.id)?.installed, false)
      assert.doesNotThrow(() => householdSchema.parse(household))
    }
  })

  it('replaces one appliance with another in one atomic fixed-slot change and restores archived identities', () => {
    const household = home()
    const component = dishwasher(household)
    const replacement = createRoomComponent('oven', component.slotId, randomUUID())
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [
      change(component, { installed: false }), change(replacement, { componentVersion: null }),
    ] }, now)
    household.version++
    assert.equal(getRoomComponents(household).filter((entry) => entry.installed && entry.slotId === component.slotId).length, 1)
    const removed = getRoomComponents(household).find((entry) => entry.id === component.id)!
    const installed = getRoomComponents(household).find((entry) => entry.id === replacement.id)!
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(removed, { installed: true }), change(installed, { installed: false })] }, now)
    assert.equal(getRoomComponents(household).filter((entry) => entry.id === component.id).length, 1)
    assert.equal(getRoomComponents(household).find((entry) => entry.id === component.id)?.installed, true)
  })

  it('records manual states without completing chores, consuming stock or changing costs', () => {
    const household = home()
    const component = dishwasher(household)
    household.chores.items = [linkedChore(household, component)]
    const before = structuredClone(household)
    const memberId = household.members[0].id
    setRoomComponentState(household, component.id, { componentVersion: 0, state: 'running' }, memberId, now)
    household.version++
    const running = getRoomComponents(household).find((entry) => entry.id === component.id)!
    assert.equal(running.stateChangedBy, memberId)
    assert.equal(running.stateChangedAt, now)
    assert.equal(running.state, 'running')
    assert.equal(running.version, 1)
    assert.deepEqual(household.chores, before.chores)
    assert.deepEqual(household.shopping, before.shopping)
    assert.deepEqual(household.expenses, before.expenses)
    throwsStatus(() => setRoomComponentState(household, component.id, { componentVersion: 0, state: 'empty' }, memberId, now), 409)
    throwsStatus(() => setRoomComponentState(household, component.id, { componentVersion: 1, state: 'running' }, memberId, now), 409)
    throwsStatus(() => setRoomComponentState(household, component.id, { componentVersion: 1, state: 'paid' }, memberId, now), 400)
    setRoomComponentState(household, component.id, { componentVersion: 1, state: null }, memberId, now)
    assert.equal(getRoomComponents(household).find((entry) => entry.id === component.id)?.state, null)
  })

  it('preserves current manual state when applying a reviewed configuration edit', () => {
    const household = home()
    const component = dishwasher(household)
    setRoomComponentState(household, component.id, { componentVersion: 0, state: 'ready-to-empty' }, household.members[0].id, now)
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(component, { componentVersion: 1, name: 'Dish friend' })] }, now)
    const saved = getRoomComponents(household).find((entry) => entry.id === component.id)!
    assert.equal(saved.state, 'ready-to-empty')
    assert.equal(saved.name, 'Dish friend')
    assert.equal(saved.version, 2)
  })

  it('moves an object between compatible positions without replacing its identity or care history', () => {
    const household = home()
    const coffee = createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID())
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(coffee, { componentVersion: null })] }, now)
    household.version++
    const task = { ...linkedChore(household, coffee), title: 'Clean the coffee machine' }
    household.chores.items = [task]
    setRoomComponentState(household, coffee.id, { componentVersion: 0, state: 'ready' }, household.members[0].id, now)
    household.version++
    const before = structuredClone(household)
    const current = getRoomComponents(household).find((component) => component.id === coffee.id)!
    applyRoomComponentPatch(household, { roomId: 'kitchen', changes: [change(current, { slotId: 'kitchen-small-appliance' })] }, now)
    household.version++
    const moved = getRoomComponents(household).find((component) => component.id === coffee.id)!
    assert.equal(moved.slotId, 'kitchen-small-appliance')
    assert.equal(moved.state, 'ready')
    assert.deepEqual(moved.supplies, current.supplies)
    assert.deepEqual(household.chores, before.chores)
    assert.deepEqual(household.shopping, before.shopping)
    assert.equal(getRoomComponents(household).filter((component) => component.id === coffee.id).length, 1)
    assert.doesNotThrow(() => householdSchema.parse(household))
  })

  it('keeps incompatible dependent placements out of saved layouts without silently deleting them', () => {
    const household = home()
    const tray = createRoomComponent('bath-tray', 'bathroom-bath-tray', randomUUID())
    household.roomComponents = [...defaultRoomComponents(), tray]
    const bath = getRoomComponents(household).find((component) => component.slotId === 'bathroom-bath')!
    const before = structuredClone(household)
    throwsStatus(() => applyRoomComponentPatch(household, { roomId: 'bathroom', changes: [change(bath, { variant: 'shower' })] }, now), 409)
    assert.deepEqual(household, before)
    applyRoomComponentPatch(household, { roomId: 'bathroom', changes: [
      change(bath, { variant: 'shower' }), change(tray, { installed: false }),
    ] }, now)
    household.version++
    assert.doesNotThrow(() => householdSchema.parse(household))
    assert.equal(availableComponentSlots(getRoomComponents(household), 'bathroom', 'bath-tray').length, 0)
  })

  it('validates object links and keeps the recorded object name in chore completions', () => {
    const household = home()
    const component = dishwasher(household)
    const fields = choreComponentFields(household, { roomId: 'kitchen', area: null, componentId: component.id })
    assert.deepEqual(fields, { componentId: component.id, componentName: component.name })
    throwsStatus(() => choreComponentFields(household, { roomId: 'bathroom', area: null, componentId: component.id }), 400)
    throwsStatus(() => choreComponentFields(household, { roomId: 'kitchen', area: 'sink', componentId: component.id }), 400)
    const result = completeChore(linkedChore(household, component), household.members, household.members[0].id, randomUUID(), now, '2026-09-08')
    assert.equal(result.completion.componentId, component.id)
    assert.equal(result.completion.componentName, component.name)
    assert.equal(householdSchema.safeParse({ ...household, chores: { items: [{ ...result.chore, componentId: randomUUID() }], history: [] } }).success, false)
  })
})
