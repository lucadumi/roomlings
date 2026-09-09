import { describe, it } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { createApp } from '../server/app.ts'
import { Store } from '../server/store.ts'
import { balances, householdSchema } from '../shared/domain.ts'
import type { Session } from '../shared/domain.ts'
import { createRoomComponent, getRoomComponents } from '../shared/roomComponents.ts'
import type { RoomComponent, RoomComponentChange } from '../shared/roomComponents.ts'

function change(component: RoomComponent, overrides: Partial<RoomComponentChange> = {}): RoomComponentChange {
  const { version, state: _state, stateChangedAt: _at, stateChangedBy: _by, ...fields } = component
  return { ...fields, componentVersion: version, ...overrides }
}
async function fixture(context: TestContext) {
  const store = new Store(':memory:')
  const server = createApp(store).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const owner = await store.create('A shared modular home', 'Ada', 'EUR', 45000)
  const ben = { id: randomUUID(), name: 'Ben', color: '#a1b18d' }
  owner.household.members.push(ben)
  await store.save(owner.household)
  const roommate = await store.session(owner.household, ben.id)
  const current = async () => {
    const household = await store.get(owner.household.id)
    assert.ok(household)
    return household
  }
  const call = async (path: string, body?: unknown, actor: Session | null = owner, method = body === undefined ? 'GET' : 'PATCH') => {
    const response = await fetch(`${origin}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data: unknown = await response.json()
    return { status: response.status, data }
  }
  const mutate = async (path: string, body: Record<string, unknown>, actor: Session | null = owner, method = 'PATCH') =>
    call(path, { version: (await current()).version, ...body }, actor, method)
  const install = async () => {
    const component = createRoomComponent('dishwasher', 'kitchen-undercounter', randomUUID())
    const result = await mutate('/household/room-components', {
      roomId: 'kitchen', changes: [change(component, { componentVersion: null })],
    })
    assert.equal(result.status, 200, JSON.stringify(result.data))
    return component
  }
  context.after(async () => {
    const closed = once(server, 'close')
    server.close()
    await closed
    await store.close()
  })
  return { store, owner, roommate, current, call, mutate, install }
}
const resultHousehold = (data: unknown) => z.object({ household: householdSchema }).parse(data).household

describe('shared room component API', () => {
  it('shares living room customization, care and shopping without creating another ledger', async (context) => {
    const api = await fixture(context)
    const household = await api.current()
    household.expenses.push({
      id: randomUUID(), description: 'Shared groceries', amount: 750, category: 'other',
      participants: [api.owner.memberId, api.roommate.memberId], paidBy: api.roommate.memberId,
      date: '2026-09-08', createdAt: '2026-09-08T12:00:00.000Z',
    })
    await api.store.save(household)
    const sofa = getRoomComponents(household).find((component) => component.kind === 'sofa')!
    const patch = { roomId: 'living-room', changes: [change(sofa, { name: 'Our sofa', variant: 'straight', finish: 'tomato' })] }
    assert.equal((await api.mutate('/household/room-components', patch, api.roommate)).status, 403)
    const configured = await api.mutate('/household/room-components', patch)
    assert.equal(configured.status, 200, JSON.stringify(configured.data))
    assert.equal(getRoomComponents(resultHousehold(configured.data)).find((component) => component.id === sofa.id)?.variant, 'straight')
    assert.equal((await api.mutate('/household/room-components', patch)).status, 409)
    const task = await api.mutate('/chores', {
      title: 'Vacuum our sofa', roomId: 'living-room', area: 'seating', componentId: sofa.id,
      dueDate: '2026-09-08', repeatDays: 7, rotation: [api.owner.memberId, api.roommate.memberId],
    }, api.roommate, 'POST')
    assert.equal(task.status, 200, JSON.stringify(task.data))
    const chore = resultHousehold(task.data).chores.items[0]
    const completed = await api.mutate(`/chores/${chore.id}/complete`, { choreVersion: chore.version }, api.roommate, 'POST')
    assert.equal(completed.status, 200, JSON.stringify(completed.data))
    const supply = await api.mutate('/shopping/items', {
      name: 'Upholstery cleaner', quantity: '1 bottle', componentSource: { componentId: sofa.id, supplyId: 'upholstery-cleaner' },
    }, api.roommate, 'POST')
    assert.equal(supply.status, 200, JSON.stringify(supply.data))
    const saved = resultHousehold(supply.data)
    assert.equal(saved.chores.history[0].roomId, 'living-room')
    assert.equal(saved.chores.history[0].componentName, 'Our sofa')
    assert.equal(saved.chores.history[0].completedBy, api.roommate.memberId)
    assert.equal(saved.shopping.items[0].componentSources?.[0].roomId, 'living-room')
    assert.deepEqual(saved.expenses, household.expenses)
    assert.deepEqual(saved.settlements, household.settlements)
    assert.deepEqual(balances(saved), balances(household))
    assert.deepEqual(saved.roomComponents?.filter((component) => component.roomId !== 'living-room'),
      household.roomComponents?.filter((component) => component.roomId !== 'living-room'))
  })

  it('only lets owners and delegated admins configure a shared room, including its overall style', async (context) => {
    const api = await fixture(context)
    const component = createRoomComponent('dishwasher', 'kitchen-undercounter', randomUUID())
    const patch = { roomId: 'kitchen', changes: [change(component, { componentVersion: null })] }
    assert.equal((await api.mutate('/household/room-components', patch, null)).status, 401)
    assert.equal((await api.mutate('/household/room-components', patch, api.roommate)).status, 403)
    assert.equal((await api.mutate('/household/room-style', { roomStyle: 'sage' }, api.roommate)).status, 403)
    const promoted = await api.mutate(`/household/room-access/${api.roommate.memberId}`, { role: 'admin' })
    assert.equal(promoted.status, 200, JSON.stringify(promoted.data))
    const saved = await api.mutate('/household/room-components', patch, api.roommate)
    assert.equal(saved.status, 200, JSON.stringify(saved.data))
    assert.equal(getRoomComponents(resultHousehold(saved.data)).some((entry) => entry.id === component.id), true)
    assert.equal((await api.mutate('/household/room-style', { roomStyle: 'sage' }, api.roommate)).status, 200)
    await api.mutate(`/household/room-access/${api.roommate.memberId}`, { role: 'member' })
    assert.equal((await api.mutate('/household/room-components', { roomId: 'kitchen', changes: [change(component, { name: 'No longer allowed' })] }, api.roommate)).status, 403)
  })

  it('lets an ordinary roommate update an installed appliance state without changing chores or money', async (context) => {
    const api = await fixture(context)
    const component = await api.install()
    const before = await api.current()
    const result = await api.mutate(`/room-components/${component.id}/state`, { componentVersion: 0, state: 'running' }, api.roommate)
    assert.equal(result.status, 200)
    const saved = resultHousehold(result.data)
    assert.equal(getRoomComponents(saved).find((entry) => entry.id === component.id)?.stateChangedBy, api.roommate.memberId)
    assert.deepEqual(saved.shopping, before.shopping)
    assert.deepEqual(saved.chores, before.chores)
    assert.deepEqual(balances(saved), balances(before))
    const stale = await api.mutate(`/room-components/${component.id}/state`, { componentVersion: 0, state: 'empty' }, api.roommate)
    assert.equal(stale.status, 409)
  })

  it('uses stable mutation receipts for interrupted installations and rejects conflicting drafts', async (context) => {
    const api = await fixture(context)
    const component = createRoomComponent('dishwasher', 'kitchen-undercounter', randomUUID())
    const before = await api.current()
    const body = {
      roomId: 'kitchen', changes: [change(component, { componentVersion: null })],
      version: before.version, mutationId: randomUUID(), mutationVersion: before.version,
    }
    const first = await api.call('/household/room-components', body)
    const replay = await api.call('/household/room-components', body)
    assert.equal(first.status, 200)
    assert.equal(replay.status, 200)
    assert.equal(z.object({ replayed: z.boolean() }).parse(replay.data).replayed, true)
    const current = await api.current()
    assert.equal(current.version, before.version + 1)
    assert.equal(getRoomComponents(current).filter((entry) => entry.id === component.id).length, 1)
    const conflict = await api.call('/household/room-components', { ...body, changes: [change(component, { componentVersion: null, name: 'Changed after saving' })] })
    assert.equal(conflict.status, 409)
    assert.deepEqual(await api.current(), current)
  })

  it('applies at most one concurrent room draft and rejects forged or occupied placements without partial saves', async (context) => {
    const api = await fixture(context)
    const first = createRoomComponent('dishwasher', 'kitchen-undercounter', randomUUID())
    const second = createRoomComponent('washing-machine', 'kitchen-undercounter', randomUUID())
    const version = (await api.current()).version
    const results = await Promise.all([first, second].map((component) => api.call('/household/room-components', {
      roomId: 'kitchen', changes: [change(component, { componentVersion: null })], version,
    })))
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409])
    const current = await api.current()
    assert.equal(getRoomComponents(current).filter((entry) => entry.installed && entry.slotId === 'kitchen-undercounter').length, 1)
    const invalid = await api.mutate('/household/room-components', {
      roomId: 'kitchen', changes: [{ ...change(first), slotId: 'bathroom-sink' }],
    })
    assert.equal(invalid.status, 400)
    assert.deepEqual(await api.current(), current)
  })

  it('retains quantities and claims when a component supply joins an existing shared-list entry', async (context) => {
    const api = await fixture(context)
    const component = await api.install()
    const added = await api.mutate('/shopping/items', { name: 'Dishwasher tablets', quantity: '3 boxes', notes: 'Already agreed' }, api.roommate, 'POST')
    assert.equal(added.status, 200)
    let item = resultHousehold(added.data).shopping.items[0]
    await api.mutate(`/shopping/items/${item.id}/claim`, { itemVersion: item.version, claimed: true }, api.roommate, 'POST')
    item = (await api.current()).shopping.items[0]
    const result = await api.mutate('/shopping/items', {
      name: '\uff24\uff29\uff33\uff28\uff37\uff21\uff33\uff28\uff25\uff32 \uff34\uff21\uff22\uff2c\uff25\uff34\uff33', quantity: '1 box', notes: 'Different proposed quantity',
      componentSource: { componentId: component.id, supplyId: 'dishwasher-tablets' },
    }, api.owner, 'POST')
    assert.equal(result.status, 200, JSON.stringify(result.data))
    const saved = resultHousehold(result.data)
    assert.equal(saved.shopping.items.length, 1)
    assert.equal(saved.shopping.items[0].quantity, '3 boxes')
    assert.equal(saved.shopping.items[0].notes, 'Already agreed')
    assert.equal(saved.shopping.items[0].claimedBy, api.roommate.memberId)
    assert.equal(saved.shopping.items[0].version, item.version + 1)
    assert.deepEqual(saved.shopping.items[0].componentSources, [{
      componentId: component.id, supplyId: 'dishwasher-tablets', roomId: 'kitchen', componentName: 'Dishwasher',
    }])
    assert.equal(saved.expenses.length, 0)
  })

  it('preserves component source snapshots through renaming, removal and the existing paid checkout', async (context) => {
    const api = await fixture(context)
    const component = await api.install()
    const supply = await api.mutate('/shopping/items', {
      name: 'Dishwasher tablets', quantity: '1 box', notes: 'All in one',
      componentSource: { componentId: component.id, supplyId: 'dishwasher-tablets' },
    }, api.roommate, 'POST')
    assert.equal(supply.status, 200)
    const chore = await api.mutate('/chores', {
      title: 'Empty the dishwasher', roomId: 'kitchen', area: null, componentId: component.id,
      dueDate: '2026-09-08', repeatDays: 1, rotation: [api.owner.memberId, api.roommate.memberId],
    }, api.owner, 'POST')
    assert.equal(chore.status, 200, JSON.stringify(chore.data))
    await api.mutate('/household/room-components', { roomId: 'kitchen', changes: [change(component, { name: 'Dish friend' })] })
    const task = (await api.current()).chores.items[0]
    const completion = await api.mutate(`/chores/${task.id}/complete`, { choreVersion: task.version }, api.roommate, 'POST')
    assert.equal(completion.status, 200, JSON.stringify(completion.data))
    assert.equal(resultHousehold(completion.data).chores.history[0].componentName, 'Dish friend')
    const latest = getRoomComponents(await api.current()).find((entry) => entry.id === component.id)!
    const removed = await api.mutate('/household/room-components', { roomId: 'kitchen', changes: [change(latest, { installed: false, linkedChores: 'keep' })] })
    assert.equal(removed.status, 200, JSON.stringify(removed.data))
    assert.equal(resultHousehold(removed.data).chores.items[0].componentId, null)
    let item = (await api.current()).shopping.items[0]
    await api.mutate(`/shopping/items/${item.id}/pick`, { itemVersion: item.version, pickedUp: true }, api.roommate, 'POST')
    item = (await api.current()).shopping.items[0]
    const paid = await api.mutate('/shopping/checkout', {
      checkoutId: randomUUID(), description: 'Household supplies', amount: 500, paidBy: api.roommate.memberId,
      participants: [api.owner.memberId, api.roommate.memberId], category: 'other', date: '2026-09-08',
      items: [{ id: item.id, version: item.version }],
    }, api.roommate, 'POST')
    assert.equal(paid.status, 200, JSON.stringify(paid.data))
    const after = resultHousehold(paid.data)
    assert.equal(after.expenses.length, 1)
    assert.equal(after.shopping.items.length, 0)
    assert.equal(after.shopping.runs[0].items[0].componentSources?.[0].componentName, 'Dishwasher')
    assert.equal(after.chores.history[0].componentName, 'Dish friend')
    assert.equal(balances(after).get(api.owner.memberId), -250)
    assert.equal(balances(after).get(api.roommate.memberId), 250)
  })

  it('does not accept new supply or chore links to another household or a removed object', async (context) => {
    const api = await fixture(context)
    const component = await api.install()
    const foreign = await api.store.create('Another household', 'Other', 'EUR', 45000)
    const body = { name: 'Dishwasher tablets', quantity: '1 box', componentSource: { componentId: component.id, supplyId: 'dishwasher-tablets' }, version: foreign.household.version }
    assert.equal((await api.call('/shopping/items', body, foreign, 'POST')).status, 404)
    await api.mutate('/household/room-components', { roomId: 'kitchen', changes: [change(component, { installed: false })] })
    const { version: _foreignVersion, ...restock } = body
    const removedSupply = await api.mutate('/shopping/items', restock, api.owner, 'POST')
    assert.equal(removedSupply.status, 409)
    assert.match(z.object({ error: z.string() }).parse(removedSupply.data).error, /removed/)
    const invalidChore = await api.mutate('/chores', {
      title: 'Removed object chore', roomId: 'kitchen', area: null, componentId: component.id,
      dueDate: '2026-09-08', repeatDays: null, rotation: [api.owner.memberId],
    }, api.owner, 'POST')
    assert.equal(invalidChore.status, 409)
    assert.equal((await api.current()).chores.items.length, 0)
    assert.equal((await api.current()).shopping.items.length, 0)
  })

  it('requires restoring an object before its archived connected chores, without discarding completions', async (context) => {
    const api = await fixture(context)
    const component = await api.install()
    await api.mutate('/chores', {
      title: 'Dishwasher filter', roomId: 'kitchen', area: null, componentId: component.id,
      dueDate: '2026-09-08', repeatDays: 30, rotation: [api.owner.memberId],
    }, api.owner, 'POST')
    const removed = await api.mutate('/household/room-components', { roomId: 'kitchen', changes: [change(component, { installed: false, linkedChores: 'archive' })] })
    assert.equal(removed.status, 200)
    const archived = (await api.current()).chores.items[0]
    assert.equal(archived.archived, true)
    assert.equal((await api.mutate(`/chores/${archived.id}/archive`, { choreVersion: archived.version, archived: false })).status, 409)
    const current = getRoomComponents(await api.current()).find((entry) => entry.id === component.id)!
    assert.equal((await api.mutate('/household/room-components', { roomId: 'kitchen', changes: [change(current, { installed: true })] })).status, 200)
    assert.equal((await api.mutate(`/chores/${archived.id}/archive`, { choreVersion: archived.version, archived: false })).status, 200)
  })

  it('rolls back failed configuration saves and retries without creating a second object', async (context) => {
    const api = await fixture(context)
    const component = createRoomComponent('dishwasher', 'kitchen-undercounter', randomUUID())
    const before = await api.current()
    const body = {
      roomId: 'kitchen', changes: [change(component, { componentVersion: null })],
      version: before.version, mutationId: randomUUID(), mutationVersion: before.version,
    }
    const save = context.mock.method(api.store, 'save', async () => { throw new Error('Simulated component persistence failure') })
    const failed = await api.call('/household/room-components', body)
    assert.equal(failed.status, 500)
    save.mock.restore()
    assert.deepEqual(await api.current(), before)
    const retried = await api.call('/household/room-components', body)
    assert.equal(retried.status, 200)
    const result = resultHousehold(retried.data)
    assert.equal(result.version, before.version + 1)
    assert.equal(getRoomComponents(result).filter((entry) => entry.id === component.id).length, 1)
    assert.deepEqual(result.expenses, before.expenses)
  })

  it('does not erase source history when an admin changes the configured supply list', async (context) => {
    const api = await fixture(context)
    const component = await api.install()
    await api.mutate('/shopping/items', {
      name: 'Dishwasher tablets', quantity: '1 box',
      componentSource: { componentId: component.id, supplyId: 'dishwasher-tablets' },
    }, api.owner, 'POST')
    const configured = await api.mutate('/household/room-components', {
      roomId: 'kitchen', changes: [change(component, { supplies: [] })],
    })
    assert.equal(configured.status, 200)
    const saved = resultHousehold(configured.data)
    assert.equal(saved.shopping.items[0].componentSources?.[0].supplyId, 'dishwasher-tablets')
    const stale = await api.mutate('/shopping/items', {
      name: 'Dishwasher tablets', quantity: '1 box',
      componentSource: { componentId: component.id, supplyId: 'dishwasher-tablets' },
    }, api.owner, 'POST')
    assert.equal(stale.status, 409)
    assert.deepEqual(await api.current(), saved)
  })

  it('moves a configured object without changing its identity or linked chore records', async (context) => {
    const api = await fixture(context)
    const plant = getRoomComponents(await api.current()).find((component) => component.slotId === 'kitchen-plant-floor')!
    await api.mutate('/chores', {
      title: 'Water the floor plant', roomId: 'kitchen', area: null, componentId: plant.id,
      dueDate: '2026-09-09', repeatDays: 7, rotation: [api.owner.memberId],
    }, api.owner, 'POST')
    const before = await api.current()
    const moved = await api.mutate('/household/room-components', {
      roomId: 'kitchen', changes: [change(plant, { slotId: 'kitchen-table-center' })],
    })
    assert.equal(moved.status, 200, JSON.stringify(moved.data))
    const saved = resultHousehold(moved.data)
    assert.equal(getRoomComponents(saved).find((component) => component.id === plant.id)?.slotId, 'kitchen-table-center')
    assert.deepEqual(saved.chores, before.chores)
    assert.deepEqual(saved.expenses, before.expenses)
    const occupied = await api.mutate('/household/room-components', {
      roomId: 'kitchen', changes: [change({ ...plant, slotId: 'kitchen-table-center', version: 1 }, { slotId: 'kitchen-plant-counter' })],
    })
    assert.equal(occupied.status, 409)
    assert.deepEqual(await api.current(), saved)
  })
})
