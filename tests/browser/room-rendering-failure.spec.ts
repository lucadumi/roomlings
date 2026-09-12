import { expect, test } from './account-fixtures.ts'
import { roomIds } from '../../shared/rooms.ts'
import { openRoomEditor } from './fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, name: string, ...args: unknown[]) {
        if (name.startsWith('webgl') || name === 'experimental-webgl') return null
        return Reflect.apply(original, this, [name, ...args])
      },
    })
  })
})

for (const roomId of roomIds) {
  test(`${roomId} has no illustrated room substitute when 3D is unavailable`, { tag: '@room' }, async ({ page }) => {
    await page.goto(`/#tour-${roomId}`)
    const tour = page.locator('.welcome-tour')
    await expect(tour).toHaveAttribute('data-scene', 'unavailable')
    await expect(tour.locator('.welcome-preview-unavailable')).toHaveText(
      '3D is unavailable. Use the controls to explore each part of the room.',
    )
    await expect(tour.locator('.welcome-stage-shell canvas, .welcome-stage-shell img, .welcome-stage-shell svg, .welcome-preview-choice img')).toHaveCount(0)
    await expect(page.locator('.welcome-home-illustration')).toHaveCount(1)
    await expect(page.locator('.welcome-invitation-plant')).toHaveCount(1)
    await tour.locator('.welcome-chapters button').nth(1).click()
    await expect(tour.locator('.welcome-chapters button').nth(1)).toHaveAttribute('aria-pressed', 'true')
  })
}

test('object cards report unavailable 3D instead of rendering SVG previews', { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
  await page.goto('/kitchen')
  const editor = await openRoomEditor(page)
  await expect(editor.locator('.component-preview-error').first()).toHaveText('3D is unavailable.')
  await expect(editor.locator('.component-preview > img, .component-preview[data-preview-renderer="svg"]')).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
})

test('room-selector spinners give way to the unavailable message without a 2D substitute', { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
  await page.goto('/kitchen')
  await page.getByRole('button', { name: 'Rooms', exact: true }).click()
  const picker = page.getByRole('menu', { name: 'Rooms', exact: true })
  await expect(picker.getByRole('group', { name: 'Choose a room', exact: true })).toHaveAttribute('aria-busy', 'false')
  await expect(picker.locator('.room-menu-preview-status')).toHaveText(roomIds.map(() => '3D is unavailable.'))
  await expect(picker.locator('.room-menu-preview svg, .room-menu-preview img:visible')).toHaveCount(0)
  await picker.getByRole('menuitemradio', { name: 'Open Bathroom', exact: true }).click()
  await expect(page).toHaveURL(/\/bathroom$/)
})
