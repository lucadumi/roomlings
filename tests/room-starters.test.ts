import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SQLiteDatabase } from '../server/database.ts'
import { Store } from '../server/store.ts'
import {
  componentIsRetired, defaultRoomComponents, getRoomComponents, newHouseholdRoomComponents, validateRoomComponents,
} from '../shared/roomComponents.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import { roomIds } from '../shared/rooms.ts'
import { roomZoneUsage } from '../shared/roomZones.ts'

const counts = (components: readonly RoomComponent[]) => roomIds.map((roomId) =>
  components.filter((component) => component.roomId === roomId && component.installed).length)

test('new households start with bathroom essentials without changing the other room defaults', () => {
  const defaults = defaultRoomComponents()
  const components = newHouseholdRoomComponents(randomUUID)
  assert.deepEqual(counts(components), [20, 12, 12])
  assert.ok(components.every((component) => !componentIsRetired(component.kind)))
  assert.deepEqual(components.filter((component) => component.id.startsWith('default-')), defaults)
  assert.deepEqual(components.filter((component) => !component.id.startsWith('default-')).map(({ slotId, kind }) => [slotId, kind]), [
    ['bathroom-laundry-basket', 'laundry-basket'], ['bathroom-bins', 'bins'],
    ['bathroom-plant', 'plant'], ['bathroom-soap-dispenser', 'soap-dispenser'],
    ['bathroom-towel-rack', 'towel-rack'], ['bathroom-shower-shelf', 'shower-shelf'],
  ])
  assert.equal(validateRoomComponents(components), null)
  for (const roomId of roomIds) {
    assert.ok(roomZoneUsage(components, roomId).every((zone) => zone.used <= zone.capacity))
  }
  const other = newHouseholdRoomComponents(randomUUID)
  const additions = new Set(components.filter((component) => !component.id.startsWith('default-')).map((component) => component.id))
  assert.ok(other.every((component) => !additions.has(component.id)))
  components[0].name = 'A private fixture name'
  assert.deepEqual(other.filter((component) => component.id.startsWith('default-')), defaults)
})

test('starter additions need unique fresh identifiers', () => {
  assert.throws(() => newHouseholdRoomComponents(() => 'not-a-uuid'), /UUID/i)
  const duplicate = randomUUID()
  assert.throws(() => newHouseholdRoomComponents(() => duplicate), /distinct identifiers/)
})

test('richer bathroom starters apply only on creation and never rewrite existing homes or sessions', async (context) => {
  const database = new SQLiteDatabase(':memory:')
  const store = new Store(database)
  context.after(() => store.close())
  const created = await store.create('New household fixture', 'Ada', 'EUR', 45000)
  const defaults = defaultRoomComponents()
  assert.deepEqual(counts(getRoomComponents(created.household)), [20, 12, 12])
  assert.deepEqual(getRoomComponents(created.household).filter((component) => component.roomId !== 'bathroom'),
    defaults.filter((component) => component.roomId !== 'bathroom'))
  assert.deepEqual(created.household.chores, { items: [], history: [] })
  assert.deepEqual(created.household.shopping, { items: [], runs: [] })
  assert.deepEqual(created.household.expenses, [])
  assert.deepEqual(created.household.settlements, [])
  assert.deepEqual((await store.authenticate(created.token))?.household, created.household)
  for (const roomComponents of [undefined, defaults]) {
    const legacy = { ...created.household, roomComponents }
    const originalJson = JSON.stringify(legacy)
    await database.prepare('UPDATE households SET state = ? WHERE id = ?').run(originalJson, legacy.id)
    const restored = await store.authenticate(created.token)
    assert.ok(restored)
    assert.equal(restored.memberId, created.memberId)
    assert.deepEqual(counts(getRoomComponents(restored.household)), [20, 6, 12])
    assert.deepEqual(restored.household.roomComponents, roomComponents)
    assert.equal((await database.prepare('SELECT state FROM households WHERE id = ?').get(legacy.id))?.state, originalJson)
  }
  assert.deepEqual(counts(getRoomComponents({})), [20, 6, 12])
})
