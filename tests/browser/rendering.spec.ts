import { expect, test } from '@playwright/test'

test('the full-size kitchen stays within its static-geometry draw-call budget', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.addInitScript(() => {
    let draws = 0
    for (const method of ['drawElements', 'drawArrays'] as const) {
      const original = WebGL2RenderingContext.prototype[method]
      Object.defineProperty(WebGL2RenderingContext.prototype, method, {
        value(this: WebGL2RenderingContext, ...args: number[]) {
          draws++
          return Reflect.apply(original, this, args)
        },
      })
    }
    Object.defineProperty(window, 'roomlingsFrameDrawCalls', { get: () => draws })
  })
  await page.goto('/')
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false')
  const draws = await page.evaluate(() => new Promise<number>((resolve) => {
    requestAnimationFrame(() => {
      const start = Number(Reflect.get(window, 'roomlingsFrameDrawCalls'))
      requestAnimationFrame(() => resolve(Number(Reflect.get(window, 'roomlingsFrameDrawCalls')) - start))
    })
  }))
  expect(draws).toBeGreaterThan(100)
  expect(draws).toBeLessThanOrEqual(350)
})
