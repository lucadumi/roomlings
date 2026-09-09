import type { Locator } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { selectRoom } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

function luminance(color: string) {
  const channels = color.match(/[\d.]+/g)?.map(Number)
  const normalized = color.startsWith('color(srgb ')
  if ((!normalized && !color.startsWith('rgb(')) || channels?.length !== 3) throw new Error(`Expected an opaque palette color, received ${color}.`)
  const [red, green, blue] = channels.map((channel) => {
    const value = normalized ? channel : channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

async function expectReadable(text: Locator, surface = text) {
  const color = await text.evaluate((element) => getComputedStyle(element).color)
  const background = await surface.evaluate((element) => getComputedStyle(element).backgroundColor)
  const values = [luminance(color), luminance(background)].sort((a, b) => a - b)
  expect((values[1] + 0.05) / (values[0] + 0.05), `${color} on ${background}`).toBeGreaterThanOrEqual(4.5)
}

test('Garden pop keeps colorful room controls and category labels readable', { tag: '@room' }, async ({ page, populatedHousehold: _household }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/kitchen')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  await page.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  for (const control of await page.locator('.dock-tool, .stock-button, .tool-count').all()) await expectReadable(control)
  const toolColors = await page.locator('.dock-tool').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor))
  expect(new Set(toolColors).size).toBe(4)
  await expectReadable(page.locator('.fund-trigger small'), page.locator('.fund-trigger'))
  await page.screenshot({ path: testInfo.outputPath('garden-pop-kitchen.png'), animations: 'disabled' })

  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByRole('region', { name: 'The receipt book.', exact: true })).toBeVisible()
  await expectReadable(page.locator('.dock-tool[aria-pressed="true"]'))
  for (const category of await page.locator('.breakdown-item').all()) await expectReadable(category)
  await page.screenshot({ path: testInfo.outputPath('garden-pop-receipts.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')

  for (const [name, source] of [
    ['Monthly budget', 'budget'], ['The roommates', 'roommates'], ['Chores', 'chores'],
    ['Shopping bag, plan and record groceries', 'roommates'], ['Settle up', 'settle'],
  ]) {
    const fill = await page.locator(`.dock-tool[data-tool="${source}"]`).evaluate((element) => getComputedStyle(element).backgroundColor)
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page.locator('.room-panel-header')).toHaveCSS('background-color', fill)
    const panelFill = await page.locator('.room-panel').evaluate((element) => getComputedStyle(element).backgroundColor)
    const controlFill = await page.getByRole('button', { name: 'Close panel', exact: true }).evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(panelFill).not.toBe(controlFill)
    await expectReadable(page.locator('.room-panel-header h2'), page.locator('.room-panel-header'))
    if (source === 'budget') {
      const ink = await page.locator('.room-panel-header h2').evaluate((element) => getComputedStyle(element).color)
      await page.getByRole('button', { name: 'Edit monthly budget', exact: true }).click()
      await expect(page.locator('.modal h2')).toHaveCSS('color', ink)
      await page.screenshot({ path: testInfo.outputPath('garden-pop-budget-form.png'), animations: 'disabled' })
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    }
    if (name === 'The roommates') {
      await expectReadable(page.locator('.roommate-card h3').first(), page.locator('.roommate-card').first())
      await page.screenshot({ path: testInfo.outputPath('garden-pop-people.png'), animations: 'disabled' })
    }
  }
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Room style', exact: true }).click()
  for (const option of await page.locator('.room-style-option').all()) {
    await expectReadable(option)
    await expectReadable(option.locator('.room-style-description'), option)
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await selectRoom(page, 'bathroom')
  await expect(page.locator('.bathroom-world')).toHaveAttribute('data-rendering', 'paused')
  await page.screenshot({ path: testInfo.outputPath('garden-pop-bathroom.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.bathroom-world')).toHaveAttribute('data-rendering', 'paused')
  expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('garden-pop-phone.png'), animations: 'disabled' })
})

test('Garden pop landing accents preserve contrast and the existing grid', { tag: '@room' }, async ({ page }, testInfo) => {
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await expectReadable(page.locator('.welcome-hero h1 em'), page.locator('.welcome'))
    await expectReadable(page.locator('#home-start'))
    await page.locator('#home-start').hover()
    await expectReadable(page.locator('#home-start'))
    await expect(page.locator('.welcome')).toHaveCSS('background-image', /radial-gradient/)
    await expect(page.locator('.welcome-hero')).toHaveCSS('display', 'grid')
    expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`garden-pop-landing-${width}.png`), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.locator('.welcome-features').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('garden-pop-journal.png'), animations: 'disabled' })
  await page.getByRole('link', { name: 'Explore rooms', exact: true }).first().click()
  await expect(page.locator('.welcome-tour')).toHaveAttribute('data-scene', 'ready')
  for (const choice of await page.locator('.welcome-preview-choice').all()) await expectReadable(choice)
  await page.screenshot({ path: testInfo.outputPath('garden-pop-explore.png'), animations: 'disabled' })
})
