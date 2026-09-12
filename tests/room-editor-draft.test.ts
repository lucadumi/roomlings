import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createRoomComponent, defaultRoomComponents, roomComponentLimit } from '../shared/roomComponents.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import {
  inspectionRoomComponents, previewComponentDrafts, roomDraftPlacementReason,
  stageRoomComponent, stageRoomPlacement, storeRoomComponent,
} from '../src/roomEditorDraft.ts'

test('read-only inspection changes only the render array and restores an exact accepted draft', () => {
  const saved = defaultRoomComponents()
  const table = saved.find((component) => component.slotId === 'kitchen-table')!
  const drafts = stageRoomComponent(saved, {}, { ...table, name: 'Our breakfast table' })
  const accepted = previewComponentDrafts(saved, drafts)
  const snapshot = structuredClone({ saved, drafts, accepted })
  const kettle = accepted.find((component) => component.slotId === 'kitchen-kettle')!
  const candidate = { ...kettle, id: 'read-only-kettle', name: 'Trial kettle' }
  const rendered = inspectionRoomComponents(accepted, candidate)
  assert.equal(rendered.find((component) => component.id === kettle.id)?.installed, false)
  assert.equal(rendered.find((component) => component.id === candidate.id)?.installed, true)
  assert.deepEqual({ saved, drafts, accepted }, snapshot)
  assert.deepEqual(previewComponentDrafts(saved, drafts), accepted)
  assert.equal(Object.keys(drafts).length, 1)
})

test('repeated preview reads retain the candidate and unchanged accepted draft records', () => {
  const saved = defaultRoomComponents()
  const table = saved.find((component) => component.slotId === 'kitchen-table')!
  const drafts = stageRoomComponent(saved, {}, { ...table, name: 'Stable table draft' })
  const accepted = previewComponentDrafts(saved, drafts)
  const candidate = createRoomComponent('coffee-machine', 'kitchen-coffee', 'stable-read-only-candidate')
  const snapshot = structuredClone({ saved, drafts, accepted, candidate })
  for (let frame = 0; frame < 12; frame++) {
    const nextAccepted = previewComponentDrafts(saved, drafts)
    for (const component of accepted) {
      assert.equal(nextAccepted.find((next) => next.id === component.id), component)
    }
    const rendered = inspectionRoomComponents(nextAccepted, candidate)
    assert.equal(rendered.find((component) => component.id === candidate.id), candidate)
    assert.equal(rendered.find((component) => component.id === table.id), drafts[table.id].value)
    assert.deepEqual(rendered.map((component) => component.id), [...accepted.map((component) => component.id), candidate.id])
  }
  assert.deepEqual({ saved, drafts, accepted, candidate }, snapshot)
})

test('Storage keeps saved identity and configuration but discards draft-only trials', () => {
  const saved = defaultRoomComponents()
  const kettle = saved.find((component) => component.kind === 'kettle')!
  const configured = { ...kettle, name: 'Morning kettle', finish: 'berry' as const, supplies: [{ id: 'descaler', name: 'Descaler', quantity: '2 packs' }] }
  let drafts = stageRoomComponent(saved, {}, configured)
  drafts = storeRoomComponent(saved, drafts, configured)
  assert.deepEqual(drafts[kettle.id], { base: kettle, value: { ...configured, installed: false }, linkedChores: 'pause' })
  const trial = createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID())
  drafts = stageRoomPlacement(saved, drafts, trial)
  drafts = storeRoomComponent(saved, drafts, trial)
  assert.equal(drafts[trial.id], undefined)
  assert.equal(previewComponentDrafts(saved, drafts).some((component) => component.id === trial.id), false)
  assert.equal(previewComponentDrafts(saved, drafts).length, saved.length)
  assert.throws(() => storeRoomComponent(saved, drafts, saved.find((component) => component.kind === 'fridge')!), /stays in the room/)
})

test('an explicit swap at capacity stores only the selected objects in one draft', () => {
  const saved = [
    ...defaultRoomComponents(),
    createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID()),
    createRoomComponent('toaster', 'kitchen-toaster', randomUUID()),
    createRoomComponent('blender', 'kitchen-blender', randomUUID()),
    createRoomComponent('rice-cooker', 'kitchen-rice-cooker', randomUUID()),
    createRoomComponent('stand-mixer', 'kitchen-stand-mixer', randomUUID()),
  ]
  const candidate = createRoomComponent('air-fryer', 'kitchen-air-fryer', randomUUID())
  assert.throws(() => stageRoomPlacement(saved, {}, candidate), /Make room first/)
  const coffee = saved.find((component) => component.kind === 'coffee-machine')!
  const drafts = stageRoomPlacement(saved, {}, candidate, [coffee.id])
  assert.equal(Object.keys(drafts).length, 2)
  assert.equal(drafts[coffee.id].linkedChores, 'pause')
  assert.equal(drafts[coffee.id].value.installed, false)
  assert.equal(drafts[candidate.id].value.installed, true)
  assert.equal(roomDraftPlacementReason(saved, previewComponentDrafts(saved, drafts)), null)
  assert.equal(saved.find((component) => component.id === coffee.id)?.installed, true)
})

test('legacy over-cap editing is valid but placement can require several explicit Storage choices', () => {
  const saved = [
    ...defaultRoomComponents(),
    createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID()),
    createRoomComponent('toaster', 'kitchen-toaster', randomUUID()),
    createRoomComponent('blender', 'kitchen-blender', randomUUID()),
    createRoomComponent('rice-cooker', 'kitchen-rice-cooker', randomUUID()),
    createRoomComponent('stand-mixer', 'kitchen-stand-mixer', randomUUID()),
    createRoomComponent('air-fryer', 'kitchen-air-fryer', randomUUID()),
    createRoomComponent('paper-towel-holder', 'kitchen-paper-towels', randomUUID()),
  ]
  assert.equal(roomDraftPlacementReason(saved, saved), null)
  const coffee = saved.find((component) => component.kind === 'coffee-machine')!
  const edited = stageRoomComponent(saved, {}, { ...coffee, finish: 'sage' })
  assert.equal(roomDraftPlacementReason(saved, previewComponentDrafts(saved, edited)), null)
  const candidate = createRoomComponent('cutting-boards', 'kitchen-cutting-boards', randomUUID())
  assert.throws(() => stageRoomPlacement(saved, edited, candidate, [coffee.id]), /Make room first/)
  const choices = saved.filter((component) => ['coffee-machine', 'toaster', 'blender'].includes(component.kind)).map((component) => component.id)
  const drafts = stageRoomPlacement(saved, edited, candidate, choices)
  assert.equal(previewComponentDrafts(saved, drafts).find((component) => component.id === coffee.id)?.finish, 'sage')
  assert.equal(roomDraftPlacementReason(saved, previewComponentDrafts(saved, drafts)), null)
})

test('an occupied trial cannot become an implicit replacement after another roommate changes the room', () => {
  const saved = defaultRoomComponents()
  const trial = createRoomComponent('dishwasher', 'kitchen-undercounter', randomUUID())
  const occupied = [...saved, createRoomComponent('oven', 'kitchen-undercounter', randomUUID())]
  assert.throws(() => stageRoomPlacement(occupied, {}, trial), /same designed position/)
  assert.equal(stageRoomPlacement(occupied, {}, trial, [occupied.at(-1)!.id])[trial.id].value.installed, true)
  const retired = { ...createRoomComponent('speaker', 'living-room-media-accessory', randomUUID()), installed: false }
  assert.throws(() => stageRoomPlacement([...saved, retired], {}, { ...retired, installed: true }), /no longer offered/)
})

test('latest manual state stays visible without entering configuration patches', () => {
  const coffee = createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID())
  const saved = [...defaultRoomComponents(), coffee]
  const drafts = stageRoomComponent(saved, {}, { ...coffee, name: 'Our coffee' })
  const changed: RoomComponent = { ...coffee, version: 1, state: 'needs-cleaning', stateChangedAt: '2026-09-11T20:00:00.000Z', stateChangedBy: randomUUID() }
  const preview = previewComponentDrafts([...saved.filter((component) => component.id !== coffee.id), changed], drafts)
  assert.deepEqual(preview.find((component) => component.id === coffee.id), { ...changed, name: 'Our coffee' })
  assert.equal(drafts[coffee.id].base?.version, 0)
})

test('missing secure identifiers and the saved-object limit still permit read-only inspection', () => {
  const saved = defaultRoomComponents()
  while (saved.length < roomComponentLimit) saved.push({ ...createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID()), installed: false })
  const candidate = createRoomComponent('air-fryer', 'kitchen-air-fryer', 'preview-no-crypto')
  assert.equal(inspectionRoomComponents(saved, candidate).at(-1)?.id, candidate.id)
  assert.throws(() => stageRoomPlacement(saved, {}, candidate), /HTTPS or localhost/)
  assert.throws(() => stageRoomPlacement(saved, {}, { ...candidate, id: randomUUID() }), /saved-object limit/)
})

test('Bring back stages the exact owned record even when another instance is already installed', () => {
  const displayed = createRoomComponent('soap-dispenser', 'bathroom-soap-dispenser', randomUUID())
  const chosen = {
    ...createRoomComponent('soap-dispenser', 'bathroom-vanity-accessory', randomUUID()),
    installed: false, name: 'Our refill bottle', finish: 'berry' as const,
    supplies: [{ id: 'soap', name: 'Hand soap', quantity: '2 bottles' }],
  }
  const saved = [...defaultRoomComponents(), displayed, chosen]
  const drafts = stageRoomPlacement(saved, {}, chosen)
  assert.deepEqual(Object.keys(drafts), [chosen.id])
  assert.equal(drafts[chosen.id].base, chosen)
  assert.deepEqual(drafts[chosen.id].value, { ...chosen, installed: true })
  const preview = previewComponentDrafts(saved, drafts)
  assert.equal(preview.length, saved.length)
  assert.deepEqual(preview.find((component) => component.id === displayed.id), displayed)
  assert.equal(preview.filter((component) => component.kind === chosen.kind && component.installed).length, 2)
})

test('discarding a draft-only trial during a swap can make room at the saved-object limit', () => {
  const saved = defaultRoomComponents()
  while (saved.length < roomComponentLimit - 1) {
    saved.push({ ...createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID()), installed: false })
  }
  const first = createRoomComponent('air-fryer', 'kitchen-air-fryer', randomUUID())
  const drafts = stageRoomPlacement(saved, {}, first)
  const snapshot = structuredClone(drafts)
  const candidate = createRoomComponent('blender', 'kitchen-blender', randomUUID())
  assert.throws(() => stageRoomPlacement(saved, drafts, candidate), /saved-object limit/)
  assert.deepEqual(drafts, snapshot)
  const swapped = stageRoomPlacement(saved, drafts, candidate, [first.id])
  const preview = previewComponentDrafts(saved, swapped)
  assert.equal(preview.length, roomComponentLimit)
  assert.equal(preview.some((component) => component.id === first.id), false)
  assert.deepEqual(Object.keys(swapped), [candidate.id])
  assert.equal(swapped[candidate.id].value.installed, true)
})

test('retired saved placements stay editable but moving them is rejected without changing accepted drafts', () => {
  const retired = createRoomComponent('speaker', 'living-room-media-accessory', randomUUID())
  const saved = [...defaultRoomComponents(), retired]
  const edited = stageRoomComponent(saved, {}, { ...retired, name: 'Kept speaker', finish: 'teal' })
  assert.equal(roomDraftPlacementReason(saved, previewComponentDrafts(saved, edited)), null)
  const snapshot = structuredClone(edited)
  assert.throws(() => stageRoomPlacement(saved, edited, { ...edited[retired.id].value, slotId: 'living-room-shelf-accessory' }), /no longer offered/)
  assert.deepEqual(edited, snapshot)
  assert.equal(storeRoomComponent(saved, edited, edited[retired.id].value)[retired.id].linkedChores, 'pause')
})
