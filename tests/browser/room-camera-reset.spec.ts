import type { Page } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { roomIds } from '../../shared/rooms.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

async function sceneImage(page: Page) {
  const sheet = await page.addStyleTag({ content: `
    :root, body, #root, .game-app, .game-app * { background: transparent !important; }
    .game-app * { visibility: hidden !important; }
    .game-home::before, .game-home::after { visibility: hidden !important; }
    .game-app .game-home, .game-app .kitchen-world, .game-app .world-canvas, .game-app canvas { visibility: visible !important; }
  ` })
  try {
    return await page.locator('.world-canvas canvas').screenshot({ omitBackground: true })
  } finally {
    await sheet.evaluate((element) => element.parentNode?.removeChild(element))
  }
}

for (const roomId of roomIds) for (const viewport of [
  { width: 1440, height: 960 }, { width: 390, height: 844 },
]) {
  test(`${roomId} reset restores the exact entry view and tracks all zoom inputs at ${viewport.width}px`, { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
    await page.setViewportSize(viewport)
    await page.clock.setFixedTime(new Date())
    await page.goto(roomPath(roomId))
    const world = page.locator('.kitchen-world')
    const controls = world.locator('.world-camera-controls')
    const reset = controls.getByRole('button', { name: 'Reset room view', exact: true })
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    await controls.getByRole('button', { name: 'Hide object labels', exact: true }).click()
    await expect(controls).toContainText('100%')
    const initial = await sceneImage(page)

    await controls.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(controls).toContainText('120%')
    await expect(reset).toHaveAttribute('aria-pressed', 'false')
    await reset.click()
    await expect(controls).toContainText('100%')
    await expect(reset).toHaveAttribute('aria-pressed', 'true')
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    expect((await sceneImage(page)).equals(initial)).toBe(true)

    await controls.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await expect(controls).toContainText('80%')
    await expect(reset).toHaveAttribute('aria-pressed', 'false')
    await reset.click()
    await world.locator('canvas').hover()
    await page.mouse.wheel(0, -140)
    await expect(controls).not.toContainText('100%')
    await expect(reset).toHaveAttribute('aria-pressed', 'false')
    await reset.click()
    await expect(world).toHaveAttribute('data-rendering', 'paused')

    const touch = await page.context().newCDPSession(page)
    const x = viewport.width / 2
    const y = viewport.height / 2
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 40, y, id: 1 }, { x: x + 40, y, id: 2 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 60, y, id: 1 }, { x: x + 60, y, id: 2 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(controls).toContainText('150%')
    await expect(reset).toHaveAttribute('aria-pressed', 'false')
    await reset.click()
    await expect(reset).toHaveAttribute('aria-pressed', 'true')
    await expect(controls).toContainText('100%')
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    expect((await sceneImage(page)).equals(initial)).toBe(true)
    await expect(page.locator('.room-panel')).toHaveCount(0)
    await touch.detach()
  })
}
