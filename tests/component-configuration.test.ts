import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRoomComponent, defaultRoomComponents } from '../shared/roomComponents.ts'
import { hasComponentConfigurationChanges } from '../src/componentConfiguration.ts'

test('chore navigation recognizes clean drafts without relying on array identity or order', () => {
  const current = defaultRoomComponents()
  assert.equal(hasComponentConfigurationChanges(current, structuredClone(current)), false)
  assert.equal(hasComponentConfigurationChanges(current, [...current].reverse()), false)
  assert.equal(hasComponentConfigurationChanges(current, current.map((component) => ({ ...component, version: component.version + 1 }))), false)
})

test('configuration changes, additions, removals and duplicate draft identifiers are detected', () => {
  const current = defaultRoomComponents()
  const changed = structuredClone(current)
  changed[0].name = 'A pending name'
  assert.equal(hasComponentConfigurationChanges(current, changed), true)
  assert.equal(hasComponentConfigurationChanges(current, [...current, createRoomComponent('dishwasher', 'kitchen-undercounter', 'new-object')]), true)
  assert.equal(hasComponentConfigurationChanges(current, current.slice(1)), true)
  assert.equal(hasComponentConfigurationChanges(current, [current[0], ...current.slice(0, -1)]), true)
  const removed = current.map((component, index) => index === 0 ? { ...component, installed: false } : component)
  assert.equal(hasComponentConfigurationChanges(current, removed), true)
})

test('manual appliance updates do not count as unsaved room configuration', () => {
  const washer = createRoomComponent('washing-machine', 'bathroom-laundry', 'washer')
  const current = [washer]
  assert.equal(hasComponentConfigurationChanges(current, [{ ...washer, state: 'running', stateChangedAt: '2026-09-10T10:00:00Z', stateChangedBy: 'roommate' }]), false)
  assert.equal(hasComponentConfigurationChanges(current, [{ ...washer, finish: 'teal' }]), true)
})
