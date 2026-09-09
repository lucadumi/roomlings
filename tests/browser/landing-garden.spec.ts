import type { Page } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { trackDrawing } from './fixtures.ts'

async function expectClearContent(page: Page) {
  await expect.poll(() => page.locator('.welcome-garden').evaluate((garden) => {
    const content = document.querySelector('.welcome-header')!.getBoundingClientRect()
    const left = garden.querySelector('.welcome-garden-left')!.getBoundingClientRect()
    const right = garden.querySelector('.welcome-garden-right')!.getBoundingClientRect()
    return Math.abs(left.right - (content.left - 12)) < 0.1 && Math.abs(right.left - (content.right + 12)) < 0.1
  })).toBe(true)
  for (const image of await page.locator('.welcome-garden-still:not([hidden])').all()) {
    expect(await image.evaluate((element) => {
      const image = element.getBoundingClientRect()
      return image.left >= 0 && image.right <= innerWidth && image.top >= 0 && image.bottom <= innerHeight
    }), 'The complete garden artwork must fit the viewport').toBe(true)
  }
  expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.locator('.welcome')).toHaveCSS('background-image', /radial-gradient/)
  await expect(page.locator('.welcome-hero')).toHaveCSS('display', 'grid')
}

test('the 3D edge garden frames the grid without covering content or intercepting controls', { tag: '@room' }, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  const garden = page.locator('.welcome-garden')
  await expect(garden).toHaveAttribute('aria-hidden', 'true')
  await expect(garden).toHaveAttribute('data-scene', 'ready')
  await expect(garden.locator('canvas')).toHaveCount(1)
  await expect(garden).toHaveCSS('pointer-events', 'none')
  await expect(garden.locator('button, a, input, [tabindex]')).toHaveCount(0)
  await expectClearContent(page)
  await page.screenshot({ path: testInfo.outputPath('garden-landing-desktop.png'), animations: 'disabled' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(garden.locator('.welcome-garden-canvas')).toHaveAttribute('data-rendering', 'paused')
  const content = await page.locator('.welcome-hero-copy').boundingBox()
  expect(content).not.toBeNull()
  await expect(garden).toHaveCSS('mask-image', /url\(/)
  const clip = { x: content!.x, y: content!.y, width: content!.width, height: content!.height }
  const withGarden = await page.screenshot({ clip, animations: 'disabled' })
  await garden.evaluate((element) => { element.style.visibility = 'hidden' })
  try {
    const withoutGarden = await page.screenshot({ clip, animations: 'disabled' })
    const difference = await page.evaluate(async (frames) => {
      const pixels: Uint8ClampedArray[] = []
      for (const frame of frames) {
        const image = new Image()
        image.src = `data:image/png;base64,${frame}`
        await image.decode()
        const context = new OffscreenCanvas(image.width, image.height).getContext('2d')
        if (!context) throw new Error('The content screenshots could not be compared.')
        context.drawImage(image, 0, 0)
        pixels.push(context.getImageData(0, 0, image.width, image.height).data)
      }
      let maximum = 0
      for (let index = 0; index < pixels[0].length; index++) maximum = Math.max(maximum, Math.abs(pixels[0][index] - pixels[1][index]))
      return maximum
    }, [withGarden.toString('base64'), withoutGarden.toString('base64')])
    if (difference > 3) {
      await testInfo.attach('content-with-garden', { body: withGarden, contentType: 'image/png' })
      await testInfo.attach('content-without-garden', { body: withoutGarden, contentType: 'image/png' })
    }
    // Chromium rounds text antialiasing slightly differently with a composited WebGL layer.
    expect(difference, 'The garden must not paint over the protected copy').toBeLessThanOrEqual(3)
  } finally {
    await garden.evaluate((element) => element.style.removeProperty('visibility'))
  }
  await page.getByRole('link', { name: 'Your home', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your home, shared.', exact: true })).toBeInViewport()
  await page.getByRole('link', { name: 'Questions', exact: true }).click()
  await page.getByText('Does Roomlings send money?', { exact: true }).click()
  await expect(page.locator('.welcome-faq details').first()).toHaveAttribute('open', '')
  await page.screenshot({ path: testInfo.outputPath('garden-landing-questions.png'), animations: 'disabled' })
})

test('the garden shares the pause control, reuses shadows on resize and releases its renderer on navigation', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const drawing = await trackDrawing(page, '.welcome-garden canvas')
  await page.goto('/')
  const garden = page.locator('.welcome-garden')
  const scene = garden.locator('.welcome-garden-canvas')
  await expect(garden).toHaveAttribute('data-scene', 'ready')
  await expect(scene).toHaveAttribute('data-rendering', 'active')
  const active = await drawing()
  expect(active.draws).toBeGreaterThan(0)
  expect(active.shadows).toBeGreaterThan(0)
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(active.draws)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(scene).toHaveAttribute('data-rendering', 'paused')
  const hidden = await drawing()
  await page.waitForTimeout(250)
  expect(await drawing()).toEqual(hidden)
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(scene).toHaveAttribute('data-rendering', 'active')
  await page.getByRole('link', { name: 'Explore rooms', exact: true }).first().click()
  await page.getByRole('button', { name: 'Reduced motion', exact: true }).click()
  await expect(scene).toHaveAttribute('data-rendering', 'paused')
  const still = await drawing()
  await page.waitForTimeout(300)
  expect(await drawing()).toEqual(still)
  const canvas = await garden.locator('canvas').elementHandle()
  expect(canvas).not.toBeNull()
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(still.draws)
  expect((await drawing()).shadows).toBe(still.shadows)
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
  await expectClearContent(page)
  await page.getByRole('button', { name: 'Reduced motion', exact: true }).click()
  await expect(scene).toHaveAttribute('data-rendering', 'active')
  await expect.poll(async () => (await drawing()).shadows).toBeGreaterThan(still.shadows)
  // A same-document route change lets the test observe React's renderer cleanup.
  await page.evaluate(() => {
    history.pushState(null, '', '/rooms/kitchen')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByRole('dialog', { name: 'Your place, on every device.', exact: true })).toBeVisible()
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(false)
  const departed = await drawing()
  await page.waitForTimeout(250)
  expect(await drawing()).toEqual(departed)
})

test('reduced motion and narrow gutters use the still 3D garden without changing the grid', { tag: '@room' }, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  for (const [width, height] of [[1920, 1080], [390, 844], [844, 390], [320, 568]]) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('.welcome-garden')).toHaveAttribute('data-scene', 'static')
    await expect(page.locator('.welcome-garden canvas')).toHaveCount(0)
    for (const image of await page.locator('.welcome-garden-still').all()) {
      if (width === 1920) await expect(image).toBeVisible()
      else await expect(image).toBeHidden()
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
    }
    await expectClearContent(page)
    await page.screenshot({ path: testInfo.outputPath(`garden-still-${width}.png`), animations: 'disabled' })
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.locator('.welcome-garden canvas')).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 960 })
  await expect(page.locator('.welcome-garden')).toHaveAttribute('data-scene', 'ready')
  await expectClearContent(page)
})

test('scroll wind follows movement, settles gently and stops with reduced motion', { tag: '@room' }, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  const scene = page.locator('.welcome-garden-canvas')
  await expect(scene).toHaveAttribute('data-rendering', 'active')
  const wind = async () => Number(await scene.getAttribute('data-wind'))
  await page.evaluate(() => window.scrollBy({ top: 260, behavior: 'instant' }))
  await expect.poll(wind).toBeGreaterThan(0.005)
  await expectClearContent(page)
  await page.screenshot({ path: testInfo.outputPath('garden-scroll-wind.png'), animations: 'disabled' })
  await expect.poll(async () => Math.abs(await wind()), { timeout: 5000 }).toBeLessThan(0.001)
  await page.evaluate(() => window.scrollBy({ top: -220, behavior: 'instant' }))
  await expect.poll(wind).toBeLessThan(-0.005)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(scene).toHaveAttribute('data-rendering', 'paused')
  const frozen = await wind()
  await page.evaluate(() => window.scrollBy({ top: 200, behavior: 'instant' }))
  await page.waitForTimeout(200)
  expect(await wind()).toBe(frozen)
})

test('failed WebGL and context loss retain the garden illustration and working page links', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  await expect(page.locator('.welcome-garden')).toHaveAttribute('data-scene', 'ready')
  await page.locator('.welcome-garden canvas').evaluate((element: HTMLCanvasElement) => {
    const extension = element.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('The browser cannot simulate garden context loss.')
    extension.loseContext()
  })
  await expect(page.locator('.welcome-garden')).toHaveAttribute('data-scene', 'unavailable')
  await expect(page.locator('.welcome-garden canvas')).toHaveCount(0)
  await expect(page.locator('.welcome-garden-still').first()).toBeVisible()
  await expectClearContent(page)
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, kind: string, options?: unknown) {
        if (kind.startsWith('webgl')) return null
        return Reflect.apply(original, this, [kind, options])
      },
    })
  })
  await page.reload()
  await expect(page.locator('.welcome-garden')).toHaveAttribute('data-scene', 'unavailable')
  await expect(page.locator('.welcome-garden-still').first()).toBeVisible()
  await page.getByRole('link', { name: 'Create our household', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Your place, on every device.', exact: true })).toBeVisible()
})
