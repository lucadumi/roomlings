import type { Locator } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { closeRoomEditor, openRoomColors, selectRoom } from './fixtures.ts'

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

test('the Coolors palette keeps room surfaces white and accent controls readable', { tag: '@room' }, async ({ page, populatedHousehold: _household }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/kitchen')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  await page.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  for (const control of await page.locator('.dock-tool, .stock-button, .tool-count').all()) await expectReadable(control)
  const toolColors = await page.locator('.dock-tool').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor))
  expect(new Set(toolColors)).toEqual(new Set(['rgb(255, 255, 255)']))
  await expect(page.locator('.stock-button')).not.toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('.fund-trigger')).not.toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expectReadable(page.locator('.fund-trigger small'), page.locator('.fund-trigger'))
  await page.screenshot({ path: testInfo.outputPath('garden-pop-kitchen.png'), animations: 'disabled' })

  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByRole('region', { name: 'The receipt book.', exact: true })).toBeVisible()
  await expectReadable(page.locator('.dock-tool[aria-pressed="true"]'))
  for (const category of await page.locator('.breakdown-item').all()) await expectReadable(category)
  await page.screenshot({ path: testInfo.outputPath('garden-pop-receipts.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')

  for (const name of ['Monthly budget', 'The roommates', 'Chores', 'Shopping bag, plan and record groceries', 'Settle up']) {
    await page.locator('.game-dock').getByRole('button', { name, exact: true }).click()
    await expect(page.locator('.room-panel-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.locator('.room-panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expectReadable(page.locator('.room-panel-header h2'), page.locator('.room-panel-header'))
    if (name === 'Monthly budget') {
      await expect(page.locator('.budget-panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      const ink = await page.locator('.room-panel-header h2').evaluate((element) => getComputedStyle(element).color)
      await page.getByRole('button', { name: 'Edit monthly budget', exact: true }).click()
      await expect(page.locator('.modal')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
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

  const colors = await openRoomColors(page)
  await expect(colors.locator('.room-style-option')).toHaveCount(4)
  for (const option of await colors.locator('.room-style-option').all()) {
    await expectReadable(option)
    await expectReadable(option.locator('.room-style-description'), option)
  }
  await colors.getByRole('button', { name: 'Cancel', exact: true }).click()
  await closeRoomEditor(page)
  await selectRoom(page, 'bathroom')
  await expect(page.locator('.bathroom-world')).toHaveAttribute('data-rendering', 'paused')
  await page.screenshot({ path: testInfo.outputPath('garden-pop-bathroom.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.bathroom-world')).toHaveAttribute('data-rendering', 'paused')
  expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('garden-pop-phone.png'), animations: 'disabled' })
})

test('the Coolors landing palette keeps uniform copy and a transparent hero', { tag: '@room' }, async ({ page }, testInfo) => {
  const plantRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/assets/garden/')) plantRequests.push(request.url())
  })
  await page.goto('/')
  await expect(page.locator('.welcome-garden, .grass-tufts')).toHaveCount(0)
  await expect(page.locator('.welcome-hero h1')).toHaveCSS('text-shadow', 'none')
  const featureColors = await page.locator('.welcome-feature h3').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color))
  expect(new Set(featureColors)).toEqual(new Set(['rgb(61, 64, 91)']))
  await expect(page.locator('.journal-ledger')).toHaveCount(1)
  await expect(page.locator('.journal-ledger')).toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('.journal-ledger-page')).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await expectReadable(page.locator('.welcome-hero h1 em'), page.locator('.welcome'))
    await expectReadable(page.locator('#home-start'))
    await page.locator('#home-start').hover()
    await expectReadable(page.locator('#home-start'))
    await expect(page.locator('.welcome')).toHaveCSS('background-image', /radial-gradient/)
    await expect(page.locator('.welcome')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.locator('.welcome-hero')).toHaveCSS('display', 'grid')
    await expect(page.locator('.welcome-home-frame')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.welcome-home-frame .welcome-vignette')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.welcome-stage-shell')).toHaveCSS(width === 1440 ? 'border-right-width' : 'border-bottom-width', '1px')
    expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`garden-pop-landing-${width}.png`), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.locator('.welcome-features').scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('garden-pop-journal.png'), animations: 'disabled' })
  await page.getByRole('link', { name: 'Explore rooms', exact: true }).first().click()
  await expect(page.locator('.welcome-tour')).toHaveAttribute('data-scene', 'ready')
  await expect(page.locator('.welcome-stage').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  for (const choice of await page.locator('.welcome-preview-choice').all()) await expectReadable(choice)
  await page.screenshot({ path: testInfo.outputPath('garden-pop-explore.png'), animations: 'disabled' })
  expect(plantRequests.every((url) => new URL(url).pathname.endsWith('/left.png'))).toBe(true)
})

test('the closing invitation is a white outlined letter with a static plant and a working action', { tag: '@room' }, async ({ page }, testInfo) => {
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  const letter = page.locator('#get-started')
  const plant = letter.locator('.welcome-invitation-plant')
  const action = letter.getByRole('link', { name: 'Start sharing', exact: true })
  for (const [width, height] of [[1440, 960], [390, 844], [320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height })
    await letter.scrollIntoViewIfNeeded()
    await expect(letter).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(letter).toHaveCSS('background-image', 'none')
    await expect(letter).toHaveCSS('box-shadow', 'none')
    await expect(letter).toHaveCSS('border-top-style', 'solid')
    await expect(plant).toBeVisible()
    await expect(plant).toHaveAttribute('aria-hidden', 'true')
    await expect(plant).toHaveCSS('pointer-events', 'none')
    await expect.poll(() => plant.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 600)).toBe(true)
    expect(await letter.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    const fold = await letter.evaluate((element) => ({
      diagonal: getComputedStyle(element, '::before').backgroundImage.includes('linear-gradient'),
      crease: getComputedStyle(element, '::after').borderLeftStyle,
      fill: getComputedStyle(element, '::after').backgroundColor,
      image: getComputedStyle(element, '::after').backgroundImage,
    }))
    expect(fold).toEqual({ diagonal: true, crease: 'solid', fill: 'rgba(0, 0, 0, 0)', image: 'none' })
    await expectReadable(action)
    const bounds = await action.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.width).toBeGreaterThanOrEqual(44)
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
    await letter.screenshot({ path: testInfo.outputPath(`outlined-letter-${width}.png`), animations: 'disabled' })
  }
  await action.click()
  await expect(page.getByRole('dialog', { name: 'Your place, on every device.', exact: true })).toBeVisible()
})

test('the normal header and centered hero fill the first screen with clear section links', async ({ page }) => {
  for (const [width, height] of [[1440, 960], [1100, 800], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/')
    await expect(page.locator('.welcome-hero')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await expect(page.locator('.welcome-header')).toHaveCSS('position', 'static')
    await expect.poll(() => page.locator('.welcome-hero').evaluate((hero) => hero.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(height - 1)
    if (width >= 1100) {
      const layout = await page.evaluate(() => {
        const hero = document.querySelector('.welcome-hero')!.getBoundingClientRect()
        const copy = document.querySelector('.welcome-hero-copy')!.getBoundingClientRect()
        const art = document.querySelector('.welcome-home-frame')!.getBoundingClientRect()
        return { bottom: hero.bottom, copyCenter: copy.top + copy.height / 2, artCenter: art.top + art.height / 2 }
      })
      expect(Math.abs(layout.bottom - height)).toBeLessThan(1)
      expect(Math.abs(layout.copyCenter - layout.artCenter)).toBeLessThan(1)
    }
    expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.getByRole('link', { name: 'Your home', exact: true }).click()
    await expect.poll(() => page.evaluate(() => {
      const header = document.querySelector('.welcome-header')!.getBoundingClientRect()
      const heading = document.querySelector('#features-title')!.getBoundingClientRect()
      return header.bottom < 0 && heading.top >= 0
    })).toBe(true)
  }
})
