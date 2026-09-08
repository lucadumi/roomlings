import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  balances, billCreateInputSchema, billSchema, billingDate, householdSchema, monthlyGroceries, suggestedTransfers,
} from '../shared/domain.ts'
import type { Bill, Expense, Household } from '../shared/domain.ts'
import {
  addMonths, billDueDate, billOccurrence, earlierOverdueBills, monthlyBills, reviseBill, setBillPaused,
} from '../shared/bills.ts'
import { dateTitle } from '../src/format.ts'

function household(): Household {
  return householdSchema.parse({
    id: randomUUID(), name: 'The bill house', currency: 'EUR', budget: 45000, inviteCode: 'test-invitation',
    version: 0,
    members: ['Ada', 'Ben'].map((name) => ({ id: randomUUID(), name, color: '#789359' })),
    expenses: [], settlements: [],
  })
}

function monthlyBill(state: Household, dueDay = 1): Bill {
  const bill = billSchema.parse({
    id: randomUUID(), createdAt: '2026-01-01T12:00:00Z', startMonth: '2026-01', pauses: [],
    revisions: [{ fromMonth: '2026-01', name: 'Internet', amount: 3000, dueDay, participants: state.members.map((member) => member.id) }],
  })
  state.bills.push(bill)
  return bill
}

function payment(state: Household, bill: Bill, month: string, amount = 3101): Expense {
  return {
    id: randomUUID(), createdAt: '2026-01-02T12:00:00Z', description: 'Internet', amount,
    paidBy: state.members[0].id, participants: state.members.map((member) => member.id),
    date: `${month}-02`, category: 'other', bill: { billId: bill.id, month, dueDate: billDueDate(month, 1) },
  }
}

describe('monthly household bills', () => {
  it('restores legacy households without classifying groceries as bills', () => {
    const state = household()
    assert.deepEqual(state.bills, [])
    state.expenses.push({
      id: randomUUID(), createdAt: '2026-01-01T12:00:00Z', description: 'Milk', amount: 201,
      paidBy: state.members[0].id, participants: [state.members[0].id], date: '2026-01-01', category: 'dairy',
    })
    assert.equal(monthlyGroceries(householdSchema.parse(state), '2026-01').length, 1)
  })

  it('clamps due dates for short months and keeps year transitions valid', () => {
    assert.equal(billDueDate('2024-02', 31), '2024-02-29')
    assert.equal(billDueDate('2026-02', 31), '2026-02-28')
    assert.equal(billDueDate('2026-04', 31), '2026-04-30')
    assert.equal(billDueDate('2026-01', 31), '2026-01-31')
    assert.equal(addMonths('2026-12', 1), '2027-01')
    assert.equal(addMonths('2026-01', -1), '2025-12')
    assert.throws(() => billDueDate('2026-02', 0))
    assert.throws(() => billDueDate('2026-13', 1))
    assert.throws(() => addMonths('2026-01', 0.5))
  })

  it('uses the household calendar across time-zone and month boundaries', () => {
    const instant = new Date('2026-09-30T23:30:00Z')
    assert.equal(billingDate('UTC', instant), '2026-09-30')
    assert.equal(billingDate('Europe/Bucharest', instant), '2026-10-01')
    assert.equal(billingDate('America/New_York', instant), '2026-09-30')
    assert.equal(dateTitle('2026-10-01', billingDate('Europe/Bucharest', instant)), 'Today')
    assert.equal(dateTitle('2026-09-30', billingDate('Europe/Bucharest', instant)), 'Yesterday')
    const state = household()
    const bill = monthlyBill(state)
    const month = billingDate('Europe/Bucharest', instant).slice(0, 7)
    assert.equal(setBillPaused(bill, true, month).pauses[0].fromMonth, '2026-11')
    assert.equal(reviseBill(bill, { ...bill.revisions[0], amount: 4000 }, month).revisions[1].fromMonth, '2026-10')
    assert.equal(billCreateInputSchema.safeParse({
      name: 'Internet', amount: 3000, firstDueDate: '2026-10-01', participants: [state.members[0].id], timeZone: 'Not/AZone',
    }).success, false)
  })

  it('distinguishes upcoming, due, overdue and paid without creating expenses', () => {
    const state = household()
    const bill = monthlyBill(state, 15)
    assert.equal(billOccurrence(state, bill, '2026-01', '2026-01-14')?.status, 'upcoming')
    assert.equal(billOccurrence(state, bill, '2026-01', '2026-01-15')?.status, 'due')
    assert.equal(billOccurrence(state, bill, '2026-01', '2026-01-16')?.status, 'overdue')
    assert.equal(billOccurrence(state, bill, '2025-12', '2026-01-16'), null)
    assert.equal(state.expenses.length, 0)
    assert.ok([...balances(state).values()].every((value) => value === 0))
    state.expenses.push(payment(state, bill, '2026-01'))
    assert.equal(billOccurrence(state, bill, '2026-01', '2026-01-16')?.status, 'paid')
  })

  it('keeps paid and earlier unpaid periods unchanged when a bill is edited', () => {
    const state = household()
    const bill = monthlyBill(state)
    const paid = payment(state, bill, '2026-02', 3507)
    state.expenses.push(paid)
    const edited = reviseBill(bill, {
      name: 'Faster internet', amount: 5000, dueDay: 20, participants: [state.members[1].id],
    }, '2026-02')
    state.bills = [edited]
    assert.equal(monthlyBills(state, '2026-01', '2026-03-01')[0].amount, 3000)
    const recorded = monthlyBills(state, '2026-02', '2026-03-01')[0]
    assert.equal(recorded.amount, 3507)
    assert.equal(recorded.name, 'Internet')
    assert.equal(recorded.dueDate, '2026-02-01')
    assert.deepEqual(recorded.participants, paid.participants)
    assert.equal(monthlyBills(state, '2026-03', '2026-03-01')[0].amount, 5000)
    assert.equal(monthlyBills(state, '2026-03', '2026-03-01')[0].dueDate, '2026-03-20')
    assert.equal(reviseBill(edited, { ...edited.revisions[1], amount: 5500 }, '2026-02').revisions.length, 2)
    assert.throws(() => reviseBill(edited, edited.revisions[1], ''))
  })

  it('pauses future months without hiding existing dues or backfilling paused months on resume', () => {
    const state = household()
    const original = monthlyBill(state)
    const paused = setBillPaused(original, true, '2026-01')
    state.bills = [paused]
    assert.equal(monthlyBills(state, '2026-01', '2026-04-02').length, 1)
    assert.equal(monthlyBills(state, '2026-02', '2026-04-02').length, 0)
    state.bills = [setBillPaused(paused, false, '2026-04')]
    assert.equal(monthlyBills(state, '2026-03', '2026-04-02').length, 0)
    assert.equal(monthlyBills(state, '2026-04', '2026-04-02').length, 1)
    assert.deepEqual(earlierOverdueBills(state, '2026-05', '2026-05-06'), { count: 2, firstMonth: '2026-01' })
    state.expenses.push(payment(state, original, '2026-01'))
    assert.deepEqual(earlierOverdueBills(state, '2026-05', '2026-05-06'), { count: 1, firstMonth: '2026-04' })
  })

  it('can cancel a pending pause and keeps early paid records visible during a pause', () => {
    const state = household()
    const original = monthlyBill(state)
    const paused = setBillPaused(original, true, '2026-01')
    assert.deepEqual(setBillPaused(paused, false, '2026-01').pauses, [])
    state.bills = [paused]
    state.expenses.push(payment(state, original, '2026-02'))
    assert.equal(monthlyBills(state, '2026-02', '2026-01-20')[0].status, 'paid')
    assert.throws(() => setBillPaused(paused, true, '2026-01'), /already paused/)
  })

  it('uses the shared balances and settlements while excluding bills from grocery spending', () => {
    const state = household()
    const bill = monthlyBill(state)
    state.expenses.push(payment(state, bill, '2026-01'))
    assert.deepEqual(monthlyGroceries(state, '2026-01'), [])
    assert.equal([...balances(state).values()].reduce((sum, value) => sum + value, 0), 0)
    const transfers = suggestedTransfers(state)
    assert.equal(transfers.length, 1)
    state.settlements.push({ ...transfers[0], id: randomUUID(), createdAt: '2026-01-03T12:00:00Z' })
    assert.ok([...balances(state).values()].every((value) => value === 0))
    state.expenses = []
    assert.equal(monthlyBills(state, '2026-01', '2026-01-20')[0].status, 'overdue')
    assert.notEqual(balances(state).get(state.members[0].id), 0)
  })

  it('rejects duplicate payment periods, unknown bills and invalid schedules', () => {
    const state = household()
    const bill = monthlyBill(state)
    const paid = payment(state, bill, '2026-01')
    state.expenses.push(paid, { ...paid, id: randomUUID() })
    assert.equal(householdSchema.safeParse(state).success, false)
    state.expenses = [{ ...paid, bill: { ...paid.bill!, billId: randomUUID() } }]
    assert.equal(householdSchema.safeParse(state).success, false)
    state.expenses = [payment(state, bill, '2025-12')]
    assert.equal(householdSchema.safeParse(state).success, false)
    state.expenses = [{ ...paid, paidBy: randomUUID() }]
    assert.equal(householdSchema.safeParse(state).success, false)
    assert.equal(billCreateInputSchema.safeParse({
      name: 'Internet', amount: 3000, firstDueDate: '2026-02-30', participants: [state.members[0].id],
    }).success, false)
    assert.equal(billSchema.safeParse({ ...bill, revisions: [bill.revisions[0], bill.revisions[0]] }).success, false)
    assert.equal(billSchema.safeParse({ ...bill, revisions: [] }).success, false)
    assert.equal(billSchema.safeParse({
      ...bill, pauses: [{ fromMonth: '2026-02', untilMonth: null }, { fromMonth: '2026-03', untilMonth: null }],
    }).success, false)
  })
})
