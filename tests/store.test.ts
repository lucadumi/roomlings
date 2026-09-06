import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { Store } from '../server/store.ts'

it('persists household data and hashed member sessions across database restarts', () => {
  const filename = resolve('data', `test-store-${randomUUID()}.sqlite`)
  let store = new Store(filename)
  try {
    const original = store.create('Persistent kitchen', 'Ada', 'EUR', 35000)
    const originalId = original.household.id
    store.close()
    store = new Store(filename)
    const restored = store.authenticate(original.token)
    assert.ok(restored)
    assert.equal(restored.household.id, originalId)
    assert.equal(restored.household.budget, 35000)
    assert.equal(restored.memberId, original.memberId)
    assert.equal(store.authenticate('not-the-session-token'), null)
  } finally {
    store.close()
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
      if (existsSync(path)) unlinkSync(path)
    }
  }
})
