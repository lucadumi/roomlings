import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { householdSchema } from '../../shared/domain.ts'
import type { Session, ShoppingItem } from '../../shared/domain.ts'
import { sessionSchema } from '../../src/api.ts'
import { chooseOption, createHousehold, openShoppingBag, savedKitchen } from './fixtures.ts'

async function current(request: APIRequestContext, token: string) {
  const response = await request.get('/api/household', { headers: { Authorization: `Bearer ${token}` } })
  await expect(response).toBeOK()
  return householdSchema.parse((await response.json()).household)
}

async function change(request: APIRequestContext, session: Session, path: string, data: Record<string, unknown>, method = 'POST') {
  const household = await current(request, session.token)
  const response = await request.fetch(`/api${path}`, {
    method, headers: { Authorization: `Bearer ${session.token}` }, data: { ...data, version: household.version },
  })
  await expect(response).toBeOK()
  return householdSchema.parse((await response.json()).household)
}

async function seedItem(request: APIRequestContext, session: Session, pickedUp = false): Promise<ShoppingItem> {
  let household = await change(request, session, '/shopping/items', { name: 'Milk', quantity: '2 cartons', notes: 'Plain' })
  let item = household.shopping.items[0]
  if (pickedUp) {
    household = await change(request, session, `/shopping/items/${item.id}/pick`, { itemVersion: item.version, pickedUp: true })
    item = household.shopping.items[0]
  }
  return item
}

async function restore(page: Page, session: Session) {
  await page.addInitScript((kitchen) => {
    if (!localStorage.getItem('roomlings.session')) {
      localStorage.setItem('roomlings.session', kitchen.token)
      localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
    }
  }, savedKitchen(session))
}

async function addItem(page: Page, name: string, quantity: string, notes = '') {
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  await page.getByLabel('Item name', { exact: true }).fill(name)
  await page.getByLabel('Quantity', { exact: true }).fill(quantity)
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill(notes)
  await page.getByRole('button', { name: 'Add to shopping list', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function pickItem(page: Page, name: string) {
  const checkbox = page.getByRole('checkbox', { name: `Picked up ${name}`, exact: true })
  await checkbox.click()
  await expect(checkbox).toBeChecked()
}

async function openCheckout(page: Page) {
  await page.getByRole('button', { name: /^Basket / }).click()
  await page.getByRole('button', { name: 'Finish shopping', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Finish this shopping run.', exact: true })).toBeVisible()
}

test.describe('shared shopping', () => {
  test.use({ reducedMotion: 'reduce' })

  test('plans without debts, checks out selected items once and keeps an archive after receipt removal', async ({ page, request }) => {
    await page.goto('/kitchen')
    const pot = page.locator('.fund-trigger strong')
    const share = page.locator('.game-balance strong')
    const beforePot = await pot.innerText()
    const beforeShare = await share.innerText()
    await openShoppingBag(page)
    await addItem(page, 'Milk', '2 cartons', 'Unsweetened')
    await addItem(page, 'Bread', '1 loaf')
    await addItem(page, 'Apples', '500 g')
    await page.getByRole('button', { name: 'Claim Milk', exact: true }).click()
    await expect(page.getByRole('article', { name: 'Milk', exact: true })).toContainText('You are buying')
    await pickItem(page, 'Milk')
    await pickItem(page, 'Bread')
    await expect(pot).toHaveText(beforePot)
    await expect(share).toHaveText(beforeShare)
    await openCheckout(page)
    await page.locator('.checkout-item').filter({ hasText: 'Bread' }).getByRole('checkbox').uncheck()
    await page.getByLabel('What did you pick up?', { exact: true }).fill('Saturday basket')
    await page.getByLabel('Total (EUR)', { exact: true }).fill('7.03')
    await chooseOption(page.getByRole('combobox', { name: 'Paid by', exact: true }), { label: 'Jules' })
    await chooseOption(page.getByRole('combobox', { name: 'On which shelf?', exact: true }), 'dairy')
    await page.getByRole('button', { name: 'Record shopping run', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'The shopping bag.', exact: true })).toHaveCount(0)
    await expect(pot).not.toHaveText(beforePot)
    await expect(share).not.toHaveText(beforeShare)
    await openShoppingBag(page)
    await expect(page.getByRole('article', { name: 'Milk', exact: true })).toHaveCount(0)
    await expect(page.getByRole('article', { name: 'Bread', exact: true })).toContainText('In your basket')
    await expect(page.getByRole('article', { name: 'Apples', exact: true })).toContainText('Available to claim')
    await page.getByRole('button', { name: 'Past runs', exact: true }).click()
    const run = page.getByRole('article', { name: 'Saturday basket', exact: true })
    await expect(run).toContainText('€7.03')
    await expect(run).toContainText('paid by Jules')
    await run.locator('summary').click()
    await expect(run).toContainText('2 cartons Milk')
    await expect(run).toContainText('Unsweetened')
    const token = await page.evaluate(() => localStorage.getItem('roomlings.session'))
    if (!token) throw new Error('The test kitchen session is missing.')
    const state = await current(request, token)
    expect(state.shopping.runs).toHaveLength(1)
    expect(state.shopping.runs[0].items).toHaveLength(1)
    expect(state.expenses.filter((expense) => expense.shoppingRunId)).toHaveLength(1)
    await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export ledger', exact: true }).click()
    const stream = await (await downloaded).createReadStream()
    let csv = ''
    for await (const chunk of stream) csv += chunk.toString()
    expect(csv).toContain('"Shopping items"')
    expect(csv).toContain('2 cartons Milk (Unsweetened)')
    await page.getByRole('button', { name: 'Remove Saturday basket', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('items stay archived')
    await page.getByRole('button', { name: 'Remove grocery run', exact: true }).click()
    await openShoppingBag(page)
    await page.getByRole('button', { name: 'Past runs', exact: true }).click()
    await expect(run).toContainText('Receipt removed')
    await page.reload()
    await openShoppingBag(page)
    await page.getByRole('button', { name: 'Past runs', exact: true }).click()
    await expect(page.locator('.shopping-run')).toHaveCount(1)
  })

  test('shows competing claims and protects a draft from a background item edit', async ({ page, request }) => {
    const owner = await createHousehold(request, 'A shared list', 'Charlie')
    const joined = await request.post('/api/join', { data: { inviteCode: owner.household.inviteCode, name: 'Dana' } })
    const roommate = sessionSchema.parse(await joined.json())
    const item = await seedItem(request, owner)
    await restore(page, owner)
    await page.goto('/kitchen')
    await openShoppingBag(page)
    await page.route(`**/api/shopping/items/${item.id}/claim`, async (route) => {
      await change(request, roommate, `/shopping/items/${item.id}/claim`, { claimed: true, itemVersion: item.version })
      await route.continue()
    })
    await page.getByRole('button', { name: 'Claim Milk', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('changed the kitchen')
    await expect(page.getByRole('article', { name: 'Milk', exact: true })).toContainText('Dana is buying')
    await expect(page.getByRole('button', { name: 'Edit Milk', exact: true })).toBeDisabled()
    await page.unroute(`**/api/shopping/items/${item.id}/claim`)
    await page.getByRole('button', { name: 'Release claim on Milk', exact: true }).click()
    await page.getByRole('button', { name: 'Release claim', exact: true }).click()
    await page.getByRole('button', { name: 'Edit Milk', exact: true }).click()
    await page.getByLabel('Quantity', { exact: true }).fill('4 cartons')
    const latest = (await current(request, owner.token)).shopping.items[0]
    await change(request, roommate, `/shopping/items/${item.id}`, { name: 'Milk', quantity: '3 cartons', notes: 'Updated by Dana', itemVersion: latest.version }, 'PATCH')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('alert').filter({ hasText: 'This item changed' })).toBeVisible()
    await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('4 cartons')
    await expect(page.getByRole('button', { name: 'Save item', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Keep my draft', exact: true }).click()
    await page.getByRole('button', { name: 'Save item', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('article', { name: 'Milk', exact: true })).toContainText('4 cartons')
    await page.getByRole('button', { name: 'Remove Milk', exact: true }).click()
    await page.getByRole('button', { name: 'Remove item', exact: true }).click()
    await expect(page.locator('.shopping-item')).toHaveCount(0)
    expect((await current(request, owner.token)).expenses).toHaveLength(0)
  })

  test('retains the basket, receipt draft and checkout key after a failed save', async ({ page, request }) => {
    const owner = await createHousehold(request, 'The retry basket', 'Charlie')
    await seedItem(request, owner, true)
    await restore(page, owner)
    await page.goto('/kitchen')
    await openShoppingBag(page)
    await openCheckout(page)
    await page.getByLabel('Total (EUR)', { exact: true }).fill('12.47')
    let checkoutId = ''
    await page.route('**/api/shopping/checkout', async (route) => {
      checkoutId = route.request().postDataJSON().checkoutId
      await route.fulfill({ status: 503, json: { error: 'The shopping receipt could not be saved. Try again.' } })
    })
    await page.getByRole('button', { name: 'Record shopping run', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('could not be saved')
    await expect(page.getByLabel('Total (EUR)', { exact: true })).toHaveValue('12.47')
    const failed = await current(request, owner.token)
    expect(failed.expenses).toHaveLength(0)
    expect(failed.shopping.runs).toHaveLength(0)
    expect(failed.shopping.items[0].pickedUp).toBe(true)
    await page.unroute('**/api/shopping/checkout')
    const savedRequest = page.waitForRequest('**/api/shopping/checkout')
    await page.getByRole('button', { name: 'Record shopping run', exact: true }).click()
    expect((await savedRequest).postDataJSON().checkoutId).toBe(checkoutId)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const saved = await current(request, owner.token)
    expect(saved.expenses).toHaveLength(1)
    expect(saved.shopping.runs).toHaveLength(1)
    expect(saved.shopping.items).toHaveLength(0)
  })

  test('reconciles a lost successful response without creating another receipt', async ({ page, request }) => {
    const owner = await createHousehold(request, 'A receipt saved once', 'Charlie')
    await seedItem(request, owner, true)
    await restore(page, owner)
    await page.goto('/kitchen')
    await openShoppingBag(page)
    await openCheckout(page)
    await page.getByLabel('Total (EUR)', { exact: true }).fill('12.49')
    await page.route('**/api/shopping/checkout', async (route) => {
      const recorded = await request.post('/api/shopping/checkout', { headers: { Authorization: `Bearer ${owner.token}` }, data: route.request().postDataJSON() })
      await expect(recorded).toBeOK()
      await route.fulfill({ status: 503, json: { error: 'The receipt response was interrupted. Try again.' } })
    })
    await page.getByRole('button', { name: 'Record shopping run', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('interrupted')
    await page.unroute('**/api/shopping/checkout')
    await page.getByRole('button', { name: 'Record shopping run', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('already been recorded')
    await expect(page.getByRole('button', { name: 'Record shopping run', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Total (EUR)', { exact: true })).toHaveValue('12.49')
    const state = await current(request, owner.token)
    expect(state.expenses).toHaveLength(1)
    expect(state.shopping.runs).toHaveLength(1)
  })

  test('requires reviewing changed basket contents while preserving the entered total', async ({ page, request }) => {
    const owner = await createHousehold(request, 'The updated basket', 'Charlie')
    const item = await seedItem(request, owner, true)
    await restore(page, owner)
    await page.goto('/kitchen')
    await openShoppingBag(page)
    await openCheckout(page)
    await page.getByLabel('Total (EUR)', { exact: true }).fill('20')
    let changed = await change(request, owner, `/shopping/items/${item.id}/pick`, { pickedUp: false, itemVersion: item.version })
    changed = await change(request, owner, `/shopping/items/${item.id}`, { name: 'Milk', quantity: '4 cartons', notes: 'Changed basket', itemVersion: changed.shopping.items[0].version }, 'PATCH')
    await change(request, owner, `/shopping/items/${item.id}/pick`, { pickedUp: true, itemVersion: changed.shopping.items[0].version })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('alert')).toContainText('Your basket changed')
    await expect(page.getByRole('button', { name: 'Record shopping run', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Total (EUR)', { exact: true })).toHaveValue('20')
    await page.getByRole('button', { name: 'Reload my basket', exact: true }).click()
    await expect(page.locator('.checkout-items')).toContainText('4 cartons Milk')
    await page.getByRole('button', { name: 'Record shopping run', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await current(request, owner.token)).shopping.runs[0].items[0].quantity).toBe('4 cartons')
  })

  test('keeps small-screen list controls and notes usable without WebGL', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value(this: HTMLCanvasElement, type: string, options?: unknown) {
          if (type.startsWith('webgl')) return null
          return Reflect.apply(original, this, [type, options])
        },
      })
    })
    await page.goto('/kitchen')
    await openShoppingBag(page)
    await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Add item', exact: true }).click()
    await expect(page.getByLabel('Item name', { exact: true })).toBeFocused()
    await page.getByLabel('Item name', { exact: true }).fill('Milk')
    await page.getByLabel('Quantity', { exact: true }).fill('2 cartons')
    await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('No sugar\nSmall cartons')
    await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveCSS('font-size', '16px')
    expect(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Add to shopping list', exact: true }).click()
    await expect(page.getByRole('article', { name: 'Milk', exact: true })).toContainText('Small cartons')
    await page.getByRole('button', { name: 'Edit Milk', exact: true }).click()
    await page.getByLabel('Quantity', { exact: true }).fill('3 cartons')
    await page.getByRole('button', { name: 'Save item', exact: true }).click()
    await expect(page.getByRole('article', { name: 'Milk', exact: true })).toContainText('3 cartons')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Shopping bag, plan and record groceries', exact: true })).toBeFocused()
  })
})
