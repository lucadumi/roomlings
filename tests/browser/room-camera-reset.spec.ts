import type { Page } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { roomIds } from '../../shared/rooms.ts'
import { getRoomComponents } from '../../shared/roomComponents.ts'
import { cameraFraming, roomCameraZoom } from '../../src/camera.ts'
import { waitForRoomReady } from './fixtures.ts'

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
  test(`${roomId} reports actual magnification while focusing an object at ${viewport.width}px`, { tag: '@room' }, async ({ page, emptyHousehold: owner }) => {
    await page.setViewportSize(viewport)
    await page.goto(roomPath(roomId))
    await waitForRoomReady(page)
    const world = page.locator('.kitchen-world')
    const canvas = world.locator('canvas')
    const controls = world.locator('.world-camera-controls')
    const label = controls.locator(':scope > span')
    await expect(label).toHaveText('100%')
    const marker = world.locator('.world-hotspot[data-component-id]:visible').first()
    await expect(marker).toBeVisible()
    const componentID = await marker.getAttribute('data-component-id')
    if (!componentID) throw new Error('The visible object marker has no component identifier.')
    expect(getRoomComponents(owner.household).some((item) => item.id === componentID)).toBe(true)
    await marker.click()
    await expect(world).toHaveAttribute('data-component-focus', 'true')
    await expect(world).toHaveAttribute('data-selected-component', componentID)
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    const expectActualPercent = async () => {
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await expect(world).toHaveAttribute('data-camera-moving', 'false')
      await expect(world).toHaveAttribute('data-rendering', 'paused')
      const box = await canvas.boundingBox()
      if (!box) throw new Error('The room canvas has no measured area.')
      const entrySpan = 2 * cameraFraming(box.width, box.height, 'room', false).halfHeight / roomCameraZoom(1, true, roomId)
      await expect.poll(async () => {
        const span = Number(await canvas.getAttribute('data-camera-span'))
        expect(span).toBeGreaterThan(0)
        return await label.innerText() === `${Math.round(entrySpan / span * 100)}%`
      }).toBe(true)
      return Number(await canvas.getAttribute('data-camera-span'))
    }
    const focusedSpan = await expectActualPercent()
    await expect(label).not.toHaveText('100%')
    const zoomIn = controls.getByRole('button', { name: 'Zoom in', exact: true })
    await expect(zoomIn).toBeEnabled()
    await zoomIn.click()
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    await expect(canvas).toHaveAttribute('data-camera-zoom', '1.10000')
    const zoomedSpan = await expectActualPercent()
    expect(zoomedSpan).toBeLessThan(focusedSpan)
    await page.setViewportSize({ width: viewport.height, height: viewport.width })
    await expect(canvas).toHaveCSS('width', `${viewport.height}px`)
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    await expectActualPercent()
    await controls.getByRole('button', { name: 'Reset room view', exact: true }).click()
    await expect(label).toHaveText('100%')
    await expect(world).toHaveAttribute('data-component-focus', 'false')
  })

  test(`${roomId} reset restores the exact entry view and tracks all zoom inputs at ${viewport.width}px`, { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
    await page.setViewportSize(viewport)
    await page.clock.setFixedTime(new Date())
    await page.goto(roomPath(roomId))
    await waitForRoomReady(page)
    const world = page.locator('.kitchen-world')
    const controls = world.locator('.world-camera-controls')
    const zoomIn = controls.getByRole('button', { name: 'Zoom in', exact: true })
    const zoomOut = controls.getByRole('button', { name: 'Zoom out', exact: true })
    const reset = controls.getByRole('button', { name: 'Reset room view', exact: true })
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    await controls.getByRole('button', { name: 'Hide object labels', exact: true }).click()
    await expect(controls).toContainText('100%')
    const initial = await sceneImage(page)

    await zoomIn.click()
    await expect(controls).toContainText('110%')
    await expect(reset).toHaveAttribute('aria-pressed', 'false')
    await reset.click()
    await expect(controls).toContainText('100%')
    await expect(reset).toHaveAttribute('aria-pressed', 'true')
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    expect((await sceneImage(page)).equals(initial)).toBe(true)

    await zoomOut.click()
    await expect(controls).toContainText('90%')
    await expect(reset).toHaveAttribute('aria-pressed', 'false')
    await reset.click()
    await world.locator('canvas').hover()
    await page.mouse.wheel(0, -140)
    await expect(controls).not.toContainText('100%')
    await expect(reset).toHaveAttribute('aria-pressed', 'false')
    const wheelPercent = Number.parseInt(await controls.locator(':scope > span').innerText(), 10)
    await zoomOut.click()
    await expect(controls.locator(':scope > span')).toHaveText(`${wheelPercent - 10}%`)
    await world.locator('canvas').hover()
    await page.mouse.wheel(0, -2000)
    await expect(controls.locator(':scope > span')).toHaveText('150%')
    await expect(zoomIn).toBeDisabled()
    await page.mouse.wheel(0, 2000)
    await expect(controls.locator(':scope > span')).toHaveText('50%')
    await expect(zoomOut).toBeDisabled()
    await reset.click()
    await expect(world).toHaveAttribute('data-rendering', 'paused')

    const touch = await page.context().newCDPSession(page)
    const x = viewport.width / 2
    const y = viewport.height / 2
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 40, y, id: 1 }, { x: x + 40, y, id: 2 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 90, y, id: 1 }, { x: x + 90, y, id: 2 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(controls).toContainText('150%')
    await expect(zoomIn).toBeDisabled()
    await expect(reset).toHaveAttribute('aria-pressed', 'false')
    await reset.click()
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 90, y, id: 1 }, { x: x + 90, y, id: 2 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 20, y, id: 1 }, { x: x + 20, y, id: 2 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(controls).toContainText('50%')
    await expect(zoomOut).toBeDisabled()
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
