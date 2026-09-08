import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { billingDate, householdSchema, localDate } from '../../shared/domain.ts'
import type { Session } from '../../shared/domain.ts'
import { addMonths } from '../../shared/bills.ts'
import { sessionSchema } from '../../src/api.ts'
import { monthTitle } from '../../src/format.ts'
import { createHousehold, savedKitchen } from './fixtures.ts'

async function createBill(request: APIRequestContext, session: Session, firstDueDate: string): Promise<Session> {
  const response = await request.post('/api/bills', {
    headers: { Authorization: `Bearer ${session.token}` },
    data: {
      name: 'Internet', amount: 3000, firstDueDate, participants: session.household.members.map((member) => member.id),
      version: session.household.version,
    },
  })
  await expect(response).toBeOK()
  return { ...session, household: householdSchema.parse((await response.json()).household) }
}

async function restoreKitchen(page: Page, session: Session) {
  await page.addInitScript((kitchen) => {
    localStorage.setItem('roomlings.session', kitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
  }, savedKitchen(session))
}

async function openBills(page: Page) {
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await page.getByRole('button', { name: 'Bills', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Bills', exact: true })).toHaveAttribute('aria-pressed', 'true')
}

test.describe('monthly bills', () => {
  test.use({ reducedMotion: 'reduce' })

  test('records variable payments in the shared ledger without changing groceries and can undo them', async ({ page }) => {
    const month = localDate().slice(0, 7)
    await page.goto('/kitchen')
    const pot = page.locator('.fund-trigger strong')
    const share = page.locator('.game-balance strong')
    const beforePot = await pot.innerText()
    const beforeShare = await share.innerText()
    const groceryCount = page.locator('.room-label > span')
    const beforeGroceries = await groceryCount.innerText()
    await openBills(page)
    await page.getByRole('button', { name: 'New monthly bill', exact: true }).click()
    await page.getByLabel('Bill name', { exact: true }).fill('Rent')
    await page.getByLabel('Default amount (EUR)', { exact: true }).fill('100')
    await page.getByLabel('First due date', { exact: true }).fill(`${month}-01`)
    await page.getByRole('button', { name: 'Create monthly bill', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const rent = page.locator('.bill-occurrence').filter({ hasText: 'Rent' })
    await expect(rent).toContainText('€100.00')
    await expect(rent.locator('.bill-status')).toHaveText(/Overdue|Due today/)
    await expect(pot).toHaveText(beforePot)
    await expect(share).toHaveText(beforeShare)

    await page.getByRole('button', { name: 'Record payment for Rent', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('does not move money')
    await page.getByLabel('Amount paid (EUR)', { exact: true }).fill('101.01')
    await page.getByRole('combobox', { name: 'Paid by', exact: true }).selectOption({ label: 'Jules' })
    await page.getByRole('button', { name: 'Record bill payment', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(rent.locator('.bill-status')).toHaveText('Paid')
    await expect(rent).toContainText('€101.01')
    await expect(rent).toContainText('Paid by Jules')
    await expect(pot).toHaveText(beforePot)
    await expect(share).not.toHaveText(beforeShare)
    await expect(groceryCount).toHaveText(beforeGroceries)
    await expect(page.getByRole('button', { name: 'Record payment for Rent', exact: true })).toHaveCount(0)

    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export ledger', exact: true }).click()
    const stream = await (await downloadEvent).createReadStream()
    let csv = ''
    for await (const chunk of stream) csv += chunk.toString()
    expect(csv).toContain('"Billing month"')
    expect(csv).toContain('"Bill"')
    expect(csv).toContain('"Rent","101.01"')
    expect(csv).toContain(`"${month}"`)

    await page.getByRole('button', { name: 'Groceries', exact: true }).click()
    await expect(page.locator('.expense-row')).toHaveCount(6)
    await expect(page.locator('.expense-row').filter({ hasText: 'Rent' })).toHaveCount(0)
    await page.locator('.category-tabs').getByRole('button', { name: 'Other groceries', exact: true }).click()
    await expect(page.locator('.expense-row')).toHaveCount(0)
    await page.getByRole('button', { name: 'Bills', exact: true }).click()
    await page.getByRole('button', { name: 'Undo payment for Rent', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('does not return money')
    await page.getByRole('button', { name: 'Undo bill payment record', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Record payment for Rent', exact: true })).toBeVisible()
    await expect(pot).toHaveText(beforePot)
    await expect(share).toHaveText(beforeShare)
  })

  test('edits defaults, keeps earlier dues, pauses future months and persists resumed schedules', async ({ page, request }) => {
    const month = billingDate('UTC').slice(0, 7)
    const previous = addMonths(month, -1)
    const session = await createBill(request, await createHousehold(request, 'The monthly house', 'Charlie'), `${previous}-01`)
    await restoreKitchen(page, session)
    await page.goto('/kitchen')
    await openBills(page)
    await page.getByRole('button', { name: `View ${monthTitle(previous)}`, exact: true }).click()
    await expect(page.locator('.bill-occurrence')).toContainText('€30.00')
    await page.getByRole('button', { name: 'Edit Internet', exact: true }).click()
    await page.getByLabel('Default amount (EUR)', { exact: true }).fill('40')
    await page.getByLabel('Day of month', { exact: true }).fill('31')
    await page.getByRole('button', { name: 'Save monthly bill', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.bill-occurrence')).toContainText('€30.00')
    await page.getByRole('button', { name: 'Next bill month', exact: true }).click()
    await expect(page.locator('.bill-occurrence')).toContainText('€40.00')
    await page.getByRole('button', { name: 'Pause Internet', exact: true }).click()
    await page.getByRole('button', { name: 'Pause monthly bill', exact: true }).click()
    await expect(page.locator('.bill-occurrence')).toHaveCount(1)
    await page.getByRole('button', { name: 'Next bill month', exact: true }).click()
    await expect(page.locator('.bill-occurrence')).toHaveCount(0)
    await page.getByRole('button', { name: 'Resume Internet', exact: true }).click()
    await page.getByRole('button', { name: 'Resume monthly bill', exact: true }).click()
    await expect(page.locator('.bill-occurrence')).toContainText('€40.00')
    await page.reload()
    await openBills(page)
    await expect(page.locator('.bill-occurrence')).toContainText('€40.00')
    await expect(page.getByRole('button', { name: 'Pause Internet', exact: true })).toBeVisible()
    const response = await request.get('/api/household', { headers: { Authorization: `Bearer ${session.token}` } })
    const restored = householdSchema.parse((await response.json()).household)
    expect(restored.expenses).toHaveLength(0)
    expect(restored.bills[0].revisions).toHaveLength(2)
  })

  test('a concurrent roommate payment cannot create another expense or erase the draft', async ({ page, request }) => {
    const owner = await createHousehold(request, 'A bill to share', 'Charlie')
    const joined = await request.post('/api/join', { data: { inviteCode: owner.household.inviteCode, name: 'Dana' } })
    await expect(joined).toBeOK()
    const roommate = sessionSchema.parse(await joined.json())
    const month = billingDate('UTC').slice(0, 7)
    const session = await createBill(request, { ...owner, household: roommate.household }, `${month}-01`)
    const bill = session.household.bills[0]
    await restoreKitchen(page, session)
    await page.goto('/kitchen')
    await openBills(page)
    await page.getByRole('button', { name: 'Record payment for Internet', exact: true }).click()
    await page.getByLabel('Amount paid (EUR)', { exact: true }).fill('99.99')
    await page.route(`**/api/bills/${bill.id}/payments`, async (route) => {
      const paid = await request.post(`/api/bills/${bill.id}/payments`, {
        headers: { Authorization: `Bearer ${roommate.token}` },
        data: {
          month, amount: 3100, paidBy: roommate.memberId, participants: session.household.members.map((member) => member.id),
          date: localDate(), version: session.household.version,
        },
      })
      await expect(paid).toBeOK()
      await route.continue()
    })
    await page.getByRole('button', { name: 'Record bill payment', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('A payment is already recorded')
    await expect(page.getByLabel('Amount paid (EUR)', { exact: true })).toHaveValue('99.99')
    await expect(page.getByRole('button', { name: 'Record bill payment', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await expect(page.locator('.bill-occurrence')).toContainText('Paid by Dana')
    const response = await request.get('/api/household', { headers: { Authorization: `Bearer ${session.token}` } })
    const current = householdSchema.parse((await response.json()).household)
    expect(current.expenses).toHaveLength(1)
    expect(current.expenses[0].amount).toBe(3100)
  })

  test('small-screen bill forms retain failed payments and remain keyboard accessible', async ({ page, request }) => {
    const month = billingDate('UTC').slice(0, 7)
    const session = await createBill(request, await createHousehold(request, 'The small bill house', 'Charlie'), `${month}-01`)
    await restoreKitchen(page, session)
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/kitchen')
    await openBills(page)
    await expect(page.getByRole('button', { name: 'New monthly bill', exact: true })).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.room-panel-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Record payment for Internet', exact: true }).click()
    const amount = page.getByLabel('Amount paid (EUR)', { exact: true })
    await expect(amount).toBeFocused()
    await amount.fill('48.76')
    expect(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.route(`**/api/bills/${session.household.bills[0].id}/payments`, (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The bill payment could not be saved. Try again.' }),
    }))
    await page.getByRole('button', { name: 'Record bill payment', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('could not be saved')
    await expect(amount).toHaveValue('48.76')
    await expect(page.getByRole('button', { name: 'Record bill payment', exact: true })).toBeEnabled()
    await page.unroute(`**/api/bills/${session.household.bills[0].id}/payments`)
    await page.getByRole('button', { name: 'Record bill payment', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.bill-occurrence')).toContainText('€48.76')
    await expect(page.locator('.bill-status')).toHaveText('Paid')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Grocery runs', exact: true })).toBeFocused()
  })
})
