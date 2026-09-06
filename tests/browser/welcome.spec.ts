import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { sampleSession, savedKitchen, trackDrawing } from './fixtures.ts'

async function jumpTo(page: Page, id: string) {
  await page.locator(`#${id}`).evaluate((element) => element.scrollIntoView({ behavior: 'instant' }))
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', id)
  await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-camera-moving', 'false')
}

test('the separate welcome route tells the story without opening or changing a kitchen session', async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/welcome')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good company.')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await expect(page.getByRole('navigation', { name: 'Kitchen tour chapters' }).getByRole('link')).toHaveCount(5)
  for (const [index, id] of ['hello', 'groceries', 'receipts', 'house-pot', 'come-in'].entries()) {
    await jumpTo(page, id)
    await expect(page.locator('.welcome-chapters a[aria-current]')).toHaveAttribute('href', `#${id}`)
    await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-tour-position', (index / 4).toFixed(3))
  }
  await expect(page.getByRole('link', { name: 'Step into the kitchen' })).toHaveAttribute('href', '/')
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  expect(errors).toEqual([])
})

test('native wheel scrolling, chapter links, browser restoration, and the return link stay usable', async ({ page }) => {
  await page.goto('/welcome/')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await page.mouse.move(850, 450)
  await page.mouse.wheel(0, 550)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
  await page.getByRole('link', { name: 'The shared ledger', exact: true }).click()
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'receipts')
  await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-camera-moving', 'false')
  await page.reload()
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'receipts')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await jumpTo(page, 'come-in')
  await page.getByRole('link', { name: 'One more look' }).click()
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'hello')
})

test('reduced motion keeps a stationary room, supports keyboard navigation, and can be changed live', async ({ page }) => {
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
  await expect(page.getByRole('link', { name: 'Skip to the story' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#welcome-content')).toBeFocused()
  const link = page.getByRole('link', { name: 'The house pot', exact: true })
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

test('opening the kitchen from the tour preserves current and Coldshare sessions', async ({ page, request }) => {
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
  await page.getByRole('link', { name: 'Open kitchen', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText(session.household.name)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(session.token)
  await page.goto('/welcome')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(session.token)
})

test('direct chapter links and unlinked scroll positions survive the lazy page entry', async ({ page }) => {
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

test('WebGL startup failure leaves the complete illustrated story and working kitchen entry', async ({ page }) => {
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
  await page.getByRole('link', { name: 'Make yourself at home', exact: true }).click()
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'come-in')
  await page.getByRole('link', { name: 'Step into the kitchen' }).click()
  await expect(page.locator('.game-house')).toBeVisible()
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The receipt book.', exact: true })).toBeVisible()
})

test('losing a WebGL context replaces the canvas without losing chapter navigation', async ({ page }) => {
  await page.goto('/welcome')
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
  await page.locator('.welcome-canvas canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The welcome canvas is missing.')
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('This browser does not expose context loss for the scenario.')
    extension.loseContext()
  })
  await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'unavailable')
  await page.getByRole('link', { name: 'The grocery run', exact: true }).click()
  await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'groceries')
  await expect(page.getByRole('link', { name: 'Open kitchen', exact: true })).toBeVisible()
})

test('small screens retain readable copy, complete navigation, and no horizontal overflow', async ({ page }) => {
  for (const [width, height] of [[390, 844], [768, 1024]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/welcome')
    await expect(page.locator('.welcome')).toHaveAttribute('data-scene', 'ready')
    for (const id of ['hello', 'groceries', 'receipts', 'house-pot', 'come-in']) {
      await jumpTo(page, id)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await expect(page.locator(`#${id} .welcome-copy`)).toBeInViewport()
    }
    await expect(page.getByRole('link', { name: 'Step into the kitchen' })).toBeInViewport()
  }
  await page.setViewportSize({ width: 320, height: 568 })
  await jumpTo(page, 'hello')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('link', { name: 'Open kitchen', exact: true })).toBeInViewport()
})

test('touch gestures scroll the document instead of being captured by the 3D scene', async ({ browser, baseURL }) => {
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
    await page.getByRole('link', { name: 'The house pot', exact: true }).tap()
    await expect(page.locator('.welcome')).toHaveAttribute('data-chapter', 'house-pot')
  } finally {
    await context.close()
  }
})
