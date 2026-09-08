import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  balances, billingDate, choreArchiveSchema, choreCompletionLimit, choreCompletionSchema, choreEditInputSchema,
  choreInputSchema, choreLimit, choreSchema, choreVersionSchema, householdSchema,
} from '../shared/domain.ts'
import type { Chore, ChoreInput, Household } from '../shared/domain.ts'
import { canUndoChore, choreAssignee, choreStatus, completeChore, nextChoreDate, undoChoreCompletion } from '../shared/chores.ts'
import { roomCatalog } from '../shared/rooms.ts'

const createdAt = '2026-09-01T12:00:00.000Z'
const completedAt = '2026-09-08T12:00:00.000Z'
const undoneAt = '2026-09-08T13:00:00.000Z'

function household(): Household {
  return householdSchema.parse({
    id: randomUUID(), name: 'The chores house', currency: 'EUR', budget: 45000, inviteCode: 'test-invitation',
    demo: false, version: 0,
    members: ['Ada', 'Ben', 'Cara', 'Drew'].map((name) => ({ id: randomUUID(), name, color: '#789359' })),
    expenses: [], settlements: [],
  })
}

function input(state: Household, overrides: Partial<ChoreInput> = {}): ChoreInput {
  return {
    title: 'Clear the sink', notes: '', roomId: 'kitchen', area: 'sink', dueDate: '2026-09-08',
    repeatDays: 7, rotation: state.members.map((member) => member.id), turn: 0, ...overrides,
  }
}

function chore(state: Household, overrides: Partial<Chore> = {}): Chore {
  return choreSchema.parse({
    ...input(state), id: randomUUID(), createdBy: state.members[0].id, createdAt, updatedAt: createdAt,
    version: 0, occurrence: 0, archived: false, ...overrides,
  })
}

describe('shared chores schema', () => {
  it('defaults old household JSON to empty chores without changing any existing fields or balances', () => {
    const state = household()
    state.expenses.push({
      id: randomUUID(), description: 'Groceries', amount: 1001, paidBy: state.members[0].id,
      participants: state.members.map((member) => member.id), category: 'pantry', date: '2026-09-01', createdAt,
    })
    const old = Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'chores'))
    const migrated = householdSchema.parse(old)
    assert.deepEqual(migrated, { ...old, chores: { items: [], history: [] } })
    assert.deepEqual([...balances(migrated)], [...balances(state)])
    migrated.chores.items.push(chore(migrated))
    assert.deepEqual(householdSchema.parse(old).chores, { items: [], history: [] })
  })

  it('validates bounded, trimmed inputs, distinct UUID rotations, cursors and task versions', () => {
    const state = household()
    const valid = input(state)
    assert.deepEqual(choreInputSchema.parse({ ...valid, title: '  Wipe the mirror  ', notes: undefined, turn: undefined }), {
      ...valid, title: 'Wipe the mirror', notes: '', turn: 0,
    })
    assert.equal(choreInputSchema.parse({ ...valid, notes: '  Use a soft cloth.  ' }).notes, 'Use a soft cloth.')
    assert.equal(choreInputSchema.safeParse({ ...valid, repeatDays: null, dueDate: '1900-01-01', rotation: [state.members[0].id] }).success, true)
    assert.equal(choreInputSchema.safeParse({ ...valid, repeatDays: 365, title: 'x'.repeat(80), notes: 'x'.repeat(240) }).success, true)
    for (const invalid of [
      { title: '' }, { title: '   ' }, { title: 'x'.repeat(81) }, { notes: 'x'.repeat(241) },
      { dueDate: null }, { dueDate: '1899-12-31' }, { dueDate: '2026-02-29' }, { dueDate: '2026-04-31' },
      { repeatDays: 0 }, { repeatDays: 366 }, { repeatDays: 1.5 }, { repeatDays: '7' },
      { rotation: [] }, { rotation: ['not-a-uuid'] }, { rotation: [state.members[0].id, state.members[0].id] },
      { rotation: Array.from({ length: 13 }, () => randomUUID()) }, { turn: -1 }, { turn: 0.5 }, { turn: 4 },
    ]) {
      assert.equal(choreInputSchema.safeParse({ ...valid, ...invalid }).success, false, JSON.stringify(invalid))
    }
    assert.equal(choreEditInputSchema.safeParse({ ...valid, choreVersion: 0 }).success, true)
    assert.equal(choreEditInputSchema.safeParse({ ...valid, choreVersion: -1 }).success, false)
    assert.equal(choreEditInputSchema.safeParse(valid).success, false)
    assert.equal(choreVersionSchema.safeParse({ choreVersion: '0' }).success, false)
    assert.equal(choreArchiveSchema.safeParse({ choreVersion: 0, archived: false }).success, true)
    assert.equal(choreArchiveSchema.safeParse({ choreVersion: 0, archived: 'false' }).success, false)
    assert.equal(choreSchema.safeParse({ ...chore(state), dueDate: null }).success, false)
    assert.equal(choreSchema.safeParse({ ...chore(state), occurrence: 1 }).success, false)
  })

  it('accepts whole-home and room-wide chores while checking every room-specific area', () => {
    const state = household()
    assert.equal(choreInputSchema.safeParse(input(state, { roomId: null, area: null })).success, true)
    for (const roomId of ['kitchen', 'bathroom'] as const) {
      assert.equal(choreInputSchema.safeParse(input(state, { roomId, area: null })).success, true)
      for (const area of roomCatalog[roomId].areas) {
        assert.equal(choreInputSchema.safeParse(input(state, { roomId, area: area.id })).success, true)
      }
    }
    for (const location of [
      { roomId: null, area: 'sink' }, { roomId: 'bathroom', area: 'fridge' },
      { roomId: 'kitchen', area: 'toilet' }, { roomId: 'bedroom', area: null }, { roomId: 'bathroom', area: 'shower' },
    ]) {
      assert.equal(choreInputSchema.safeParse({ ...input(state), ...location }).success, false)
    }
  })

  it('retains inactive references but rejects unknown identities, duplicate chores and invalid completion history', () => {
    const state = household()
    const original = chore(state, { turn: 3 })
    const result = completeChore(original, state.members, state.members[1].id, randomUUID(), completedAt, '2026-09-08')
    state.chores = { items: [result.chore], history: [result.completion] }
    state.members[0].inactive = true
    state.members[1].inactive = true
    assert.equal(householdSchema.safeParse(state).success, true)
    for (const invalid of [
      { createdBy: randomUUID() }, { rotation: [randomUUID()] }, { id: 'invalid' },
    ]) {
      assert.equal(householdSchema.safeParse({ ...state, chores: { ...state.chores, items: [{ ...result.chore, ...invalid }] } }).success, false)
    }
    assert.equal(householdSchema.safeParse({ ...state, chores: { ...state.chores, items: [result.chore, result.chore] } }).success, false)
    for (const invalid of [
      { choreId: randomUUID() }, { completedBy: randomUUID() }, { assignedTo: randomUUID() },
      { undoneAt, undoneBy: randomUUID() }, { resultVersion: 2 }, { occurrence: 1, resultVersion: 2 },
      { undoneAt, undoneBy: null }, { undoneAt: null, undoneBy: state.members[2].id },
      { roomId: 'bathroom', area: 'fridge' }, { dueDate: null }, { id: 'invalid' }, { turn: 12 },
    ]) {
      assert.equal(householdSchema.safeParse({ ...state, chores: { ...state.chores, history: [{ ...result.completion, ...invalid }] } }).success, false, JSON.stringify(invalid))
    }
    assert.equal(householdSchema.safeParse({
      ...state, chores: { ...state.chores, history: [result.completion, { ...result.completion, id: randomUUID() }] },
    }).success, false)
    assert.equal(householdSchema.safeParse({
      ...state, chores: { ...state.chores, history: [result.completion, { ...result.completion, undoneAt, undoneBy: state.members[2].id }] },
    }).success, false)
    const edited = { ...result.chore, title: 'A new title', roomId: null, area: null, rotation: [state.members[2].id], turn: 0, version: 2, archived: true }
    assert.equal(householdSchema.safeParse({ ...state, chores: { items: [edited], history: [result.completion] } }).success, true)
    assert.equal(choreCompletionSchema.parse(result.completion).title, original.title)
    assert.equal(choreCompletionSchema.parse(result.completion).turn, 3)
  })

  it('bounds retained chores and history, including archived tasks and undone records', () => {
    const state = household()
    state.chores.items = Array.from({ length: choreLimit }, () => chore(state, { archived: true }))
    assert.equal(householdSchema.safeParse(state).success, true)
    state.chores.items.push(chore(state))
    assert.equal(householdSchema.safeParse(state).success, false)
    const result = completeChore(chore(state), state.members, state.members[0].id, randomUUID(), completedAt, '2026-09-08')
    state.chores.items = [result.chore]
    state.chores.history = Array.from({ length: choreCompletionLimit }, () => ({
      ...result.completion, id: randomUUID(), undoneAt, undoneBy: state.members[0].id,
    }))
    assert.equal(householdSchema.safeParse(state).success, true)
    state.chores.history.push({ ...result.completion, id: randomUUID() })
    assert.equal(householdSchema.safeParse(state).success, false)
  })
})

describe('chore scheduling and rotation', () => {
  it('advances calendar intervals from the scheduled date, skipping missed intervals without drifting', () => {
    for (const [dueDate, repeatDays, today, expected] of [
      ['2026-09-08', 7, '2026-09-06', '2026-09-15'],
      ['2026-09-08', 7, '2026-09-08', '2026-09-15'],
      ['2026-09-08', 7, '2026-09-15', '2026-09-22'],
      ['2026-09-01', 7, '2026-09-30', '2026-10-06'],
      ['2024-02-28', 1, '2024-02-28', '2024-02-29'],
      ['2024-02-29', 1, '2024-02-29', '2024-03-01'],
      ['2024-02-29', 365, '2024-02-29', '2025-02-28'],
      ['2026-12-31', 1, '2026-12-31', '2027-01-01'],
      ['1900-01-01', 1, '2026-09-08', '2026-09-09'],
    ] as const) {
      assert.equal(nextChoreDate(dueDate, repeatDays, today), expected, `${dueDate}/${repeatDays}/${today}`)
    }
    assert.throws(() => nextChoreDate('2026-02-30', 7, '2026-09-08'))
    assert.throws(() => nextChoreDate('2026-09-08', 0, '2026-09-08'))
    assert.throws(() => nextChoreDate('2026-09-08', 366, '2026-09-08'))
    assert.throws(() => nextChoreDate('2026-09-08', 1, 'not-a-date'))
    assert.throws(() => nextChoreDate('9999-12-31', 1, '9999-12-31'), /supported calendar/)
  })

  it('uses the household calendar across spring, autumn and midnight time-zone boundaries', () => {
    const beforeSpring = billingDate('America/New_York', new Date('2026-03-08T04:30:00Z'))
    const spring = billingDate('America/New_York', new Date('2026-03-08T07:30:00Z'))
    const autumn = billingDate('America/New_York', new Date('2026-11-01T06:30:00Z'))
    assert.equal(beforeSpring, '2026-03-07')
    assert.equal(nextChoreDate('2026-03-07', 1, beforeSpring), '2026-03-08')
    assert.equal(nextChoreDate('2026-03-07', 1, spring), '2026-03-09')
    assert.equal(nextChoreDate('2026-10-31', 1, autumn), '2026-11-02')
    assert.equal(nextChoreDate('2026-09-08', 1, billingDate('Pacific/Kiritimati', new Date('2026-09-08T12:00:00Z'))), '2026-09-10')
    assert.equal(nextChoreDate('2026-09-08', 1, billingDate('America/Los_Angeles', new Date('2026-09-08T02:00:00Z'))), '2026-09-09')
  })

  it('derives status and assignees without advancing a task on reads or inventing an inactive default', () => {
    const state = household()
    const entry = chore(state)
    state.members[0].inactive = true
    state.members[1].inactive = true
    const before = structuredClone(entry)
    assert.equal(choreAssignee(entry, state.members)?.id, state.members[2].id)
    assert.equal(choreStatus(entry, '2026-09-07'), 'upcoming')
    assert.equal(choreStatus(entry, '2026-09-08'), 'due')
    assert.equal(choreStatus(entry, '2026-12-01'), 'overdue')
    assert.equal(choreStatus({ ...entry, dueDate: null, repeatDays: null }, '2026-09-08'), 'completed')
    assert.equal(choreStatus({ ...entry, archived: true, dueDate: null }, '2026-09-08'), 'archived')
    assert.equal(choreAssignee({ ...entry, rotation: [state.members[0].id] }, state.members), null)
    state.members.forEach((member) => { member.inactive = true })
    assert.equal(choreAssignee(entry, state.members), null)
    assert.deepEqual(entry, before)
  })

  it('skips inactive roommates, records the actual actor, and advances once even when badly overdue', () => {
    const state = household()
    state.members[0].inactive = true
    state.members[2].inactive = true
    const original = chore(state, { dueDate: '2026-01-01' })
    const before = structuredClone(original)
    const result = completeChore(original, state.members, state.members[3].id, randomUUID(), completedAt, '2026-09-08')
    assert.equal(result.completion.assignedTo, state.members[1].id)
    assert.equal(result.completion.completedBy, state.members[3].id)
    assert.equal(result.completion.turn, 0)
    assert.equal(result.completion.dueDate, '2026-01-01')
    assert.equal(result.chore.turn, 3)
    assert.equal(choreAssignee(result.chore, state.members)?.id, state.members[3].id)
    assert.equal(result.chore.occurrence, 1)
    assert.equal(result.chore.version, 1)
    assert.equal(result.completion.occurrence, 0)
    assert.equal(result.completion.resultVersion, 1)
    assert.equal(result.chore.dueDate, nextChoreDate(original.dueDate!, 7, '2026-09-08'))
    assert.deepEqual(original, before)
    const again = completeChore(result.chore, state.members, state.members[1].id, randomUUID(), completedAt, '2026-09-08')
    assert.equal(again.chore.turn, 1)
    assert.equal(again.chore.occurrence, 2)
  })

  it('supports fixed assignments and unassigned rotations without blocking another active roommate', () => {
    const state = household()
    const fixed = chore(state, { rotation: [state.members[0].id] })
    assert.equal(completeChore(fixed, state.members, state.members[1].id, randomUUID(), completedAt, '2026-09-08').chore.turn, 0)
    state.members[0].inactive = true
    state.members[1].inactive = true
    const unassigned = chore(state, { rotation: state.members.slice(0, 2).map((member) => member.id) })
    const result = completeChore(unassigned, state.members, state.members[2].id, randomUUID(), completedAt, '2026-09-08')
    assert.equal(result.completion.assignedTo, null)
    assert.equal(result.completion.completedBy, state.members[2].id)
    assert.equal(result.chore.turn, 1)
    assert.equal(choreAssignee(result.chore, state.members), null)
    assert.throws(() => completeChore(unassigned, state.members, state.members[0].id, randomUUID(), completedAt, '2026-09-08'), /active roommate/)
    assert.throws(() => completeChore(unassigned, state.members, randomUUID(), randomUUID(), completedAt, '2026-09-08'), /active roommate/)
  })
})

describe('chore completion and undo', () => {
  it('completes whole-home one-offs and retains undone history when the occurrence is completed again', () => {
    const state = household()
    const original = chore(state, { roomId: null, area: null, repeatDays: null, turn: 2 })
    const first = completeChore(original, state.members, state.members[0].id, randomUUID(), completedAt, '2026-09-08')
    assert.equal(first.chore.dueDate, null)
    assert.equal(first.completion.roomId, null)
    assert.equal(first.completion.area, null)
    assert.equal(canUndoChore(first.chore, first.completion), true)
    assert.throws(() => completeChore(first.chore, state.members, state.members[0].id, randomUUID(), completedAt, '2026-09-08'), /already completed/)
    const undone = undoChoreCompletion(first.chore, first.completion, state.members, state.members[1].id, undoneAt)
    assert.equal(undone.chore.dueDate, original.dueDate)
    assert.equal(undone.chore.turn, 2)
    assert.equal(undone.chore.occurrence, 0)
    assert.equal(undone.chore.version, 2)
    assert.equal(undone.completion.undoneAt, undoneAt)
    assert.equal(undone.completion.undoneBy, state.members[1].id)
    assert.equal(first.completion.undoneAt, null)
    const redone = completeChore(undone.chore, state.members, state.members[2].id, randomUUID(), undoneAt, '2026-09-08')
    state.chores = { items: [redone.chore], history: [redone.completion, undone.completion] }
    assert.equal(redone.chore.version, 3)
    assert.equal(redone.completion.occurrence, 0)
    assert.equal(householdSchema.safeParse(state).success, true)
    assert.equal(canUndoChore(redone.chore, undone.completion), false)
  })

  it('rejects undo after edits, later completions, archiving or another undo without overwriting state', () => {
    const state = household()
    const first = completeChore(chore(state), state.members, state.members[0].id, randomUUID(), completedAt, '2026-09-08')
    assert.equal(canUndoChore(undefined, first.completion), false)
    for (const changed of [
      { ...first.chore, id: randomUUID() }, { ...first.chore, version: 2 },
      { ...first.chore, occurrence: 2 }, { ...first.chore, archived: true },
    ]) {
      const before = structuredClone(changed)
      assert.equal(canUndoChore(changed, first.completion), false)
      assert.throws(() => undoChoreCompletion(changed, first.completion, state.members, state.members[1].id, undoneAt), /no longer be undone/)
      assert.deepEqual(changed, before)
    }
    const later = completeChore(first.chore, state.members, state.members[1].id, randomUUID(), completedAt, '2026-09-08')
    assert.equal(canUndoChore(later.chore, first.completion), false)
    const undone = undoChoreCompletion(later.chore, later.completion, state.members, state.members[0].id, undoneAt)
    assert.equal(canUndoChore(undone.chore, first.completion), false)
    assert.equal(canUndoChore(later.chore, undone.completion), false)
    assert.throws(() => completeChore({ ...first.chore, archived: true }, state.members, state.members[0].id, randomUUID(), completedAt, '2026-09-08'), /Restore/)
    state.members[0].inactive = true
    assert.throws(() => undoChoreCompletion(first.chore, first.completion, state.members, state.members[0].id, undoneAt), /active roommate/)
  })
})
