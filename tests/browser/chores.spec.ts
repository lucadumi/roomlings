import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { billingDate, householdSchema } from '../../shared/domain.ts'
import type { Household, Session } from '../../shared/domain.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { expect, routeAccountApi, closeAccountContext, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'
import { chooseOption, savedKitchen, selectRoom } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

async function seedHome(page: Page, accounts: AccountHarness) {
  const owner = await accounts.store.create('The chore household', 'Ada', 'EUR', 45000)
  const ben = { id: randomUUID(), name: 'Ben', color: '#7d9070' }
  owner.household.members.push(ben)
  await accounts.store.save(owner.household)
  const roommate = await accounts.store.session(owner.household, ben.id)
  await page.addInitScript((kitchen) => {
    if (!localStorage.getItem('roomlings.session')) {
      localStorage.setItem('roomlings.session', kitchen.token)
      localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
      localStorage.setItem('roomlings.access-mode', 'browser')
    }
  }, savedKitchen(owner))
  return { owner, roommate, ben }
}

async function readHome(accounts: AccountHarness, id: string): Promise<Household> {
  const household = await accounts.store.get(id)
  if (!household) throw new Error('The isolated household is missing.')
  return household
}

async function openChores(page: Page) {
  await page.getByRole('button', { name: 'Chores', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Household chores.', exact: true })).toBeVisible()
}

async function addChore(page: Page, title: string, roomId: string, area: string, repeat = '') {
  await page.getByRole('button', { name: 'Add chore', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Chore name', { exact: true }).fill(title)
  await chooseOption(dialog.getByRole('combobox', { name: 'Room', exact: true }), roomId)
  if (roomId) await chooseOption(dialog.getByRole('combobox', { name: 'Area', exact: true }), area)
  await dialog.getByLabel('Due date', { exact: true }).fill(billingDate('UTC'))
  await chooseOption(dialog.getByRole('combobox', { name: 'Repeat', exact: true }), repeat)
  await dialog.getByRole('button', { name: 'Create chore', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function roommateChange(accounts: AccountHarness, session: Session, path: string, body: Record<string, unknown>, method = 'POST') {
  const household = await readHome(accounts, session.household.id)
  const response = await fetch(`${accounts.origin}/api${path}`, {
    method, headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, version: household.version }),
  })
  expect(response.ok).toBe(true)
  const data: { household: unknown } = await response.json()
  return householdSchema.parse(data.household)
}

test('chores span rooms, rotate once, and undo without touching financial history', async ({ page, accounts }) => {
  const { owner, ben } = await seedHome(page, accounts)
  const moneyBefore = { expenses: owner.household.expenses, settlements: owner.household.settlements, bills: owner.household.bills, budget: owner.household.budget }
  await page.goto(roomPath())
  await openChores(page)
  await addChore(page, 'Wash the dishes', 'kitchen', 'sink', '7')
  const kitchenChore = page.getByRole('article', { name: 'Wash the dishes', exact: true })
  await kitchenChore.getByRole('button', { name: 'Edit Wash the dishes', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: /Ben/ }).check()
  await dialog.getByRole('button', { name: 'Save chore', exact: true }).click()
  await expect(kitchenChore).toContainText('Rotating')
  await addChore(page, 'Clean the mirror', 'bathroom', 'mirror', '7')
  await addChore(page, 'Put out the recycling', '', '')
  await chooseOption(page.getByRole('combobox', { name: 'Chore room', exact: true }), 'all')
  await expect(page.locator('.chore-list .chore-card')).toHaveCount(3)
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await selectRoom(page, 'bathroom')
  await expect(page).toHaveURL(new RegExp(`${roomPath('bathroom')}$`))
  await expect(page.locator('.game-house')).toContainText('The chore household')
  await openChores(page)
  await expect(page.getByRole('combobox', { name: 'Chore room', exact: true })).toHaveAttribute('data-value', 'bathroom')
  await expect(page.locator('.chore-list .chore-card')).toHaveCount(1)
  await expect(page.getByRole('article', { name: 'Clean the mirror', exact: true })).toBeVisible()
  await chooseOption(page.getByRole('combobox', { name: 'Chore room', exact: true }), 'all')
  await kitchenChore.getByRole('button', { name: 'Mark done', exact: true }).click()
  await expect(dialog).toContainText('Assigned to Ada')
  await dialog.getByRole('button', { name: 'Record completion', exact: true }).click()
  await expect(kitchenChore).toContainText("Ben's turn")
  const completed = await readHome(accounts, owner.household.id)
  expect(completed.chores.history).toHaveLength(1)
  expect(completed.chores.history[0].assignedTo).toBe(owner.memberId)
  expect(completed.chores.history[0].completedBy).toBe(owner.memberId)
  const next = completed.chores.items.find((chore) => chore.title === 'Wash the dishes')
  expect(next?.rotation[next.turn]).toBe(ben.id)
  expect(next?.dueDate! > billingDate('UTC')).toBe(true)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: 'Undo completion', exact: true }).click()
  await dialog.getByRole('button', { name: 'Undo completion', exact: true }).click()
  await expect(page.locator('.chore-completion')).toContainText('Undone')
  await page.getByRole('navigation', { name: 'Chore sections', exact: true }).getByRole('button', { name: 'Chores', exact: true }).click()
  await expect(kitchenChore).toContainText('Your turn')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toContainText('Bathroom')
  await openChores(page)
  await chooseOption(page.getByRole('combobox', { name: 'Chore room', exact: true }), 'all')
  await expect(page.locator('.chore-list .chore-card')).toHaveCount(3)
  const final = await readHome(accounts, owner.household.id)
  expect({ expenses: final.expenses, settlements: final.settlements, bills: final.bills, budget: final.budget }).toEqual(moneyBefore)
  expect(final.chores.history[0].undoneAt).not.toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(owner.token)
})

test('one-off completion, custom recurrence, reassignment and archive restoration remain editable', async ({ page, accounts }) => {
  const { owner, ben } = await seedHome(page, accounts)
  await page.goto(roomPath())
  await openChores(page)
  await addChore(page, 'Clean the counters', 'kitchen', 'counters')
  let card = page.getByRole('article', { name: 'Clean the counters', exact: true })
  await card.getByRole('button', { name: 'Mark done', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Record completion', exact: true }).click()
  await expect(card).toHaveCount(0)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: 'Schedule again', exact: true }).click()
  await chooseOption(dialog.getByRole('combobox', { name: 'Repeat', exact: true }), 'custom')
  await dialog.getByLabel('Repeat every (days)', { exact: true }).fill('')
  await expect(dialog.getByLabel('Repeat every (days)', { exact: true })).toBeVisible()
  await dialog.getByLabel('Repeat every (days)', { exact: true }).fill('10')
  await dialog.getByRole('checkbox', { name: /Ben/ }).check()
  await chooseOption(dialog.getByRole('combobox', { name: 'Next turn', exact: true }), ben.id)
  await dialog.getByRole('button', { name: 'Move Ben earlier', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save chore', exact: true }).click()
  await page.getByRole('navigation', { name: 'Chore sections', exact: true }).getByRole('button', { name: 'Chores', exact: true }).click()
  card = page.getByRole('article', { name: 'Clean the counters', exact: true })
  await expect(card).toContainText('Every 10 days')
  await expect(card).toContainText("Ben's turn")
  await card.getByRole('button', { name: 'Archive Clean the counters', exact: true }).click()
  await dialog.getByRole('button', { name: 'Archive chore', exact: true }).click()
  await expect(card).toHaveCount(0)
  await page.getByRole('button', { name: 'Archived', exact: true }).click()
  await page.getByRole('button', { name: 'Restore chore', exact: true }).click()
  await dialog.getByRole('button', { name: 'Restore chore', exact: true }).click()
  await expect(page.locator('.chore-list .chore-card')).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Chore sections', exact: true }).getByRole('button', { name: 'Chores', exact: true }).click()
  await expect(card).toContainText("Ben's turn")
  const task = (await readHome(accounts, owner.household.id)).chores.items[0]
  expect(task.rotation).toEqual([ben.id, owner.memberId])
  expect(task.archived).toBe(false)
  expect(task.repeatDays).toBe(10)
})

test('failed saves retain drafts and a roommate completion cannot be recorded twice', async ({ page, accounts }) => {
  const { owner, roommate } = await seedHome(page, accounts)
  await page.goto(roomPath())
  await openChores(page)
  await addChore(page, 'Clean the kitchen floor', 'kitchen', 'floor', '7')
  const initial = (await readHome(accounts, owner.household.id)).chores.items[0]
  await page.getByRole('button', { name: 'Edit Clean the kitchen floor', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Chore name', { exact: true }).fill('Keep this chore draft')
  await page.route(`**/api/chores/${initial.id}`, (route) => route.fulfill({ status: 503, json: { error: 'The chore could not be saved.' } }))
  await dialog.getByRole('button', { name: 'Save chore', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('The chore could not be saved.')
  await expect(dialog.getByLabel('Chore name', { exact: true })).toHaveValue('Keep this chore draft')
  expect((await readHome(accounts, owner.household.id)).chores.items[0].title).toBe(initial.title)
  await page.unroute(`**/api/chores/${initial.id}`)
  await roommateChange(accounts, roommate, `/chores/${initial.id}`, {
    title: 'A roommate edit', notes: '', roomId: 'kitchen', area: 'floor', dueDate: initial.dueDate,
    repeatDays: 7, rotation: initial.rotation, turn: initial.turn, choreVersion: initial.version,
  }, 'PATCH')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(dialog.getByRole('button', { name: 'Keep my draft', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Chore name', { exact: true })).toHaveValue('Keep this chore draft')
  await dialog.getByRole('button', { name: 'Keep my draft', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save chore', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('article', { name: 'Keep this chore draft', exact: true }).getByRole('button', { name: 'Mark done', exact: true }).click()
  const latest = (await readHome(accounts, owner.household.id)).chores.items[0]
  await roommateChange(accounts, roommate, `/chores/${latest.id}/complete`, { choreVersion: latest.version })
  await dialog.getByRole('button', { name: 'Record completion', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('This chore changed')
  await expect(dialog.getByRole('button', { name: 'Record completion', exact: true })).toBeDisabled()
  const saved = await readHome(accounts, owner.household.id)
  expect(saved.chores.history).toHaveLength(1)
  expect(saved.chores.history[0].completedBy).toBe(roommate.memberId)
})

test('restocking uses one shared shopping list and retains lost-response recovery without creating expenses', async ({ page, accounts }) => {
  const { owner } = await seedHome(page, accounts)
  await page.goto(roomPath('bathroom'))
  await openChores(page)
  await page.getByRole('button', { name: 'Restock room supplies', exact: true }).click()
  await page.getByRole('button', { name: 'Restock Toilet paper', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue('Toilet paper')
  await dialog.getByLabel('Quantity', { exact: true }).fill('2 packs')
  await dialog.getByRole('button', { name: 'Add to shopping list', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Toilet paper', exact: true })).toContainText('2 packs already on the shared list')
  await expect(page.getByRole('button', { name: 'Restock Toilet paper', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Restock Hand soap', exact: true }).click()
  await page.route('**/api/shopping/items', async (route) => {
    const response = await route.fetch({ url: `${accounts.origin}/api/shopping/items` })
    expect(response.ok()).toBe(true)
    await route.fulfill({ status: 503, json: { error: 'The response was interrupted. Review the list before retrying.' } })
  })
  await dialog.getByRole('button', { name: 'Add to shopping list', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('response was interrupted')
  await expect(dialog.getByLabel('Item name', { exact: true })).toHaveValue('Hand soap')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(dialog.getByRole('button', { name: 'Add to shopping list', exact: true })).toBeDisabled()
  await expect(dialog).toContainText('already on the shared list')
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.unroute('**/api/shopping/items')
  await page.getByRole('button', { name: 'Open shopping list', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Hand soap', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await selectRoom(page, 'kitchen')
  await openChores(page)
  await page.getByRole('button', { name: 'Restock room supplies', exact: true }).click()
  await page.getByRole('button', { name: 'Restock Dish soap', exact: true }).click()
  await dialog.getByRole('button', { name: 'Add to shopping list', exact: true }).click()
  const saved = await readHome(accounts, owner.household.id)
  expect(saved.shopping.items.map((item) => item.name).sort()).toEqual(['Dish soap', 'Hand soap', 'Toilet paper'])
  expect(saved.expenses).toEqual([])
  expect(saved.settlements).toEqual([])
})

test('two roommates see the same chore completion while keeping their own room choices', async ({ page, accounts, browser, baseURL }) => {
  const { owner, roommate } = await seedHome(page, accounts)
  await page.goto(roomPath('bathroom'))
  await openChores(page)
  await addChore(page, 'Clean the bath', 'bathroom', 'bath', '7')
  const otherContext = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
  try {
    const other = await otherContext.newPage()
    await routeAccountApi(other, accounts)
    await other.addInitScript((token) => localStorage.setItem('roomlings.session', token), roommate.token)
    await other.goto(roomPath())
    await openChores(other)
    await chooseOption(other.getByRole('combobox', { name: 'Chore room', exact: true }), 'all')
    await other.getByRole('article', { name: 'Clean the bath', exact: true }).getByRole('button', { name: 'Mark done', exact: true }).click()
    await other.getByRole('dialog').getByRole('button', { name: 'Record completion', exact: true }).click()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('button', { name: 'History', exact: true }).click()
    await expect(page.locator('.chore-completion')).toContainText('Ben completed it')
    await expect(page).toHaveURL(new RegExp(`${roomPath('bathroom')}$`))
    await expect(other).toHaveURL(new RegExp(`${roomPath()}$`))
    expect((await readHome(accounts, owner.household.id)).chores.history).toHaveLength(1)
  } finally {
    await closeAccountContext(otherContext)
  }
})

test('room switching retains real household edits and browser access', async ({ page, accounts }) => {
  const { owner } = await seedHome(page, accounts)
  await page.goto(roomPath('bathroom'))
  await openChores(page)
  await addChore(page, 'A room-specific task', 'bathroom', 'sink')
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await selectRoom(page, 'kitchen')
  await expect(page).toHaveURL(new RegExp(`${roomPath()}$`))
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`${roomPath('bathroom')}$`))
  await openChores(page)
  await expect(page.getByRole('article', { name: 'A room-specific task', exact: true })).toBeVisible()
  await page.reload()
  await openChores(page)
  await expect(page.getByRole('article', { name: 'A room-specific task', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(owner.token)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.access-mode'))).toBe('browser')
})

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`chores and restocking remain usable without WebGL at ${viewport.width}x${viewport.height}`, async ({ page, accounts }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value(this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
          if (kind.startsWith('webgl') || kind === 'experimental-webgl') return null
          return Reflect.apply(original, this, [kind, ...args])
        },
      })
    })
    await seedHome(page, accounts)
    await page.goto(roomPath('bathroom'))
    await openChores(page)
    await page.getByRole('button', { name: 'Add chore', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Chore name', { exact: true }).fill('A narrow-screen chore')
    await dialog.getByLabel('Notes', { exact: true }).fill('Long instructions '.repeat(12))
    await dialog.getByRole('checkbox', { name: /Ben/ }).check()
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await dialog.getByRole('button', { name: 'Create chore', exact: true }).click()
    await expect(page.getByRole('article', { name: 'A narrow-screen chore', exact: true })).toBeVisible()
    const panel = page.getByRole('region', { name: 'Household chores.', exact: true })
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Restock room supplies', exact: true }).click()
    await page.getByRole('button', { name: 'Restock Hand soap', exact: true }).click()
    await expect(dialog.getByLabel('Item name', { exact: true })).toBeFocused()
    await expect(dialog.getByLabel('Quantity', { exact: true })).toHaveCSS('font-size', '16px')
    await dialog.getByRole('button', { name: 'Add to shopping list', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Close panel', exact: true }).click()
    const chooser = page.getByRole('button', { name: 'Rooms', exact: true })
    await chooser.focus()
    await expect(chooser).toBeInViewport({ ratio: 1 })
    await selectRoom(page, 'kitchen')
    await expect(page).toHaveURL(new RegExp(`${roomPath()}$`))
  })
}
