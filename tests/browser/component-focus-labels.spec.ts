import { expect, test } from './account-fixtures.ts'
import { openRoomEditor, openRoomObjects } from './fixtures.ts'
import { roomPath } from '../../src/roomNavigation.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

for (const [roomId, names] of [
  ['kitchen', ['Fridge', 'Dining table']],
  ['bathroom', ['Bathroom sink', 'Bath or shower']],
  ['living-room', ['Sofa', 'TV']],
] as const) {
  test(`${roomId} focused component labels are opaque, named and centered`, { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
    await page.goto(roomPath(roomId))
    const objects = await openRoomObjects(page)
    const world = page.locator(`.${roomId === 'kitchen' ? 'kitchen' : roomId}-world`)
    const label = world.locator('.world-view-label')
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 960 })
      for (const name of names) {
        await objects.getByRole('button', { name: `Open ${name} details`, exact: true }).click()
        await expect(world).toHaveAttribute('data-camera-moving', 'false')
        await expect(label).toHaveText(name)
        await expect(label).toBeVisible()
        await expect(label).toHaveCSS('opacity', '1')
        await expect(label).toHaveCSS('background-color', 'rgb(255, 255, 255)')
        const box = await label.boundingBox()
        expect(box).not.toBeNull()
        expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(1)
        await objects.getByRole('button', { name: 'All room objects', exact: true }).click()
        await expect(label).toBeHidden()
      }
    }
    await page.setViewportSize({ width: 1440, height: 960 })
    const editor = await openRoomEditor(page)
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await editor.getByRole('button', { name: `Preview ${names[0] === 'Bathroom sink' ? 'Sink' : names[0]}`, exact: true }).click()
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    await expect(label).toHaveText(names[0])
    const centered = await label.boundingBox()
    expect(centered).not.toBeNull()
    expect(Math.abs(centered!.x + centered!.width / 2 - 720)).toBeLessThan(1)
  })
}
