import { randomUUID } from 'node:crypto'
import { billingDate, choreSchema } from '../../shared/domain.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { expect, test } from './account-fixtures.ts'
import { savedKitchen } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

test('the notification bell lists my turns and shared money, opens them and keeps read state', async ({ page, accounts }) => {
  const owner = await accounts.store.create('The inbox household', 'Ada', 'EUR', 45000)
  const household = owner.household
  const ben = { id: randomUUID(), name: 'Ben', color: '#7d9070' }
  household.members.push(ben)
  const today = billingDate(household.billingTimeZone)
  const overdue = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10)
  household.chores.items.push(choreSchema.parse({
    id: randomUUID(), title: 'Scrub the sink', notes: '', roomId: 'kitchen', area: 'sink', dueDate: overdue, repeatDays: 7,
    rotation: [owner.memberId], turn: 0, createdBy: owner.memberId, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), version: 0, occurrence: 0, archived: false,
  }))
  household.expenses.push({
    id: randomUUID(), description: 'Market run', amount: 2410, paidBy: ben.id, participants: [owner.memberId, ben.id],
    category: 'produce', date: today, createdAt: new Date().toISOString(),
  })
  household.settlements.push({ id: randomUUID(), from: ben.id, to: owner.memberId, amount: 1200, createdAt: new Date().toISOString() })
  await accounts.store.save(household)
  await page.addInitScript((kitchen) => {
    if (!localStorage.getItem('roomlings.session')) {
      localStorage.setItem('roomlings.session', kitchen.token)
      localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
      localStorage.setItem('roomlings.access-mode', 'browser')
    }
  }, savedKitchen(owner))
  await page.goto(roomPath())

  const bell = page.locator('.inbox-trigger')
  await expect(bell).toHaveAccessibleName('Notifications, 3 unread')
  await bell.click()
  const inbox = page.getByRole('region', { name: 'Notifications', exact: true })
  await expect(inbox.locator('.inbox-item')).toHaveCount(3)
  await expect(inbox).toContainText('Scrub the sink is 2 days overdue')
  await expect(inbox).toContainText('Ben paid Market run')
  await expect(inbox).toContainText('Ben paid you back')

  await inbox.getByRole('button', { name: /Ben paid Market run/ }).click()
  await expect(page.getByRole('table', { name: 'Grocery expenses' })).toContainText('Market run')
  await expect(bell).toHaveAccessibleName('Notifications, 2 unread')

  await bell.click()
  await inbox.getByRole('button', { name: /Scrub the sink/ }).click()
  await expect(page.getByRole('article', { name: 'Scrub the sink', exact: true })).toBeVisible()
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread')

  await bell.click()
  await inbox.getByRole('button', { name: 'Mark all read', exact: true }).click()
  await expect(bell).toHaveAccessibleName('Notifications')
  await expect(inbox.getByRole('button', { name: 'Mark all read', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.locator('.inbox-trigger')).toHaveAccessibleName('Notifications')
  const saved = await accounts.store.get(household.id)
  expect(saved?.version).toBe(household.version)
})

test('a failed read keeps notifications unread and says so', async ({ page, accounts }) => {
  const owner = await accounts.store.create('The offline inbox', 'Ada', 'EUR', 45000)
  const household = owner.household
  const ben = { id: randomUUID(), name: 'Ben', color: '#7d9070' }
  household.members.push(ben)
  household.settlements.push({ id: randomUUID(), from: ben.id, to: owner.memberId, amount: 1200, createdAt: new Date().toISOString() })
  await accounts.store.save(household)
  await page.addInitScript((kitchen) => {
    if (!localStorage.getItem('roomlings.session')) {
      localStorage.setItem('roomlings.session', kitchen.token)
      localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
      localStorage.setItem('roomlings.access-mode', 'browser')
    }
  }, savedKitchen(owner))
  await page.goto(roomPath())
  const bell = page.locator('.inbox-trigger')
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread')
  await page.route('**/api/inbox', (route) => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The kitchen is resting.' }) })
    : route.continue())
  await bell.click()
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click()
  await expect(page.locator('.error-banner')).toContainText('The kitchen is resting.')
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread')
})
