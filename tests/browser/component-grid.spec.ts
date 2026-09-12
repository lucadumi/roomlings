import type { Locator, Page } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { componentCatalog, getRoomComponents, retiredComponentKinds } from '../../shared/roomComponents.ts'
import { roomCatalog, roomIds } from '../../shared/rooms.ts'
import { openRoomEditor, pauseRequest, placeRoomObject } from './fixtures.ts'

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

async function expectAvailabilitySymbol(badge: Locator, label: string, icon: string) {
  await expect(badge).toHaveRole('img')
  await expect(badge).toHaveAccessibleName(label)
  await expect(badge).toHaveText('')
  await expect(badge.locator(`svg.lucide-${icon}`)).toHaveCount(1)
  await expect(badge).toHaveCSS('width', '22px')
  await expect(badge).toHaveCSS('height', '22px')
}

test('component render spinners stop when the actual image is ready', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const pending = await pauseRequest(page, '**/{componentThumbnail.ts*,componentThumbnail-*.js}')
  await page.goto('/kitchen')
  const editor = await openEditor(page)
  const route = await pending.pending
  const preview = editor.getByRole('button', { name: 'Edit Fridge', exact: true }).locator('.component-preview')
  await expect(preview).toHaveAttribute('data-preview-loading', 'true')
  await expect(preview.locator('.component-preview-loading .lucide-loader-circle')).toHaveCSS('animation-name', 'spin')
  await expect(preview.locator('.roomlings-loader')).toHaveCount(0)
  await route.continue()
  await expect(preview).toHaveAttribute('data-preview-ready', 'true', { timeout: 30_000 })
  await expect(preview).toHaveAttribute('data-preview-loading', 'false')
  await expect(preview.locator('.component-preview-loading')).toHaveCount(0)
})

test('component render spinners respect reduced motion and stop on render failure', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
  await withoutWebGL(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const pending = await pauseRequest(page, '**/{componentThumbnail.ts*,componentThumbnail-*.js}')
  await page.goto('/kitchen')
  const editor = await openEditor(page)
  const route = await pending.pending
  const preview = editor.getByRole('button', { name: 'Edit Fridge', exact: true }).locator('.component-preview')
  const spinner = preview.locator('.component-preview-loading .lucide-loader-circle')
  await expect(spinner).toHaveCSS('animation-name', 'spin')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(spinner).toHaveCSS('animation-name', 'none')
  await route.continue()
  await expect(preview.locator('.component-preview-error')).toHaveText('3D is unavailable.')
  await expect(preview.locator('.component-preview-error')).toHaveRole('status')
  await expect(preview).toHaveAttribute('data-preview-loading', 'false')
  await expect(preview.locator('.component-preview-loading')).toHaveCount(0)
})

test('object and editor panels keep their close control without mode badges', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
  await withoutWebGL(page)
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/kitchen')
    for (const mode of ['objects', 'editor']) {
      if (mode === 'editor') await openEditor(page)
      else await page.getByRole('button', { name: 'Room objects', exact: true }).click()
      if (mode === 'objects') {
        const row = page.locator('.room-objects-tools')
        const edit = row.getByRole('button', { name: 'Edit room', exact: true })
        await expect(edit).toHaveCSS('flex-grow', '0')
        const rowBounds = (await row.boundingBox())!
        const editBounds = (await edit.boundingBox())!
        expect(editBounds.width).toBeLessThan(rowBounds.width * 0.75)
        expect(editBounds.width).toBeGreaterThanOrEqual(44)
        expect(editBounds.x + editBounds.width).toBeCloseTo(rowBounds.x + rowBounds.width, 0)
        if (width <= 390) expect(editBounds.height).toBeGreaterThanOrEqual(44)
      }
      const header = page.locator('.room-panel-header')
      await expect(header.locator('.room-panel-mode')).toHaveCount(0)
      await expect(header.getByText('Live room', { exact: true })).toHaveCount(0)
      await expect(header.getByText('Private preview', { exact: true })).toHaveCount(0)
      const close = header.getByRole('button', { name: 'Close panel', exact: true })
      await expect(close).toBeInViewport({ ratio: 1 })
      await close.click()
      await expect(page.locator('.room-panel')).toHaveCount(0)
    }
  }
})

test('the editor Back button stays beside the section tabs on desktop and narrow screens', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
  await withoutWebGL(page)
  await page.goto('/kitchen')
  const editor = await openEditor(page)
  const back = editor.getByRole('button', { name: 'Back to room objects', exact: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 })
    await expect(back).toBeInViewport({ ratio: 1 })
    const alignment = await editor.locator('.room-editor-navigation').evaluate((element) => {
      const button = element.querySelector('button')!.getBoundingClientRect()
      const tabs = element.querySelector('nav')!.getBoundingClientRect()
      return { gap: tabs.left - button.right, offset: Math.abs(button.y + button.height / 2 - (tabs.y + tabs.height / 2)) }
    })
    expect(alignment.gap).toBeCloseTo(8, 0)
    expect(alignment.offset).toBeLessThan(1)
    expect(await editor.locator('.room-editor-toolbar').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (const control of await editor.locator('.room-editor-toolbar button').all()) {
      await expect(control).toBeInViewport({ ratio: 1 })
      if (width <= 390) {
        const bounds = await control.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.width).toBeGreaterThanOrEqual(44)
        expect(bounds!.height).toBeGreaterThanOrEqual(44)
      }
    }
  }
})

test('object details and object editors are narrower than their component lists', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
  await withoutWebGL(page)
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/kitchen')
    await page.getByRole('button', { name: 'Room objects', exact: true }).click()
    const panel = page.locator('.room-panel')
    const live = page.getByRole('region', { name: 'Kitchen objects', exact: true })
    const listWidth = await panel.evaluate((element) => element.getBoundingClientRect().width)
    await live.getByRole('button', { name: 'Open Fridge details', exact: true }).click()
    await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(listWidth * 0.8)
    await live.getByRole('button', { name: 'All room objects', exact: true }).click()
    await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(listWidth, 0)
    await live.getByRole('button', { name: 'Edit room', exact: true }).click()
    const editor = page.getByRole('region', { name: 'Edit Kitchen objects', exact: true })
    await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(listWidth, 0)
    await editor.getByRole('button', { name: 'Edit Fridge', exact: true }).click()
    await expect(editor.getByLabel('Object name', { exact: true })).toBeVisible()
    await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(listWidth * 0.8)
    await editor.getByRole('button', { name: 'All room objects', exact: true }).click()
    await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(listWidth, 0)
  }
})

test('retired objects are not offered in any room and the living room offers no new bin', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  await withoutWebGL(page)
  const before = await accounts.store.get(owner.household.id)
  for (const roomId of roomIds) {
    await page.goto(`/rooms/${roomId}`)
    await openRoomEditor(page)
    const editor = page.getByRole('region', { name: `Edit ${roomCatalog[roomId].name} objects`, exact: true })
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    for (const kind of retiredComponentKinds) {
      await expect(editor.getByRole('article', { name: componentCatalog[kind].name, exact: true })).toHaveCount(0)
    }
    await expect(editor.getByRole('article', { name: 'Bin', exact: true })).toHaveCount(roomId === 'living-room' ? 0 : 1)
  }
  expect(await accounts.store.get(owner.household.id)).toEqual(before)
})

test('a new spice rack uses a wall position and offers only wall alternatives', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  await withoutWebGL(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/kitchen')
  const editor = await openEditor(page)
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await placeRoomObject(editor, 'Spice rack')
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Spice rack')
  await editor.getByRole('combobox', { name: 'Move object', exact: true }).click()
  await expect(page.getByRole('option')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const household = await accounts.store.get(owner.household.id)
  expect(getRoomComponents(household ?? {}).find((component) => component.kind === 'spice-rack')?.slotId).toBe('kitchen-spice-rack')
  expect(household?.expenses).toEqual(owner.household.expenses)
  expect(household?.shopping).toEqual(owner.household.shopping)
  expect(household?.chores).toEqual(owner.household.chores)
})

test('discarding a placement leaves a visible gap above the discarded-preview notice', { tag: '@room' }, async ({ page, emptyHousehold: _owner }, testInfo) => {
  await withoutWebGL(page)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/kitchen')
    const editor = await openEditor(page)
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await editor.getByRole('button', { name: 'Preview Dishwasher', exact: true }).click()
    await page.getByRole('group', { name: 'Placement preview', exact: true }).getByRole('button', { name: 'Discard preview', exact: true }).click()
    const notice = editor.locator('.room-editor-notice')
    await expect(notice).toHaveText('The placement preview was discarded. Your other draft changes are kept.')
    await notice.scrollIntoViewIfNeeded()
    await expect(notice).toHaveCSS('margin-top', '16px')
    await expect(notice).toHaveCSS('padding-top', '12px')
    const footer = editor.locator('.room-editor-footer')
    await expect(footer.getByRole('status')).toHaveText('No unapplied changes.')
    await expect(footer).toHaveCSS('margin-top', '18px')
    await expect(footer).toHaveCSS('padding-top', '12px')
    const gap = await notice.evaluate((element) => {
      const previous = element.previousElementSibling
      if (!previous) throw new Error('The editor notice needs a preceding content block.')
      return element.getBoundingClientRect().top - previous.getBoundingClientRect().bottom
    })
    expect(gap).toBeGreaterThanOrEqual(15)
    const footerGap = await footer.evaluate((element) => {
      const previous = element.previousElementSibling
      if (!previous) throw new Error('The editor footer needs a preceding content block.')
      return element.getBoundingClientRect().top - previous.getBoundingClientRect().bottom
    })
    expect(footerGap).toBeGreaterThanOrEqual(17)
    await page.locator('.room-panel').screenshot({ path: testInfo.outputPath(`discard-notice-${width}.png`), animations: 'disabled' })
  }
})

test('the object browser uses inline info panels instead of hover details', { tag: '@room' }, async ({ page, emptyHousehold: _owner }, testInfo) => {
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
  await expect(editor.locator('.room-object-hover-details')).toHaveCount(0)
  await fridge.hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.mouse.move(1400, 40)
  await fridge.focus()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(fridge).toHaveAccessibleDescription(`Placed. ${componentCatalog.fridge.description}`)
  const info = editor.getByRole('button', { name: 'Info about Fridge', exact: true })
  await expect(info).toHaveCSS('border-top-width', '0px')
  await expect(info).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(info).toHaveCSS('box-shadow', 'none')
  await info.click()
  const information = editor.getByRole('region', { name: 'Fridge information', exact: true })
  await expect(information).toBeVisible()
  await expect(information).toContainText('Surface cleaner')
  await expect(information.locator('dt')).toHaveText(['Supplies'])
  await expect(information).toHaveCSS('box-shadow', 'none')
  await page.keyboard.press('Escape')
  await expect(information).toHaveCount(0)
  await expect(editor).toBeVisible()
  await expect(info).toBeFocused()
  await panel.focus()
  await expect(page.locator('.world-canvas canvas')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('left-object-grid.png'), animations: 'disabled' })
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByRole('navigation', { name: 'Filter object availability', exact: true }).getByRole('button', { name: /^Available/ }).click()
  for (const name of ['Dishwasher', 'Oven', 'Coffee machine']) {
    const card = editor.getByRole('article', { name, exact: true })
    await card.scrollIntoViewIfNeeded()
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
  await expect(page.locator('.room-panel').getByText('Live room', { exact: true })).toHaveCount(0)
  await expect(page.locator('.room-panel').getByText('Private preview', { exact: true })).toHaveCount(0)
  await expect(live.getByRole('button', { name: 'Apply for everyone', exact: true })).toHaveCount(0)
  await live.getByRole('button', { name: 'Edit room', exact: true }).click()
  const editor = page.getByRole('region', { name: 'Edit Kitchen objects', exact: true })
  await expect(page.locator('.room-panel').getByText('Private preview', { exact: true })).toHaveCount(0)
  await expect(page.locator('.room-panel').getByText('Live room', { exact: true })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  const filters = editor.getByRole('navigation', { name: 'Filter object availability', exact: true })
  const dishwasher = editor.getByRole('article', { name: 'Dishwasher', exact: true })
  await expect(dishwasher).toHaveAttribute('data-availability', 'available')
  await expect(editor.getByRole('article', { name: 'Fridge', exact: true })).toHaveAttribute('data-availability', 'placed')
  await expectAvailabilitySymbol(dishwasher.locator('.room-availability'), 'Available to add', 'plus')
  await expectAvailabilitySymbol(editor.getByRole('article', { name: 'Fridge', exact: true }).locator('.room-availability'), 'Placed', 'check')
  await filters.getByRole('button', { name: /^Available/ }).click()
  await expect(editor.locator('.room-catalog-card[data-free-positions="0"]')).toHaveCount(0)
  await dishwasher.scrollIntoViewIfNeeded()
  await expect(dishwasher.locator('.component-preview-error')).toHaveText('3D is unavailable.')
  await expect(dishwasher.locator('.component-preview-error')).toHaveRole('status')
  await expect(dishwasher.locator('.component-preview')).toHaveAttribute('data-preview-loading', 'false')
  await page.screenshot({ path: testInfo.outputPath('available-object-grid.png'), animations: 'disabled' })
  await placeRoomObject(editor, 'Dishwasher')
  const saved = await accounts.store.get(owner.household.id)
  expect(getRoomComponents(saved ?? {}).some((component) => component.kind === 'dishwasher')).toBe(false)
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await filters.getByRole('button', { name: /^All objects/ }).click()
  await expect(dishwasher).toHaveAttribute('data-availability', 'preview')
  await expectAvailabilitySymbol(dishwasher.locator('.room-availability'), 'In preview', 'pencil')
  await expect(editor.getByRole('article', { name: 'Oven', exact: true })).toHaveAttribute('data-availability', 'available')
  await filters.getByRole('button', { name: /^Placed/ }).click()
  await expect(dishwasher).toHaveCount(0)
  await expect(editor.locator('.room-catalog-card[data-availability="available"]')).toHaveCount(0)
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await accounts.store.get(owner.household.id))?.roomComponents).toEqual(owner.household.roomComponents)
})

test('unavailable model previews stop loading, reuse one probe and keep controls working', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
  await withoutWebGL(page)
  await page.goto('/kitchen')
  await expect(page.getByText('Your kitchen, minus the 3D.', { exact: true })).toBeVisible()
  const before = await page.evaluate(() => Reflect.get(window, 'componentPreviewContextAttempts'))
  const editor = await openEditor(page)
  const fridge = editor.getByRole('button', { name: 'Edit Fridge', exact: true })
  await expect(fridge.locator('.component-preview-error')).toHaveText('3D is unavailable.')
  await expect(fridge.locator('.component-preview-error')).toHaveRole('status')
  await expect(fridge.locator('.component-preview')).toHaveAttribute('data-preview-ready', 'false')
  await expect(fridge.locator('.component-preview')).toHaveAttribute('data-preview-loading', 'false')
  await expect(fridge.locator('.component-preview img, .component-preview svg')).toHaveCount(0)
  await expect(fridge).toBeEnabled()
  expect(await page.evaluate(() => Reflect.get(window, 'componentPreviewContextAttempts'))).toBe(Number(before) + 1)
  await expect(editor.getByRole('button', { name: 'Edit Sink', exact: true }).locator('.component-preview-error')).toHaveText('3D is unavailable.')
  expect(await page.evaluate(() => Reflect.get(window, 'componentPreviewContextAttempts'))).toBe(Number(before) + 1)
  await expect(editor.locator('.component-preview img')).toHaveCount(0)
  await fridge.click()
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Fridge')
})

test.describe('touch object grids', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('touch users open card info explicitly and the grid stays inside the viewport', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
    await withoutWebGL(page)
    await page.goto('/kitchen')
    const editor = await openEditor(page)
    const grid = editor.getByRole('list', { name: 'Objects in your room preview', exact: true })
    const fridge = grid.getByRole('button', { name: 'Edit Fridge', exact: true })
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await editor.getByRole('button', { name: 'Info about Fridge', exact: true }).tap()
    const information = editor.getByRole('region', { name: 'Fridge information', exact: true })
    await expect(information).toBeInViewport({ ratio: 1 })
    await expect(information.locator('dt')).toHaveText(['Supplies'])
    await editor.getByRole('button', { name: 'Show rendering of Fridge', exact: true }).tap()
    await expect(information).toHaveCount(0)
    await expect(fridge.locator('.component-preview')).toBeVisible()
    await expect(fridge.locator('.component-preview-error')).toHaveText('3D is unavailable.')
    await expect(fridge.locator('.component-preview-error')).toHaveRole('status')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const bounds = await grid.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    await fridge.click()
    await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Fridge')
  })
})
