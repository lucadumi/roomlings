import { expect, test } from './account-fixtures.ts'
import { openRoomEditor, selectRoom } from './fixtures.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { roomIds } from '../../shared/rooms.ts'

test.use({ reducedMotion: 'reduce' })

test('room-selector spinners stay visible while renders load and stop when the saved previews are ready', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route(/\/src\/householdRoomPreview\.ts(?:\?.*)?$/, async (route) => {
    await pending
    await route.continue()
  })
  const before = await accounts.store.get(owner.household.id)
  try {
    await page.goto(roomPath())
    const trigger = page.getByRole('button', { name: 'Rooms', exact: true })
    await trigger.click()
    const picker = page.getByRole('menu', { name: 'Rooms', exact: true })
    const previews = picker.getByRole('group', { name: 'Choose a room', exact: true })
    await expect(previews).toHaveAttribute('aria-busy', 'true')
    await expect(picker.getByRole('status')).toHaveCount(roomIds.length)
    await expect(picker.locator('.room-menu-preview img:visible')).toHaveCount(0)
    for (const spinner of await picker.locator('.room-menu-preview-status .spin').all()) {
      await expect(spinner).toBeVisible()
      await expect(spinner).toHaveCSS('animation-name', 'spin')
    }
    await expect(picker.getByRole('menuitemradio', { name: 'Open Bathroom', exact: true })).toBeEnabled()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const spinner of await picker.locator('.room-menu-preview-status .spin').all()) {
      await expect(spinner).toHaveCSS('animation-name', 'none')
    }
    release?.()
    await expect(previews).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
    await expect(picker.locator('.room-menu-preview-status')).toHaveCount(0)
    await expect.poll(() => picker.locator('img').evaluateAll((images) =>
      images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
    await page.keyboard.press('Escape')
    await trigger.click()
    await expect(previews).toHaveAttribute('aria-busy', 'false')
    await expect(picker.getByRole('status')).toHaveCount(0)
    expect(await accounts.store.get(owner.household.id)).toEqual(before)
  } finally { release?.() }
})

test('saved room images are warmed before opening and reused without illustration backgrounds', { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
  await page.addInitScript(() => {
    let renders = 0
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(window, 'savedRoomPreviewRenders', { get: () => renders })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, name: string, options?: WebGLContextAttributes) {
        if (name === 'webgl2' && options?.preserveDrawingBuffer) renders++
        return Reflect.apply(original, this, [name, options])
      },
    })
  })
  await page.goto(roomPath())
  const renders = () => page.evaluate(() => Number(Reflect.get(window, 'savedRoomPreviewRenders')))
  await expect.poll(renders, { timeout: 20_000 }).toBe(1)
  const trigger = page.getByRole('button', { name: 'Rooms', exact: true })
  await trigger.click()
  const picker = page.getByRole('menu', { name: 'Rooms', exact: true })
  await expect(picker.getByRole('group', { name: 'Choose a room', exact: true })).toHaveAttribute('aria-busy', 'false')
  await expect(picker.locator('.room-menu-preview-status')).toHaveCount(0)
  for (const image of await picker.locator('.room-menu-preview').all()) {
    await expect(image).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  }
  const first = await picker.locator('img').evaluateAll((images) => images.map((image) => image.getAttribute('src')))
  await page.keyboard.press('Escape')
  await trigger.click()
  await expect(picker.getByRole('group', { name: 'Choose a room', exact: true })).toHaveAttribute('aria-busy', 'false')
  expect(await picker.locator('img').evaluateAll((images) => images.map((image) => image.getAttribute('src')))).toEqual(first)
  expect(await renders()).toBe(1)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Room style', exact: true }).click()
  await page.getByRole('radio', { name: 'Coastal', exact: true }).check()
  await page.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect.poll(renders).toBe(2)
  await trigger.click()
  await expect(picker.getByRole('group', { name: 'Choose a room', exact: true })).toHaveAttribute('aria-busy', 'false')
  expect(await picker.locator('img').evaluateAll((images) => images.map((image) => image.getAttribute('src')))).not.toEqual(first)
  expect(await renders()).toBe(2)
})

test('the Rooms menu shows real previews beneath its button and preserves the household', { tag: '@room' }, async ({ page, populatedHousehold }, testInfo) => {
  await page.goto(roomPath())
  await page.getByRole('button', { name: 'Rooms', exact: true }).click()
  const picker = page.getByRole('menu', { name: 'Rooms', exact: true })
  await expect(page.getByRole('dialog', { name: 'Rooms', exact: true })).toHaveCount(0)
  await expect(picker.getByRole('menuitemradio', { name: 'Open Kitchen', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(picker.getByRole('menuitemradio', { name: 'Open Bathroom', exact: true })).toHaveAttribute('aria-checked', 'false')
  const trigger = await page.getByRole('button', { name: 'Rooms', exact: true }).boundingBox()
  const menu = await picker.boundingBox()
  expect(menu!.y).toBeGreaterThanOrEqual(trigger!.y + trigger!.height)
  expect(menu!.y - trigger!.y - trigger!.height).toBeLessThanOrEqual(12)
  await expect(picker.locator('img')).toHaveCount(roomIds.length)
  await expect.poll(() => picker.locator('img').evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('anchored-rooms-menu.png'), animations: 'disabled' })
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(populatedHousehold.token)
  await picker.getByRole('menuitemradio', { name: 'Open Bathroom', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`${roomPath('bathroom')}$`))
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toContainText('Bathroom')
  await selectRoom(page, 'bathroom')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(populatedHousehold.token)
})

test('the room preview cards support keyboard selection, cancellation and browser history', async ({ page, populatedHousehold: _household }) => {
  await page.goto(roomPath())
  const trigger = page.getByRole('button', { name: 'Rooms', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const picker = page.getByRole('menu', { name: 'Rooms', exact: true })
  await expect(picker).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(picker.getByRole('menuitemradio', { name: 'Open Kitchen', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await page.keyboard.press('ArrowDown')
  await expect(picker.getByRole('menuitemradio', { name: 'Open Bathroom', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${roomPath('bathroom')}$`))
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`${roomPath()}$`))
  await expect(trigger).toContainText('Kitchen')
})

test('the room menu toggles, closes outside, and returns Tab navigation to the toolbar', async ({ page, populatedHousehold: _household }) => {
  await page.goto(roomPath())
  const trigger = page.getByRole('button', { name: 'Rooms', exact: true })
  const menu = page.getByRole('menu', { name: 'Rooms', exact: true })
  await trigger.click()
  await expect(menu).toBeVisible()
  await expect(page.locator('.modal-backdrop')).toHaveCount(0)
  await trigger.click()
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.press('ArrowDown')
  await expect(menu.getByRole('menuitemradio', { name: 'Open Kitchen', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Meet your roommates', exact: true })).toBeFocused()
  await trigger.click()
  await page.getByRole('button', { name: 'How to play', exact: true }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('the anchored menu leaves an editor draft visible and Escape closes only the menu', async ({ page, accounts, populatedHousehold }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath())
  const editor = await openRoomEditor(page)
  await editor.getByRole('button', { name: 'Edit Dining table', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('A draft beside the menu')
  const original = await accounts.store.get(populatedHousehold.household.id)
  await page.getByRole('button', { name: 'Rooms', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Rooms', exact: true })
  await expect(menu).toBeVisible()
  await expect(editor).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('A draft beside the menu')
  expect((await accounts.store.get(populatedHousehold.household.id))?.roomComponents).toEqual(original?.roomComponents)
})

test('an open room menu follows its button when the viewport changes', async ({ page, populatedHousehold: _household }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath())
  const trigger = page.getByRole('button', { name: 'Rooms', exact: true })
  await trigger.click()
  const menu = page.getByRole('menu', { name: 'Rooms', exact: true })
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 960 }]) {
    await page.setViewportSize(viewport)
    await expect.poll(async () => {
      const anchor = await trigger.boundingBox()
      const bounds = await menu.boundingBox()
      return !!anchor && !!bounds && Math.abs(bounds.y - anchor.y - anchor.height - 8) < 2
        && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height
    }).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
})

test('an open room menu follows position-only header reflow', async ({ page, populatedHousehold: _household }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(roomPath())
  const trigger = page.getByRole('button', { name: 'Rooms', exact: true })
  await trigger.click()
  const menu = page.getByRole('menu', { name: 'Rooms', exact: true })
  const original = await trigger.boundingBox()
  expect(original).not.toBeNull()
  await page.locator('.game-hud').evaluate((element) => { element.style.paddingBottom = '44px' })
  await expect.poll(() => trigger.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(original!.y)
  expect((await trigger.boundingBox())!.height).toBe(original!.height)
  await expect.poll(async () => {
    const anchor = await trigger.boundingBox()
    const bounds = await menu.boundingBox()
    if (!anchor || !bounds) throw new Error('The room trigger and menu must remain visible.')
    return Math.abs(bounds.y - anchor.y - anchor.height - 8)
  }).toBeLessThan(1)
  await page.locator('.game-hud').evaluate((element) => element.style.removeProperty('padding-bottom'))
  await expect.poll(async () => {
    const anchor = await trigger.boundingBox()
    const bounds = await menu.boundingBox()
    if (!anchor || !bounds) throw new Error('The room trigger and menu must remain visible.')
    return Math.abs(bounds.y - anchor.y - anchor.height - 8)
  }).toBeLessThan(1)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`room previews fit on ${viewport.width}x${viewport.height} screens`, async ({ page, populatedHousehold: _household }) => {
    await page.setViewportSize(viewport)
    await page.goto(roomPath())
    await page.getByRole('button', { name: 'Rooms', exact: true }).click()
    const picker = page.getByRole('menu', { name: 'Rooms', exact: true })
    expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (const card of await picker.locator('.room-preview-card').all()) {
      await card.scrollIntoViewIfNeeded()
      await expect(card).toBeInViewport({ ratio: 1 })
      const bounds = await card.boundingBox()
      expect(bounds?.width).toBeGreaterThanOrEqual(44)
      expect(bounds?.height).toBeGreaterThanOrEqual(44)
    }
    const trigger = await page.getByRole('button', { name: 'Rooms', exact: true }).boundingBox()
    const bounds = await picker.boundingBox()
    expect(bounds!.y).toBeGreaterThanOrEqual(trigger!.y + trigger!.height)
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
    await picker.getByRole('menuitemradio', { name: 'Open Bathroom', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toContainText('Bathroom')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
  test(`both rooms start close up with the same measured scene space at ${viewport.width}px`, { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
    await page.setViewportSize(viewport)
    await page.goto(roomPath())
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
    await expect(page.getByRole('button', { name: 'Reset room view', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Reset room view', exact: true }).click()
    await expect(bathroom).toHaveAttribute('data-framing', 'close')
    await expect(bathroom).toHaveAttribute('data-camera-moving', 'false')
  })
}
