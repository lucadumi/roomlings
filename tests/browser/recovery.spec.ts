import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { householdSchema, localDate } from '../../shared/domain.ts'
import type { Session } from '../../shared/domain.ts'
import { recoveryRotationSchema } from '../../shared/access.ts'
import { createHousehold, pauseRequest, savedKitchen } from './fixtures.ts'

async function restoreBrowser(page: Page, session: Session, others: Session[] = []) {
  await page.addInitScript((kitchens) => {
    if (!localStorage.getItem('roomlings.session')) {
      localStorage.setItem('roomlings.session', kitchens[0].token)
      localStorage.setItem('roomlings.kitchens', JSON.stringify(kitchens))
    }
  }, [savedKitchen(session), ...others.map(savedKitchen)])
}

async function generateCode(request: APIRequestContext, session: Session) {
  const response = await request.post('/api/access/recovery', {
    headers: { Authorization: `Bearer ${session.token}` },
    data: { version: 0, revokeOthers: false },
  })
  await expect(response).toBeOK()
  return recoveryRotationSchema.parse(await response.json()).code
}

async function openAccess(page: Page) {
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await page.getByRole('button', { name: 'Recovery and devices', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Your browser access.', exact: true })).toBeVisible()
  await expect(page.getByLabel('Name this browser', { exact: true })).toHaveValue('Saved browser')
}

async function submitRecovery(page: Page, code: string, label: string) {
  await page.getByLabel('Recovery code', { exact: true }).fill(code)
  await page.getByLabel('Name this browser', { exact: true }).fill(label)
  await page.getByRole('button', { name: 'Recover my access', exact: true }).click()
}

test.describe('roommate recovery', () => {
  test.use({ reducedMotion: 'reduce' })

  test('creates a private code, restores the same roommate elsewhere and revokes a lost browser', async ({ page, request, browser, baseURL }) => {
    if (!baseURL) throw new Error('Recovery tests need a configured base URL.')
    const owner = await createHousehold(request, 'The recovery home', 'Charlie')
    const expense = await request.post('/api/expenses', {
      headers: { Authorization: `Bearer ${owner.token}` },
      data: { description: 'Saved groceries', amount: 803, category: 'produce', date: localDate(), paidBy: owner.memberId, participants: [owner.memberId], version: 0 },
    })
    await expect(expense).toBeOK()
    const before = householdSchema.parse((await expense.json()).household)
    await restoreBrowser(page, owner)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
    await page.goto('/')
    await openAccess(page)
    await page.getByLabel('Name this browser', { exact: true }).fill('Home laptop')
    await page.getByRole('button', { name: 'Save browser name', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Browser name saved')
    await page.getByRole('button', { name: 'Generate recovery code', exact: true }).click()
    const code = await page.getByLabel('Your private recovery code', { exact: true }).inputValue()
    await page.getByRole('button', { name: 'Copy recovery code', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Recovery code copied', exact: true })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code)
    expect(await page.evaluate((secret) => Object.values(localStorage).some((value) => String(value).includes(secret)), code)).toBe(false)
    expect(page.url()).not.toContain(code)
    await page.getByRole('button', { name: 'I saved the code', exact: true }).click()
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

    const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
    try {
      const phone = await context.newPage()
      await phone.goto('/#recover')
      await submitRecovery(phone, code, 'Phone')
      await expect(phone.locator('.game-house')).toContainText('The recovery home')
      await expect(phone.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Charlie')
      const token = await phone.evaluate(() => localStorage.getItem('roomlings.session'))
      const state = await request.get('/api/household', { headers: { Authorization: `Bearer ${token}` } })
      expect((await state.json()).household).toEqual(before)
      await phone.getByRole('button', { name: 'Grocery runs', exact: true }).click()
      await expect(phone.getByText('Saved groceries', { exact: true })).toBeVisible()

      await page.getByRole('button', { name: 'Recovery and devices', exact: true }).click()
      await page.getByRole('button', { name: 'Sign out Phone', exact: true }).click()
      await expect(page.getByRole('dialog')).toContainText('does not remove your roommate identity')
      await page.getByRole('button', { name: 'Sign out browser', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Sign out Phone', exact: true })).toHaveCount(0)
      await phone.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(phone.getByRole('button', { name: 'Recover access', exact: true })).toBeVisible()
      await expect(phone.locator('.game-house')).toHaveCount(0)
      await expect(phone.getByRole('alert')).toContainText('revoked')
      const unchanged = await request.get('/api/household', { headers: { Authorization: `Bearer ${owner.token}` } })
      expect((await unchanged.json()).household).toEqual(before)
    } finally {
      await context.close()
    }
  })

  test('replaces codes, signs out other sessions and deduplicates a recovered saved identity', async ({ page, request }) => {
    const owner = await createHousehold(request, 'The original identity', 'Charlie')
    const other = await createHousehold(request, 'Another saved home', 'Riley')
    const originalCode = await generateCode(request, owner)
    const phoneResponse = await request.post('/api/recover', { data: { code: originalCode, label: 'Old phone' } })
    await expect(phoneResponse).toBeOK()
    const phone: Session = await phoneResponse.json()
    await restoreBrowser(page, owner, [other])
    await page.goto('/')
    await openAccess(page)
    await page.getByRole('button', { name: 'Replace recovery code', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: /Also sign out/ })).toBeChecked()
    await page.getByRole('button', { name: 'Confirm replacement', exact: true }).click()
    const code = await page.getByLabel('Your private recovery code', { exact: true }).inputValue()
    expect((await request.post('/api/recover', { data: { code: originalCode, label: 'Invalid old code' } })).status()).toBe(401)
    expect((await request.get('/api/household', { headers: { Authorization: `Bearer ${phone.token}` } })).status()).toBe(401)
    await page.getByRole('button', { name: 'I saved the code', exact: true }).click()
    await page.getByRole('button', { name: 'Use a recovery code', exact: true }).click()
    await submitRecovery(page, code, 'Same browser restored')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.game-house')).toContainText('The original identity')
    const kitchens = await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))
    expect(kitchens).toHaveLength(2)
    expect(kitchens.filter((kitchen: { householdId: string; memberId: string }) => kitchen.householdId === owner.household.id && kitchen.memberId === owner.memberId)).toHaveLength(1)
    expect(kitchens.some((kitchen: { token: string }) => kitchen.token === other.token)).toBe(true)
    expect(await page.evaluate((previous) => localStorage.getItem('roomlings.session') !== previous, owner.token)).toBe(true)
    expect(await page.evaluate((secret) => Object.values(localStorage).some((value) => String(value).includes(secret)), code)).toBe(false)
    await page.reload()
    await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Charlie')
  })

  test('keeps recovery input across startup and a rejected request', async ({ page, request }) => {
    const owner = await createHousehold(request, 'The retained recovery', 'Charlie')
    const code = await generateCode(request, owner)
    const startup = await pauseRequest(page, '**/api/demo')
    await page.goto('/#recover')
    const demo = await startup.pending
    await page.getByLabel('Recovery code', { exact: true }).fill(code)
    await page.getByLabel('Name this browser', { exact: true }).fill('Phone draft')
    await demo.continue()
    await expect(page.locator('.game-house')).toContainText('The Sunday House')
    await expect(page.getByLabel('Recovery code', { exact: true })).toHaveValue(code)
    await page.route('**/api/recover', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Recovery is temporarily unavailable. Try again.' }),
    }))
    await page.getByRole('button', { name: 'Recover my access', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
    await expect(page.getByLabel('Recovery code', { exact: true })).toHaveValue(code)
    await expect(page.getByLabel('Name this browser', { exact: true })).toHaveValue('Phone draft')
    await page.unroute('**/api/recover')
    await page.getByRole('button', { name: 'Recover my access', exact: true }).click()
    await expect(page.locator('.game-house')).toContainText('The retained recovery')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('does not replace a recovered identity with a late sample kitchen', async ({ page, request }) => {
    const owner = await createHousehold(request, 'The recovered identity', 'Charlie')
    const code = await generateCode(request, owner)
    const startup = await pauseRequest(page, '**/api/demo')
    await page.goto('/#recover')
    const demo = await startup.pending
    await submitRecovery(page, code, 'A recovered browser')
    await expect(page.locator('.game-house')).toContainText('The recovered identity')
    const token = await page.evaluate(() => localStorage.getItem('roomlings.session'))
    const response = page.waitForResponse('**/api/demo')
    await demo.continue()
    await (await response).finished()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.locator('.game-house')).toContainText('The recovered identity')
    expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(token)
    await page.unroute('**/api/demo')
    await page.reload()
    await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Charlie')
  })

  test('ignores an expired refresh from the session that recovery has already replaced', async ({ page, request }) => {
    const owner = await createHousehold(request, 'The refreshed identity', 'Charlie')
    const code = await generateCode(request, owner)
    await restoreBrowser(page, owner)
    await page.goto('/')
    await expect(page.locator('.game-house')).toContainText('The refreshed identity')
    const pending = await pauseRequest(page, '**/api/household')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const oldRequest = await pending.pending
    await page.getByRole('button', { name: 'The roommates', exact: true }).click()
    await page.getByRole('button', { name: 'Use a recovery code', exact: true }).click()
    await submitRecovery(page, code, 'Restored identity')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const token = await page.evaluate(() => localStorage.getItem('roomlings.session'))
    expect(token).not.toBe(owner.token)
    const response = page.waitForResponse('**/api/household')
    await oldRequest.fulfill({ status: 401, json: { error: 'The old browser was revoked.' } })
    await (await response).finished()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.locator('.game-house')).toContainText('The refreshed identity')
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(token)
    await page.unroute('**/api/household')
  })

  test('small-screen access controls surface failed rotation and revocation without showing success', async ({ page, request }) => {
    const owner = await createHousehold(request, 'The careful recovery', 'Charlie')
    const code = await generateCode(request, owner)
    const restored = await request.post('/api/recover', { data: { code, label: 'Lost phone' } })
    await expect(restored).toBeOK()
    const phone: Session = await restored.json()
    await restoreBrowser(page, owner)
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/')
    await openAccess(page)
    expect(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Replace recovery code', exact: true }).click()
    await page.route('**/api/access/recovery', (route) => route.fulfill({
      status: 503, json: { error: 'The recovery code could not be replaced. Keep this browser open and try again.' },
    }))
    await page.getByRole('button', { name: 'Confirm replacement', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('could not be replaced')
    await expect(page.getByLabel('Your private recovery code', { exact: true })).toHaveCount(0)
    expect((await request.get('/api/household', { headers: { Authorization: `Bearer ${phone.token}` } })).status()).toBe(200)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Sign out Lost phone', exact: true }).click()
    await page.route('**/api/access/devices/*', (route) => route.fulfill({
      status: 503, json: { error: 'The browser could not be signed out. Try again.' },
    }))
    await page.getByRole('button', { name: 'Sign out browser', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('could not be signed out')
    expect((await request.get('/api/household', { headers: { Authorization: `Bearer ${phone.token}` } })).status()).toBe(200)
    await page.unroute('**/api/access/devices/*')
    await page.getByRole('button', { name: 'Sign out browser', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sign out Lost phone', exact: true })).toHaveCount(0)
    expect((await request.get('/api/household', { headers: { Authorization: `Bearer ${phone.token}` } })).status()).toBe(401)
  })
})
