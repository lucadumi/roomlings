import { expect, test } from './account-fixtures.ts'
import { sessionSchema } from '../../src/api.ts'
import { createHousehold, pauseRequest, savedKitchen } from './fixtures.ts'

test.use({ providerEnabled: false })

test('an invitation keeps its draft and focus until it is submitted', async ({ page, accounts }) => {
  const owner = await createHousehold(accounts.store, 'The invitation house', 'Charlie')
  await page.goto(`/rooms/kitchen#join=${encodeURIComponent(owner.household.inviteCode)}`)
  const name = page.getByLabel('Your name', { exact: true })
  await name.fill('Dana')
  await expect(name).toHaveValue('Dana')
  await expect(name).toBeFocused()
  await page.getByRole('button', { name: 'Join the kitchen', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The invitation house')
  await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Dana')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a failed startup reports the error and retries the saved kitchen', async ({ page, accounts }) => {
  const original = await createHousehold(accounts.store, 'The saved house', 'Riley')
  await page.addInitScript((kitchen) => {
    localStorage.setItem('roomlings.session', kitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
  }, savedKitchen(original))
  const startup = await pauseRequest(page, '**/api/household')
  await page.goto('/kitchen')
  await (await startup.pending).fulfill({
    status: 503, json: { error: 'The kitchen is temporarily unavailable.' },
  })

  await expect(page.getByRole('alert')).toHaveText('The kitchen is temporarily unavailable.')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(original.token)
  await page.unroute('**/api/household')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The saved house')
  await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Riley')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(original.token)
})

test('joining from a room invitation keeps its draft while saved access loads', async ({ page, accounts }) => {
  const previous = await createHousehold(accounts.store, 'The previous house', 'Riley')
  const owner = await createHousehold(accounts.store, 'The joined house', 'Charlie')
  await page.addInitScript((kitchen) => {
    if (!localStorage.getItem('roomlings.session')) {
      localStorage.setItem('roomlings.session', kitchen.token)
      localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
    }
  }, savedKitchen(previous))
  await page.goto(`/rooms/kitchen#join=${encodeURIComponent(owner.household.inviteCode)}`)
  const name = page.getByLabel('Your name', { exact: true })
  await name.fill('Dana')
  await expect(page.locator('.game-house')).toContainText(previous.household.name)
  await expect(name).toHaveValue('Dana')
  await expect(name).toBeFocused()
  const joinedResponse = page.waitForResponse('**/api/join')
  await page.getByRole('button', { name: 'Join the kitchen', exact: true }).click()
  const joined = sessionSchema.parse(await (await joinedResponse).json())
  await expect(page.locator('.game-house')).toContainText('The joined house')
  await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Dana')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(joined.token)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]').length)).toBe(2)
  await page.reload()
  await expect(page.locator('.game-house')).toContainText('The joined house')
})
