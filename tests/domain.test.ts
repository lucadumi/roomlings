import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { balances, dateSchema, escapeCsv, parseMoney, splitAmount, suggestedTransfers } from '../shared/domain.ts'
import type { Household } from '../shared/domain.ts'

function kitchen(): Household {
  return {
    id: randomUUID(), name: 'Test kitchen', currency: 'EUR', budget: 45000, inviteCode: 'test-invite',
    demo: false, version: 0, members: ['A', 'B', 'C'].map((name) => ({ id: randomUUID(), name, color: '#888888' })),
    expenses: [], settlements: [], bills: [], billingTimeZone: 'UTC',
    roomStyle: 'original',
    shopping: { items: [], runs: [] },
  }
}

describe('exact money handling', () => {
  it('parses money without floating-point rounding or ambiguous formats', () => {
    assert.equal(parseMoney('12.99'), 1299)
    assert.equal(parseMoney('0,01'), 1)
    assert.equal(parseMoney(' 25 '), 2500)
    for (const input of ['0', '-1', '1.001', '1e2', '1,000.00', '', 'NaN', '1000000.01']) assert.equal(parseMoney(input), null)
  })
  it('shares every cent and is independent of participant ordering', () => {
    assert.deepEqual([...splitAmount(100, ['c', 'a', 'b'])], [['a', 34], ['b', 33], ['c', 33]])
    assert.deepEqual([...splitAmount(2, ['a', 'b', 'c'])], [['a', 1], ['b', 1], ['c', 0]])
    assert.throws(() => splitAmount(100, ['a', 'a']))
  })
  it('makes balances sum to zero and suggested repayments fully settle them', () => {
    for (let run = 1; run <= 100; run++) {
      const state = kitchen()
      const ids = state.members.map((member) => member.id)
      for (let i = 0; i < 12; i++) {
        state.expenses.push({
          id: randomUUID(), description: 'Groceries', amount: (run * 317 + i * 131) % 21000 + 1,
          participants: i % 3 ? ids : ids.slice(1), paidBy: ids[i % 3], date: '2026-09-01',
          category: 'produce', createdAt: new Date().toISOString(),
        })
      }
      assert.equal([...balances(state).values()].reduce((sum, balance) => sum + balance, 0), 0)
      const transfers = suggestedTransfers(state)
      assert.ok(transfers.length <= state.members.length - 1)
      state.settlements.push(...transfers.map((transfer) => ({ ...transfer, id: randomUUID(), createdAt: new Date().toISOString() })))
      assert.ok([...balances(state).values()].every((balance) => balance === 0))
    }
  })
  it('keeps prior payments when an expense is removed', () => {
    const state = kitchen()
    const [a, b] = state.members
    state.expenses.push({ id: randomUUID(), description: 'Dinner', amount: 1200, paidBy: a.id, participants: [a.id, b.id], date: '2026-09-01', category: 'pantry', createdAt: new Date().toISOString() })
    state.settlements.push({ id: randomUUID(), from: b.id, to: a.id, amount: 600, createdAt: new Date().toISOString() })
    assert.equal(balances(state).get(a.id), 0)
    state.expenses = []
    assert.equal(balances(state).get(a.id), -600)
    assert.equal(balances(state).get(b.id), 600)
  })
  it('rejects impossible dates and escapes spreadsheet formulas', () => {
    assert.equal(dateSchema.safeParse('2026-02-30').success, false)
    assert.equal(dateSchema.safeParse('2024-02-29').success, true)
    assert.equal(escapeCsv('=SUM(1,2)'), '"\'=SUM(1,2)"')
    assert.equal(escapeCsv('Some "milk"'), '"Some ""milk"""')
  })
})
