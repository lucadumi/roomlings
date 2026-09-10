import assert from 'node:assert/strict'
import { test } from 'node:test'
import { availableComponentSlots, createRoomComponent, defaultRoomComponents } from '../shared/roomComponents.ts'
import { preferredComponentSlot } from '../src/componentAvailability.ts'

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
  ] as const) {
    const available = availableComponentSlots(components, 'bathroom', kind)
    const before = [...available]
    assert.equal(preferredComponentSlot(kind, available, components)?.id, slotId, kind)
    assert.deepEqual(available, before)
  }
})

test('occupied dedicated positions fall back to another supported location', () => {
  const placed = createRoomComponent('tissue-box', 'bathroom-tissue-box', 'placed-tissues')
  const components = [...defaultRoomComponents(), placed]
  const available = availableComponentSlots(components, 'bathroom', placed.kind)
  assert.equal(preferredComponentSlot(placed.kind, available, components)?.id, 'bathroom-vanity-accessory')
  assert.equal(preferredComponentSlot('toothbrush-holder',
    availableComponentSlots(components, 'bathroom', 'toothbrush-holder'), components)?.id, 'bathroom-vanity-accessory')
})

test('restoration keeps an archived object in its existing spot ahead of a free dedicated position', () => {
  const archived = { ...createRoomComponent('first-aid-kit', 'bathroom-vanity-accessory', 'saved-kit'), installed: false, finish: 'berry' as const }
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
