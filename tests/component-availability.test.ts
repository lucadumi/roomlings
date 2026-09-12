import assert from 'node:assert/strict'
import { test } from 'node:test'
import { availableComponentSlots, componentIsRetired, createRoomComponent, defaultRoomComponents } from '../shared/roomComponents.ts'
import { componentAvailability, componentPlacementReason, groupedRoomComponents, preferredComponentSlot } from '../src/componentAvailability.ts'

test('bathroom additions prefer dedicated positions over the first generic corner', () => {
  const components = defaultRoomComponents()
  for (const [kind, slotId] of [
    ['first-aid-kit', 'bathroom-first-aid'],
    ['tissue-box', 'bathroom-tissue-box'],
    ['hair-dryer', 'bathroom-hair-dryer'],
    ['storage-jars', 'bathroom-storage-jars'],
    ['reed-diffuser', 'bathroom-diffuser'],
    ['bathroom-stool', 'bathroom-stool'],
    ['ironing-board', 'bathroom-ironing-board'],
    ['air-purifier', 'bathroom-air-purifier'],
    ['vacuum', 'bathroom-vacuum'],
    ['dryer', 'bathroom-dryer'],
    ['soap-dispenser', 'bathroom-soap-dispenser'],
  ] as const) {
    const available = availableComponentSlots(components, 'bathroom', kind)
    const before = [...available]
    assert.equal(preferredComponentSlot(kind, available, components)?.id, componentIsRetired(kind) ? undefined : slotId, kind)
    assert.deepEqual(available, before)
  }
})

test('occupied dedicated positions fall back to another supported location', () => {
  const placed = createRoomComponent('soap-dispenser', 'bathroom-soap-dispenser', 'placed-soap')
  const components = [...defaultRoomComponents(), placed]
  const available = availableComponentSlots(components, 'bathroom', placed.kind)
  assert.equal(preferredComponentSlot(placed.kind, available, components)?.id, 'bathroom-vanity-accessory')
})

test('retired bathroom accessories never offer a new or restored position', () => {
  for (const kind of ['tissue-box', 'first-aid-kit', 'toothbrush-holder'] as const) {
    const archived = { ...createRoomComponent(kind, 'bathroom-vanity-accessory', `stored-${kind}`), installed: false }
    const components = [...defaultRoomComponents(), archived]
    const available = availableComponentSlots(components, 'bathroom', kind)
    assert.deepEqual(available, [])
    assert.equal(preferredComponentSlot(kind, available, components, archived.id), undefined)
    assert.equal(componentAvailability(kind, 'bathroom', components, components, { storedComponentId: archived.id }).position, undefined)
  }
})

test('restoration keeps an archived object in its existing spot ahead of a free dedicated position', () => {
  const archived = { ...createRoomComponent('soap-dispenser', 'bathroom-vanity-accessory', 'saved-soap'), installed: false, finish: 'berry' as const }
  const components = [...defaultRoomComponents(), archived]
  const before = structuredClone(components)
  const available = availableComponentSlots(components, 'bathroom', archived.kind)
  assert.equal(preferredComponentSlot(archived.kind, available, components)?.id, archived.slotId)
  assert.deepEqual(components, before)
})

test('unavailable placements have no preferred location', () => {
  const components = defaultRoomComponents().map((component) => component.slotId === 'bathroom-bath'
    ? { ...component, variant: 'shower' } : component)
  const available = availableComponentSlots(components, 'bathroom', 'bath-tray')
  assert.equal(preferredComponentSlot('bath-tray', available, components), undefined)
})

test('zone availability selects an actual matching instance instead of creating catalog duplicates', () => {
  const components = defaultRoomComponents()
  const selected = components.find((component) => component.slotId === 'kitchen-plant-counter')!
  const availability = componentAvailability('plant', 'kitchen', components, components, { surface: 'counter', selectedComponentId: selected.id })
  assert.equal(availability.instance?.id, selected.id)
  assert.equal(availability.placed, 2)
  assert.equal(availability.positions.some((slot) => slot.id === 'kitchen-plant-floor'), false)
  assert.equal(groupedRoomComponents(components, { roomId: 'kitchen', installed: true, surface: 'counter' })
    .find((group) => group.kind === 'plant')?.items.length, 1)
})

test('Bring back preferences belong to the chosen stored ID rather than another copy', () => {
  const first = { ...createRoomComponent('soap-dispenser', 'bathroom-soap-dispenser', 'stored-first'), installed: false }
  const chosen = { ...createRoomComponent('soap-dispenser', 'bathroom-vanity-accessory', 'stored-chosen'), installed: false }
  const components = [...defaultRoomComponents(), first, chosen]
  const available = availableComponentSlots(components, 'bathroom', chosen.kind)
  assert.equal(preferredComponentSlot(chosen.kind, available, components, chosen.id)?.id, chosen.slotId)
  const state = componentAvailability(chosen.kind, 'bathroom', components, components, { storedComponentId: chosen.id })
  assert.equal(state.stored?.id, chosen.id)
  assert.equal(state.position?.id, chosen.slotId)
})

test('ordinary full zones still allow same-zone moves, but explain blocked new placements', () => {
  const components = [
    ...defaultRoomComponents(),
    createRoomComponent('coffee-machine', 'kitchen-coffee', 'coffee'),
    createRoomComponent('toaster', 'kitchen-toaster', 'toaster'),
    createRoomComponent('blender', 'kitchen-blender', 'blender'),
    createRoomComponent('rice-cooker', 'kitchen-rice-cooker', 'rice'),
    createRoomComponent('stand-mixer', 'kitchen-stand-mixer', 'mixer'),
  ]
  const plant = components.find((component) => component.slotId === 'kitchen-plant-counter')!
  const move = componentAvailability('plant', 'kitchen', components, components, { surface: 'counter', movingComponentId: plant.id })
  assert.equal(move.available.some((slot) => slot.id === 'kitchen-windowsill'), true)
  const addition = componentAvailability('air-fryer', 'kitchen', components, components, { surface: 'counter' })
  assert.equal(addition.free, 0)
  assert.match(addition.reason!, /Counter 6 of 6.*Make room first/)
  assert.equal(componentPlacementReason(components, 'kitchen', 'plant', 'kitchen-windowsill', plant.id), null)
})

test('a Storage choice is not replaced by the catalog focus instance', () => {
  const displayed = createRoomComponent('soap-dispenser', 'bathroom-soap-dispenser', 'displayed-soap')
  const chosen = { ...createRoomComponent('soap-dispenser', 'bathroom-vanity-accessory', 'stored-soap'), installed: false }
  const components = [...defaultRoomComponents(), displayed, chosen]
  const availability = componentAvailability(chosen.kind, 'bathroom', components, components, {
    selectedComponentId: displayed.id, storedComponentId: chosen.id,
  })
  assert.equal(availability.instance?.id, displayed.id)
  assert.equal(availability.stored?.id, chosen.id)
  assert.equal(availability.position?.id, chosen.slotId)
})

test('occupied placement feedback names the blocker without repeating the zone or swap instructions', () => {
  const fruit = createRoomComponent('fruit-bowl', 'kitchen-table-center', 'table-fruit')
  const components = [...defaultRoomComponents(), fruit]
  const before = structuredClone(components)
  assert.equal(componentPlacementReason(components, 'kitchen', 'tea-set', fruit.slotId), 'Occupied by Fruit bowl.')
  assert.equal(componentPlacementReason(components, 'kitchen', fruit.kind, fruit.slotId, fruit.id), null)
  assert.equal(availableComponentSlots(components, 'kitchen', 'tea-set').some((slot) => slot.id === fruit.slotId), false)
  assert.deepEqual(components, before)
})
