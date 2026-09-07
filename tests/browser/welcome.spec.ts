import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sampleSession, savedKitchen, trackDrawing } from './fixtures.ts'
import { tourChapters } from '../../src/landing/tour.ts'

async function jumpTo(page: Page, id: string) {
  await page.locator(`#${id}`).evaluate((element) => element.scrollIntoView({ behavior: 'instant' }))
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', id)
  await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-camera-moving', 'false')
  if (await page.locator('.welcome').getAttribute('data-motion') === 'full'
    && await page.locator('.welcome').getAttribute('data-scene') === 'ready') {
    const index = tourChapters.findIndex((chapter) => chapter.id === id)
    await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-tour-position', (index / (tourChapters.length - 1)).toFixed(3))
  }
}

async function layoutProblems(page: Page, id: string) {
  return page.evaluate((id) => {
    const header = document.querySelector('.welcome-header')?.getBoundingClientRect()
    const footer = document.querySelector('.welcome-controls')?.getBoundingClientRect()
    const copy = document.querySelector(`#${id} .welcome-copy`)?.getBoundingClientRect()
    if (!header || !footer || !copy) throw new Error('The landing layout is incomplete.')
    const flowing = document.querySelector('.welcome')?.getAttribute('data-flow') === 'true'
    const problems: string[] = []
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) problems.push('Horizontal overflow')
    if (copy.top < header.bottom + 4) problems.push('Copy overlaps the header')
    if (!flowing && copy.bottom > footer.top - 4) problems.push('Copy overlaps the footer')
    const controls = [...document.querySelectorAll(`.welcome-header a, .welcome-header button, .welcome-chapters a, #${id} .welcome-copy a`)]
    const boxes = controls.map((control) => {
      const bounds = control.getBoundingClientRect()
      const label = control.getAttribute('aria-label') ?? control.textContent?.trim()
      if (bounds.width < 43.9 || bounds.height < 43.9) problems.push(`Small touch target: ${label}`)
      if (flowing && (bounds.top < 0 || bounds.bottom > innerHeight)) return { bounds, label }
      if (bounds.left < 0 || bounds.right > document.documentElement.clientWidth || bounds.top < 0 || bounds.bottom > innerHeight) {
        problems.push(`Control outside the viewport: ${label}`)
      } else if (!control.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))) {
        problems.push(`Covered control: ${label}`)
      }
      return { bounds, label }
    })
    const overlaps = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) > Math.max(a.left, b.left)
      && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      if (overlaps(boxes[a].bounds, boxes[b].bounds)) problems.push(`Overlapping controls: ${boxes[a].label}, ${boxes[b].label}`)
    }
    const status = document.querySelector('.welcome-scene-status')
    if (status?.textContent?.trim() && overlaps(status.getBoundingClientRect(), copy)) problems.push('The scene status overlaps the copy')
    return problems
  }, id)
}

test('the separate welcome route tells the story without opening or changing a kitchen session', { tag: '@room' }, async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/welcome')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Split groceries and bills.')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await expect(page.getByRole('navigation', { name: 'On this page' }).getByRole('link')).toHaveCount(5)
  const copy = await page.locator('.welcome-story').innerText()
  const words = copy.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0
  expect(words).toBeGreaterThanOrEqual(110)
  expect(words).toBeLessThanOrEqual(145)
  const pageCopy = await page.locator('.welcome').innerText()
  expect(pageCopy.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length).toBeLessThanOrEqual(170)
  const entries = page.getByRole('link', { name: 'Open kitchen', exact: true })
  await expect(entries).toHaveCount(3)
  for (const entry of await entries.all()) await expect(entry).toHaveAttribute('href', '/')
  for (const [index, id] of ['hello', 'groceries', 'receipts', 'house-pot', 'come-in'].entries()) {
    await jumpTo(page, id)
    await expect(page.locator('.welcome-chapters a[aria-current]')).toHaveAttribute('href', `#${id}`)
    await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-tour-position', (index / 4).toFixed(3))
  }
  await expect(page.locator('#come-in').getByRole('link', { name: 'Open kitchen', exact: true })).toBeInViewport()
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  expect(errors).toEqual([])
})

test('native wheel scrolling, chapter links, browser restoration, and the return link stay usable', { tag: '@room' }, async ({ page }) => {
  await page.goto('/welcome/')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await page.mouse.move(850, 450)
  await page.mouse.wheel(0, 550)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
  await page.getByRole('link', { name: 'Bills and receipts', exact: true }).click()
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'receipts')
  await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-camera-moving', 'false')
  await page.reload()
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'receipts')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await jumpTo(page, 'come-in')
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'hello')
})

test('reduced motion keeps a stationary room, supports keyboard navigation, and can be changed live', { tag: '@room' }, async ({ page }) => {
  const drawing = await trackDrawing(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/welcome')
  const scene = page.locator('.welcome-canvas')
  await expect(scene).toHaveAttribute('data-rendering', 'paused')
  await expect(scene).toHaveAttribute('data-tour-position', 'static')
  const idle = await drawing()
  expect(idle.draws).toBeGreaterThan(0)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await drawing()).toEqual(idle)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#welcome-content')).toBeFocused()
  const link = page.getByRole('link', { name: 'Monthly budget', exact: true })
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'house-pot')
  await expect(scene).toHaveAttribute('data-tour-position', 'static')
  await expect(scene).toHaveAttribute('data-rendering', 'paused')
  expect(await drawing()).toEqual(idle)
  await page.getByRole('button', { name: 'Reduced motion', exact: true }).click()
  await expect(scene).toHaveAttribute('data-tour-position', '0.750')
  await expect(scene).toHaveAttribute('data-rendering', 'active')
  await page.getByRole('button', { name: 'Reduced motion', exact: true }).click()
  await expect(scene).toHaveAttribute('data-tour-position', 'static')
})

test('opening the kitchen from the tour preserves current and Coldshare sessions', { tag: '@room' }, async ({ page, request }) => {
  const session = await sampleSession(request)
  const kitchen = savedKitchen(session)
  await page.addInitScript(({ token, kitchen }) => {
    localStorage.setItem('coldshare.session', token)
    localStorage.setItem('coldshare.kitchens', JSON.stringify([kitchen]))
  }, { token: session.token, kitchen })
  await page.goto('/welcome')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).toBe(session.token)
  await page.locator('#hello').getByRole('link', { name: 'Open kitchen', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText(session.household.name)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(session.token)
  await page.goto('/welcome')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(session.token)
  await jumpTo(page, 'come-in')
  await page.locator('#come-in').getByRole('link', { name: 'Open kitchen', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText(session.household.name)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(session.token)
})

test('direct chapter links and unlinked scroll positions survive the lazy page entry', { tag: '@room' }, async ({ page }) => {
  await page.goto('/welcome#house-pot')
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'house-pot')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await page.goto('/welcome')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await page.locator('#groceries').evaluate((element) => window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY + 140, behavior: 'instant' }))
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'groceries')
  const scroll = await page.evaluate(() => window.scrollY)
  await page.reload()
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0)
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('WebGL startup failure leaves the complete illustrated story and working kitchen entry', { tag: '@room' }, async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === 'webgl2' || kind === 'webgl' || kind === 'experimental-webgl') return null
        return Reflect.apply(original, this, [kind, ...args])
      },
    })
  })
  await page.goto('/welcome')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'unavailable')
  await expect(page.getByRole('status')).toContainText('3D is unavailable')
  await expect(page.locator('.welcome-static')).toBeVisible()
  await page.getByRole('link', { name: 'Get started', exact: true }).click()
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'come-in')
  await page.locator('#come-in').getByRole('link', { name: 'Open kitchen', exact: true }).click()
  await expect(page.locator('.game-house')).toBeVisible()
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The receipt book.', exact: true })).toBeVisible()
})

test('losing a WebGL context replaces the canvas without losing chapter navigation', { tag: '@room' }, async ({ page }) => {
  await page.goto('/welcome')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await page.locator('.welcome-canvas canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The welcome canvas is missing.')
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('This browser does not expose context loss for the scenario.')
    extension.loseContext()
  })
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'unavailable')
  await page.getByRole('link', { name: 'Groceries', exact: true }).click()
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'groceries')
  await expect(page.locator('.welcome-header').getByRole('link', { name: 'Open kitchen', exact: true })).toBeVisible()
})

test('small screens retain readable copy, complete navigation, and no horizontal overflow', { tag: '@room' }, async ({ page }) => {
  for (const [width, height] of [[390, 844], [768, 1024]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/welcome')
    await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
    for (const id of ['hello', 'groceries', 'receipts', 'house-pot', 'come-in']) {
      await jumpTo(page, id)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await expect(page.locator(`#${id} .welcome-copy`)).toBeInViewport()
    }
    await expect(page.locator('#come-in').getByRole('link', { name: 'Open kitchen', exact: true })).toBeInViewport()
  }
  await page.setViewportSize({ width: 320, height: 568 })
  await jumpTo(page, 'hello')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.locator('.welcome-header').getByRole('link', { name: 'Open kitchen', exact: true })).toBeInViewport()
})

test('touch gestures scroll the document instead of being captured by the 3D scene', { tag: '@room' }, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    const page = await context.newPage()
    await page.goto('/welcome')
    await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
    const client = await context.newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 270, y: 700 }] })
    for (const y of [640, 550, 450, 350, 230]) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 270, y }] })
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(150)
    await page.getByRole('link', { name: 'Monthly budget', exact: true }).tap()
    await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'house-pot')
  } finally {
    await context.close()
  }
})

test('practical layouts keep every control readable and unobstructed, including reserved scrollbar space', { tag: '@room' }, async ({ page }) => {
  test.setTimeout(90_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const [width, height] of [[1440, 960], [1280, 720], [1024, 600], [768, 1024], [390, 844], [374, 667], [320, 568], [844, 390], [640, 360], [320, 360]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/welcome')
    await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
    await page.addStyleTag({ content: 'html { scrollbar-gutter: stable; }' })
    for (const { id } of tourChapters) {
      await jumpTo(page, id)
      expect(await layoutProblems(page, id), `${width}x${height}, ${id}`).toEqual([])
    }
    const entry = page.locator('#come-in').getByRole('link', { name: 'Open kitchen', exact: true })
    await entry.scrollIntoViewIfNeeded()
    await expect(entry).toBeInViewport({ ratio: 1 })
  }
})

test('the fallback notice never covers the copy or entry actions on short screens', { tag: '@room' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === 'webgl2' || kind === 'webgl' || kind === 'experimental-webgl') return null
        return Reflect.apply(original, this, [kind, ...args])
      },
    })
  })
  for (const [width, height] of [[844, 390], [640, 360], [390, 480], [320, 360]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/welcome')
    await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'unavailable')
    for (const { id } of tourChapters) {
      await page.locator(`#${id}`).evaluate((element) => element.scrollIntoView({ behavior: 'instant' }))
      await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', id)
      expect(await layoutProblems(page, id), `${width}x${height}, ${id}, fallback`).toEqual([])
    }
  }
})

test('keyboard focus stays visible on the primary entry and page navigation', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/welcome')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  const primary = page.locator('#hello').getByRole('link', { name: 'Open kitchen', exact: true })
  await expect(primary).toBeFocused()
  await expect(primary).toHaveCSS('outline-style', 'solid')
  await expect(primary).toHaveCSS('outline-color', 'rgb(174, 66, 43)')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'See how it works', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'groceries')
  const budget = page.getByRole('link', { name: 'Monthly budget', exact: true })
  await budget.focus()
  await expect(budget).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Enter')
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'house-pot')
  expect(await layoutProblems(page, 'house-pot')).toEqual([])
})

test('scene framing adapts to longer copy and orientation changes without a reload', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/welcome')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  const area = () => page.locator('.welcome-canvas').evaluate((element) => {
    const value = element.getAttribute('data-scene-area')
    if (!value) throw new Error('The measured scene area is missing.')
    return JSON.parse(value) as { x: number; y: number; width: number; height: number }
  })
  const original = await area()
  await page.locator('#hello p').evaluate((element) => {
    element.textContent += ' Additional household details should remain readable without covering the kitchen scene.'.repeat(3)
  })
  await expect.poll(async () => (await area()).y).toBeGreaterThan(original.y)
  const copy = await page.locator('#hello .welcome-copy').boundingBox()
  if (!copy) throw new Error('The longer copy is missing.')
  expect((await area()).y).toBeGreaterThanOrEqual(copy.y + copy.height)

  await page.setViewportSize({ width: 1200, height: 800 })
  await expect.poll(async () => (await area()).x).toBeGreaterThan(400)
  const wideCopy = await page.locator('#hello .welcome-copy').boundingBox()
  if (!wideCopy) throw new Error('The wide copy is missing.')
  expect((await area()).x).toBeGreaterThan(wideCopy.x + wideCopy.width)

  await page.setViewportSize({ width: 640, height: 360 })
  await expect(page.locator('.welcome')).toHaveAttribute('data-flow', 'true')
  const entry = page.locator('#hello').getByRole('link', { name: 'Open kitchen', exact: true })
  await entry.scrollIntoViewIfNeeded()
  await expect(entry).toBeInViewport({ ratio: 1 })
})

test('the header adapts to a constrained content width without overlapping controls', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/welcome')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await page.addStyleTag({ content: '.welcome-header { right: 40px; }' })
  await expect.poll(() => layoutProblems(page, 'hello')).toEqual([])
  const entry = page.locator('.welcome-header').getByRole('link', { name: 'Open kitchen', exact: true })
  await expect(entry).toBeInViewport({ ratio: 1 })
  await entry.click()
  await expect(page.locator('.game-house')).toBeVisible()
})
