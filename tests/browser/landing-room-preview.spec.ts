import { expect, test } from './account-fixtures.ts'
import { savedKitchen, trackDrawing } from './fixtures.ts'
import { roomIds } from '../../shared/rooms.ts'

test.use({ reducedMotion: 'reduce' })

test('the hero keeps only the home illustration and links to the room tour', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
  })
  await page.goto('/')
  const hero = page.locator('.welcome-hero')
  await expect(hero.getByRole('img', { name: 'Illustration of a shared home', exact: true })).toBeVisible()
  await expect(hero.getByRole('radio')).toHaveCount(0)
  await expect(hero.locator('img')).toHaveCount(0)
  const tourLink = hero.getByRole('link', { name: 'Explore rooms', exact: true })
  await expect(tourLink).toHaveAttribute('href', '#tour')
  await expect(tourLink).toHaveCSS('border-top-width', '0px')
  await expect(tourLink).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  const explore = page.locator('#tour')
  await expect(explore.getByRole('radio', { name: 'Kitchen', exact: true })).toBeChecked()
  await expect(explore.locator('.welcome-preview-choice img')).toHaveCount(roomIds.length)
  await explore.getByRole('radio', { name: 'Kitchen', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(explore.getByRole('radio', { name: 'Bathroom', exact: true })).toBeChecked()
  await expect(page).toHaveURL(/#tour-bathroom$/)
  await expect(explore.locator('.welcome-tour-track')).toBeVisible()
  await expect(explore.getByRole('navigation', { name: 'Bathroom tour', exact: true })).toBeVisible()
  await expect(explore.getByRole('link', { name: /^Open (kitchen|bathroom)$/ })).toHaveCount(0)
  await expect(tourLink).toHaveAttribute('href', '#tour')
  for (const link of await page.locator('a.welcome-enter').all()) {
    await expect(link).toHaveAttribute('href', '/rooms/kitchen#account=create')
  }
  await page.goBack()
  await expect(explore.getByRole('radio', { name: 'Kitchen', exact: true })).toBeChecked()
  await expect(explore.locator('.welcome-tour-track')).toBeVisible()
  await expect(explore.getByRole('navigation', { name: 'Kitchen tour', exact: true })).toBeVisible()
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('exploring either room leaves saved personal access unchanged', async ({ page, accounts }) => {
  const personal = await accounts.store.create('The personal household', 'Ada', 'EUR', 45000)
  await page.addInitScript((kitchen) => {
    if (!localStorage.getItem('roomlings.session')) {
      localStorage.setItem('roomlings.session', kitchen.token)
      localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
      localStorage.setItem('roomlings.access-mode', 'browser')
    }
  }, savedKitchen(personal))
  await page.goto('/#tour-bathroom')
  const explore = page.locator('#tour')
  await expect(explore.getByRole('radio', { name: 'Bathroom', exact: true })).toBeChecked()
  await explore.getByRole('radio', { name: 'Kitchen', exact: true }).check()
  await expect(explore.getByRole('link', { name: /^Open (kitchen|bathroom)$/ })).toHaveCount(0)
  await expect(page.locator('.game-house')).toHaveCount(0)
  const access = await page.evaluate(() => ({
    personal: localStorage.getItem('roomlings.session'),
    kitchens: localStorage.getItem('roomlings.kitchens'),
    mode: localStorage.getItem('roomlings.access-mode'),
  }))
  expect(access.personal).toBe(personal.token)
  expect(JSON.parse(access.kitchens ?? '[]')).toEqual([savedKitchen(personal)])
  expect(access.mode).toBe('browser')
})

test('room choices and shared exploration controls remain contained through resizing', async ({ page }) => {
  await page.goto('/#tour-bathroom')
  const explore = page.locator('#tour')
  for (const viewport of [
    { width: 1440, height: 960 }, { width: 320, height: 568 },
    { width: 390, height: 844 }, { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    for (const choice of await explore.getByRole('radio').all()) {
      await choice.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
      await expect(choice).toBeInViewport({ ratio: 1 })
      const bounds = await choice.boundingBox()
      expect(bounds?.width).toBeGreaterThanOrEqual(44)
      expect(bounds?.height).toBeGreaterThanOrEqual(44)
    }
    const controls = explore.getByRole('navigation', { name: 'Bathroom tour', exact: true })
    await controls.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
    await expect(controls).toBeInViewport({ ratio: 1 })
    expect(await explore.locator('.welcome-tour-pin').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('switching rooms releases the old renderer and browser Back restores its chapter', { tag: '@room' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const drawing = await trackDrawing(page)
  await page.goto('/#receipts')
  const explore = page.locator('#tour')
  const canvas = explore.locator('.welcome-canvas')
  await expect(explore).toHaveAttribute('data-scene', 'ready')
  await expect(explore).toHaveAttribute('data-chapter', 'receipts')
  await expect(canvas).toHaveAttribute('data-rendering', 'active')
  await explore.getByRole('radio', { name: 'Bathroom', exact: true }).check()
  await expect(canvas).toHaveCount(0)
  await expect(explore).toHaveAttribute('data-scene', 'ready')
  await expect(explore.locator('.bathroom-preview-world')).toHaveAttribute('data-rendering', 'paused')
  const paused = await drawing()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await drawing()).toEqual(paused)
  await page.goBack()
  await expect(page).toHaveURL(/#receipts$/)
  await expect(explore.getByRole('radio', { name: 'Kitchen', exact: true })).toBeChecked()
  await expect(explore).toHaveAttribute('data-chapter', 'receipts')
  await expect(canvas).toHaveAttribute('data-rendering', 'active')
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(paused.draws)
})
