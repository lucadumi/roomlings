import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../server/store.ts'
import { applyRoomComponentPatch, setRoomComponentState } from '../shared/componentChanges.ts'
import { componentAllowedInRoom, createRoomComponent, defaultRoomComponents, getRoomComponents } from '../shared/roomComponents.ts'
import { completeRoomLayout } from './room-layout-fixture.ts'

it('keeps installed objects, settings, manual states and the original browser session across a database reopen', async (context) => {
  const filename = resolve('data', `test-room-components-${randomUUID()}.sqlite`)
  let store = new Store(filename)
  context.after(async () => {
    await store.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) rmSync(path, { force: true })
  })
  const session = await store.create('The existing home', 'Ada', 'EUR', 45000)
  const component = createRoomComponent('dishwasher', 'kitchen-undercounter', randomUUID())
  const { version: _version, state: _state, stateChangedAt: _at, stateChangedBy: _by, ...fields } = component
  const now = new Date().toISOString()
  applyRoomComponentPatch(session.household, {
    roomId: 'kitchen', changes: [{ ...fields, name: 'Our dishwasher', finish: 'sage', componentVersion: null }],
  }, now)
  session.household.version++
  setRoomComponentState(session.household, component.id, { componentVersion: 0, state: 'running' }, session.memberId, now)
  session.household.version++
  await store.save(session.household)
  await store.close()
  store = new Store(filename)
  const restored = await store.authenticate(session.token)
  assert.ok(restored)
  assert.equal(restored.memberId, session.memberId)
  assert.deepEqual(restored.household, session.household)
  assert.equal(getRoomComponents(restored.household).find((entry) => entry.id === component.id)?.state, 'running')
})

it('keeps legacy household JSON and browser access intact while deriving the original room layout', async (context) => {
  const filename = resolve('data', `test-room-components-legacy-${randomUUID()}.sqlite`)
  let store = new Store(filename)
  context.after(async () => {
    await store.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) rmSync(path, { force: true })
  })
  const session = await store.create('An older home', 'Original owner', 'EUR', 50000)
  const legacy = { ...session.household }
  delete legacy.roomComponents
  const originalJson = JSON.stringify(legacy)
  await store.close()
  const database = new DatabaseSync(filename)
  database.prepare('UPDATE households SET state = ? WHERE id = ?').run(originalJson, legacy.id)
  database.close()
  store = new Store(filename)
  const restored = await store.authenticate(session.token)
  assert.ok(restored)
  assert.deepEqual(restored.household, legacy)
  assert.deepEqual(getRoomComponents(restored.household), defaultRoomComponents())
  const reader = new DatabaseSync(filename, { readOnly: true })
  try {
    assert.equal(reader.prepare('SELECT state FROM households WHERE id = ?').get(legacy.id)?.state, originalJson)
  } finally { reader.close() }
})

it('persists the complete expanded home and independent laundry states without replacing its original session', async (context) => {
  const filename = resolve('data', `test-room-layout-${randomUUID()}.sqlite`)
  let store = new Store(filename)
  context.after(async () => {
    await store.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) rmSync(path, { force: true })
  })
  const session = await store.create('A fully equipped home', 'Ada', 'EUR', 45000)
  const before = structuredClone(session.household)
  const components = completeRoomLayout().filter((component) => componentAllowedInRoom(component.kind, component.roomId))
    .map((component) => component.id.startsWith('default-') ? component : { ...component, id: randomUUID() })
  const now = new Date().toISOString()
  for (const roomId of ['kitchen', 'bathroom'] as const) {
    applyRoomComponentPatch(session.household, {
      roomId,
      changes: components.filter((component) => component.roomId === roomId).map((component) => {
        const { version: _version, state: _state, stateChangedAt: _at, stateChangedBy: _by, ...fields } = component
        return { ...fields, componentVersion: component.id.startsWith('default-') ? 0 : null }
      }),
    }, now)
    session.household.version++
  }
  const washer = components.find((component) => component.slotId === 'bathroom-laundry')!
  const dryer = components.find((component) => component.slotId === 'bathroom-dryer')!
  setRoomComponentState(session.household, washer.id, { componentVersion: 0, state: 'running' }, session.memberId, now)
  setRoomComponentState(session.household, dryer.id, { componentVersion: 0, state: 'ready-to-unload' }, session.memberId, now)
  session.household.version++
  await store.save(session.household)
  await store.close()
  store = new Store(filename)
  const restored = await store.authenticate(session.token)
  assert.ok(restored)
  assert.deepEqual(restored.household, session.household)
  assert.equal(getRoomComponents(restored.household).length, 98)
  assert.equal(getRoomComponents(restored.household).find((component) => component.id === washer.id)?.state, 'running')
  assert.equal(getRoomComponents(restored.household).find((component) => component.id === dryer.id)?.state, 'ready-to-unload')
  for (const key of ['expenses', 'settlements', 'shopping', 'chores', 'members'] as const) {
    assert.deepEqual(restored.household[key], before[key])
  }
})
