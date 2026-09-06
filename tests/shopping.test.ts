import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { balances, householdSchema, shoppingItemInputSchema, shoppingItemSchema } from '../shared/domain.ts'
import type { Household, ShoppingItem } from '../shared/domain.ts'
import { canEditShoppingItem, checkoutItems, inBasket } from '../shared/shopping.ts'

function household(): Household {
  return householdSchema.parse({
    id: randomUUID(), name: 'The shopping house', currency: 'EUR', budget: 45000, inviteCode: 'test-invitation',
    demo: false, version: 0, members: ['Ada', 'Ben'].map((name) => ({ id: randomUUID(), name, color: '#789359' })),
    expenses: [], settlements: [],
  })
}

function item(state: Household): ShoppingItem {
  return {
    id: randomUUID(), name: 'Milk', quantity: '2 cartons', notes: 'Unsweetened',
    createdBy: state.members[0].id, createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-01T12:00:00Z',
    version: 0, claimedBy: null, pickedUp: false,
  }
}

describe('shared shopping list', () => {
  it('restores old households with an empty list and no new debts', () => {
    const state = household()
    assert.equal(state.shopping.items.length, 0)
    assert.equal(state.shopping.runs.length, 0)
    state.shopping.items.push({ ...item(state), claimedBy: state.members[0].id, pickedUp: true })
    assert.equal(state.expenses.length, 0)
    assert.ok([...balances(state).values()].every((value) => value === 0))
  })

  it('validates quantities, notes, claims and picked-up state', () => {
    const state = household()
    const entry = item(state)
    assert.equal(shoppingItemInputSchema.parse({ name: '  Milk  ' }).quantity, '1')
    assert.equal(shoppingItemInputSchema.safeParse({ name: 'Milk', quantity: '' }).success, false)
    assert.equal(shoppingItemInputSchema.safeParse({ name: 'Milk', notes: 'x'.repeat(241) }).success, false)
    assert.equal(shoppingItemSchema.safeParse({ ...entry, pickedUp: true }).success, false)
    state.shopping.items.push({ ...entry, claimedBy: randomUUID() })
    assert.equal(householdSchema.safeParse(state).success, false)
  })

  it('requires the selected items to be unchanged and in the current shopper basket', () => {
    const state = household()
    const entry = { ...item(state), claimedBy: state.members[0].id, pickedUp: true, version: 2 }
    state.shopping.items.push(entry)
    assert.equal(inBasket(entry, state.members[0].id), true)
    assert.equal(inBasket(entry, state.members[1].id), false)
    assert.equal(canEditShoppingItem(entry, state.members[0].id), false)
    assert.deepEqual(checkoutItems(state, state.members[0].id, [{ id: entry.id, version: 2 }]), [entry])
    assert.equal(checkoutItems(state, state.members[0].id, [{ id: entry.id, version: 1 }]), null)
    assert.equal(checkoutItems(state, state.members[1].id, [{ id: entry.id, version: 2 }]), null)
    assert.equal(checkoutItems(state, state.members[0].id, [{ id: entry.id, version: 2 }, { id: entry.id, version: 2 }]), null)
    assert.equal(checkoutItems(state, state.members[0].id, []), null)
    assert.equal(state.shopping.items.length, 1)
  })

  it('keeps archive history when a receipt is removed without inventing another debt', () => {
    const state = household()
    const entry = item(state)
    const runId = randomUUID()
    const expenseId = randomUUID()
    state.shopping.runs.push({
      id: runId, expenseId, name: 'The milk run', completedBy: state.members[0].id,
      completedAt: '2026-09-01T13:00:00Z', items: [entry],
    })
    state.expenses.push({
      id: expenseId, description: 'The milk run', amount: 301, paidBy: state.members[0].id,
      participants: state.members.map((member) => member.id), category: 'dairy', date: '2026-09-01',
      createdAt: '2026-09-01T13:00:00Z', shoppingRunId: runId,
    })
    assert.equal(householdSchema.safeParse(state).success, true)
    state.expenses[0].paidBy = randomUUID()
    assert.equal(householdSchema.safeParse(state).success, false)
    state.expenses[0].paidBy = state.members[0].id
    state.expenses = []
    assert.equal(householdSchema.safeParse(state).success, true)
    assert.equal(state.shopping.runs[0].items[0].quantity, '2 cartons')
    assert.ok([...balances(state).values()].every((value) => value === 0))
    state.shopping.items.push(entry)
    assert.equal(householdSchema.safeParse(state).success, false)
  })

  it('rejects duplicate items and receipts pointing at an unrelated run', () => {
    const state = household()
    const entry = item(state)
    state.shopping.items.push(entry, entry)
    assert.equal(householdSchema.safeParse(state).success, false)
    state.shopping.items = []
    state.expenses.push({
      id: randomUUID(), description: 'No matching run', amount: 301, paidBy: state.members[0].id,
      participants: [state.members[0].id], category: 'other', date: '2026-09-01',
      createdAt: '2026-09-01T13:00:00Z', shoppingRunId: randomUUID(),
    })
    assert.equal(householdSchema.safeParse(state).success, false)
  })
})
