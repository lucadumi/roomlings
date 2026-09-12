import { expect, test } from './account-fixtures.ts'
import { roomIds } from '../../shared/rooms.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { waitForRoomReady } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

for (const roomId of roomIds) {
  test(`${roomId} active object names stack above neighboring plus markers`, { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath(roomId))
    await waitForRoomReady(page)
    const marker = page.locator('.world-hotspot:visible').first()
    await expect(marker).toBeVisible()
    await marker.hover()
    await expect(marker.locator('.hotspot-label')).toHaveCSS('opacity', '1')
    await expect(marker).toHaveCSS('z-index', '2')
    const others = await page.locator('.world-hotspot:not(:hover):not(:focus-visible)').evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).zIndex))
    expect(others.every((value) => value === 'auto' || Number(value) < 2)).toBe(true)
    await page.mouse.move(5, 5)
    await page.keyboard.press('Tab')
    await marker.focus()
    await expect(marker.locator('.hotspot-label')).toHaveCSS('opacity', '1')
    await expect(marker).toHaveCSS('z-index', '2')
  })
}
