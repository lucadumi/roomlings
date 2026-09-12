import { expect, test } from './account-fixtures.ts'
import { savedKitchen, trackDrawing, waitForTourReady } from './fixtures.ts'
import { roomCatalog, roomIds } from '../../shared/rooms.ts'

test.use({ reducedMotion: 'reduce' })

test('the hero keeps only the home illustration and links to the room tour', { tag: '@room' }, async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
  })
  await page.goto('/')
  const hero = page.locator('.welcome-hero')
  await expect(hero.getByRole('img', { name: 'Illustration of a shared home', exact: true })).toBeVisible()
  await expect(hero.getByRole('radio')).toHaveCount(0)
  await expect(hero.locator('img')).toHaveCount(0)
  const artwork = await hero.locator('.welcome-home-illustration').evaluate((element) => {
    if (!(element instanceof SVGSVGElement)) throw new Error('The home illustration is missing.')
    const bounds = element.getBBox()
    const view = element.viewBox.baseVal
    const scale = element.getScreenCTM()!.a
    const width = element.getBoundingClientRect().width
    return {
      contained: bounds.x > view.x && bounds.y > view.y && bounds.x + bounds.width < view.x + view.width && bounds.y + bounds.height < view.y + view.height,
      coverage: bounds.width * scale / width,
    }
  })
  expect(artwork.contained).toBe(true)
  expect(artwork.coverage).toBeGreaterThanOrEqual(0.95)
  const tourLink = hero.getByRole('link', { name: 'Explore rooms', exact: true })
  await expect(tourLink).toHaveAttribute('href', '#tour')
  await expect(tourLink).toHaveCSS('border-top-width', '0px')
  await expect(tourLink).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  const explore = page.locator('#tour')
  await expect(explore.getByRole('radio', { name: 'Kitchen', exact: true })).toBeChecked()
  const choices = explore.getByRole('group', { name: 'Preview a room', exact: true })
  await expect(choices.getByRole('radio')).toHaveCount(roomIds.length)
  await expect(choices.locator('img')).toHaveCount(0)
  for (const id of roomIds) {
    const choice = choices.getByRole('radio', { name: roomCatalog[id].name, exact: true })
    await expect(choice).toBeVisible()
    await expect(choice).toBeEnabled()
    await expect(choice).toHaveValue(id)
  }
  await explore.getByRole('radio', { name: 'Kitchen', exact: true }).focus()
  for (const id of roomIds.slice(1)) {
    await page.keyboard.press('ArrowRight')
    const choice = choices.getByRole('radio', { name: roomCatalog[id].name, exact: true })
    await expect(choice).toBeChecked()
    await expect(choice).toBeFocused()
    await expect(page).toHaveURL(new RegExp(`#tour-${id}$`))
    await expect(explore.locator('.welcome-tour-track')).toBeVisible()
    await expect(explore.getByRole('navigation', { name: `${roomCatalog[id].name} tour`, exact: true })).toBeVisible()
  }
  await expect(explore.getByRole('link', { name: /^Open (kitchen|bathroom)$/ })).toHaveCount(0)
  await expect(tourLink).toHaveAttribute('href', '#tour')
  for (const link of await page.locator('a.welcome-enter').all()) {
    await expect(link).toHaveAttribute('href', '/rooms/kitchen#account=create')
  }
  await page.goBack()
  await expect(explore.getByRole('radio', { name: 'Bathroom', exact: true })).toBeChecked()
  await expect(explore.getByRole('navigation', { name: 'Bathroom tour', exact: true })).toBeVisible()
  await page.goBack()
  await expect(explore.getByRole('radio', { name: 'Kitchen', exact: true })).toBeChecked()
  await expect(explore.locator('.welcome-tour-track')).toBeVisible()
  await expect(explore.getByRole('navigation', { name: 'Kitchen tour', exact: true })).toBeVisible()
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('the three-room hero cutaway stays contained through narrow sizing, orientation and longer copy', { tag: '@room' }, async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const hero = page.locator('.welcome-hero')
  const image = hero.getByRole('img', { name: 'Illustration of a shared home', exact: true })
  await expect(image).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  for (const viewport of [
    { width: 1280, height: 960 }, { width: 1440, height: 1000 },
    { width: 320, height: 780 }, { width: 390, height: 844 },
    { width: 780, height: 320 }, { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport)
    if (viewport.height === 568) {
      await hero.getByRole('heading', { level: 1 }).evaluate((heading) => {
        heading.append(' A little more space for every roommate to feel at home.')
      })
    }
    const artwork = await image.locator('svg').evaluate((element) => {
      if (!(element instanceof SVGSVGElement)) throw new Error('The home illustration is missing.')
      const bounds = element.getBBox()
      const view = element.viewBox.baseVal
      const matrix = element.getScreenCTM()!
      const frame = element.parentElement!.getBoundingClientRect()
      const title = document.querySelector('.welcome-hero h1')!.getBoundingClientRect()
      const artwork = element.getBoundingClientRect()
      const hero = element.closest('.welcome-hero')!
      const columnWidth = Number.parseFloat(getComputedStyle(hero).gridTemplateColumns.split(' ').at(-1)!)
      const columnCenter = hero.getBoundingClientRect().right - columnWidth / 2
      const start = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix)
      const end = new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height).matrixTransform(matrix)
      return {
        contained: bounds.x > view.x && bounds.y > view.y && bounds.x + bounds.width < view.x + view.width && bounds.y + bounds.height < view.y + view.height,
        unclipped: start.x >= frame.left && start.y >= frame.top && end.x <= frame.right && end.y <= frame.bottom,
        proportional: matrix.a === matrix.d,
        separate: title.right <= artwork.left || title.bottom <= artwork.top,
        drawingWidth: bounds.width * matrix.a,
        frameRatio: artwork.width / columnWidth,
        centered: Math.abs(artwork.left + artwork.width / 2 - columnCenter) < 1,
        polygons: element.querySelectorAll('polygon').length,
      }
    })
    expect(artwork.contained).toBe(true)
    expect(artwork.unclipped).toBe(true)
    expect(artwork.proportional).toBe(true)
    expect(artwork.separate).toBe(true)
    expect(artwork.frameRatio).toBeCloseTo(0.94, 2)
    expect(artwork.centered).toBe(true)
    if (viewport.width >= 1280) {
      expect(artwork.drawingWidth).toBeGreaterThanOrEqual(570)
      expect(artwork.drawingWidth).toBeLessThanOrEqual(600)
    }
    if (viewport.width === 320) {
      expect(artwork.drawingWidth).toBeGreaterThanOrEqual(250)
      expect(artwork.drawingWidth).toBeLessThanOrEqual(270)
    }
    if (viewport.width === 390) {
      expect(artwork.drawingWidth).toBeGreaterThanOrEqual(300)
      expect(artwork.drawingWidth).toBeLessThanOrEqual(320)
    }
    expect(artwork.polygons).toBeLessThan(1500)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await expect(hero.locator('canvas, img, button')).toHaveCount(0)
  expect(requests).toEqual([])
  expect(errors).toEqual([])
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
      const hitTarget = await choice.evaluate((element) => {
        if (!(element instanceof HTMLInputElement) || !element.labels?.[0]) throw new Error('Each room choice needs a clickable native label.')
        const { width, height } = element.labels[0].getBoundingClientRect()
        return { width, height }
      })
      expect(hitTarget.width).toBeGreaterThanOrEqual(44)
      expect(hitTarget.height).toBeGreaterThanOrEqual(44)
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
  await waitForTourReady(page)
  await expect(explore).toHaveAttribute('data-chapter', 'receipts')
  await expect(canvas).toHaveAttribute('data-rendering', 'active')
  await explore.getByRole('radio', { name: 'Bathroom', exact: true }).check()
  await expect(canvas).toHaveCount(0)
  await waitForTourReady(page)
  await expect(explore.locator('.bathroom-preview-world')).toHaveAttribute('data-rendering', 'paused')
  const paused = await drawing()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await drawing()).toEqual(paused)
  await page.goBack()
  await expect(page).toHaveURL(/#receipts$/)
  await expect(explore.getByRole('radio', { name: 'Kitchen', exact: true })).toBeChecked()
  await waitForTourReady(page)
  await expect(explore).toHaveAttribute('data-chapter', 'receipts')
  await expect(canvas).toHaveAttribute('data-rendering', 'active')
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(paused.draws)
})
