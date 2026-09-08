import { expect, test } from './account-fixtures.ts'
import { selectRoom } from './fixtures.ts'
import { samplePath } from '../../src/roomNavigation.ts'

test.use({ reducedMotion: 'reduce' })

test('the Rooms panel shows real previews and switches without creating another sample', async ({ page }) => {
  let samples = 0
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/demo') samples++ })
  await page.goto(samplePath())
  await page.getByRole('button', { name: 'Rooms', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Rooms', exact: true })
  await expect(picker.getByRole('button', { name: 'Open Kitchen', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(picker.getByRole('button', { name: 'Open Bathroom', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(picker.locator('img')).toHaveCount(2)
  await expect.poll(() => picker.locator('img').evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
  const token = await page.evaluate(() => localStorage.getItem('roomlings.sample-session'))
  expect(token).not.toBeNull()
  await picker.getByRole('button', { name: 'Open Bathroom', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`${samplePath('bathroom')}$`))
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toContainText('Bathroom')
  await selectRoom(page, 'bathroom')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.sample-session'))).toBe(token)
  expect(samples).toBe(1)
})

test('the room preview cards support keyboard selection, cancellation and browser history', async ({ page }) => {
  await page.goto(samplePath())
  const trigger = page.getByRole('button', { name: 'Rooms', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const picker = page.getByRole('dialog', { name: 'Rooms', exact: true })
  await expect(picker).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await picker.getByRole('button', { name: 'Open Bathroom', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${samplePath('bathroom')}$`))
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`${samplePath()}$`))
  await expect(trigger).toContainText('Kitchen')
})

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`room previews fit on ${viewport.width}x${viewport.height} screens`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(samplePath())
    await page.getByRole('button', { name: 'Rooms', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Rooms', exact: true })
    expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (const card of await picker.locator('.room-preview-card').all()) {
      await card.scrollIntoViewIfNeeded()
      await expect(card).toBeInViewport({ ratio: 1 })
      const bounds = await card.boundingBox()
      expect(bounds?.width).toBeGreaterThanOrEqual(44)
      expect(bounds?.height).toBeGreaterThanOrEqual(44)
    }
    await picker.getByRole('button', { name: 'Open Bathroom', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toContainText('Bathroom')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
  test(`both rooms start close up with the same measured scene space at ${viewport.width}px`, { tag: '@room' }, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(samplePath())
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false')
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-framing', 'close')
    const kitchen = await page.locator('.kitchen-world').boundingBox()
    if (!kitchen) throw new Error('The kitchen scene is missing.')
    await selectRoom(page, 'bathroom')
    const bathroom = page.locator('.bathroom-world')
    await expect(bathroom).toHaveAttribute('data-camera-moving', 'false')
    await expect(bathroom).toHaveAttribute('data-framing', 'close')
    await expect.poll(async () => {
      const area = await page.locator('.bathroom-scene-area').boundingBox()
      if (!area) return false
      return Math.abs(area.width - kitchen.width) < 1 && Math.abs(area.height - kitchen.height) < 1
    }).toBe(true)
    await expect(page.getByRole('button', { name: 'Frame the whole room', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
    await expect(bathroom).toHaveAttribute('data-framing', 'whole')
    await expect(bathroom).toHaveAttribute('data-camera-moving', 'false')
  })
}
