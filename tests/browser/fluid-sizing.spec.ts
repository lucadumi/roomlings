import type { Page } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { openGroceryForm, openRoomEditor, openShoppingBag, waitForRoomReady } from './fixtures.ts'

// Keep large CSS viewports without spending the layout suite's budget on software-rendered pixels.
test.use({ reducedMotion: 'reduce', deviceScaleFactor: process.env.CI ? 0.5 : 1 })

const laptop = { width: 1440, height: 900, unit: 16 }
const largerWindows = [
  { width: 1920, height: 1080, unit: 16.9 },
  { width: 2560, height: 1440, unit: 18.7 },
  { width: 3840, height: 2160, unit: 22 },
]
type Dimension = 'width' | 'height' | 'font-size' | 'column-gap' | 'padding-top' | 'margin-bottom'

async function resize(page: Page, viewport: typeof laptop) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)), { timeout: 15_000 })
    .toBeCloseTo(viewport.unit, 3)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

async function sizes(page: Page, fields: Record<string, [string, Dimension]>) {
  return page.evaluate((fields) => Object.fromEntries(Object.entries(fields).map(([name, [selector, property]]) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error(`Missing sized element: ${selector}`)
    const bounds = element.getBoundingClientRect()
    const value = property === 'width' || property === 'height'
      ? bounds[property] : parseFloat(getComputedStyle(element).getPropertyValue(property))
    if (!Number.isFinite(value)) throw new Error(`Invalid ${property} for ${selector}`)
    return [name, value]
  })), fields)
}

test('landing text, actions, branding, spacing and artwork scale within comfortable limits', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: laptop.width, height: laptop.height })
  await page.goto('/')
  await expect(page.locator('.welcome-hero')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const fields: Record<string, [string, Dimension]> = {
    heading: ['.welcome-hero h1', 'font-size'],
    body: ['.welcome-feature p', 'font-size'],
    action: ['.welcome-hero .welcome-enter', 'height'],
    icon: ['.welcome-hero .welcome-enter svg', 'width'],
    brand: ['.welcome-header .roomlings-brand', 'height'],
    spacing: ['.welcome-actions', 'column-gap'],
    padding: ['.welcome-invitation', 'padding-top'],
    margin: ['.welcome-hero h1', 'margin-bottom'],
    artwork: ['.welcome-home-frame', 'width'],
  }
  const baseline = await sizes(page, fields)
  expect(baseline).toMatchObject({ heading: 82, body: 14, action: 48, icon: 18, spacing: 24 })
  let previous = baseline
  for (const viewport of largerWindows) {
    await resize(page, viewport)
    const current = await sizes(page, fields)
    for (const name of Object.keys(fields)) {
      expect(current[name], `${name} at ${viewport.width}px`).toBeGreaterThan(previous[name])
      expect(current[name], `${name} stays bounded`).toBeLessThanOrEqual(baseline[name] * 1.4)
    }
    await expect(page.getByRole('link', { name: 'Get started', exact: true })).toBeVisible()
    previous = current
  }
  await resize(page, { width: 5120, height: 2880, unit: 22 })
  expect(await sizes(page, fields)).toEqual(previous)
  await resize(page, laptop)
  expect(await sizes(page, fields)).toEqual(baseline)

  for (const viewport of [
    { width: 1280, height: 720, unit: 15.1 },
    { width: 1024, height: 900, unit: 14.96 },
    { width: 1440, height: 600, unit: 14.5 },
    { width: 3840, height: 600, unit: 14.5 },
    { width: 1024, height: 600, unit: 14.5 },
    { width: 390, height: 844, unit: 14 },
    { width: 320, height: 568, unit: 14 },
  ]) {
    await resize(page, viewport)
    const current = await sizes(page, fields)
    expect(current.heading).toBeGreaterThanOrEqual(40)
    expect(current.body).toBeGreaterThanOrEqual(14)
    expect(current.action).toBeGreaterThanOrEqual(44)
    for (const name of ['heading', 'spacing', 'padding', 'margin', 'icon']) {
      expect(current[name], `${name} compacts at ${viewport.width}x${viewport.height}`).toBeLessThan(baseline[name])
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator('.welcome')).toHaveAttribute('data-mobile-app', 'false')
  }
})

test('household controls, icons, dialogs, fields and room menus share the same size scale', { tag: '@room' }, async ({ page, emptyHousehold: _owner }, testInfo) => {
  test.setTimeout(process.env.CI ? 180_000 : 90_000)
  await page.setViewportSize({ width: laptop.width, height: laptop.height })
  await page.goto('/kitchen')
  await waitForRoomReady(page)
  await page.evaluate(() => document.fonts.ready)
  await openShoppingBag(page)
  const panelWidth = (await page.locator('.room-panel').boundingBox())!.width
  await page.getByRole('button', { name: 'Record without a list', exact: true }).click()
  const fields: Record<string, [string, Dimension]> = {
    brand: ['.game-hud .roomlings-brand', 'height'],
    dock: ['.game-dock', 'height'],
    dockIcon: ['.dock-tool svg', 'width'],
    cameraButton: ['.world-camera-controls button', 'height'],
    cameraIcon: ['.world-camera-controls button svg', 'width'],
    modal: ['.modal', 'width'],
    padding: ['.modal', 'padding-top'],
    inputFont: ['.modal input', 'font-size'],
    inputHeight: ['.modal input', 'height'],
    action: ['.modal .button.primary', 'height'],
    actionIcon: ['.modal .button.primary svg', 'width'],
  }
  const baseline = await sizes(page, fields)
  expect(baseline).toMatchObject({ modal: 450, inputFont: 13, cameraButton: 36, cameraIcon: 19 })
  expect(baseline.inputHeight).toBeCloseTo(44, 0)
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('laptop-dialog.png') })
  let previous = baseline
  for (const viewport of largerWindows) {
    await resize(page, viewport)
    const current = await sizes(page, fields)
    for (const name of Object.keys(fields)) {
      expect(current[name], `${name} at ${viewport.width}px`).toBeGreaterThan(previous[name])
      expect(current[name], `${name} stays bounded`).toBeLessThanOrEqual(baseline[name] * 1.4)
    }
    await expect(page.getByRole('dialog')).toBeInViewport({ ratio: 1 })
    const payer = page.getByRole('combobox', { name: 'Paid by', exact: true })
    await payer.click()
    await expect(page.getByRole('listbox')).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeVisible()
    previous = current
  }
  await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('large-dialog.png') })
  await page.keyboard.press('Escape')
  expect((await page.locator('.room-panel').boundingBox())!.width).toBeGreaterThan(panelWidth * 1.3)
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await resize(page, laptop)
  await page.getByRole('button', { name: /^Rooms: / }).click()
  const menu = page.getByRole('menu', { name: 'Rooms', exact: true })
  const menuWidth = (await menu.boundingBox())!.width
  expect(menuWidth).toBe(320)
  await resize(page, largerWindows[2])
  await expect.poll(async () => (await menu.boundingBox())!.width).toBe(440)
  await expect(menu).toBeInViewport({ ratio: 1 })
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Rooms: / })).toBeFocused()
})

test.describe('compact screenshot layouts', () => {
  test.use({ deviceScaleFactor: process.env.CI ? 0.5 : 2 })

  for (const viewport of [{ width: 952, height: 534 }, { width: 644, height: 534 }]) {
    test(`compact controls keep their names and usable hit areas at ${viewport.width}px`, { tag: '@room' }, async ({ page, emptyHousehold: _owner }, testInfo) => {
      test.setTimeout(process.env.CI ? 180_000 : 90_000)
      await page.setViewportSize(viewport)
      await page.goto('/kitchen')
      await waitForRoomReady(page)
      await page.evaluate(() => document.fonts.ready)
      const identity = await page.locator('.room-caption').evaluate((element) => {
        const room = element.querySelector('.room-picker-trigger')!.getBoundingClientRect()
        const house = element.querySelector('.game-house')!.getBoundingClientRect()
        return { gap: house.left - room.right, aligned: Math.abs(house.top + house.height / 2 - room.top - room.height / 2) < 1 }
      })
      expect(identity.aligned).toBe(true)
      expect(identity.gap).toBeGreaterThanOrEqual(3)
      expect(identity.gap).toBeLessThanOrEqual(8)
      await expect(page.locator('.room-picker-trigger > strong')).toBeHidden()
      await expect(page.locator('.room-picker-trigger > small')).toBeHidden()
      await expect(page.locator('.game-house > span').first()).toBeHidden()
      await expect(page.getByRole('button', { name: 'Rooms: Kitchen', exact: true })).toBeVisible()
      const controls = await sizes(page, {
        button: ['.house-tools button', 'width'],
        camera: ['.world-camera-controls button', 'height'],
        gap: ['.house-tools', 'column-gap'],
        houseIcon: ['.game-house > svg', 'width'],
        roomIcon: ['.room-picker-trigger > svg', 'width'],
      })
      expect(controls.button).toBe(32)
      expect(controls.camera).toBe(32)
      expect(controls.gap).toBeLessThanOrEqual(4)
      expect(controls.houseIcon).toBeCloseTo(controls.roomIcon, 3)
      for (const selector of ['.game-house', '.room-picker-trigger']) {
        const centered = await page.locator(selector).evaluate((element) => {
          const button = element.getBoundingClientRect()
          const icon = element.querySelector('svg')!.getBoundingClientRect()
          const reference = document.querySelector('.house-tools .icon-button')!
          const referenceStyle = getComputedStyle(reference)
          const style = getComputedStyle(element)
          return Math.abs(button.left + button.width / 2 - icon.left - icon.width / 2) < 0.5
            && Math.abs(button.top + button.height / 2 - icon.top - icon.height / 2) < 0.5
            && style.borderRadius === referenceStyle.borderRadius
            && style.backgroundColor === referenceStyle.backgroundColor
            && Math.abs(icon.width - reference.querySelector('svg')!.getBoundingClientRect().width) < 0.5
        })
        expect(centered).toBe(true)
      }
      const headerGap = await page.locator('.house-tools').evaluate((element) =>
        element.getBoundingClientRect().top - document.querySelector('.fund-trigger')!.getBoundingClientRect().bottom)
      expect(headerGap).toBeGreaterThanOrEqual(0)
      expect(headerGap).toBeLessThanOrEqual(14)

      const dock = page.getByRole('navigation', { name: 'Household tools', exact: true })
      if (viewport.width <= 800) {
        for (const label of await dock.locator('.dock-tool > span, .stock-button > span:last-child').all()) await expect(label).toBeHidden()
        expect((await dock.boundingBox())!.width).toBeLessThan(300)
        expect(await dock.evaluate((element) => parseFloat(getComputedStyle(element).paddingTop))).toBeGreaterThanOrEqual(6)
      }
      for (const button of await dock.getByRole('button').all()) {
        await expect(button).toHaveAttribute('aria-label', /.+/)
        await expect(button).toHaveAttribute('title', /.+/)
      }
      const markers = await page.locator('.world-hotspot:visible').evaluateAll((elements) => elements.map((element) => {
        const face = getComputedStyle(element, '::before')
        const dot = element.querySelector('.hotspot-dot')!.getBoundingClientRect()
        return { target: element.getBoundingClientRect().width, face: parseFloat(face.width), dot: dot.width }
      }))
      expect(markers.length).toBeGreaterThan(0)
      for (const marker of markers) {
        expect(marker.target).toBeCloseTo(44, 3)
        expect(marker.face).toBeLessThanOrEqual(24)
        expect(marker.face - marker.dot).toBeLessThanOrEqual(8)
      }
      await page.screenshot({ path: testInfo.outputPath('compact-room.png') })
      await page.getByRole('button', { name: 'Rooms: Kitchen', exact: true }).click()
      const menu = page.getByRole('menu', { name: 'Rooms', exact: true })
      for (const preview of await menu.locator('.room-menu-preview').all()) await expect(preview).toBeHidden()
      await expect(menu.locator('.room-preview-label strong').first()).toHaveCSS('font-size', '14px')
      expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(220)
      await page.keyboard.press('Escape')
      await resize(page, laptop)
      await expect(page.locator('.game-identity .game-house')).toHaveCount(1)
      await expect(page.locator('.room-picker-trigger > strong')).toBeVisible()
      for (const label of await dock.locator('.dock-tool > span, .stock-button > span:last-child').all()) await expect(label).toBeVisible()
      expect((await page.locator('.world-camera-controls button').first().boundingBox())!.width).toBe(36)
    })

    test(`compact editor actions and fields remain usable at ${viewport.width}px`, { tag: '@room' }, async ({ page, emptyHousehold: _owner }, testInfo) => {
      test.setTimeout(process.env.CI ? 180_000 : 90_000)
      await page.setViewportSize(viewport)
      await page.goto('/kitchen')
      await waitForRoomReady(page)
      const editor = await openRoomEditor(page)
      const tabs = editor.getByRole('navigation', { name: 'Room editor sections', exact: true })
      if (viewport.width <= 800) {
        for (const label of await tabs.locator('.compact-action-label, .compact-action-count').all()) await expect(label).toBeHidden()
        expect((await tabs.boundingBox())!.width).toBeLessThan(150)
      }
      await tabs.getByRole('button', { name: 'Add objects', exact: true }).click()
      await expect(editor.getByLabel('Find an object', { exact: true })).toHaveCSS('font-size', '12px')
      await tabs.getByRole('button', { name: 'Storage', exact: true }).click()
      await expect(tabs.getByRole('button', { name: 'Storage', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.screenshot({ path: testInfo.outputPath('compact-editor.png') })
      await page.getByRole('button', { name: 'Close panel', exact: true }).click()
      await openGroceryForm(page)
      await expect(page.getByLabel('What did you pick up?', { exact: true })).toHaveCSS('font-size', '12px')
      expect((await page.getByRole('button', { name: 'Close dialog', exact: true }).boundingBox())!.width).toBe(32)
      await expect(page.getByRole('button', { name: 'Add & split the groceries', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Close panel', exact: true }).click()
      await resize(page, laptop)
      await expect(page.locator('.room-picker-trigger > strong')).toBeVisible()
      const dock = page.getByRole('navigation', { name: 'Household tools', exact: true })
      for (const label of await dock.locator('.dock-tool > span, .stock-button > span:last-child').all()) await expect(label).toBeVisible()
      expect((await page.locator('.world-camera-controls button').first().boundingBox())!.width).toBe(36)
    })
  }

  test('the household shortcut keeps keyboard focus when moving between compact and wide headers', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
    await page.setViewportSize({ width: 644, height: 534 })
    await page.goto('/kitchen')
    await waitForRoomReady(page)
    const house = page.locator('.game-house')
    await house.focus()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('.game-identity .game-house')).toBeFocused()
    await page.setViewportSize({ width: 644, height: 534 })
    await expect(page.locator('.room-caption .game-house')).toBeFocused()
    await house.press('Enter')
    await expect(page.getByRole('region', { name: 'Your kind of people.', exact: true })).toBeVisible()
  })
})
