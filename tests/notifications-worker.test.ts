import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { suggestedTransfers } from '../shared/domain.ts'
import { getRoomComponents, componentChoreArea } from '../shared/roomComponents.ts'
import { pushAttemptLimit, pushClaimLifetime, pushRetention } from '../server/notifications-store.ts'
import { NotificationWorker } from '../server/notification-worker.ts'
import { notificationFixture, testChore, testExpense } from './notifications-fixture.ts'

describe('atomic money notification outbox', () => {
  it('notifies other active members, not the actor or only the payer, and deduplicates confirmed retries', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household, ownerId, otherId } = await f.home()
    await f.register(owner.session, 'aa')
    await f.register(other.session, 'bb')
    const extraDevice = await f.signIn('ada@example.com')
    await f.register(extraDevice.session, 'cc')
    const input = { ...testExpense(household, ownerId), paidBy: otherId }
    const results = await Promise.all([owner.request('/expenses', input), owner.request('/expenses', input)])
    assert.deepEqual(results.map((result) => result.status), [200, 200])
    assert.equal(results.filter((result) => result.data.replayed).length, 1)
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM notification_events').get())?.count), 1)
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM notification_deliveries').get())?.count), 1)
    assert.equal((await owner.request('/expenses', { ...input, amount: 555 })).status, 409)
    const current = (await f.store.get(household.id))!
    const delivered = await f.worker.runOnce()
    assert.equal(delivered.sent, 1)
    assert.equal(f.provider.requests[0].token, 'bb')
    const request = f.provider.requests[0]
    assert.deepEqual(request.payload.roomlings, { version: 1, kind: 'expense', householdId: household.id, expenseId: current.expenses[0].id })
    assert.deepEqual(request.payload.aps.alert, { title: 'Roomlings', body: 'A new expense was recorded.' })
    const payload = JSON.stringify(request.payload)
    for (const text of ['Private grocery details', '"Ada"', '"Ben"', '1234', 'Test home']) assert.ok(!payload.includes(text))
    assert.equal(Buffer.byteLength(request.collapseId), 64)
    assert.equal((await f.worker.runOnce()).sent, 0)
    assert.deepEqual(await f.store.get(household.id), current)
  })

  it('includes other household members who are not expense participants and excludes inactive identities', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household, ownerId } = await f.home()
    const third = await f.signIn('cara@example.com', 'Cara')
    const invitation = await f.store.accounts.invite(owner.session, household.id, household.version, 7)
    await f.store.accounts.accept(third.session, invitation.code, 'Cara')
    await f.register(other.session, 'bb')
    await f.register(third.session, 'cc')
    let current = (await f.store.get(household.id))!
    assert.equal((await owner.request('/expenses', { ...testExpense(current, ownerId), participants: [ownerId] })).status, 200)
    assert.equal((await f.worker.runOnce()).sent, 2)
    current = (await f.store.get(household.id))!
    await f.store.accounts.leave(third.session, current.id, current.version)
    current = (await f.store.get(household.id))!
    assert.equal((await owner.request('/expenses', { ...testExpense(current, ownerId), participants: [ownerId] })).status, 200)
    assert.equal((await f.worker.runOnce()).sent, 1)
    assert.equal(f.provider.requests.at(-1)?.token, 'bb')
  })

  it('creates notifications only for committed new expenses and repayments, including shopping checkout and bill payments', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household, ownerId } = await f.home()
    await f.register(other.session, 'bb')
    let current = household
    const item = await owner.request('/shopping/items', { version: current.version, name: 'Private milk', quantity: '1', notes: '' })
    assert.equal(item.status, 200)
    current = item.data.household
    const shopping = current.shopping.items[0]
    const picked = await owner.request(`/shopping/items/${shopping.id}/pick`, { version: current.version, itemVersion: shopping.version, pickedUp: true })
    assert.equal(picked.status, 200)
    current = picked.data.household
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM notification_events').get())?.count), 0)
    const checkout = {
      ...testExpense(current, ownerId), checkoutId: randomUUID(),
      items: [{ id: shopping.id, version: current.shopping.items[0].version }],
    }
    const bought = await owner.request('/shopping/checkout', checkout)
    assert.equal(bought.status, 200)
    assert.equal((await owner.request('/shopping/checkout', checkout)).data.replayed, true)
    current = bought.data.household
    const transfer = suggestedTransfers(current)[0]
    const repayment = { ...transfer, version: current.version, mutationId: randomUUID(), mutationVersion: current.version }
    const settled = await owner.request('/settlements', repayment)
    assert.equal(settled.status, 200)
    assert.equal((await owner.request('/settlements', repayment)).data.replayed, true)
    current = settled.data.household
    const bill = await owner.request('/bills', {
      version: current.version, name: 'Private rent', amount: 5000,
      firstDueDate: '2026-09-20', participants: [ownerId],
    })
    assert.equal(bill.status, 200)
    current = bill.data.household
    const payment = await owner.request(`/bills/${current.bills[0].id}/payments`, {
      version: current.version, month: '2026-09', amount: 5000, paidBy: ownerId, participants: [ownerId], date: '2026-09-20',
    })
    assert.equal(payment.status, 200)
    current = payment.data.household
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM notification_events').get())?.count), 3)
    assert.equal((await f.worker.runOnce()).sent, 3)
    const targets = f.provider.requests.map((request) => request.payload.roomlings)
    assert.equal(targets.filter((target) => target.kind === 'expense').length, 2)
    const settlement = targets.find((target) => target.kind === 'settlement')!
    assert.equal(settlement.kind === 'settlement' && settlement.settlementId, current.settlements[0].id)
    assert.equal(f.provider.requests.find((request) => request.payload.roomlings.kind === 'settlement')?.payload.aps.alert.body, 'A repayment was recorded.')
  })

  it('rolls back outbox, ledger and retry receipts together when enqueue or saving fails', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household, ownerId } = await f.home()
    await f.register(other.session)
    const input = testExpense(household, ownerId)
    const original = f.store.notifications.enqueueNewEntries
    const brokenOutbox = t.mock.method(f.store.notifications, 'enqueueNewEntries', async (...args: Parameters<typeof original>) => {
      await original(...args)
      throw new Error('Simulated outbox persistence failure')
    })
    assert.equal((await owner.request('/expenses', input)).status, 500)
    brokenOutbox.mock.restore()
    assert.deepEqual(await f.store.get(household.id), household)
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM notification_events').get())?.count), 0)
    const save = f.store.save
    const brokenSave = t.mock.method(f.store, 'save', async (...args: Parameters<typeof save>) => {
      await save(...args)
      throw new Error('Simulated failed save')
    })
    assert.equal((await owner.request('/expenses', input)).status, 500)
    brokenSave.mock.restore()
    assert.deepEqual(await f.store.get(household.id), household)
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM notification_events').get())?.count), 0)
    assert.equal((await owner.request('/expenses', input)).status, 200)
    assert.equal((await f.worker.runOnce()).sent, 1)
  })
})

describe('durable daily summaries and current authorization', () => {
  it('sends once per member and local day at 09:00 without changing assignments or household state', async (t) => {
    const f = await notificationFixture(t, { now: '2026-03-29T06:59:59Z' })
    const { owner, other, household, ownerId } = await f.home()
    household.billingTimeZone = 'Europe/Rome'
    const component = getRoomComponents(household).find((entry) => entry.kind === 'sink')!
    household.chores.items = [testChore(household, ownerId, f.now(), {
      componentId: component.id, roomId: component.roomId, area: componentChoreArea(component),
    })]
    await f.store.save(household)
    await f.register(owner.session, 'aa')
    await f.register(other.session, 'bb')
    assert.equal((await f.worker.runOnce()).sent, 0)
    f.advance(1000)
    assert.equal((await f.worker.runOnce()).sent, 1)
    assert.equal(f.provider.requests[0].token, 'aa')
    assert.deepEqual(f.provider.requests[0].payload.roomlings, {
      version: 1, kind: 'chores', householdId: household.id, componentId: component.id,
    })
    assert.equal(f.provider.requests[0].payload.aps.alert.body, 'You have chores due today.')
    const restarted = new NotificationWorker(f.store, f.push, { now: f.now })
    f.advance(30 * 60_000)
    assert.equal((await restarted.runOnce()).sent, 0)
    assert.deepEqual(await f.store.get(household.id), household)
    f.setTime('2026-03-30T07:00:00Z')
    assert.equal((await restarted.runOnce()).sent, 1)
    assert.notEqual(f.provider.requests[0].collapseId, f.provider.requests[1].collapseId)
  })

  it('does not invent a late summary after opt-in, a new registration or a new chore after the daily snapshot', async (t) => {
    const f = await notificationFixture(t, { now: '2026-09-20T09:00:00Z' })
    const { owner, household, ownerId } = await f.home()
    await f.store.notifications.scheduleChores()
    household.chores.items = [testChore(household, ownerId, f.now())]
    await f.store.save(household)
    await f.register(owner.session)
    f.advance(60_000)
    assert.equal((await f.worker.runOnce()).sent, 0)
    f.advance(24 * 60 * 60_000)
    assert.equal((await f.worker.runOnce()).sent, 1)
  })

  it('rechecks current due date, assignment, completion, archive and household time zone before sending', async (t) => {
    for (const change of ['assignment', 'completed', 'archived', 'future', 'time-zone'] as const) {
      const f = await notificationFixture(t, { now: '2026-09-20T09:00:00Z' })
      const { owner, household, ownerId, otherId } = await f.home()
      household.chores.items = [testChore(household, ownerId, f.now())]
      await f.store.save(household)
      await f.register(owner.session)
      await f.store.notifications.scheduleChores()
      if (change === 'assignment') household.chores.items[0].rotation = [otherId]
      if (change === 'completed') household.chores.items[0].dueDate = null
      if (change === 'archived') household.chores.items[0].archived = true
      if (change === 'future') household.chores.items[0].dueDate = '2026-09-21'
      if (change === 'time-zone') household.billingTimeZone = 'America/New_York'
      await f.store.save(household)
      assert.equal((await f.worker.runOnce({ schedule: false })).sent, 0, change)
      assert.equal((await f.db.prepare('SELECT status FROM notification_deliveries').get())?.status, 'skipped', change)
    }
  })

  it('cancels queued work on mute, leave, logout and account deletion and rechecks removed ledger entries', async (t) => {
    for (const action of ['mute', 'leave', 'logout', 'deletion', 'entry-removed'] as const) {
      const f = await notificationFixture(t)
      const { owner, other, household, ownerId } = await f.home()
      await f.register(other.session)
      const created = await owner.request('/expenses', testExpense(household, ownerId))
      assert.equal(created.status, 200)
      const current = created.data.household
      if (action === 'mute') {
        const path = `/account/households/${household.id}/notifications`
        await other.request(path, { chores: true, money: false }, 'PUT')
        await other.request(path, { chores: true, money: true }, 'PUT')
      }
      if (action === 'leave') await f.store.accounts.leave(other.session, household.id, current.version)
      if (action === 'logout') await f.store.accounts.logout(other.session, false)
      if (action === 'deletion') await f.store.accounts.beginDeletion(other.session, 'ben@example.com')
      if (action === 'entry-removed') {
        assert.equal((await owner.request(`/expenses/${current.expenses[0].id}`, { version: current.version }, 'DELETE')).status, 200)
      }
      assert.equal((await f.worker.runOnce()).sent, 0, action)
      assert.equal(f.provider.requests.length, 0, action)
    }
  })

  it('does not send to a new account or session that takes over an installation or token', async (t) => {
    for (const replacement of ['installation', 'token', 'session'] as const) {
      const f = await notificationFixture(t)
      const { owner, other, household, ownerId } = await f.home()
      const installation = await f.register(other.session, 'aabb')
      await owner.request('/expenses', testExpense(household, ownerId))
      const next = await f.signIn(replacement === 'session' ? 'ben@example.com' : 'outside@example.com')
      await f.register(next.session, replacement === 'installation' ? 'ccdd' : 'aabb', replacement === 'token' ? randomUUID() : installation)
      assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM push_devices').get())?.count), 1)
      assert.equal((await f.worker.runOnce()).sent, 0)
      assert.equal(f.provider.requests.length, 0)
    }
  })
})

describe('worker claims, retry limits and invalid registrations', () => {
  it('claims once across workers and reclaims a crashed lease without accepting its stale completion', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household, ownerId } = await f.home()
    await f.register(other.session)
    await owner.request('/expenses', testExpense(household, ownerId))
    const claims = await Promise.all([f.store.notifications.claim(), f.store.notifications.claim()])
    assert.equal(claims.filter(Boolean).length, 1)
    const first = claims.find((claim) => claim !== null)!
    const prepared = (await f.store.notifications.prepare(first, f.cipher))!
    f.advance(pushClaimLifetime)
    assert.equal(await f.store.notifications.prepare(first, f.cipher), null)
    assert.equal((await f.db.prepare('SELECT status FROM notification_deliveries').get())?.status, 'claimed')
    const reclaimed = (await f.store.notifications.claim())!
    assert.equal(reclaimed.id, first.id)
    assert.notEqual(reclaimed.claimToken, first.claimToken)
    const current = (await f.store.notifications.prepare(reclaimed, f.cipher))!
    assert.equal(current.request.id, prepared.request.id)
    assert.equal(current.request.collapseId, prepared.request.collapseId)
    await f.store.notifications.finish(first, prepared, { status: 'invalid' })
    assert.ok(await f.db.prepare('SELECT 1 FROM push_devices').get())
    await f.store.notifications.finish(reclaimed, current, { status: 'sent' })
    assert.equal((await f.db.prepare('SELECT status FROM notification_deliveries').get())?.status, 'sent')
  })

  it('uses persisted exponential retry times, honors rate limits and stops at bounded attempts', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household, ownerId } = await f.home()
    await f.register(other.session)
    await owner.request('/expenses', testExpense(household, ownerId))
    f.provider.result = { status: 'retry', reason: 'rate-limited', retryAfterMs: 120_000 }
    assert.equal((await f.worker.runOnce()).retried, 1)
    const row = (await f.db.prepare('SELECT * FROM notification_deliveries').get())!
    assert.equal(Date.parse(String(row.next_attempt_at)), f.now() + 120_000)
    assert.equal((await f.worker.runOnce()).claimed, 0)
    assert.ok(await f.db.prepare('SELECT 1 FROM push_devices').get())
    f.provider.result = { status: 'retry', reason: 'unavailable' }
    for (let attempt = 1; attempt < pushAttemptLimit; attempt++) {
      f.advance(15 * 60_000)
      assert.equal((await f.worker.runOnce()).claimed, 1)
    }
    const failed = (await f.db.prepare('SELECT status, attempts FROM notification_deliveries').get())!
    assert.equal(failed.status, 'failed')
    assert.equal(failed.attempts, pushAttemptLimit)
    f.advance(60_000)
    assert.equal((await f.worker.runOnce()).claimed, 0)
    assert.equal(new Set(f.provider.requests.map((request) => request.id)).size, 1)
  })

  it('expires unsent jobs and retains only bounded dedup history without deleting preferences', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household, ownerId } = await f.home()
    await f.register(other.session)
    await other.request(`/account/households/${household.id}/notifications`, { chores: false, money: true }, 'PUT')
    await owner.request('/expenses', testExpense(household, ownerId))
    f.advance(24 * 60 * 60_000)
    assert.equal((await f.worker.runOnce()).sent, 0)
    assert.equal((await f.db.prepare('SELECT status FROM notification_deliveries').get())?.status, 'failed')
    f.advance(pushRetention)
    await f.store.notifications.cleanup()
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM notification_events').get())?.count), 0)
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM push_devices').get())?.count), 0)
    assert.equal(Number((await f.db.prepare('SELECT COUNT(*) AS count FROM notification_preferences').get())?.count), 1)
  })

  it('invalidates APNs 410/BadDeviceToken registrations but never deletes a refreshed token', async (t) => {
    for (const outcome of ['invalid', 'unregistered', 'refreshed', 'old-timestamp'] as const) {
      const f = await notificationFixture(t)
      const { owner, other, household, ownerId } = await f.home()
      const installation = await f.register(other.session, 'aabb')
      await owner.request('/expenses', testExpense(household, ownerId))
      f.provider.handle = async () => {
        const invalidatedAt = f.now()
        if (outcome === 'refreshed') {
          f.advance(1)
          await f.register(other.session, 'ccdd', installation)
        }
        return { status: 'invalid', ...(outcome === 'invalid' ? {} : { invalidatedAt: outcome === 'old-timestamp' ? invalidatedAt - 1000 : invalidatedAt }) }
      }
      await f.worker.runOnce()
      const remaining = await f.db.prepare('SELECT 1 FROM push_devices WHERE installation_id = ?').get(installation)
      assert.equal(!!remaining, outcome === 'refreshed' || outcome === 'old-timestamp', outcome)
      if (outcome === 'refreshed') {
        f.provider.handle = undefined
        f.advance(2000)
        assert.equal((await f.worker.runOnce()).sent, 1)
        assert.equal(f.provider.requests.at(-1)?.token, 'ccdd')
      }
    }
  })

  it('records safe failures without logging tokens, private payloads or upstream errors', async (t) => {
    const f = await notificationFixture(t)
    const { owner, other, household, ownerId } = await f.home()
    const installation = await f.register(other.session, 'aabbccdd')
    await owner.request('/expenses', testExpense(household, ownerId))
    f.provider.handle = async () => { throw new Error('https://api.push.apple.com/3/device/aabbccdd private JWT upstream detail') }
    assert.equal((await f.worker.runOnce()).retried, 1)
    assert.ok(f.logs.length)
    assert.ok(!f.logs.join(' ').includes('aabbccdd'))
    assert.ok(!f.logs.join(' ').includes('upstream detail'))
    await f.db.prepare('UPDATE push_devices SET token_ciphertext = ? WHERE installation_id = ?').run('tampered', installation)
    f.advance(2000)
    assert.equal((await f.worker.runOnce()).failed, 1)
    assert.equal((await f.db.prepare('SELECT last_error FROM notification_deliveries').get())?.last_error, 'protected-token')
    assert.ok(!f.logs.join(' ').includes('tampered'))
  })
})
