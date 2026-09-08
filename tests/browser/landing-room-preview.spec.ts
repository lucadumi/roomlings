import { expect, test } from './account-fixtures.ts'
import { savedKitchen, trackDrawing } from './fixtures.ts'
import { sessionSchema } from '../../src/api.ts'

test.use({ reducedMotion: 'reduce' })

test('the hero keeps only the home illustration and its original sample link', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
  })
  await page.goto('/')
  const hero = page.locator('.welcome-hero')
  await expect(hero.getByRole('img', { name: 'Illustration of a shared home', exact: true })).toBeVisible()
  await expect(hero.getByRole('radio')).toHaveCount(0)
  await expect(hero.locator('img')).toHaveCount(0)
  const sample = hero.getByRole('link', { name: 'Try the sample', exact: true })
  await expect(sample).toHaveAttribute('href', '/sample/kitchen')
  await expect(sample).toHaveCSS('border-top-width', '0px')
  await expect(sample).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  const explore = page.locator('#tour')
  await expect(explore.getByRole('radio', { name: 'Kitchen', exact: true })).toBeChecked()
  await expect(explore.locator('.welcome-preview-choice img')).toHaveCount(2)
  await explore.getByRole('radio', { name: 'Kitchen', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(explore.getByRole('radio', { name: 'Bathroom', exact: true })).toBeChecked()
  await expect(page).toHaveURL(/#tour-bathroom$/)
  await expect(explore.getByRole('img', { name: 'Bathroom preview', exact: true })).toBeVisible()
  await expect(explore.locator('.welcome-tour-track')).toBeHidden()
  await expect(explore.getByRole('link', { name: 'Try the sample', exact: true })).toHaveAttribute('href', '/sample/bathroom')
  await expect(sample).toHaveAttribute('href', '/sample/kitchen')
  for (const link of await page.getByRole('link', { name: 'Get started', exact: true }).all()) {
    await expect(link).toHaveAttribute('href', '/rooms/kitchen#account=create')
  }
  await page.goBack()
  await expect(explore.getByRole('radio', { name: 'Kitchen', exact: true })).toBeChecked()
  await expect(explore.locator('.welcome-tour-track')).toBeVisible()
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('both Explore sample links keep one sample separate from saved personal access', async ({ page, accounts }) => {
  const personal = await accounts.store.create('The personal household', 'Ada', 'EUR', 45000)
  await page.addInitScript((kitchen) => {
    if (!localStorage.getItem('roomlings.session')) {
      localStorage.setItem('roomlings.session', kitchen.token)
      localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
      localStorage.setItem('roomlings.access-mode', 'browser')
    }
  }, savedKitchen(personal))
  let samples = 0
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/demo') samples++ })
  await page.goto('/#tour-bathroom')
  const explore = page.locator('#tour')
  await expect(explore.getByRole('radio', { name: 'Bathroom', exact: true })).toBeChecked()
  const created = page.waitForResponse('**/api/demo')
  await explore.getByRole('link', { name: 'Try the sample', exact: true }).click()
  const sample = sessionSchema.parse(await (await created).json())
  await expect(page).toHaveURL(/\/sample\/bathroom$/)
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toContainText('Bathroom')
  expect(sample.household.id).not.toBe(personal.household.id)
  expect(sample.household.demo).toBe(true)
  await page.getByRole('link', { name: 'Roomlings home', exact: true }).click()
  await expect(page.locator('#tour')).toBeVisible()
  await explore.getByRole('radio', { name: 'Kitchen', exact: true }).check()
  await explore.getByRole('link', { name: 'Try the sample', exact: true }).click()
  await expect(page).toHaveURL(/\/sample\/kitchen$/)
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toContainText('Kitchen')
  const access = await page.evaluate(() => ({
    sample: localStorage.getItem('roomlings.sample-session'),
    personal: localStorage.getItem('roomlings.session'),
    kitchens: localStorage.getItem('roomlings.kitchens'),
    mode: localStorage.getItem('roomlings.access-mode'),
  }))
  expect(access.sample).toBe(sample.token)
  expect(access.personal).toBe(personal.token)
  expect(JSON.parse(access.kitchens ?? '[]')).toEqual([savedKitchen(personal)])
  expect(access.mode).toBe('browser')
  expect(samples).toBe(1)
})

test('room choices, previews and sample links remain contained through resizing', async ({ page }) => {
  await page.goto('/#tour-bathroom')
  const explore = page.locator('#tour')
  for (const viewport of [
    { width: 1440, height: 960 }, { width: 320, height: 568 },
    { width: 390, height: 844 }, { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('img', { name: 'Bathroom preview', exact: true })).toBeVisible()
    for (const choice of await explore.getByRole('radio').all()) {
      await choice.scrollIntoViewIfNeeded()
      await expect(choice).toBeInViewport({ ratio: 1 })
      const bounds = await choice.boundingBox()
      expect(bounds?.width).toBeGreaterThanOrEqual(44)
      expect(bounds?.height).toBeGreaterThanOrEqual(44)
    }
    const sample = explore.getByRole('link', { name: 'Try the sample', exact: true })
    await sample.scrollIntoViewIfNeeded()
    await expect(sample).toBeInViewport({ ratio: 1 })
    expect(await explore.locator('.welcome-bathroom-preview').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('an unavailable room image leaves the sample action available and reports the failure', async ({ page }) => {
  await page.route('**/*bathroom.png', (route) => route.abort())
  await page.goto('/#tour-bathroom')
  const explore = page.locator('#tour')
  await expect(explore.getByRole('status')).toContainText('The bathroom preview could not load')
  await expect(explore.getByRole('img', { name: 'Bathroom preview', exact: true })).toHaveCount(0)
  await expect(explore.getByRole('link', { name: 'Try the sample', exact: true })).toHaveAttribute('href', '/sample/bathroom')
  await explore.getByRole('radio', { name: 'Kitchen', exact: true }).check()
  await expect(explore.locator('.welcome-tour-track')).toBeVisible()
})

test('switching rooms pauses the kitchen renderer and browser Back restores its chapter', { tag: '@room' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const drawing = await trackDrawing(page)
  await page.goto('/#receipts')
  const explore = page.locator('#tour')
  const canvas = explore.locator('.welcome-canvas')
  await expect(explore).toHaveAttribute('data-scene', 'ready')
  await expect(explore).toHaveAttribute('data-chapter', 'receipts')
  await expect(canvas).toHaveAttribute('data-rendering', 'active')
  await explore.getByRole('radio', { name: 'Bathroom', exact: true }).check()
  await expect(explore.locator('.welcome-tour-track')).toBeHidden()
  await expect(canvas).toHaveAttribute('data-rendering', 'paused')
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
