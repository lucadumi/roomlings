import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../server/store.ts'
import { localDate } from '../shared/domain.ts'

it('persists household data and hashed member sessions across database restarts', async () => {
  const filename = resolve('data', `test-store-${randomUUID()}.sqlite`)
  let store = new Store(filename)
  try {
    const original = (await store.create('Persistent kitchen', 'Ada', 'EUR', 35000))
    const originalId = original.household.id
    const month = localDate().slice(0, 7)
    const billId = randomUUID()
    original.household.bills.push({
      id: billId, createdAt: new Date().toISOString(), startMonth: month, pauses: [],
      revisions: [{ fromMonth: month, name: 'Rent', amount: 90000, dueDay: 1, participants: [original.memberId] }],
    })
    original.household.expenses.push({
      id: randomUUID(), createdAt: new Date().toISOString(), description: 'Rent', amount: 90500,
      category: 'other', date: localDate(), paidBy: original.memberId, participants: [original.memberId],
      bill: { billId, month, dueDate: `${month}-01` },
    })
    const runId = randomUUID()
    const receiptId = randomUUID()
    const now = new Date().toISOString()
    original.household.shopping.items.push({
      id: randomUUID(), name: 'Bread', quantity: '1 loaf', notes: '', createdBy: original.memberId,
      createdAt: now, updatedAt: now, version: 0, claimedBy: null, pickedUp: false,
    })
    original.household.shopping.runs.push({
      id: runId, expenseId: receiptId, name: 'Milk run', completedBy: original.memberId, completedAt: now,
      items: [{ id: randomUUID(), name: 'Milk', quantity: '2 cartons', notes: 'Plain', createdBy: original.memberId, createdAt: now }],
    })
    original.household.expenses.push({
      id: receiptId, description: 'Milk run', amount: 503, category: 'dairy', date: localDate(),
      paidBy: original.memberId, participants: [original.memberId], createdAt: now, shoppingRunId: runId,
    })
    await store.save(original.household)
    await store.close()
    store = new Store(filename)
    const restored = (await store.authenticate(original.token))
    assert.ok(restored)
    assert.equal(restored.household.id, originalId)
    assert.equal(restored.household.budget, 35000)
    assert.equal(restored.memberId, original.memberId)
    assert.equal(restored.household.bills[0].id, billId)
    assert.equal(restored.household.expenses[0].bill?.billId, billId)
    assert.equal(restored.household.expenses[0].amount, 90500)
    assert.equal(restored.household.shopping.items[0].name, 'Bread')
    assert.equal(restored.household.shopping.runs[0].items[0].quantity, '2 cartons')
    assert.equal(restored.household.expenses[1].shoppingRunId, runId)
    assert.equal((await store.authenticate('not-the-session-token')), null)
  } finally {
    await store.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
      if (existsSync(path)) unlinkSync(path)
    }
  }
})

it('restores a pre-bills database without replacing its household or member session', async () => {
  const filename = resolve('data', `test-legacy-store-${randomUUID()}.sqlite`)
  let store = new Store(filename)
  try {
    const original = (await store.create('Legacy kitchen', 'Ada', 'EUR', 35000))
    const legacy = { ...original.household, bills: undefined, billingTimeZone: undefined, shopping: undefined }
    await store.close()
    const database = new DatabaseSync(filename)
    try {
      database.prepare('UPDATE households SET state = ? WHERE id = ?').run(JSON.stringify(legacy), original.household.id)
    } finally {
      database.close()
    }
    store = new Store(filename)
    const restored = (await store.authenticate(original.token))
    assert.ok(restored)
    assert.equal(restored.household.id, original.household.id)
    assert.equal(restored.memberId, original.memberId)
    assert.deepEqual(restored.household.bills, [])
    assert.equal(restored.household.billingTimeZone, 'UTC')
    assert.deepEqual(restored.household.shopping, { items: [], runs: [] })
  } finally {
    await store.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
      if (existsSync(path)) unlinkSync(path)
    }
  }
})
