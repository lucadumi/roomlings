import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { billingDate, householdSchema, localDate } from '../../shared/domain.ts'
import type { Household, Session } from '../../shared/domain.ts'
import { expect, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'
import { chooseOption, openGroceryForm, savedKitchen } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

async function seedHome(page: Page, accounts: AccountHarness): Promise<Session> {
  const session = await accounts.store.create('The shared home', 'Ada', 'EUR', 45000)
  session.household.members.push({ id: randomUUID(), name: 'Ben', color: '#7d9070' })
  await accounts.store.save(session.household)
  await page.addInitScript((kitchen) => {
    localStorage.setItem('roomlings.session', kitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
    localStorage.setItem('roomlings.access-mode', 'browser')
  }, savedKitchen(session))
  return session
}

async function current(accounts: AccountHarness, session: Session): Promise<Household> {
  const household = await accounts.store.get(session.household.id)
  if (!household) throw new Error('The isolated household is missing.')
  return household
}

async function change(accounts: AccountHarness, session: Session, path: string, body: Record<string, unknown>, method = 'POST') {
  const household = await current(accounts, session)
  const response = await fetch(`${accounts.origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, version: household.version }),
  })
  expect(response.ok).toBe(true)
  return householdSchema.parse((await response.json()).household)
}

async function refresh(page: Page) {
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/household')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await response
}

async function openBills(page: Page) {
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await page.getByRole('button', { name: 'Bills', exact: true }).click()
}

async function seedBill(accounts: AccountHarness, session: Session) {
  const household = await change(accounts, session, '/bills', {
    name: 'Internet', amount: 3000, firstDueDate: `${billingDate('UTC').slice(0, 7)}-01`,
    participants: session.household.members.map((member) => member.id),
  })
  return household.bills[0]
}

test('retrying an interrupted grocery save after refresh does not duplicate the receipt', async ({ page, accounts }) => {
  const session = await seedHome(page, accounts)
  await page.goto('/rooms/kitchen')
  await openGroceryForm(page)
  await page.getByLabel('What did you pick up?', { exact: true }).fill('One paid receipt')
  await page.getByLabel('Total (EUR)', { exact: true }).fill('12.47')
  await page.route('**/api/expenses', async (route) => {
    const saved = await fetch(`${accounts.origin}/api/expenses`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: route.request().postData(),
    })
    expect(saved.ok).toBe(true)
    await route.fulfill({ status: 503, json: { error: 'The receipt response was interrupted. Try again.' } })
  })
  await page.getByRole('button', { name: 'Add & split the groceries', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('interrupted')
  await expect(page.getByLabel('Total (EUR)', { exact: true })).toHaveValue('12.47')
  await page.unroute('**/api/expenses')
  await refresh(page)
  await page.getByRole('button', { name: 'Add & split the groceries', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await current(accounts, session)).expenses).toHaveLength(1)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.locator('.expense-row')).toHaveCount(1)
  await expect(page.locator('.expense-row')).toContainText('One paid receipt')
})

test('a changed draft cannot disguise an earlier interrupted save as another receipt', async ({ page, accounts }) => {
  const session = await seedHome(page, accounts)
  await page.goto('/rooms/kitchen')
  await openGroceryForm(page)
  await page.getByLabel('What did you pick up?', { exact: true }).fill('Original paid receipt')
  await page.getByLabel('Total (EUR)', { exact: true }).fill('10')
  await page.route('**/api/expenses', async (route) => {
    const saved = await fetch(`${accounts.origin}/api/expenses`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: route.request().postData(),
    })
    expect(saved.ok).toBe(true)
    await route.fulfill({ status: 503, json: { error: 'The receipt response was interrupted.' } })
  })
  await page.getByRole('button', { name: 'Add & split the groceries', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('interrupted')
  await page.unroute('**/api/expenses')
  await page.getByLabel('Total (EUR)', { exact: true }).fill('20')
  await refresh(page)
  await page.getByRole('button', { name: 'Add & split the groceries', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('already saved with different details')
  await expect(page.getByLabel('Total (EUR)', { exact: true })).toHaveValue('20')
  const household = await current(accounts, session)
  expect(household.expenses).toHaveLength(1)
  expect(household.expenses[0].amount).toBe(1000)
})

test('house-rule drafts require reviewing concurrent changes and keep refreshed names everywhere', async ({ page, accounts }) => {
  const session = await seedHome(page, accounts)
  await page.goto('/rooms/kitchen')
  await page.getByRole('button', { name: 'House rules', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Monthly budget', { exact: true }).fill('400')
  await change(accounts, session, '/household', { name: 'The renamed home', budget: 50000, currency: 'EUR' }, 'PATCH')
  await refresh(page)
  await expect(dialog.getByRole('button', { name: 'Save the house rules', exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('Monthly budget', { exact: true })).toHaveValue('400')
  await dialog.getByRole('button', { name: 'Use latest values', exact: true }).click()
  await expect(dialog.getByLabel('Kitchen name', { exact: true })).toHaveValue('The renamed home')
  await expect(dialog.getByLabel('Monthly budget', { exact: true })).toHaveValue('500.00')
  await dialog.getByLabel('Monthly budget', { exact: true }).fill('600')
  await dialog.getByRole('button', { name: 'Save the house rules', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.game-house')).toContainText('The renamed home')
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await expect(page.locator('.kitchen-settings')).toContainText('€600.00')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))
  expect(saved[0].name).toBe('The renamed home')
})

test('a first receipt locks an open currency draft to the actual ledger currency', async ({ page, accounts }) => {
  const session = await seedHome(page, accounts)
  await page.goto('/rooms/kitchen')
  await page.getByRole('button', { name: 'House rules', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const currency = dialog.getByRole('combobox', { name: 'Currency', exact: true })
  await chooseOption(currency, 'USD')
  await change(accounts, session, '/expenses', {
    description: 'First paid groceries', amount: 1000, paidBy: session.memberId,
    participants: [session.memberId], category: 'produce', date: localDate(),
  })
  await refresh(page)
  await expect(currency).toBeDisabled()
  await expect(currency).toHaveAttribute('data-value', 'EUR')
  await dialog.getByRole('button', { name: 'Save the house rules', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await current(accounts, session)).currency).toBe('EUR')
})

test('bill defaults cannot silently overwrite a schedule changed while editing', async ({ page, accounts }) => {
  const session = await seedHome(page, accounts)
  const bill = await seedBill(accounts, session)
  await page.goto('/rooms/kitchen')
  await openBills(page)
  await page.getByRole('button', { name: 'Edit Internet', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Default amount (EUR)', { exact: true }).fill('40')
  await change(accounts, session, `/bills/${bill.id}`, {
    name: 'A shared internet plan', amount: 5000, dueDay: 12, participants: [session.memberId],
  }, 'PATCH')
  await refresh(page)
  await expect(dialog.getByRole('button', { name: 'Save monthly bill', exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('Default amount (EUR)', { exact: true })).toHaveValue('40')
  await dialog.getByRole('button', { name: 'Use latest values', exact: true }).click()
  await expect(dialog.getByLabel('Bill name', { exact: true })).toHaveValue('A shared internet plan')
  await expect(dialog.getByLabel('Default amount (EUR)', { exact: true })).toHaveValue('50.00')
  await dialog.getByLabel('Default amount (EUR)', { exact: true }).fill('52')
  await dialog.getByRole('button', { name: 'Save monthly bill', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const revision = (await current(accounts, session)).bills[0].revisions.at(-1)
  expect(revision?.name).toBe('A shared internet plan')
  expect(revision?.amount).toBe(5200)
  expect(revision?.dueDay).toBe(12)
})

test('a payment draft needs explicit review when its unpaid bill changes', async ({ page, accounts }) => {
  const session = await seedHome(page, accounts)
  const bill = await seedBill(accounts, session)
  await page.goto('/rooms/kitchen')
  await openBills(page)
  await page.getByRole('button', { name: 'Record payment for Internet', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount paid (EUR)', { exact: true }).fill('31')
  await change(accounts, session, `/bills/${bill.id}`, {
    name: 'A changed internet plan', amount: 5000, dueDay: 12, participants: [session.memberId],
  }, 'PATCH')
  await refresh(page)
  await expect(dialog.getByRole('button', { name: 'Record bill payment', exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('Amount paid (EUR)', { exact: true })).toHaveValue('31')
  await dialog.getByRole('button', { name: 'Keep my draft', exact: true }).click()
  await dialog.getByRole('button', { name: 'Record bill payment', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const household = await current(accounts, session)
  expect(household.expenses).toHaveLength(1)
  expect(household.expenses[0].amount).toBe(3100)
  expect(household.expenses[0].description).toBe('A changed internet plan')
})

test('the My turn filter survives cancelling and completing a chore dialog', async ({ page, accounts }) => {
  const session = await seedHome(page, accounts)
  await change(accounts, session, '/chores', {
    title: 'Wash the dishes', roomId: 'kitchen', area: 'sink', dueDate: billingDate('UTC'),
    repeatDays: 7, rotation: session.household.members.map((member) => member.id), turn: 0,
  })
  await page.goto('/rooms/kitchen')
  await page.getByRole('button', { name: 'Chores', exact: true }).click()
  await page.getByRole('checkbox', { name: 'My turn only', exact: true }).check()
  await page.getByRole('button', { name: 'Mark done', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'My turn only', exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Mark done', exact: true }).click()
  await page.getByRole('button', { name: 'Record completion', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'My turn only', exact: true })).toBeChecked()
  await expect(page.locator('.chore-list .chore-card')).toHaveCount(0)
})

test.describe('household calendar labels', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  test('chore dates and confirmation labels agree with their household due status', async ({ page, accounts }) => {
    const session = await seedHome(page, accounts)
    session.household.billingTimeZone = 'Pacific/Kiritimati'
    await accounts.store.save(session.household)
    await change(accounts, session, '/chores', {
      title: 'Check the supplies', roomId: 'kitchen', area: null, dueDate: '2026-09-09',
      repeatDays: null, rotation: [session.memberId], turn: 0,
    })
    await page.clock.setFixedTime(new Date('2026-09-08T23:30:00Z'))
    await page.goto('/rooms/kitchen')
    await page.getByRole('button', { name: 'Chores', exact: true }).click()
    const chore = page.getByRole('article', { name: 'Check the supplies', exact: true })
    await expect(chore.locator('.chore-status')).toHaveText('Due today')
    await expect(chore.locator('.chore-schedule')).toContainText('Today')
    await chore.getByRole('button', { name: 'Mark done', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Scheduled for Today.')
  })
})
