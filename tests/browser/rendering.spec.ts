import { expect, test } from '@playwright/test'
import { trackDrawing } from './fixtures.ts'

test('the full-size kitchen stays within its static-geometry draw-call budget', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await trackDrawing(page)
  await page.goto('/kitchen')
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false')
  const draws = await page.evaluate(() => new Promise<number[]>((resolve) => {
    requestAnimationFrame(() => {
      const frames: number[] = []
      let previous = Number(Reflect.get(window, 'roomlingsFrameDrawCalls'))
      const sample = () => {
        const current = Number(Reflect.get(window, 'roomlingsFrameDrawCalls'))
        frames.push(current - previous)
        previous = current
        if (frames.length === 8) resolve(frames)
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  }))
  expect(Math.min(...draws)).toBeGreaterThan(100)
  expect(Math.max(...draws)).toBeLessThanOrEqual(350)
})

test('reduced-motion rooms stop idle drawing and refresh cached shadows only when an object moves', { tag: '@room' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date())
  const drawing = await trackDrawing(page)
  await page.goto('/kitchen')
  const room = page.locator('.kitchen-world')
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  const idle = await drawing()
  expect(idle.draws).toBeGreaterThan(0)
  expect(idle.shadows).toBeGreaterThan(0)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  expect(await drawing()).toEqual(idle)

  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.locator('.world-camera-controls')).toContainText('120%')
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(idle.draws)
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  const zoomed = await drawing()
  expect(zoomed.shadows).toBe(idle.shadows)

  await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(zoomed.draws)
  await expect(room).toHaveAttribute('data-evening', 'true')
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  expect((await drawing()).shadows).toBe(idle.shadows)

  await page.getByRole('button', { name: 'Room style', exact: true }).click()
  await page.getByRole('radio', { name: 'Sage', exact: true }).check()
  await page.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(room).toHaveAttribute('data-room-style', 'sage')
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  expect((await drawing()).shadows).toBe(idle.shadows)

  await page.getByRole('button', { name: 'Close the fridge', exact: true }).click()
  await expect.poll(async () => (await drawing()).shadows).toBeGreaterThan(idle.shadows)
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  await expect(page.getByRole('button', { name: 'Peek inside', exact: true })).toBeVisible()
})
