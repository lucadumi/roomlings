import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { balances, householdSchema } from '../shared/domain.ts'
import type { Chore, Household } from '../shared/domain.ts'
import { completeChore } from '../shared/chores.ts'
import {
  applyRoomComponentPatch, choreComponentFields, RoomComponentError, setRoomComponentState,
} from '../shared/componentChanges.ts'
import {
  availableComponentSlots, componentCatalog, componentChoreMatches, componentKinds, createRoomComponent, defaultRoomComponents,
  getRoomComponents, roomComponentSchema, roomComponentsPatchSchema, roomSlots, suggestedComponentSupplies, validateRoomComponents,
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

describe('room component catalog and legacy defaults', () => {
  it('gives every real catalog entry an allowed fixed position and useful supported settings', () => {
    assert.ok(componentKinds.length >= 35)
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
  it('installs and customizes without making a shopping item, chore, expense or debt', () => {
    const household = home()
    const before = structuredClone(household)
    const component = dishwasher(household)
    assert.equal(getRoomComponents(household).find((entry) => entry.id === component.id)?.installed, true)
    assert.equal(availableComponentSlots(getRoomComponents(household), 'kitchen', 'washing-machine').length, 0)
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
    const competing = createRoomComponent('washing-machine', 'kitchen-undercounter', randomUUID())
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
    const replacement = createRoomComponent('washing-machine', component.slotId, randomUUID())
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
    applyRoomComponentPatch(household, { roomId: 'bathroom', changes: [change(tray, { componentVersion: null })] }, now)
    household.version++
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
