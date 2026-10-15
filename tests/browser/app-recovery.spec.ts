import { expect, test } from './account-fixtures.ts'
import type { Page } from '@playwright/test'
import { pauseRequest } from './fixtures.ts'

const appModule = '**/{src/App.tsx,assets/App-*.js}*'

function recovery(page: Page) {
  return page.getByRole('alert').filter({ has: page.getByRole('heading', { name: "Roomlings couldn't open.", exact: true }) })
}

function countNavigations(page: Page) {
  let navigations = 0
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations += 1 })
  return () => navigations
}

test('a failed app load shows recovery and reloads only when asked', async ({ page, emptyHousehold: _household }) => {
  const failures: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()) })
  await page.route(appModule, (route) => route.abort())
  await page.goto('/kitchen')
  const card = recovery(page)
  await expect(card).toBeVisible()
  await expect(card.getByRole('heading', { level: 1 })).toBeFocused()
  await expect(card.getByText('may not have saved')).toHaveCount(0)
  const navigations = countNavigations(page)
  await page.waitForTimeout(1_000)
  expect(navigations()).toBe(0)
  expect(failures).toContain('Roomlings could not open (load: TypeError).')

  await page.unroute(appModule)
  await card.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Room style', exact: true })).toBeVisible()
  await expect(recovery(page)).toHaveCount(0)
  expect(navigations()).toBe(1)
})

test('a render failure during a save says the change is unconfirmed without replaying it', async ({ page, emptyHousehold: _household }) => {
  const failures: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()) })
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query) => {
      if (query === '(max-width: 1024px)' && sessionStorage.getItem('test.render-failure')) throw new Error('Rendering failed for The browser household')
      return matchMedia(query)
    }
  })
  await page.goto('/kitchen')
  await page.getByRole('button', { name: 'Room style', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Make the room feel like home.', exact: true })
  await picker.getByRole('radio', { name: 'Clay', exact: true }).check()
  const saves: string[] = []
  page.on('request', (request) => { if (request.url().endsWith('/api/household/room-style')) saves.push(request.method()) })
  const pending = await pauseRequest(page, '**/api/household/room-style')
  await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  const route = await pending.pending

  const card = recovery(page)
  try {
    await page.evaluate(() => sessionStorage.setItem('test.render-failure', '1'))
    await page.setViewportSize({ width: 1000, height: 720 })
    await expect(card).toBeVisible()
    await expect(card).toContainText('Your last change may not have saved. Check it after reloading.')
    expect(failures).toContain('Roomlings could not open (render: Error).')
  } finally {
    await route.fulfill({ status: 503, json: { error: 'The room style could not be saved. Please try again.' } })
  }
  await page.unroute('**/api/household/room-style')
  await page.evaluate(() => sessionStorage.removeItem('test.render-failure'))
  await card.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'original')
  await expect(recovery(page)).toHaveCount(0)
  expect(saves).toEqual(['PATCH'])
})
