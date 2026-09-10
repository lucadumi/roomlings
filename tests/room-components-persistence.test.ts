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
  for (const roomId of ['kitchen', 'bathroom', 'living-room'] as const) {
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
  assert.equal(getRoomComponents(restored.household).length, components.length)
  assert.equal(getRoomComponents(restored.household).find((component) => component.id === washer.id)?.state, 'running')
  assert.equal(getRoomComponents(restored.household).find((component) => component.id === dryer.id)?.state, 'ready-to-unload')
  for (const key of ['expenses', 'settlements', 'shopping', 'chores', 'members'] as const) {
    assert.deepEqual(restored.household[key], before[key])
  }
})

it('upgrades a saved two-room layout without changing its session, furniture or stored history', async (context) => {
  const filename = resolve('data', `test-living-room-upgrade-${randomUUID()}.sqlite`)
  let store = new Store(filename)
  context.after(async () => {
    await store.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) rmSync(path, { force: true })
  })
  const session = await store.create('A furnished home', 'Ada', 'EUR', 50000)
  const legacy = {
    ...session.household,
    roomComponents: defaultRoomComponents().filter((component) => component.roomId !== 'living-room')
      .map((component) => component.slotId === 'bathroom-bath'
        ? { ...component, name: 'Our shower', variant: 'shower', version: 4 } : component),
  }
  const originalJson = JSON.stringify(legacy)
  await store.close()
  const database = new DatabaseSync(filename)
  database.prepare('UPDATE households SET state = ? WHERE id = ?').run(originalJson, legacy.id)
  database.close()
  store = new Store(filename)
  const restored = await store.authenticate(session.token)
  assert.ok(restored)
  assert.equal(restored.memberId, session.memberId)
  assert.equal(restored.household.version, legacy.version)
  assert.deepEqual(restored.household.roomComponents?.filter((component) => component.roomId !== 'living-room'), legacy.roomComponents)
  assert.deepEqual(restored.household.chores, legacy.chores)
  assert.deepEqual(restored.household.shopping, legacy.shopping)
  const reader = new DatabaseSync(filename, { readOnly: true })
  try {
    assert.equal(reader.prepare('SELECT state FROM households WHERE id = ?').get(legacy.id)?.state, originalJson)
  } finally { reader.close() }

  const television = getRoomComponents(restored.household).find((component) => component.kind === 'tv')!
  const { version, state: _state, stateChangedAt: _at, stateChangedBy: _by, ...fields } = television
  applyRoomComponentPatch(restored.household, {
    roomId: 'living-room', changes: [{ ...fields, installed: false, componentVersion: version }],
  }, new Date().toISOString())
  restored.household.version++
  await store.save(restored.household)
  await store.close()
  store = new Store(filename)
  const reopened = await store.authenticate(session.token)
  assert.ok(reopened)
  assert.deepEqual(reopened.household, restored.household)
  assert.equal(getRoomComponents(reopened.household).find((component) => component.id === television.id)?.installed, false)
})
