import { describe, it } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/app.ts'
import { Store } from '../server/store.ts'
import type { AccountProvider } from '../server/provider.ts'
import { balances, billingDate, choreCompletionLimit, choreLimit, choreSchema, householdSchema } from '../shared/domain.ts'
import type { Chore, ChoreInput, Household, Session } from '../shared/domain.ts'
import { choreAssignee, nextChoreDate } from '../shared/chores.ts'
import { createPopulatedHousehold } from './household-fixture.ts'

const appOrigin = 'http://localhost:5173'
type RequestOptions = {
  method?: string; token?: string; cookie?: string; csrf?: string; householdId?: string; headers?: Record<string, string>
}

function input(memberId: string, overrides: Partial<ChoreInput> = {}): ChoreInput {
  return {
    title: 'Clear the sink', notes: '', roomId: 'kitchen', area: 'sink',
    dueDate: billingDate('UTC'), repeatDays: 7, rotation: [memberId], turn: 0, ...overrides,
  }
}

function unchangedFields(household: Household) {
  return {
    household: Object.fromEntries(Object.entries(household).filter(([key]) => key !== 'chores' && key !== 'version')),
    balances: [...balances(household)],
  }
}

async function fixture(context: TestContext, options: { persistent?: boolean; accounts?: boolean } = {}) {
  const filename = options.persistent ? resolve('data', `test-chores-${randomUUID()}.sqlite`) : ':memory:'
  let store = new Store(filename)
  let server: Server
  let origin: string
  const identities = new Map<string, string>()
  const provider: AccountProvider = {
    async sendCode() { throw new Error('Chore tests must not send email.') },
    async verifyCode(email, code) {
      assert.equal(code, '123456')
      if (!identities.has(email)) identities.set(email, randomUUID())
      return { providerId: identities.get(email)!, email }
    },
    async deleteUser() { throw new Error('Chore tests must not delete provider accounts.') },
  }
  const listen = async () => {
    server = createApp(store, { provider: options.accounts ? provider : undefined, appOrigin, allowLocalDevelopment: true }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }
  const close = async () => {
    const closed = once(server, 'close')
    server.close()
    await closed
    await store.close()
  }
  await listen()
  context.after(async () => {
    await close()
    if (filename !== ':memory:') {
      for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) rmSync(path, { force: true })
    }
  })
  const call = async (path: string, body?: unknown, options: RequestOptions = {}) => {
    const response = await fetch(`${origin}/api${path}`, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        'Content-Type': 'application/json', 'X-Roomlings-Request': '1', Origin: appOrigin,
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
        ...(options.householdId ? { 'X-Roomlings-Household': options.householdId } : {}),
        ...options.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { response, status: response.status, data: await response.json() }
  }
  const create = async (): Promise<Session> => {
    const result = await call('/households', {
      name: 'Our chores house', memberName: 'Ada', currency: 'EUR', budget: 45000,
    })
    assert.equal(result.status, 201, JSON.stringify(result.data))
    return result.data
  }
  const join = async (owner: Session, name = 'Ben'): Promise<Session> => {
    const result = await call('/join', { inviteCode: owner.household.inviteCode, name })
    assert.equal(result.status, 201, JSON.stringify(result.data))
    return result.data
  }
  const current = async (session: Session): Promise<Household> => {
    const result = await call('/household', undefined, { token: session.token })
    assert.equal(result.status, 200, JSON.stringify(result.data))
    return householdSchema.parse(result.data.household)
  }
  const change = async (session: Session, path: string, body: Record<string, unknown>, method?: string): Promise<Household> => {
    const state = await current(session)
    const result = await call(path, { ...body, version: state.version }, { token: session.token, method })
    assert.equal(result.status, 200, JSON.stringify(result.data))
    assert.deepEqual(Object.keys(result.data), ['household'])
    return householdSchema.parse(result.data.household)
  }
  const add = async (session: Session, overrides: Partial<ChoreInput> = {}): Promise<Chore> => {
    return (await change(session, '/chores', input(session.memberId, overrides))).chores.items.at(-1)!
  }
  const browser = () => {
    let cookie = ''
    let csrf = ''
    const request = async (path: string, body?: unknown, options: RequestOptions = {}) => {
      const result = await call(path, body, { cookie, csrf, ...options })
      const header = result.response.headers.get('set-cookie')
      if (header) cookie = header.split(';')[0]
      if (result.data.csrfToken) csrf = result.data.csrfToken
      return result
    }
    return {
      request,
      async signIn(email: string) {
        assert.equal((await request('/account/verify', { email, code: '123456', name: 'Ada', label: 'Chore test' })).status, 200)
      },
      async create() {
        const result = await request('/account/households', { name: 'Account home', memberName: 'Ada', currency: 'EUR', budget: 45000 })
        assert.equal(result.status, 201, JSON.stringify(result.data))
        return { household: householdSchema.parse(result.data.session.household), memberId: String(result.data.session.memberId) }
      },
    }
  }
  return {
    get store() { return store }, filename, call, create, join, current, change, add, browser,
    async restart(beforeOpen?: () => void) {
      await close()
      beforeOpen?.()
      store = new Store(filename)
      await listen()
    },
  }
}

async function seedLedger(store: Store, session: Session) {
  const state = (await store.get(session.household.id))!
  const participants = state.members.map((member) => member.id)
  const now = new Date().toISOString()
  const date = billingDate(state.billingTimeZone)
  const billId = randomUUID()
  const runId = randomUUID()
  const expenseId = randomUUID()
  state.bills.push({
    id: billId, createdAt: now, startMonth: date.slice(0, 7), pauses: [],
    revisions: [{ fromMonth: date.slice(0, 7), name: 'Rent', amount: 90000, dueDay: 1, participants }],
  })
  state.expenses.push({
    id: randomUUID(), description: 'Rent', amount: 90000, category: 'other', date, createdAt: now,
    paidBy: session.memberId, participants, bill: { billId, month: date.slice(0, 7), dueDate: `${date.slice(0, 7)}-01` },
  }, {
    id: expenseId, description: 'Milk run', amount: 1001, category: 'dairy', date, createdAt: now,
    paidBy: session.memberId, participants, shoppingRunId: runId,
  })
  state.settlements.push({ id: randomUUID(), from: state.members[1].id, to: session.memberId, amount: 200, createdAt: now })
  state.shopping.items.push({
    id: randomUUID(), name: 'Hand soap', quantity: '1 bottle', notes: '', createdBy: session.memberId,
    createdAt: now, updatedAt: now, claimedBy: null, pickedUp: false, version: 0,
  })
  state.shopping.runs.push({
    id: runId, expenseId, name: 'Milk run', completedBy: session.memberId, completedAt: now,
    items: [{ id: randomUUID(), name: 'Milk', quantity: '2 cartons', notes: '', createdBy: session.memberId, createdAt: now }],
  })
  await store.save(state)
}

describe('shared chores API', () => {
  it('starts new homes empty while populated test fixtures remain outside production creation', async (context) => {
    const f = await fixture(context)
    const personal = await f.create()
    assert.deepEqual(personal.household.chores, { items: [], history: [] })
    const populated = await createPopulatedHousehold(f.store)
    assert.equal(populated.household.chores.items.length, 4)
    assert.deepEqual(populated.household.members.map((member) => member.name), ['You', 'Jules', 'Sam', 'Alex'])
    assert.deepEqual(populated.household.expenses.map((expense) => expense.amount), [8632, 2840, 1875, 2490, 3620, 1260])
    assert.deepEqual(await f.current(populated), populated.household)
    assert.deepEqual(await f.current(personal), personal.household)
  })

  it('collaboratively creates, edits, completes, archives and restores chores without changing any finances', async (context) => {
    const f = await fixture(context)
    const owner = await f.create()
    const roommate = await f.join(owner)
    await seedLedger(f.store, owner)
    const before = unchangedFields(await f.current(owner))
    const foreignId = randomUUID()
    const created = await f.change(owner, '/chores', {
      ...input(owner.memberId, { rotation: [owner.memberId, roommate.memberId] }),
      id: foreignId, createdBy: roommate.memberId, archived: true, occurrence: 50,
    })
    const original = created.chores.items[0]
    assert.notEqual(original.id, foreignId)
    assert.equal(original.createdBy, owner.memberId)
    assert.equal(original.version, 0)
    assert.equal(original.occurrence, 0)
    assert.equal(original.archived, false)
    const editedInput = input(owner.memberId, {
      title: '  Clean the bathroom sink  ', roomId: 'bathroom', area: 'sink',
      rotation: [owner.memberId, roommate.memberId], turn: 1,
    })
    const edited = await f.change(roommate, `/chores/${original.id}`, {
      ...editedInput, choreVersion: 0, id: foreignId, createdBy: roommate.memberId, createdAt: '1900-01-01T00:00:00.000Z',
    }, 'PATCH')
    assert.equal(edited.chores.items[0].id, original.id)
    assert.equal(edited.chores.items[0].createdBy, original.createdBy)
    assert.equal(edited.chores.items[0].createdAt, original.createdAt)
    assert.equal(edited.chores.items[0].version, 1)
    const completed = await f.change(owner, `/chores/${original.id}/complete`, { choreVersion: 1, completedBy: roommate.memberId })
    const snapshot = completed.chores.history[0]
    assert.equal(snapshot.title, 'Clean the bathroom sink')
    assert.equal(snapshot.roomId, 'bathroom')
    assert.equal(snapshot.area, 'sink')
    assert.equal(snapshot.dueDate, editedInput.dueDate)
    assert.equal(snapshot.assignedTo, roommate.memberId)
    assert.equal(snapshot.completedBy, owner.memberId)
    assert.equal(snapshot.turn, 1)
    assert.equal(snapshot.resultVersion, 2)
    const archived = await f.change(roommate, `/chores/${original.id}/archive`, { archived: true, choreVersion: 2 }, 'PATCH')
    assert.equal(archived.chores.items[0].archived, true)
    assert.deepEqual(archived.chores.history[0], snapshot)
    for (const [path, body, method] of [
      [`/chores/${original.id}`, { ...editedInput }, 'PATCH'],
      [`/chores/${original.id}/complete`, {}, 'POST'],
      [`/chores/${original.id}/archive`, { archived: true }, 'PATCH'],
      [`/chores/completions/${snapshot.id}/undo`, {}, 'POST'],
    ] as const) {
      const result = await f.call(path, { ...body, version: archived.version, choreVersion: 3 }, { token: owner.token, method })
      assert.equal(result.status, 409, JSON.stringify(result.data))
    }
    const restored = await f.change(owner, `/chores/${original.id}/archive`, { archived: false, choreVersion: 3 }, 'PATCH')
    assert.equal(restored.chores.items[0].archived, false)
    const renamed = await f.change(roommate, `/chores/${original.id}`, {
      ...input(owner.memberId, { title: 'Sweep the kitchen floor', area: 'floor' }), choreVersion: 4,
    }, 'PATCH')
    assert.deepEqual(renamed.chores.history[0], snapshot)
    assert.equal((await f.call(`/chores/completions/${snapshot.id}/undo`, {
      version: renamed.version, choreVersion: 5,
    }, { token: owner.token })).status, 409)
    assert.deepEqual(unchangedFields(await f.current(owner)), before)
  })

  it('completes and undoes whole-home one-offs without deleting their completion history', async (context) => {
    const f = await fixture(context)
    const owner = await f.create()
    const roommate = await f.join(owner)
    const original = await f.add(owner, { roomId: null, area: null, repeatDays: null, rotation: [owner.memberId, roommate.memberId], turn: 1 })
    const completed = await f.change(owner, `/chores/${original.id}/complete`, { choreVersion: 0 })
    const completion = completed.chores.history[0]
    assert.equal(completed.chores.items[0].dueDate, null)
    assert.equal(completed.chores.items[0].occurrence, 1)
    assert.equal(completion.assignedTo, roommate.memberId)
    const duplicate = await f.call(`/chores/${original.id}/complete`, {
      choreVersion: 1, version: completed.version,
    }, { token: owner.token })
    assert.equal(duplicate.status, 409)
    assert.match(duplicate.data.error, /already completed/)
    const undone = await f.change(roommate, `/chores/completions/${completion.id}/undo`, { choreVersion: 1 })
    assert.equal(undone.chores.items[0].dueDate, original.dueDate)
    assert.equal(undone.chores.items[0].turn, 1)
    assert.equal(undone.chores.items[0].occurrence, 0)
    assert.equal(undone.chores.items[0].version, 2)
    assert.equal(undone.chores.history[0].undoneBy, roommate.memberId)
    assert.ok(undone.chores.history[0].undoneAt)
    const redone = await f.change(roommate, `/chores/${original.id}/complete`, { choreVersion: 2 })
    assert.equal(redone.chores.history.length, 2)
    assert.equal(redone.chores.history[0].occurrence, 0)
    assert.equal(redone.chores.history[0].resultVersion, 3)
    assert.deepEqual(redone.chores.history[1], undone.chores.history[0])
    assert.equal((await f.call(`/chores/completions/${completion.id}/undo`, {
      choreVersion: 3, version: redone.version,
    }, { token: owner.token })).status, 409)
    assert.deepEqual(await f.current(owner), redone)
  })

  it('serializes concurrent completion and undo requests and checks both global and per-chore versions', async (context) => {
    const f = await fixture(context)
    const owner = await f.create()
    const roommate = await f.join(owner)
    const entry = await f.add(owner, { rotation: [owner.memberId, roommate.memberId] })
    const before = await f.current(owner)
    const body = { choreVersion: 0, version: before.version }
    const attempts = await Promise.all([owner, roommate].map((session) => f.call(`/chores/${entry.id}/complete`, body, { token: session.token })))
    assert.deepEqual(attempts.map((result) => result.status).sort(), [200, 409])
    const saved = await f.current(owner)
    assert.equal(saved.chores.history.length, 1)
    assert.equal(saved.chores.items[0].occurrence, 1)
    assert.equal(saved.chores.items[0].turn, 1)
    assert.equal(saved.chores.history[0].completedBy, attempts[0].status === 200 ? owner.memberId : roommate.memberId)
    const staleTask = await f.call(`/chores/${entry.id}/complete`, { ...body, version: saved.version }, { token: owner.token })
    assert.equal(staleTask.status, 409)
    assert.match(staleTask.data.error, /Chore changed/)
    assert.equal((await f.call(`/chores/${entry.id}/complete`, { ...body, choreVersion: 1 }, { token: owner.token })).status, 409)
    const other = await f.add(roommate, { title: 'Wipe the mirror', roomId: 'bathroom', area: 'mirror' })
    const latest = await f.current(owner)
    const undoBody = { choreVersion: 1, version: latest.version }
    const undos = await Promise.all([owner, roommate].map((session) => f.call(
      `/chores/completions/${saved.chores.history[0].id}/undo`, undoBody, { token: session.token },
    )))
    assert.deepEqual(undos.map((result) => result.status).sort(), [200, 409])
    const undone = await f.current(owner)
    assert.equal(undone.chores.items[0].version, 2)
    assert.equal(undone.chores.items[0].occurrence, 0)
    assert.equal(undone.chores.history[0].undoneBy, undos[0].status === 200 ? owner.memberId : roommate.memberId)
    assert.deepEqual(undone.chores.items[1], other)
  })

  it('rejects foreign or malformed IDs, invalid inputs and unauthenticated mutations without changing state', async (context) => {
    const f = await fixture(context)
    const owner = await f.create()
    const entry = await f.add(owner)
    const saved = await f.change(owner, `/chores/${entry.id}/complete`, { choreVersion: 0 })
    const other = await f.create()
    const paths = [
      { path: `/chores/${entry.id}`, body: input(other.memberId), method: 'PATCH' },
      { path: `/chores/${entry.id}/archive`, body: { archived: true }, method: 'PATCH' },
      { path: `/chores/${entry.id}/complete`, body: {}, method: 'POST' },
      { path: `/chores/completions/${saved.chores.history[0].id}/undo`, body: {}, method: 'POST' },
    ]
    for (const action of paths) {
      const body = { ...action.body, version: other.household.version, choreVersion: 1 }
      const foreign = await f.call(action.path, body, { token: other.token, method: action.method })
      assert.equal(foreign.status, 404, JSON.stringify(foreign.data))
      assert.match(foreign.data.error, /not found in this home/)
      assert.equal((await f.call(action.path, body, { method: action.method })).status, 401)
      const malformed = action.path.replace(action.path.includes('/completions/') ? saved.chores.history[0].id : entry.id, 'not-a-uuid')
      assert.equal((await f.call(malformed, body, { token: other.token, method: action.method })).status, 400)
    }
    assert.equal((await f.call(`/chores/${randomUUID()}/complete`, {
      version: saved.version, choreVersion: 0,
    }, { token: owner.token })).status, 404)
    for (const invalid of [
      { title: '' }, { notes: 'x'.repeat(241) }, { dueDate: '2026-02-30' }, { dueDate: '1899-12-31' },
      { dueDate: null }, { roomId: 'bathroom', area: 'fridge' }, { roomId: null, area: 'sink' },
      { repeatDays: 0 }, { repeatDays: 366 }, { rotation: [] }, { rotation: [owner.memberId, owner.memberId] },
      { rotation: [other.memberId] }, { turn: 1 }, { version: -1 },
    ]) {
      const result = await f.call('/chores', { ...input(owner.memberId), version: saved.version, ...invalid }, { token: owner.token })
      assert.equal(result.status, 400, JSON.stringify(invalid))
      assert.equal(typeof result.data.error, 'string')
    }
    assert.equal((await f.call('/chores', { ...input(owner.memberId), version: saved.version })).status, 401)
    for (const choreVersion of [undefined, -1, 0.5, '1']) {
      assert.equal((await f.call(`/chores/${entry.id}/complete`, { choreVersion, version: saved.version }, { token: owner.token })).status, 400)
    }
    assert.equal((await f.call(`/chores/${entry.id}/archive`, { archived: 'true', choreVersion: 1, version: saved.version }, {
      token: owner.token, method: 'PATCH',
    })).status, 400)
    assert.deepEqual(await f.current(owner), saved)
    assert.deepEqual(await f.current(other), other.household)
  })

  it('keeps inactive assignment history, skips departed roommates and requires active rotations on new inputs', async (context) => {
    const f = await fixture(context)
    const owner = await f.create()
    const roommate = await f.join(owner)
    const third = await f.join(owner, 'Cara')
    const entry = await f.add(owner, { rotation: [roommate.memberId] })
    const first = await f.change(third, `/chores/${entry.id}/complete`, { choreVersion: 0 })
    const state = (await f.store.get(owner.household.id))!
    state.members.find((member) => member.id === roommate.memberId)!.inactive = true
    state.version++
    await f.store.save(state)
    assert.equal((await f.call('/household', undefined, { token: roommate.token })).status, 401)
    const unassigned = await f.current(owner)
    assert.equal(choreAssignee(unassigned.chores.items[0], unassigned.members), null)
    assert.equal(unassigned.chores.items[0].version, 1)
    assert.deepEqual(unassigned.chores.history[0], first.chores.history[0])
    assert.deepEqual(await f.current(owner), unassigned)
    assert.equal((await f.call('/chores', { ...input(roommate.memberId), version: unassigned.version }, { token: owner.token })).status, 400)
    assert.equal((await f.call(`/chores/${entry.id}`, {
      ...input(roommate.memberId), version: unassigned.version, choreVersion: 1,
    }, { token: owner.token, method: 'PATCH' })).status, 400)
    const completed = await f.change(owner, `/chores/${entry.id}/complete`, { choreVersion: 1 })
    assert.equal(completed.chores.history[0].assignedTo, null)
    assert.equal(completed.chores.history[0].completedBy, owner.memberId)
    assert.equal(completed.chores.history[1].assignedTo, roommate.memberId)
    assert.equal(completed.chores.items[0].turn, 0)
    const undone = await f.change(third, `/chores/completions/${completed.chores.history[0].id}/undo`, { choreVersion: 2 })
    assert.equal(undone.chores.history[0].undoneBy, third.memberId)
    assert.equal(choreAssignee(undone.chores.items[0], undone.members), null)
  })

  it('reports retained task and completion limits explicitly without deleting history or blocking a valid undo', async (context) => {
    const f = await fixture(context)
    const owner = await f.create()
    const entry = await f.add(owner)
    const state = await f.current(owner)
    state.chores.items = Array.from({ length: choreLimit }, (_, index) => ({ ...entry, id: index ? randomUUID() : entry.id, archived: index > 0 }))
    await f.store.save(state)
    const full = await f.call('/chores', { ...input(owner.memberId), version: state.version }, { token: owner.token })
    assert.equal(full.status, 409)
    assert.match(full.data.error, /200 chores/)
    const now = new Date().toISOString()
    const version = choreCompletionLimit * 2
    state.chores.items[0].version = version
    state.chores.items[0].occurrence = 1
    state.chores.items[0].dueDate = nextChoreDate(entry.dueDate!, 7, billingDate(state.billingTimeZone))
    state.chores.history = Array.from({ length: choreCompletionLimit }, (_, index) => ({
      id: randomUUID(), choreId: entry.id, occurrence: 0, title: entry.title, roomId: entry.roomId, area: entry.area,
      dueDate: entry.dueDate!, turn: 0, assignedTo: owner.memberId, completedBy: owner.memberId, completedAt: now,
      resultVersion: index === 0 ? version : index * 2 + 1,
      undoneAt: index === 0 ? null : now, undoneBy: index === 0 ? null : owner.memberId,
    }))
    await f.store.save(state)
    const historyFull = await f.call(`/chores/${entry.id}/complete`, { choreVersion: version, version: state.version }, { token: owner.token })
    assert.equal(historyFull.status, 409)
    assert.match(historyFull.data.error, /20,000-completion history limit/)
    const unchanged = (await f.store.get(state.id))!
    assert.deepEqual(unchanged, state)
    const undo = await f.call(`/chores/completions/${state.chores.history[0].id}/undo`, {
      choreVersion: version, version: state.version,
    }, { token: owner.token })
    assert.equal(undo.status, 200, JSON.stringify(undo.data.error))
    assert.equal(undo.data.household.chores.history.length, choreCompletionLimit)
    assert.equal(undo.data.household.chores.items.length, choreLimit)
    assert.equal(undo.data.household.chores.history[0].undoneBy, owner.memberId)
    assert.equal(undo.data.household.chores.items[0].version, version + 1)
  })

  it('rolls back every chore mutation if persistence writes and then fails, leaving retries available', async (context) => {
    const f = await fixture(context)
    const owner = await f.create()
    const entry = await f.add(owner)
    const before = await f.current(owner)
    const save = f.store.save
    const failingSave = context.mock.method(f.store, 'save', async (state: Household) => {
      await save(state)
      throw new Error('Simulated chore persistence failure after writing')
    })
    try {
      for (const [path, body, method] of [
        ['/chores', input(owner.memberId), 'POST'],
        [`/chores/${entry.id}`, input(owner.memberId, { title: 'Changed title' }), 'PATCH'],
        [`/chores/${entry.id}/archive`, { archived: true }, 'PATCH'],
        [`/chores/${entry.id}/complete`, {}, 'POST'],
      ] as const) {
        const result = await f.call(path, { ...body, version: before.version, choreVersion: 0 }, { token: owner.token, method })
        assert.equal(result.status, 500)
        assert.equal(result.data.household, undefined)
        assert.deepEqual(await f.current(owner), before)
      }
    } finally {
      failingSave.mock.restore()
    }
    const completed = await f.change(owner, `/chores/${entry.id}/complete`, { choreVersion: 0 })
    const failingUndo = context.mock.method(f.store, 'save', async (state: Household) => {
      await save(state)
      throw new Error('Simulated chore undo persistence failure after writing')
    })
    const path = `/chores/completions/${completed.chores.history[0].id}/undo`
    try {
      const result = await f.call(path, { version: completed.version, choreVersion: 1 }, { token: owner.token })
      assert.equal(result.status, 500)
      assert.equal(result.data.household, undefined)
    } finally {
      failingUndo.mock.restore()
    }
    assert.deepEqual(await f.current(owner), completed)
    const undone = await f.change(owner, path, { choreVersion: 1 })
    assert.equal(undone.chores.history.length, 1)
    assert.equal(undone.chores.items[0].version, 2)
    assert.equal(undone.chores.items[0].occurrence, 0)
  })

  it('uses the household billing time zone for recurrence at midnight and across daylight saving', async (context) => {
    context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-08T04:30:00Z') })
    const f = await fixture(context)
    const owner = await f.create()
    const state = await f.current(owner)
    state.billingTimeZone = 'America/New_York'
    await f.store.save(state)
    const entry = await f.add(owner, { dueDate: '2026-03-07', repeatDays: 1 })
    const first = await f.change(owner, `/chores/${entry.id}/complete`, { choreVersion: 0 })
    assert.equal(first.chores.items[0].dueDate, '2026-03-08')
    context.mock.timers.tick(3 * 60 * 60 * 1000)
    const second = await f.change(owner, `/chores/${entry.id}/complete`, { choreVersion: 1 })
    assert.equal(second.chores.items[0].dueDate, '2026-03-09')
    assert.equal(second.chores.items[0].occurrence, 2)
    assert.deepEqual(second.chores.history.map((completion) => completion.dueDate), ['2026-03-08', '2026-03-07'])
    assert.equal((await f.call(`/chores/completions/${first.chores.history[0].id}/undo`, {
      choreVersion: 2, version: second.version,
    }, { token: owner.token })).status, 409)
  })

  it('enforces cookie CSRF and explicit household authorization for every chore mutation', async (context) => {
    const f = await fixture(context, { accounts: true })
    const owner = f.browser()
    await owner.signIn('chores-owner@example.com')
    const first = await owner.create()
    const created = await owner.request('/chores', { ...input(first.memberId), version: first.household.version })
    assert.equal(created.status, 200)
    const entry = choreSchema.parse(created.data.household.chores.items[0])
    const completed = await owner.request(`/chores/${entry.id}/complete`, { choreVersion: 0, version: created.data.household.version })
    assert.equal(completed.status, 200)
    const state = householdSchema.parse(completed.data.household)
    for (const [path, body, method] of [
      ['/chores', input(first.memberId), 'POST'],
      [`/chores/${entry.id}`, input(first.memberId), 'PATCH'],
      [`/chores/${entry.id}/archive`, { archived: true }, 'PATCH'],
      [`/chores/${entry.id}/complete`, {}, 'POST'],
      [`/chores/completions/${state.chores.history[0].id}/undo`, {}, 'POST'],
    ] as const) {
      assert.equal((await owner.request(path, { ...body, version: state.version, choreVersion: 1 }, { csrf: '', method })).status, 403)
    }
    assert.equal((await owner.request(`/chores/${entry.id}/complete`, { choreVersion: 1, version: state.version }, { csrf: 'wrong-token' })).status, 403)
    assert.equal((await owner.request(`/chores/${entry.id}/complete`, { choreVersion: 1, version: state.version }, {
      headers: { Origin: 'https://attacker.example' },
    })).status, 403)
    const second = await owner.create()
    assert.equal((await owner.request(`/chores/${entry.id}/complete`, { choreVersion: 1, version: second.household.version }, {
      householdId: second.household.id,
    })).status, 404)
    const stranger = f.browser()
    await stranger.signIn('chores-stranger@example.com')
    const foreign = await stranger.create()
    assert.equal((await owner.request('/chores', { ...input(first.memberId), version: foreign.household.version }, {
      householdId: foreign.household.id,
    })).status, 403)
    const edited = await owner.request(`/chores/${entry.id}`, {
      ...input(first.memberId, { title: 'Edited in the first home' }), version: state.version, choreVersion: 1,
    }, { method: 'PATCH', householdId: first.household.id })
    assert.equal(edited.status, 200)
    assert.equal(edited.data.household.id, first.household.id)
    assert.deepEqual((await f.store.get(second.household.id))!.chores, { items: [], history: [] })
    assert.deepEqual((await f.store.get(foreign.household.id))!.chores, { items: [], history: [] })
  })

  it('keeps existing chores canonical when a legacy home is linked to a verified account', async (context) => {
    const f = await fixture(context, { accounts: true })
    const legacy = await f.store.create('Existing chores home', 'Ada', 'EUR', 45000)
    const entry = await f.add(legacy, { roomId: 'bathroom', area: 'sink' })
    const completed = await f.change(legacy, `/chores/${entry.id}/complete`, { choreVersion: 0 })
    const owner = f.browser()
    await owner.signIn('linked-chores@example.com')
    const linked = await owner.request('/account/link', { token: legacy.token })
    assert.equal(linked.status, 200, JSON.stringify(linked.data))
    const linkedState = householdSchema.parse(linked.data.session.household)
    assert.equal(linked.data.session.memberId, legacy.memberId)
    assert.deepEqual(linkedState.chores, completed.chores)
    assert.deepEqual(unchangedFields(linkedState), unchangedFields(completed))
    assert.deepEqual(await f.current(legacy), linkedState)
    const undone = await owner.request(`/chores/completions/${completed.chores.history[0].id}/undo`, {
      version: linkedState.version, choreVersion: 1,
    })
    assert.equal(undone.status, 200, JSON.stringify(undone.data))
    const state = householdSchema.parse(undone.data.household)
    assert.equal(state.chores.history[0].undoneBy, legacy.memberId)
    assert.deepEqual(await f.current(legacy), state)
    assert.deepEqual(householdSchema.parse((await owner.request('/household')).data.household), state)
  })

  it('preserves chores and finances through managed member removal, both auth paths, restart and rejoining', async (context) => {
    const f = await fixture(context, { accounts: true, persistent: true })
    const owner = f.browser()
    await owner.signIn('managed-chores-owner@example.com')
    const first = await owner.create()
    assert.deepEqual(first.household.chores, { items: [], history: [] })
    const invitation = await owner.request(`/account/households/${first.household.id}/invitations`, {
      version: first.household.version, expiresInDays: 7,
    })
    assert.equal(invitation.status, 201, JSON.stringify(invitation.data))
    const roommate = f.browser()
    await roommate.signIn('managed-chores-roommate@example.com')
    const joined = await roommate.request('/account/invitations/accept', { code: invitation.data.code, memberName: 'Ben' })
    assert.equal(joined.status, 200, JSON.stringify(joined.data))
    const joinedState = householdSchema.parse(joined.data.session.household)
    const roommateId = String(joined.data.session.memberId)
    const ownerLegacy = await f.store.session(joinedState, first.memberId)
    const roommateLegacy = await f.store.session(joinedState, roommateId)
    await seedLedger(f.store, ownerLegacy)
    const entry = await f.add(ownerLegacy, { rotation: [roommateId] })
    const accountRead = await owner.request('/household')
    const created = householdSchema.parse(accountRead.data.household)
    assert.deepEqual(await f.current(ownerLegacy), created)
    const completed = await roommate.request(`/chores/${entry.id}/complete`, { version: created.version, choreVersion: 0 })
    assert.equal(completed.status, 200, JSON.stringify(completed.data))
    const beforeRemoval = householdSchema.parse(completed.data.household)
    assert.equal(beforeRemoval.chores.history[0].assignedTo, roommateId)
    assert.equal(beforeRemoval.chores.history[0].completedBy, roommateId)
    assert.deepEqual(await f.current(roommateLegacy), beforeRemoval)
    const removal = await owner.request(`/account/households/${first.household.id}/members/${roommateId}`, {
      version: beforeRemoval.version,
    }, { method: 'DELETE' })
    assert.equal(removal.status, 200, JSON.stringify(removal.data))
    const removed = householdSchema.parse(removal.data.household)
    assert.equal(removed.members.find((member) => member.id === roommateId)!.inactive, true)
    assert.deepEqual(removed.chores, beforeRemoval.chores)
    assert.deepEqual(unchangedFields(removed), unchangedFields({ ...beforeRemoval, members: removed.members }))
    assert.equal(choreAssignee(removed.chores.items[0], removed.members), null)
    assert.equal((await f.call(`/chores/${entry.id}/complete`, {
      version: removed.version, choreVersion: 1,
    }, { token: roommateLegacy.token })).status, 401)
    assert.equal((await roommate.request(`/chores/${entry.id}/complete`, {
      version: removed.version, choreVersion: 1,
    }, { householdId: removed.id })).status, 403)
    assert.equal((await owner.request('/chores', { ...input(roommateId), version: removed.version })).status, 400)
    assert.equal((await owner.request(`/chores/${entry.id}`, {
      ...input(roommateId), version: removed.version, choreVersion: 1,
    }, { method: 'PATCH' })).status, 400)
    const undone = await owner.request(`/chores/completions/${removed.chores.history[0].id}/undo`, {
      version: removed.version, choreVersion: 1,
    })
    assert.equal(undone.status, 200, JSON.stringify(undone.data))
    assert.equal(undone.data.household.chores.history[0].completedBy, roommateId)
    assert.equal(undone.data.household.chores.history[0].undoneBy, first.memberId)
    const redone = await f.change(ownerLegacy, `/chores/${entry.id}/complete`, { choreVersion: 2 })
    assert.equal(redone.chores.history[0].assignedTo, null)
    assert.equal(redone.chores.history[0].completedBy, first.memberId)
    assert.equal(redone.chores.history[1].assignedTo, roommateId)
    assert.deepEqual(unchangedFields(redone), unchangedFields(removed))
    await f.restart()
    assert.deepEqual(await f.current(ownerLegacy), redone)
    assert.deepEqual(householdSchema.parse((await owner.request('/household')).data.household), redone)
    assert.equal((await roommate.request('/household', undefined, { householdId: removed.id })).status, 403)
    assert.equal(await f.store.authenticate(roommateLegacy.token), null)
    const freshInvitation = await owner.request(`/account/households/${redone.id}/invitations`, {
      version: redone.version, expiresInDays: 7,
    })
    assert.equal(freshInvitation.status, 201, JSON.stringify(freshInvitation.data))
    const rejoined = await roommate.request('/account/invitations/accept', { code: freshInvitation.data.code, memberName: 'Ben' })
    assert.equal(rejoined.status, 200, JSON.stringify(rejoined.data))
    const restored = householdSchema.parse(rejoined.data.session.household)
    assert.equal(rejoined.data.session.memberId, roommateId)
    assert.deepEqual(restored.chores, redone.chores)
    assert.equal(choreAssignee(restored.chores.items[0], restored.members)?.id, roommateId)
    assert.deepEqual(unchangedFields(restored), unchangedFields({ ...redone, members: restored.members }))
    assert.deepEqual(await f.current(ownerLegacy), restored)
    assert.equal(await f.store.authenticate(roommateLegacy.token), null)
  })

  it('persists chores, archived snapshots, undone history and existing access across a restart', async (context) => {
    const f = await fixture(context, { persistent: true })
    const owner = await f.create()
    await f.join(owner)
    await seedLedger(f.store, owner)
    const entry = await f.add(owner, { roomId: null, area: null, repeatDays: null })
    const first = await f.change(owner, `/chores/${entry.id}/complete`, { choreVersion: 0 })
    await f.change(owner, `/chores/completions/${first.chores.history[0].id}/undo`, { choreVersion: 1 })
    await f.change(owner, `/chores/${entry.id}/complete`, { choreVersion: 2 })
    const saved = await f.change(owner, `/chores/${entry.id}/archive`, { archived: true, choreVersion: 3 }, 'PATCH')
    await f.restart()
    assert.deepEqual(await f.current(owner), saved)
    assert.equal((await f.store.authenticate(owner.token))!.memberId, owner.memberId)
    assert.equal(saved.chores.history.length, 2)
    assert.ok(saved.chores.history[1].undoneAt)
    assert.equal(saved.chores.items[0].archived, true)
  })

  it('reads an older real household marker with empty chores without replacing its existing session', async (context) => {
    const f = await fixture(context, { persistent: true })
    const owner = await f.create()
    const legacy = {
      ...Object.fromEntries(Object.entries(owner.household).filter(([key]) => key !== 'chores')),
      demo: false,
    }
    await f.restart(() => {
      const database = new DatabaseSync(f.filename)
      try {
        database.prepare('UPDATE households SET state = ? WHERE id = ?').run(JSON.stringify(legacy), owner.household.id)
      } finally {
        database.close()
      }
    })
    const restored = await f.current(owner)
    assert.deepEqual(restored, { ...owner.household, chores: { items: [], history: [] } })
    assert.equal('demo' in restored, false)
    assert.deepEqual(unchangedFields(restored), unchangedFields(owner.household))
    assert.equal((await f.store.authenticate(owner.token))!.memberId, owner.memberId)
    await f.change(owner, '/chores', input(owner.memberId))
    await f.restart()
    assert.equal((await f.current(owner)).chores.items.length, 1)
  })
})
