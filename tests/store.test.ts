import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../server/store.ts'
import { localDate } from '../shared/domain.ts'

it('persists household data and hashed member sessions across database restarts', () => {
  const filename = resolve('data', `test-store-${randomUUID()}.sqlite`)
  let store = new Store(filename)
  try {
    const original = store.create('Persistent kitchen', 'Ada', 'EUR', 35000)
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
    store.save(original.household)
    store.close()
    store = new Store(filename)
    const restored = store.authenticate(original.token)
    assert.ok(restored)
    assert.equal(restored.household.id, originalId)
    assert.equal(restored.household.budget, 35000)
    assert.equal(restored.memberId, original.memberId)
    assert.equal(restored.household.bills[0].id, billId)
    assert.equal(restored.household.expenses[0].bill?.billId, billId)
    assert.equal(restored.household.expenses[0].amount, 90500)
    assert.equal(store.authenticate('not-the-session-token'), null)
  } finally {
    store.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
      if (existsSync(path)) unlinkSync(path)
    }
  }
})

it('restores a pre-bills database without replacing its household or member session', () => {
  const filename = resolve('data', `test-legacy-store-${randomUUID()}.sqlite`)
  let store = new Store(filename)
  try {
    const original = store.create('Legacy kitchen', 'Ada', 'EUR', 35000)
    const legacy = { ...original.household, bills: undefined, billingTimeZone: undefined }
    store.close()
    const database = new DatabaseSync(filename)
    try {
      database.prepare('UPDATE households SET state = ? WHERE id = ?').run(JSON.stringify(legacy), original.household.id)
    } finally {
      database.close()
    }
    store = new Store(filename)
    const restored = store.authenticate(original.token)
    assert.ok(restored)
    assert.equal(restored.household.id, original.household.id)
    assert.equal(restored.memberId, original.memberId)
    assert.deepEqual(restored.household.bills, [])
    assert.equal(restored.household.billingTimeZone, 'UTC')
  } finally {
    store.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
      if (existsSync(path)) unlinkSync(path)
    }
  }
})
