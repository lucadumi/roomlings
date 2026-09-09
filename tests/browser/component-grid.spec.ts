import type { Page } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { getRoomComponents } from '../../shared/roomComponents.ts'
import { openRoomEditor } from './fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

async function openEditor(page: Page) {
  await openRoomEditor(page)
  const editor = page.getByRole('region', { name: 'Edit Kitchen objects', exact: true })
  await expect(editor).toBeVisible()
  return editor
}

async function withoutWebGL(page: Page) {
  await page.addInitScript(() => {
    let attempts = 0
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(window, 'componentPreviewContextAttempts', { get: () => attempts })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, type: string, options?: unknown) {
        if (type.startsWith('webgl')) { attempts++; return null }
        return Reflect.apply(original, this, [type, options])
      },
    })
  })
}

test('menu status labels sit on the right beside the close button', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
  await withoutWebGL(page)
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/kitchen')
    await page.getByRole('button', { name: 'Room objects', exact: true }).click()
    for (const label of ['Live room', 'Private preview']) {
      if (label === 'Private preview') await page.locator('.room-objects-panel').getByRole('button', { name: 'Edit room', exact: true }).click()
      const header = page.locator('.room-panel-header')
      await expect(header.locator('.room-panel-mode')).toHaveText(label)
      const bounds = await header.evaluate((element) => {
        const title = element.querySelector('h2')!.getBoundingClientRect()
        const badge = element.querySelector('.room-panel-mode')!.getBoundingClientRect()
        const close = element.querySelector('[aria-label="Close panel"]')!.getBoundingClientRect()
        return { titleRight: title.right, badgeLeft: badge.left, badgeRight: badge.right, closeLeft: close.left, closeRight: close.right,
          badgeCenter: badge.y + badge.height / 2, closeCenter: close.y + close.height / 2 }
      })
      expect(bounds.badgeLeft).toBeGreaterThan(bounds.titleRight)
      expect(bounds.closeLeft - bounds.badgeRight).toBeCloseTo(8, 0)
      expect(Math.abs(bounds.badgeCenter - bounds.closeCenter)).toBeLessThan(1)
      expect(bounds.closeRight).toBeLessThanOrEqual(width)
    }
  }
})

test('the object browser is a large left-side grid with real previews and hover/focus details', { tag: '@room' }, async ({ page, emptyHousehold: _owner }, testInfo) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/kitchen')
  const editor = await openEditor(page)
  const panel = page.locator('.room-panel')
  await expect(panel).toHaveAttribute('data-panel-side', 'left')
  const bounds = await panel.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeLessThan(40)
  expect(bounds!.width).toBeGreaterThan(1440 * 0.4)
  const room = await page.locator('.kitchen-world').boundingBox()
  expect(room!.x).toBeGreaterThanOrEqual(bounds!.x + bounds!.width)
  const grid = editor.getByRole('list', { name: 'Objects in your room preview', exact: true })
  const firstRow = await grid.locator('li').evaluateAll((items) => items.slice(0, 3).map((item) => {
    const rect = item.getBoundingClientRect()
    return { x: rect.x, y: rect.y }
  }))
  expect(firstRow).toHaveLength(3)
  expect(Math.max(...firstRow.map((item) => item.y)) - Math.min(...firstRow.map((item) => item.y))).toBeLessThan(2)
  expect(firstRow[0].x < firstRow[1].x && firstRow[1].x < firstRow[2].x).toBe(true)
  const fridge = editor.getByRole('button', { name: 'Edit Fridge', exact: true })
  await expect(fridge.locator('.component-preview')).toHaveAttribute('data-preview-ready', 'true')
  await expect.poll(() => fridge.locator('img').evaluate((image) => image instanceof HTMLImageElement
    && image.complete && image.naturalWidth >= 320 && image.src.startsWith('data:image/png'))).toBe(true)
  await expect(fridge.locator('.room-object-hover-details')).toBeHidden()
  await fridge.hover()
  await expect(fridge.locator('.room-object-hover-details')).toBeVisible()
  await expect(fridge.locator('.room-object-hover-details')).toContainText('Surface cleaner')
  await page.mouse.move(1400, 40)
  await fridge.focus()
  await expect(fridge.locator('.room-object-hover-details')).toBeVisible()
  await expect(fridge).toHaveAccessibleDescription(/Placed.*familiar fridge/)
  await panel.focus()
  await expect(page.locator('.world-canvas canvas')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('left-object-grid.png'), animations: 'disabled' })
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByRole('navigation', { name: 'Filter object availability', exact: true }).getByRole('button', { name: /^Available/ }).click()
  for (const name of ['Dishwasher', 'Washing machine', 'Dryer']) {
    const card = editor.getByRole('article', { name, exact: true })
    await expect(card.locator('.component-preview')).toHaveAttribute('data-preview-renderer', 'webgl')
    await expect.poll(() => card.locator('img').evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth >= 320)).toBe(true)
  }
  await panel.focus()
  await page.screenshot({ path: testInfo.outputPath('available-object-grid-hardware.png'), animations: 'disabled' })
  expect(failures).toEqual([])
})

test('catalog badges and filters distinguish availability, placed objects and unsaved additions', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }, testInfo) => {
  await withoutWebGL(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/kitchen')
  await page.getByRole('button', { name: 'Room objects', exact: true }).click()
  const live = page.getByRole('region', { name: 'Kitchen objects', exact: true })
  await expect(page.getByRole('heading', { name: 'Components.', exact: true })).toBeVisible()
  await expect(page.locator('.room-panel').getByText('Live room', { exact: true })).toBeVisible()
  await expect(page.locator('.room-panel').getByText('Private preview', { exact: true })).toHaveCount(0)
  await expect(live.getByRole('button', { name: 'Apply for everyone', exact: true })).toHaveCount(0)
  await live.getByRole('button', { name: 'Edit room', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Edit Kitchen objects', exact: true })
  await expect(page.locator('.room-panel').getByText('Private preview', { exact: true })).toBeVisible()
  await expect(page.locator('.room-panel').getByText('Live room', { exact: true })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  const filters = editor.getByRole('navigation', { name: 'Filter object availability', exact: true })
  const dishwasher = editor.getByRole('article', { name: 'Dishwasher', exact: true })
  await expect(dishwasher).toHaveAttribute('data-availability', 'available')
  await expect(editor.getByRole('article', { name: 'Fridge', exact: true })).toHaveAttribute('data-availability', 'placed')
  await filters.getByRole('button', { name: /^Available/ }).click()
  await expect(editor.locator('.room-catalog-card[data-free-positions="0"]')).toHaveCount(0)
  await dishwasher.scrollIntoViewIfNeeded()
  await expect(dishwasher.locator('.component-preview')).toHaveAttribute('data-preview-ready', 'true')
  await page.screenshot({ path: testInfo.outputPath('available-object-grid.png'), animations: 'disabled' })
  await dishwasher.getByRole('button', { name: 'Add Dishwasher', exact: true }).click()
  const saved = await accounts.store.get(owner.household.id)
  expect(getRoomComponents(saved ?? {}).some((component) => component.kind === 'dishwasher')).toBe(false)
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await filters.getByRole('button', { name: /^All objects/ }).click()
  await expect(dishwasher).toHaveAttribute('data-availability', 'preview')
  await expect(dishwasher.locator('.room-availability')).toHaveText('In preview')
  await expect(editor.getByRole('article', { name: 'Washing machine', exact: true })).toHaveAttribute('data-availability', 'occupied')
  await filters.getByRole('button', { name: /^Placed/ }).click()
  await expect(dishwasher).toHaveCount(0)
  await expect(editor.locator('.room-catalog-card[data-availability="available"]')).toHaveCount(0)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await accounts.store.get(owner.household.id))?.roomComponents).toEqual(owner.household.roomComponents)
})

test('model previews retain lighting and grounding with one shared capability probe when WebGL is unavailable', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
  await withoutWebGL(page)
  await page.goto('/kitchen')
  await expect(page.getByText('Your kitchen, minus the 3D.', { exact: true })).toBeVisible()
  const before = await page.evaluate(() => Reflect.get(window, 'componentPreviewContextAttempts'))
  const editor = await openEditor(page)
  const fridge = editor.getByRole('button', { name: 'Edit Fridge', exact: true })
  await expect(fridge.locator('.component-preview')).toHaveAttribute('data-preview-ready', 'true')
  const graphics = await fridge.locator('img').evaluate((image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error('Missing object image.')
    const svg = new DOMParser().parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)), 'image/svg+xml')
    return {
      paths: svg.querySelectorAll('path').length,
      colors: new Set([...svg.querySelectorAll('path')].map((path) => path.getAttribute('style'))).size,
      shadow: svg.querySelector('radialGradient#object-shadow') !== null,
      parseErrors: svg.querySelectorAll('parsererror').length,
    }
  })
  expect(graphics.paths).toBeGreaterThan(3)
  expect(graphics.colors).toBeGreaterThan(3)
  expect(graphics.shadow).toBe(true)
  expect(graphics.parseErrors).toBe(0)
  expect(await page.evaluate(() => Reflect.get(window, 'componentPreviewContextAttempts'))).toBe(Number(before) + 1)
  await expect(editor.getByRole('button', { name: 'Edit Sink', exact: true }).locator('.component-preview')).toHaveAttribute('data-preview-ready', 'true')
  expect(await page.evaluate(() => Reflect.get(window, 'componentPreviewContextAttempts'))).toBe(Number(before) + 1)
  await expect(editor.locator('.component-preview-error')).toHaveCount(0)
})

test.describe('touch object grids', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('touch users see card details without hovering and the grid stays inside the viewport', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
    await withoutWebGL(page)
    await page.goto('/kitchen')
    const editor = await openEditor(page)
    const grid = editor.getByRole('list', { name: 'Objects in your room preview', exact: true })
    const fridge = grid.getByRole('button', { name: 'Edit Fridge', exact: true })
    await expect(fridge.locator('.room-object-hover-details')).toBeVisible()
    await expect(fridge.locator('.component-preview')).toHaveAttribute('data-preview-ready', 'true')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const bounds = await grid.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    await fridge.click()
    await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Fridge')
  })
})
