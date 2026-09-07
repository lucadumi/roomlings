import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sampleSession, savedKitchen, trackDrawing } from './fixtures.ts'
import { tourChapters } from '../../src/landing/tour.ts'

async function openTour(page: Page) {
  await page.locator('#tour').scrollIntoViewIfNeeded()
  await expect(page.locator('.welcome-tour')).toHaveAttribute('data-scene', 'ready')
}

async function chooseChapter(page: Page, index: number) {
  const chapter = tourChapters[index]
  await page.getByRole('navigation', { name: 'Kitchen tour' }).getByRole('button', { name: chapter.label, exact: true }).click()
  await expect(page.locator('.welcome-tour')).toHaveAttribute('data-chapter', chapter.id)
  await expect(page.getByRole('button', { name: chapter.label, exact: true })).toHaveAttribute('aria-pressed', 'true')
}

async function layoutProblems(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = []
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) problems.push('Horizontal overflow')
    for (const group of document.querySelectorAll('.welcome-header, .welcome-navigation, .welcome-header-actions, .welcome-tour-controls, .welcome-actions')) {
      const controls = [...group.children].filter((child) => child.matches('a, button') && child.getClientRects().length)
      const boxes = controls.map((control) => {
        const box = control.getBoundingClientRect()
        const label = control.getAttribute('aria-label') ?? control.textContent?.trim()
        if (box.width < 43.9 || box.height < 43.9) problems.push(`Small touch target: ${label}`)
        if (box.left < 0 || box.right > document.documentElement.clientWidth) problems.push(`Clipped control: ${label}`)
        return box
      })
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        if (Math.min(boxes[a].right, boxes[b].right) > Math.max(boxes[a].left, boxes[b].left)
          && Math.min(boxes[a].bottom, boxes[b].bottom) > Math.max(boxes[a].top, boxes[b].top)) problems.push('Overlapping controls')
      }
    }
    for (const paragraph of document.querySelectorAll('.welcome-feature p, .welcome-tour-copy p, .welcome-faq p')) {
      if (parseFloat(getComputedStyle(paragraph).fontSize) < 14) problems.push('Unreadable body copy')
    }
    return problems
  })
}

test('the public welcome page explains the product without opening or changing a kitchen session', async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/welcome')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Share a home.Not the hassle.')
  await expect(page.locator('.welcome-feature')).toHaveCount(3)
  await expect(page.getByRole('link', { name: 'Make yourself at home', exact: true })).toHaveAttribute('href', '/#account=create')
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/#account')
  await page.getByText('Does Roomlings send money?', { exact: true }).click()
  await expect(page.locator('.welcome-faq details').first()).toHaveAttribute('open', '')
  await expect(page.locator('.welcome-faq details').first()).toContainText('the app never moves money')
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  expect(errors).toEqual([])
})

test('the secondary kitchen tour uses less than one extra screen of native scrolling and reverses cleanly', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/welcome')
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
  await expect(page.locator('.welcome-canvas')).toHaveCount(0)
  await openTour(page)
  const dimensions = await page.locator('.welcome-tour-track').evaluate((element) => {
    const card = element.querySelector('.welcome-tour-pin')
    if (!card) throw new Error('The tour card is missing.')
    return { travel: element.getBoundingClientRect().height - card.getBoundingClientRect().height, screen: innerHeight }
  })
  expect(dimensions.travel).toBeGreaterThan(0)
  expect(dimensions.travel).toBeLessThanOrEqual(dimensions.screen)
  for (const index of [0, 1, 2, 3, 4, 2, 0]) {
    await chooseChapter(page, index)
    await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-camera-moving', 'false')
    const position = Number(await page.locator('.welcome-canvas').getAttribute('data-tour-position'))
    expect(Math.abs(position - index / 4)).toBeLessThanOrEqual(1 / dimensions.travel + 0.0005)
  }
  const before = await page.evaluate(() => scrollY)
  await page.mouse.move(600, 350)
  await page.mouse.wheel(0, 240)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 100)
  await page.getByRole('link', { name: 'Skip the tour', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Before you come in.', exact: true })).toBeInViewport()
})

test('reduced motion removes the scroll runway and holds a stationary room while the object buttons work', { tag: '@room' }, async ({ page }) => {
  const drawing = await trackDrawing(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/welcome')
  await openTour(page)
  const scene = page.locator('.welcome-canvas')
  await expect(page.locator('.welcome-tour-track')).toHaveAttribute('data-flow', 'true')
  await expect(scene).toHaveAttribute('data-rendering', 'paused')
  await expect(scene).toHaveAttribute('data-tour-position', 'static')
  const idle = await drawing()
  expect(idle.draws).toBeGreaterThan(0)
  await chooseChapter(page, 3)
  await expect(page.getByRole('heading', { name: 'Know what is left.', exact: true })).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await drawing()).toEqual(idle)
  await page.getByRole('button', { name: 'Reduced motion', exact: true }).click()
  await expect(scene).toHaveAttribute('data-rendering', 'active')
  await expect(scene).not.toHaveAttribute('data-tour-position', 'static')
  await page.getByRole('button', { name: 'Reduced motion', exact: true }).click()
  await expect(scene).toHaveAttribute('data-tour-position', 'static')
})

test('the tour stops drawing off screen instead of running behind the rest of the landing', { tag: '@room' }, async ({ page }) => {
  const drawing = await trackDrawing(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/welcome')
  await openTour(page)
  await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-rendering', 'active')
  await page.locator('#get-started').scrollIntoViewIfNeeded()
  await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-rendering', 'paused')
  const idle = await drawing()
  await page.waitForTimeout(200)
  expect(await drawing()).toEqual(idle)
  await openTour(page)
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(idle.draws)
})

test('opening the kitchen from the landing preserves current and Coldshare sessions', async ({ page, request }) => {
  const session = await sampleSession(request)
  await page.addInitScript((kitchen) => {
    localStorage.setItem('coldshare.session', kitchen.token)
    localStorage.setItem('coldshare.kitchens', JSON.stringify([kitchen]))
  }, savedKitchen(session))
  await page.goto('/welcome')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBeNull()
  await page.locator('.welcome-hero').getByRole('link', { name: 'Explore the kitchen', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText(session.household.name)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(session.token)
  await page.goto('/')
  await expect(page.locator('.game-house')).toContainText(session.household.name)
  await expect(page.locator('.welcome')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).toBe(session.token)
})

test('chapter deep links and unlinked scroll positions survive lazy entry and reload', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/welcome#house-pot')
  await expect(page.locator('.welcome-tour')).toHaveAttribute('data-scene', 'ready')
  await expect(page.locator('.welcome-tour')).toHaveAttribute('data-chapter', 'house-pot')
  await page.reload()
  await expect(page.locator('.welcome-tour')).toHaveAttribute('data-chapter', 'house-pot')
  await page.goto('/welcome')
  await page.locator('#how-it-works').scrollIntoViewIfNeeded()
  const scroll = await page.evaluate(() => scrollY)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0)
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

function withoutWebGL(page: Page) {
  return page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind.startsWith('webgl') || kind === 'experimental-webgl') return null
        return Reflect.apply(original, this, [kind, ...args])
      },
    })
  })
}

test('WebGL startup failure keeps the illustration, object navigation and actual kitchen tools available', { tag: '@room' }, async ({ page }) => {
  await withoutWebGL(page)
  await page.goto('/welcome')
  await page.locator('#tour').scrollIntoViewIfNeeded()
  await expect(page.locator('.welcome-tour')).toHaveAttribute('data-scene', 'unavailable')
  await expect(page.locator('.welcome-scene-status')).toContainText('3D is unavailable')
  await expect(page.locator('.welcome-static')).toBeVisible()
  await chooseChapter(page, 2)
  await expect(page.getByRole('heading', { name: 'The little things. The monthly things.', exact: true })).toBeVisible()
  await page.locator('.welcome-tour').getByRole('link', { name: 'Explore the kitchen', exact: true }).click()
  await expect(page.getByText('Your kitchen, minus the 3D.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The receipt book.', exact: true })).toBeVisible()
})

test('context loss restores the illustration without breaking the shorter tour', { tag: '@room' }, async ({ page }) => {
  await page.goto('/welcome')
  await openTour(page)
  await page.locator('.welcome-canvas canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The welcome canvas is missing.')
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('The browser cannot simulate context loss.')
    extension.loseContext()
  })
  await expect(page.locator('.welcome-tour')).toHaveAttribute('data-scene', 'unavailable')
  await chooseChapter(page, 1)
  await expect(page.locator('.welcome-static')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'From list to fridge.', exact: true })).toBeVisible()
})

test('the landing remains readable across phones, tablets, short landscapes and reserved scrollbar space', { tag: '@room' }, async ({ page }) => {
  test.setTimeout(90_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/welcome')
  await page.addStyleTag({ content: 'html { scrollbar-gutter: stable; }' })
  for (const [width, height] of [[1440, 960], [1024, 600], [768, 1024], [390, 844], [360, 640], [320, 568], [844, 390], [640, 360], [320, 360]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => document.fonts.ready)
    expect(await layoutProblems(page), `${width}x${height}`).toEqual([])
    await openTour(page)
    await chooseChapter(page, 2)
    await expect(page.locator('.welcome-tour-track')).toHaveAttribute('data-flow', 'true')
    await expect(page.getByRole('button', { name: 'Bills and receipts', exact: true })).toBeInViewport({ ratio: 1 })
    await page.locator('#get-started').getByRole('link', { name: 'Get started', exact: true }).scrollIntoViewIfNeeded()
    await expect(page.locator('#get-started').getByRole('link', { name: 'Get started', exact: true })).toBeInViewport({ ratio: 1 })
  }
})

test('longer copy and orientation changes use measured scene areas without clipping controls', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/welcome')
  await openTour(page)
  await page.locator('.welcome-tour-copy p').first().evaluate((element) => {
    element.textContent += ' Extra details about sharing a home should remain readable, even with larger type.'.repeat(6)
  })
  await expect(page.locator('.welcome-tour-track')).toHaveAttribute('data-flow', 'true')
  for (const [width, height] of [[390, 844], [1200, 800], [640, 360]]) {
    await page.setViewportSize({ width, height })
    await openTour(page)
    expect(await layoutProblems(page)).toEqual([])
    const fits = await page.locator('.welcome-stage').evaluate((element) => {
      const canvas = element.querySelector('.welcome-canvas')
      const raw = canvas?.getAttribute('data-scene-area')
      if (!raw) return false
      const area = JSON.parse(raw) as { x: number; y: number; width: number; height: number }
      return area.x >= 0 && area.y >= 0 && area.x + area.width <= element.clientWidth && area.y + area.height <= element.clientHeight
    })
    expect(fits).toBe(true)
  }
  await page.setViewportSize({ width: 320, height: 568 })
  await page.addStyleTag({ content: '.welcome-header { width: calc(100% - 72px); }' })
  expect(await layoutProblems(page)).toEqual([])
})

test('skip navigation, FAQ disclosures and tour controls work with a keyboard', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/welcome')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#welcome-content')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Make yourself at home', exact: true })).toBeFocused()
  await expect(page.getByRole('link', { name: 'Make yourself at home', exact: true })).toHaveCSS('outline-style', 'solid')
  await openTour(page)
  const budget = page.getByRole('button', { name: 'Monthly budget', exact: true })
  await budget.focus()
  await page.keyboard.press('Enter')
  await expect(budget).toHaveAttribute('aria-pressed', 'true')
  const question = page.locator('.welcome-faq summary').first()
  await question.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.welcome-faq details').first()).toHaveAttribute('open', '')
})

test('touch gestures scroll the page instead of being captured by the tour', { tag: '@room' }, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    const page = await context.newPage()
    await page.goto('/welcome')
    await openTour(page)
    const before = await page.evaluate(() => scrollY)
    const touch = await context.newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 270, y: 700 }] })
    for (const y of [640, 550, 450, 350, 230]) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 270, y }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 150)
  } finally {
    await context.close()
  }
})
