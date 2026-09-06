import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { sessionSchema } from '../../src/api.ts'
import { createHousehold, sampleSession, savedKitchen } from './fixtures.ts'

async function pauseRequest(page: Page, url: string) {
  let receiveRoute!: (route: Route) => void
  const pending = new Promise<Route>((resolve) => { receiveRoute = resolve })
  await page.route(url, receiveRoute)
  return { pending }
}

test('an invitation keeps its draft and focus when the kitchen finishes loading', async ({ page, request }) => {
  const owner = await createHousehold(request, 'The invitation house', 'Charlie')
  const startup = await pauseRequest(page, '**/api/demo')
  await page.goto(`/#join=${encodeURIComponent(owner.household.inviteCode)}`)
  const route = await startup.pending
  const name = page.getByLabel('Your name', { exact: true })
  await name.fill('Dana')
  await route.continue()

  await expect(page.locator('.game-house')).toContainText('The Sunday House')
  await expect(name).toHaveValue('Dana')
  await expect(name).toBeFocused()
  await page.getByRole('button', { name: 'Join the kitchen', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The invitation house')
  await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Dana')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a failed startup reports the error and retries the saved kitchen', async ({ page, request }) => {
  const original = await createHousehold(request, 'The saved house', 'Riley')
  await page.addInitScript((kitchen) => {
    localStorage.setItem('roomlings.session', kitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
  }, savedKitchen(original))
  const startup = await pauseRequest(page, '**/api/household')
  await page.goto('/')
  await (await startup.pending).fulfill({
    status: 503, json: { error: 'The kitchen is temporarily unavailable.' },
  })

  await expect(page.getByRole('alert')).toHaveText('The kitchen is temporarily unavailable.')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(original.token)
  await page.unroute('**/api/household')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The saved house')
  await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Riley')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(original.token)
})

for (const source of ['demo', 'saved kitchen'] as const) {
  for (const outcome of ['success', 'failure'] as const) {
    test(`joining a kitchen survives a late ${source} startup ${outcome}`, async ({ page, request }) => {
      const previous = source === 'demo'
        ? await sampleSession(request)
        : await createHousehold(request, 'The previous house', 'Riley')
      const owner = await createHousehold(request, 'The joined house', 'Charlie')
      if (source === 'saved kitchen') {
        await page.addInitScript((kitchen) => {
          if (!localStorage.getItem('roomlings.session')) {
            localStorage.setItem('roomlings.session', kitchen.token)
            localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
          }
        }, savedKitchen(previous))
      }
      const path = source === 'demo' ? '**/api/demo' : '**/api/household'
      const startup = await pauseRequest(page, path)
      await page.goto(`/#join=${encodeURIComponent(owner.household.inviteCode)}`)
      const route = await startup.pending
      await page.getByLabel('Your name', { exact: true }).fill('Dana')
      const joinedResponse = page.waitForResponse('**/api/join')
      await page.getByRole('button', { name: 'Join the kitchen', exact: true }).click()
      const joined = sessionSchema.parse(await (await joinedResponse).json())
      await expect(page.locator('.game-house')).toContainText('The joined house')
      await expect(page.getByRole('dialog')).toHaveCount(0)

      const startupResponse = page.waitForResponse(path)
      await route.fulfill({
        status: outcome === 'failure' ? 503 : source === 'demo' ? 201 : 200,
        json: outcome === 'failure'
          ? { error: 'The previous kitchen could not be opened.' }
          : source === 'demo' ? previous : { household: previous.household, memberId: previous.memberId },
      })
      await (await startupResponse).finished()
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }))

      await expect(page.locator('.game-house')).toContainText('The joined house')
      await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Dana')
      await expect(page.getByRole('alert')).toHaveCount(0)
      expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(joined.token)
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]').length))
        .toBe(source === 'demo' ? 1 : 2)

      await page.unroute(path)
      await page.reload()
      await expect(page.locator('.game-house')).toContainText('The joined house')
      await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Dana')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })
  }
}
