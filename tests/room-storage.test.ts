import { describe, it } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Request, RequestHandler, Response } from 'express'
import { createApp } from '../server/app.ts'
import { ApiError } from '../server/errors.ts'
import { Store } from '../server/store.ts'
import { householdSchema } from '../shared/domain.ts'
import { RoomComponentError } from '../shared/componentChanges.ts'
import { componentChoreIsPaused, createRoomComponent, getRoomComponents } from '../shared/roomComponents.ts'
import type { RoomComponent, RoomComponentChange } from '../shared/roomComponents.ts'
import { completeRoomLayout } from './room-layout-fixture.ts'

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: RequestHandler }[] } }
const resultSchema = z.object({ household: householdSchema, replayed: z.boolean().optional() })
const now = '2026-09-11T20:00:00.000Z'
function change(component: RoomComponent, overrides: Partial<RoomComponentChange> = {}): RoomComponentChange {
  const { version, state: _state, stateChangedAt: _at, stateChangedBy: _by, ...fields } = component
  return { ...fields, componentVersion: version, ...overrides }
}
async function fixture(context: TestContext) {
  const store = new Store(':memory:')
  context.after(() => store.close())
  const session = await store.create('Storage fixture', 'Ada', 'EUR', 45000)
  const app = createApp(store)
  const current = async () => {
    const household = await store.get(session.household.id)
    assert.ok(household)
    return household
  }
  // Exercise the registered mutation boundary without opening a server or socket.
  const call = async (method: 'post' | 'patch', path: string, input: Record<string, unknown>, params: Record<string, string> = {}) => {
    const layer = (app.router as { stack: RouteLayer[] }).stack.find((layer) => layer.route?.path === path && layer.route.methods[method])
    assert.ok(layer?.route)
    const request = {
      body: { version: (await current()).version, ...input }, method: method.toUpperCase(),
      path: path.replace(/:([a-z]+)/gi, (_match, key: string) => params[key]), params, headers: {},
      get: (header: string) => header.toLowerCase() === 'authorization' ? `Bearer ${session.token}` : undefined,
    } as unknown as Request
    let result: unknown
    const response = { json: (data: unknown) => { result = data } } as unknown as Response
    await layer.route.stack[0].handle(request, response, (error?: unknown) => { if (error) throw error })
    return resultSchema.parse(result)
  }
  return { store, session, current, call }
}

describe('in-memory room storage mutation boundary', () => {
  it('keeps legacy over-cap objects and sessions readable, editable and storable without automatic additions', async (context) => {
    const api = await fixture(context)
    const legacy = { ...await api.current(), roomComponents: completeRoomLayout() }
    await api.store.save(legacy)
    const normalized = householdSchema.parse(legacy)
    assert.deepEqual((await api.store.authenticate(api.session.token))?.household, normalized)
    assert.equal(normalized.roomComponents?.find((component) => component.slotId === 'living-room-bins')?.installed, false)
    const coffee = getRoomComponents(legacy).find((component) => component.slotId === 'kitchen-coffee')!
    const edited = (await api.call('patch', '/api/household/room-components', {
      roomId: 'kitchen', changes: [change(coffee, { finish: 'sage' })],
    })).household
    const current = getRoomComponents(edited).find((component) => component.id === coffee.id)!
    const stored = (await api.call('patch', '/api/household/room-components', {
      roomId: 'kitchen', changes: [change(current, { installed: false, linkedChores: 'pause' })],
    })).household
    assert.equal(getRoomComponents(stored).length, legacy.roomComponents.length)
    assert.deepEqual(getRoomComponents(stored).map((component) => component.id), legacy.roomComponents.map((component) => component.id))
    assert.deepEqual((await api.store.authenticate(api.session.token))?.household, stored)
    for (const key of ['chores', 'shopping', 'expenses', 'settlements', 'members'] as const) assert.deepEqual(stored[key], legacy[key])
  })

  it('blocks paused chore completion and stored shortcuts, then resumes the same care without altering shopping or history', async (context) => {
    const api = await fixture(context)
    const memberId = api.session.memberId
    const dishwasher = createRoomComponent('dishwasher', 'kitchen-undercounter', randomUUID())
    await api.call('patch', '/api/household/room-components', { roomId: 'kitchen', changes: [change(dishwasher, {
      componentVersion: null, name: 'Our dishwasher', finish: 'teal', supplies: dishwasher.supplies.slice(0, 1),
    })] })
    await api.call('patch', '/api/room-components/:id/state', { componentVersion: 0, state: 'running' }, { id: dishwasher.id })
    await api.call('post', '/api/chores', {
      title: 'Empty our dishwasher', roomId: 'kitchen', area: null, componentId: dishwasher.id,
      dueDate: '2026-09-11', repeatDays: 1, rotation: [memberId],
    })
    await api.call('post', '/api/chores', {
      title: 'Clear the kitchen sink', roomId: 'kitchen', area: 'sink',
      dueDate: '2026-09-11', repeatDays: 1, rotation: [memberId],
    })
    await api.call('post', '/api/shopping/items', {
      name: 'Dishwasher tablets', quantity: '2 boxes', componentSource: { componentId: dishwasher.id, supplyId: 'dishwasher-tablets' },
    })
    const withHistory = await api.current()
    const runId = randomUUID()
    const receiptId = randomUUID()
    withHistory.expenses.push({
      id: receiptId, description: 'Earlier shared supplies', amount: 375, category: 'other',
      date: '2026-09-11', createdAt: now, paidBy: memberId, participants: [memberId], shoppingRunId: runId,
    })
    withHistory.shopping.runs.push({
      id: runId, expenseId: receiptId, name: 'Earlier shared supplies', completedBy: memberId, completedAt: now,
      items: [{
        id: randomUUID(), name: 'Dishwasher tablets', quantity: '1 box', notes: '', createdBy: memberId, createdAt: now,
        componentSources: withHistory.shopping.items[0].componentSources,
      }],
    })
    await api.store.save(withHistory)
    const linked = withHistory.chores.items.find((chore) => chore.componentId === dishwasher.id)!
    await api.call('post', '/api/chores/:id/complete', { choreVersion: linked.version }, { id: linked.id })
    const before = await api.current()
    const configured = getRoomComponents(before).find((component) => component.id === dishwasher.id)!
    const paused = (await api.call('patch', '/api/household/room-components', {
      roomId: 'kitchen', changes: [change(configured, { installed: false, linkedChores: 'pause' })],
    })).household
    const stored = getRoomComponents(paused).find((component) => component.id === dishwasher.id)!
    assert.deepEqual(stored, { ...configured, installed: false, version: configured.version + 1 })
    assert.deepEqual(paused.chores, before.chores)
    assert.deepEqual(paused.shopping, before.shopping)
    assert.deepEqual(paused.expenses, before.expenses)
    assert.deepEqual(paused.settlements, before.settlements)
    const pausedChore = paused.chores.items.find((chore) => chore.id === linked.id)!
    assert.equal(componentChoreIsPaused(pausedChore, getRoomComponents(paused)), true)
    assert.deepEqual(await api.current(), paused)
    await assert.rejects(api.call('post', '/api/chores/:id/complete', { choreVersion: pausedChore.version }, { id: linked.id }),
      (error) => error instanceof RoomComponentError && error.status === 409 && /paused.*storage/.test(error.message))
    await assert.rejects(api.call('patch', '/api/room-components/:id/state', { componentVersion: stored.version, state: 'empty' }, { id: stored.id }),
      (error) => error instanceof RoomComponentError && error.status === 409)
    await assert.rejects(api.call('post', '/api/shopping/items', {
      name: 'More tablets', quantity: '1 box', componentSource: { componentId: stored.id, supplyId: 'dishwasher-tablets' },
    }), (error) => error instanceof RoomComponentError && error.status === 409)
    assert.deepEqual(await api.current(), paused)

    const generic = paused.chores.items.find((chore) => !chore.componentId)!
    await api.call('post', '/api/chores/:id/complete', { choreVersion: generic.version }, { id: generic.id })
    const beforeRestore = await api.current()
    const restored = (await api.call('patch', '/api/household/room-components', {
      roomId: 'kitchen', changes: [change(stored, { installed: true })],
    })).household
    assert.equal(componentChoreIsPaused(pausedChore, getRoomComponents(restored)), false)
    assert.deepEqual(restored.chores, beforeRestore.chores)
    assert.deepEqual(restored.shopping, before.shopping)
    assert.deepEqual(getRoomComponents(restored).find((component) => component.id === dishwasher.id), {
      ...configured, version: configured.version + 2,
    })
    const completed = (await api.call('post', '/api/chores/:id/complete', { choreVersion: pausedChore.version }, { id: linked.id })).household
    assert.equal(completed.chores.items.find((chore) => chore.id === linked.id)?.occurrence, pausedChore.occurrence + 1)
    assert.equal(completed.chores.history.filter((completion) => completion.choreId === linked.id).length, 2)
    assert.equal(getRoomComponents(completed).filter((component) => component.id === dishwasher.id).length, 1)
    assert.deepEqual(completed.shopping, before.shopping)
    assert.deepEqual(completed.expenses, before.expenses)
    assert.deepEqual((await api.store.authenticate(api.session.token))?.household, completed)
  })

  it('keeps failed saves, optimistic conflicts and replayed storage requests atomic', async (context) => {
    const api = await fixture(context)
    const before = await api.current()
    const lamp = getRoomComponents(before).find((component) => component.slotId === 'living-room-floor-lamp')!
    const payload = {
      roomId: 'living-room', changes: [change(lamp, { installed: false, linkedChores: 'pause' })],
      version: before.version, mutationId: randomUUID(), mutationVersion: before.version,
    }
    const save = context.mock.method(api.store, 'save', async () => { throw new Error('Storage persistence failed') })
    await assert.rejects(api.call('patch', '/api/household/room-components', payload), /Storage persistence failed/)
    save.mock.restore()
    assert.deepEqual(await api.current(), before)
    const stored = await api.call('patch', '/api/household/room-components', payload)
    const replayed = await api.call('patch', '/api/household/room-components', payload)
    assert.equal(replayed.replayed, true)
    assert.deepEqual(replayed.household, stored.household)
    assert.equal(stored.household.version, before.version + 1)
    assert.equal(stored.household.mutationReceipts?.length, 1)
    const current = getRoomComponents(stored.household).find((component) => component.id === lamp.id)!
    await assert.rejects(api.call('patch', '/api/household/room-components', {
      roomId: 'living-room', changes: [change(current, { installed: true, componentVersion: lamp.version })],
    }), (error) => error instanceof RoomComponentError && error.status === 409)
    await assert.rejects(api.call('patch', '/api/household/room-components', {
      roomId: 'living-room', changes: [change(current, { installed: true })], version: before.version,
    }), (error) => error instanceof ApiError && error.status === 409)
    assert.deepEqual(await api.current(), stored.household)
  })

  it('enforces final-zone budgets and at most one concurrent household mutation through the existing route', async (context) => {
    const api = await fixture(context)
    const counterObjects = [
      createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID()),
      createRoomComponent('microwave', 'kitchen-small-appliance', randomUUID()),
      createRoomComponent('blender', 'kitchen-blender', randomUUID()),
      createRoomComponent('stand-mixer', 'kitchen-stand-mixer', randomUUID()),
      createRoomComponent('water-filter', 'kitchen-water-filter', randomUUID()),
    ]
    await api.call('patch', '/api/household/room-components', {
      roomId: 'kitchen', changes: counterObjects.map((component) => change(component, { componentVersion: null })),
    })
    const before = await api.current()
    const coffee = getRoomComponents(before).find((component) => component.kind === 'coffee-machine')!
    const toaster = createRoomComponent('toaster', 'kitchen-toaster', randomUUID())
    await assert.rejects(api.call('patch', '/api/household/room-components', {
      roomId: 'kitchen', changes: [change(toaster, { componentVersion: null })],
    }), (error) => error instanceof RoomComponentError && error.status === 409 && /Make room first/.test(error.message))
    assert.deepEqual(await api.current(), before)
    await api.call('patch', '/api/household/room-components', {
      roomId: 'kitchen', changes: [change(toaster, { componentVersion: null }), change(coffee, { installed: false, linkedChores: 'pause' })],
    })
    const full = await api.current()
    const outcomes = await Promise.allSettled(['sage', 'tomato'].map((finish) => api.call('patch', '/api/household/room-components', {
      roomId: 'kitchen', changes: [change(toaster, { finish: finish as 'sage' | 'tomato' })], version: full.version,
    })))
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
    const conflict = outcomes.find((outcome) => outcome.status === 'rejected')
    assert.ok(conflict?.status === 'rejected' && conflict.reason instanceof ApiError && conflict.reason.status === 409)
    assert.equal((await api.current()).version, full.version + 1)
  })
})
