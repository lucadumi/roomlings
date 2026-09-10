import type { Locator } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { openRoomObjects } from './fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

async function expectFeedbackFits(feedback: Locator) {
  await expect(feedback).toBeInViewport({ ratio: 1 })
  expect(await feedback.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(feedback.locator('.feedback-text')).toHaveCSS('font-size', '12px')
  await expect(feedback.locator('.feedback-text')).toHaveCSS('line-height', '19.2px')
}

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`compact room-access feedback keeps Retry intact at ${viewport.width}px`, { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
    await page.setViewportSize(viewport)
    let detail = ''
    await page.route('**/api/household/room-access', (route) => route.fulfill(detail
      ? { status: 503, json: { error: detail } }
      : { status: 503, contentType: 'text/html', body: '<h1>Service unavailable</h1>' }))
    await page.goto('/kitchen')
    const feedback = page.locator('.app-feedback .feedback-error')
    const retry = feedback.getByRole('button', { name: 'Retry room access', exact: true })
    await expect(feedback.getByRole('alert')).toHaveText('Server unavailable. Try again.')
    await expect(retry).toHaveText('Retry')
    await expect(retry).toHaveCSS('white-space', 'nowrap')
    await expect(retry).toBeInViewport({ ratio: 1 })
    await expectFeedbackFits(feedback)

    detail = `Room access unavailable for ${'A'.repeat(100)}. Try again.`
    await retry.click()
    await expect(feedback.getByRole('alert')).toHaveText(detail)
    await expectFeedbackFits(feedback)
    await expect(retry).toBeInViewport({ ratio: 1 })
    if (viewport.width <= 390) {
      const button = await retry.boundingBox()
      expect(button).not.toBeNull()
      expect(button!.width).toBeGreaterThanOrEqual(44)
      expect(button!.height).toBeGreaterThanOrEqual(44)
    }

    await page.unroute('**/api/household/room-access')
    await retry.click()
    await expect(feedback).toHaveCount(0)
    await expect((await openRoomObjects(page)).getByRole('button', { name: 'Edit room', exact: true })).toBeVisible()
  })
}

test('form errors and confirmed successes share formatting without leaving stale success notices', async ({ page, accounts, emptyHousehold: household }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/kitchen')
  const rules = page.getByRole('button', { name: 'House rules', exact: true })
  await rules.click()
  const dialog = page.getByRole('dialog')
  const name = dialog.getByLabel('Kitchen name', { exact: true })
  const save = dialog.getByRole('button', { name: 'Save the house rules', exact: true })
  await name.fill('A saved household name')
  await page.route('**/api/household', (route) => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Service unavailable</h1>' })
    : route.fallback())
  await save.click()
  await expect(dialog.getByRole('alert')).toHaveText('Server unavailable. Request not confirmed. Try again.')
  await expectFeedbackFits(dialog.locator('.feedback-error'))
  await expect(name).toHaveValue('A saved household name')
  await expect(page.locator('.toast')).toHaveCount(0)
  expect((await accounts.store.get(household.household.id))?.name).toBe(household.household.name)

  await page.unroute('**/api/household')
  await save.click()
  await expect(dialog).toHaveCount(0)
  const success = page.locator('.toast')
  await expect(success.getByRole('status')).toHaveText('House rules saved.')
  await expect(success).toHaveClass(/feedback-success/)
  await expectFeedbackFits(success)
  expect((await accounts.store.get(household.household.id))?.name).toBe('A saved household name')

  await rules.click()
  await name.fill('An unconfirmed household name')
  await page.route('**/api/household', (route) => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Service unavailable</h1>' })
    : route.fallback())
  await save.click()
  await expect(dialog.getByRole('alert')).toContainText('Request not confirmed.')
  await expect(success).toHaveCount(0)
  await expect(name).toHaveValue('An unconfirmed household name')
  expect((await accounts.store.get(household.household.id))?.name).toBe('A saved household name')
})

test('room-access errors and successful saves stay separate without overlapping', { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.route('**/api/household/room-access', (route) => route.fulfill({
    status: 503, contentType: 'text/html', body: '<h1>Service unavailable</h1>',
  }))
  await page.goto('/kitchen')
  await expect(page.getByRole('alert')).toHaveText('Server unavailable. Try again.')
  await page.getByRole('button', { name: 'House rules', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Kitchen name', { exact: true }).fill('The same shared home')
  await dialog.getByRole('button', { name: 'Save the house rules', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const messages = page.locator('.app-feedback')
  await expect(messages.getByRole('alert')).toHaveText('Server unavailable. Try again.')
  await expect(messages.getByRole('status')).toHaveText('House rules saved.')
  await expect(messages.locator('.feedback-success').getByRole('button', { name: 'Retry room access', exact: true })).toHaveCount(0)
  const separation = await messages.evaluate((element) => {
    const error = element.querySelector('.feedback-error')!.getBoundingClientRect()
    const success = element.querySelector('.feedback-success')!.getBoundingClientRect()
    return success.top - error.bottom
  })
  expect(separation).toBeGreaterThanOrEqual(10)
  await expect(messages).toBeInViewport({ ratio: 1 })
  await messages.getByRole('button', { name: 'Dismiss notification', exact: true }).click()
  await expect(messages.getByRole('status')).toHaveCount(0)
  await expect(messages.getByRole('button', { name: 'Retry room access', exact: true })).toBeEnabled()
})
