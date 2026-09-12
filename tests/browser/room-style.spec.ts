import { expect, routeAccountApi, test } from './account-fixtures.ts'
import type { Page } from '@playwright/test'
import { householdSchema, roomStyleSchema } from '../../shared/domain.ts'
import { componentFinishes } from '../../shared/componentFinishes.ts'
import { getRoomComponents } from '../../shared/roomComponents.ts'
import { sessionSchema } from '../../src/api.ts'
import { roomPresets } from '../../src/roomStyles.ts'
import { chooseOption, createHousehold, openRoomEditor, pauseRequest, savedKitchen, selectRoom } from './fixtures.ts'

test.use({ providerEnabled: false })
test.use({ reducedMotion: 'reduce' })

async function openPicker(page: Page) {
  await page.getByRole('button', { name: 'Room style', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Make the room feel like home.', exact: true })
  await expect(picker).toBeVisible()
  return picker
}

async function roomScreenshot(page: Page) {
  const sheet = await page.addStyleTag({
    content: `
      :root, body, #root, .game-app, .game-app * { background: transparent !important; }
      .game-app * { visibility: hidden !important; }
      .game-home::before, .game-home::after { visibility: hidden !important; }
      .game-app .game-home, .game-app .kitchen-world, .game-app .world-canvas, .game-app canvas { visibility: visible !important; }
    `,
  })
  try {
    await expect(page.locator('.house-tools')).toBeHidden()
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    return await page.locator('.kitchen-world').screenshot({ omitBackground: true })
  } finally {
    await sheet.evaluate((element) => element.parentNode?.removeChild(element))
  }
}

async function savedRoomImages(page: Page) {
  await page.getByRole('button', { name: 'Rooms', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Rooms', exact: true })
  await expect(menu.getByRole('group', { name: 'Choose a room', exact: true })).toHaveAttribute('aria-busy', 'false')
  const images: Record<string, string> = {}
  for (const roomId of ['kitchen', 'bathroom']) {
    const image = menu.locator(`[data-room-preview="${roomId}"] img`)
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/)
    images[roomId] = (await image.getAttribute('src'))!
  }
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  return images
}

async function visibleAccentChange(page: Page, before: Buffer, after: Buffer) {
  return page.evaluate(async (frames) => {
    const pixels: Uint8ClampedArray[] = []
    for (const frame of frames) {
      const image = new Image()
      image.src = `data:image/png;base64,${frame}`
      await image.decode()
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('The room screenshots could not be compared.')
      context.drawImage(image, 0, 0)
      pixels.push(context.getImageData(0, 0, image.width, image.height).data)
    }
    if (pixels[0].length !== pixels[1].length) throw new Error('Room screenshots have different dimensions.')
    let changed = 0
    let visible = 0
    for (let i = 0; i < pixels[0].length; i += 4) {
      // Compare the whole visible room, not the transparent corners around its isometric footprint.
      if (pixels[0][i + 3] === 0 && pixels[1][i + 3] === 0) continue
      visible++
      const difference = Math.max(
        Math.abs(pixels[0][i] - pixels[1][i]),
        Math.abs(pixels[0][i + 1] - pixels[1][i + 1]),
        Math.abs(pixels[0][i + 2] - pixels[1][i + 2]),
      )
      if (difference >= 12) changed++
    }
    if (!visible) throw new Error('The room screenshots contain no visible room pixels.')
    return changed / visible
  }, [before.toString('base64'), after.toString('base64')])
}

test('presets require admin confirmation and sync to another roommate without WebGL', async ({ page, accounts, browser, request, baseURL }) => {
  const owner = await createHousehold(accounts.store, 'A room of our own', 'Rowan')
  const joined = await request.post('/api/join', { data: { inviteCode: owner.household.inviteCode, name: 'Alex' } })
  await expect(joined).toBeOK()
  const roommate = sessionSchema.parse(await joined.json())
  await page.addInitScript((token) => {
    localStorage.setItem('roomlings.session', token)
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, contextId: string, options?: unknown) {
        if (contextId.startsWith('webgl')) return null
        return Reflect.apply(original, this, [contextId, options])
      },
    })
  }, owner.token)
  const second = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
  try {
    await second.addInitScript((token) => localStorage.setItem('roomlings.session', token), roommate.token)
    const other = await second.newPage()
    await routeAccountApi(other, accounts)
    await other.goto('/kitchen')
    await expect(other.locator('.game-house')).toContainText('A room of our own')
    await page.goto('/kitchen')
    await expect(page.getByText('Your kitchen, minus the 3D.', { exact: true })).toBeVisible()
    const picker = await openPicker(page)
    await expect(picker.getByRole('radio', { name: 'Roomlings', exact: true })).toBeChecked()
    await expect(picker.getByRole('button', { name: 'Apply for everyone', exact: true })).toBeDisabled()
    await picker.getByRole('radio', { name: 'Clay', exact: true }).check()
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Room style', exact: true })).toBeFocused()
    await openPicker(page)
    await expect(picker.getByRole('radio', { name: 'Roomlings', exact: true })).toBeChecked()
    await picker.getByRole('radio', { name: 'Sage', exact: true }).check()
    await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(page.locator('.toast').getByRole('status')).toHaveText('Room style saved.')
    await page.reload()
    await openPicker(page)
    await expect(picker.getByRole('radio', { name: 'Sage', exact: true })).toBeChecked()
    await expect(picker.getByRole('radio', { name: 'Sage', exact: true })).toBeFocused()
    await other.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(other.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'sage')
    await expect(other.getByRole('button', { name: 'Room style', exact: true })).toHaveCount(0)
    const result = await request.get('/api/household', { headers: { Authorization: `Bearer ${owner.token}` } })
    await expect(result).toBeOK()
    const saved = householdSchema.parse((await result.json()).household)
    expect(saved.roomStyle).toBe('sage')
    expect(saved.expenses).toEqual([])
    expect(saved.settlements).toEqual([])
    expect(saved.members).toEqual(roommate.household.members)
    expect(saved.version).toBe(roommate.household.version + 1)
  } finally {
    await second.close()
  }
})

test('a delayed failed preset save keeps the room, draft and dismissal state honest', async ({ page, emptyHousehold: _household }) => {
  await page.goto('/kitchen')
  const picker = await openPicker(page)
  await picker.getByRole('radio', { name: 'Clay', exact: true }).check()
  const pending = await pauseRequest(page, '**/api/household/room-style')
  await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  const route = await pending.pending
  await expect(picker).toHaveAttribute('aria-busy', 'true')
  for (const radio of await picker.getByRole('radio').all()) await expect(radio).toBeDisabled()
  await expect(picker.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await expect(picker.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled()
  await expect(picker.getByRole('button', { name: 'Saving...', exact: true })).toBeDisabled()
  await page.keyboard.press('Tab')
  await expect(picker).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picker).toBeVisible()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'original')
  await route.fulfill({ status: 503, json: { error: 'The room style could not be saved. Please try again.' } })
  await expect(picker.getByRole('alert')).toHaveText('The room style could not be saved. Please try again.')
  await expect(picker.getByRole('radio', { name: 'Clay', exact: true })).toBeChecked()
  await expect(page.locator('.toast')).toHaveCount(0)
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'original')
  await page.unroute('**/api/household/room-style')
  await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'clay')
  await expect(page.getByRole('button', { name: 'Room style', exact: true })).toBeFocused()
})

test('a stale save retains the selection while showing the updated shared room', async ({ page, accounts, request }) => {
  const original = await createHousehold(accounts.store, 'The concurrently styled home', 'You')
  await page.addInitScript((token) => localStorage.setItem('roomlings.session', token), original.token)
  await page.goto('/kitchen')
  const picker = await openPicker(page)
  await picker.getByRole('radio', { name: 'Sage', exact: true }).check()
  const pending = await pauseRequest(page, '**/api/household/room-style')
  await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  const route = await pending.pending
  const changed = await request.patch('/api/household/room-style', {
    headers: { Authorization: `Bearer ${original.token}` },
    data: { roomStyle: 'linen', version: original.household.version },
  })
  await expect(changed).toBeOK()
  await route.fallback()
  await expect(picker.getByRole('alert')).toBeVisible()
  await expect(picker.getByRole('status')).toContainText('Current shared look: Linen.')
  await expect(picker.getByRole('status')).toContainText('Review your selection before applying.')
  await expect(picker.getByRole('radio', { name: 'Sage', exact: true })).toBeChecked()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'linen')
  await page.unroute('**/api/household/room-style')
  await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'sage')
})

test('switching saved kitchens loads each household preset without replacing its identity', async ({ page, accounts, request }) => {
  const sage = await createHousehold(accounts.store, 'The sage kitchen', 'Rowan')
  const linen = await createHousehold(accounts.store, 'The linen kitchen', 'Alex')
  for (const [session, roomStyle] of [[sage, 'sage'], [linen, 'linen']] as const) {
    const response = await request.patch('/api/household/room-style', {
      headers: { Authorization: `Bearer ${session.token}` },
      data: { roomStyle, version: session.household.version },
    })
    await expect(response).toBeOK()
  }
  await page.addInitScript((kitchens) => {
    localStorage.setItem('roomlings.session', kitchens[0].token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify(kitchens))
  }, [savedKitchen(sage), savedKitchen(linen)])
  await page.goto('/kitchen')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'sage')
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await page.getByRole('button', { name: 'The linen kitchen Return as Alex', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The linen kitchen')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'linen')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(linen.token)
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await page.getByRole('button', { name: 'The sage kitchen Return as Rowan', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The sage kitchen')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'sage')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(sage.token)
})

test('saved finishes repaint the same scene and restore Original without resetting the room', { tag: '@room' }, async ({ page, emptyHousehold: _household }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.clock.setFixedTime(new Date())
  await page.goto('/kitchen')
  const room = page.locator('.kitchen-world')
  // Allow cold reflected-material shader preparation before comparing stable images.
  await expect(room).toHaveAttribute('data-rendering', 'paused', { timeout: 15_000 })
  const canvas = await page.locator('.world-canvas canvas').elementHandle()
  expect(canvas).not.toBeNull()
  await page.getByRole('button', { name: 'Close the fridge', exact: true }).click()
  await page.getByRole('button', { name: 'Reset room view', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  const screenshot = () => roomScreenshot(page)
  const original = await screenshot()
  const seen = [original]
  for (const style of [...roomStyleSchema.options.filter((style) => style !== 'original'), 'original'] as const) {
    const name = style === 'original' ? 'Roomlings' : roomPresets[style].name
    const picker = await openPicker(page)
    await picker.getByRole('radio', { name, exact: true }).check()
    await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(room).toHaveAttribute('data-room-style', style)
    await expect(room).toHaveAttribute('data-rendering', 'paused')
    await expect(room).toHaveAttribute('data-framing', 'close')
    await expect(room).toHaveAttribute('data-evening', 'true')
    await expect(page.locator('.world-camera-controls')).toContainText('110%')
    await expect(page.getByRole('button', { name: 'Peek inside', exact: true })).toBeVisible()
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
    const image = await screenshot()
    if (name === 'Roomlings') {
      if (!image.equals(original)) {
        await testInfo.attach('original-before', { body: original, contentType: 'image/png' })
        await testInfo.attach('original-restored', { body: image, contentType: 'image/png' })
      }
      expect(image.equals(original)).toBe(true)
    } else {
      for (const previous of seen) expect(image.equals(previous)).toBe(false)
      expect(await visibleAccentChange(page, original, image), `${name} should visibly change furniture accents`).toBeGreaterThanOrEqual(0.05)
      seen.push(image)
    }
  }
})

for (const roomId of ['kitchen', 'bathroom'] as const) for (const style of ['coastal', 'lavender', 'citrus', 'rose'] as const) {
  test(`${style} visibly repaints the ${roomId} and restores Original without rebuilding`, { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.clock.setFixedTime(new Date())
    await page.goto('/kitchen')
    if (roomId === 'bathroom') await selectRoom(page, roomId)
    const room = page.locator(roomId === 'bathroom' ? '.bathroom-world' : '.kitchen-world')
    await expect(room).toHaveAttribute('data-rendering', 'paused')
    if (roomId === 'kitchen') await page.getByRole('button', { name: 'Close the fridge', exact: true }).click()
    await page.getByRole('button', { name: 'Reset room view', exact: true }).click()
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
    await expect(room).toHaveAttribute('data-rendering', 'paused')
    const canvas = await room.locator('canvas').elementHandle()
    expect(canvas).not.toBeNull()
    const original = await roomScreenshot(page)
    const picker = await openPicker(page)
    await picker.getByRole('radio', { name: roomPresets[style].name, exact: true }).check()
    await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(room).toHaveAttribute('data-room-style', style)
    await expect(room).toHaveAttribute('data-rendering', 'paused')
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
    const changed = await roomScreenshot(page)
    expect(await visibleAccentChange(page, original, changed), `${style} should visibly change the ${roomId} furniture accents`).toBeGreaterThanOrEqual(0.05)
    await openPicker(page)
    await picker.getByRole('radio', { name: 'Roomlings', exact: true }).check()
    await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(room).toHaveAttribute('data-room-style', 'original')
    await expect(room).toHaveAttribute('data-rendering', 'paused')
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
    expect((await roomScreenshot(page)).equals(original)).toBe(true)
  })
}

for (const roomId of ['kitchen', 'bathroom'] as const) {
  test(`approved ${roomId} object finishes preview honestly and persist in thumbnails and saved room images`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.clock.setFixedTime(new Date())
    await page.goto('/kitchen')
    if (roomId === 'bathroom') await selectRoom(page, roomId)
    const style = roomId === 'kitchen' ? 'coastal' : 'lavender'
    const picker = await openPicker(page)
    await picker.getByRole('radio', { name: roomPresets[style].name, exact: true }).check()
    await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    await expect(picker).toHaveCount(0)
    const before = await accounts.store.get(owner.household.id)
    if (!before) throw new Error('The isolated palette household is missing.')
    const component = getRoomComponents(before).find((component) => component.id === (roomId === 'kitchen' ? 'default-kitchen-fridge' : 'default-bathroom-sink'))
    if (!component) throw new Error('The palette object is missing.')
    const roomImages = await savedRoomImages(page)
    const editor = await openRoomEditor(page)
    const card = editor.getByRole('button', { name: `Edit ${component.name}`, exact: true })
    const thumbnail = card.locator('.component-preview')
    await expect(thumbnail).toHaveAttribute('data-preview-ready', 'true')
    const originalImage = await thumbnail.locator('img').getAttribute('src')
    await card.click()
    const control = editor.getByRole('combobox', { name: 'Finish', exact: true })
    await control.click()
    const options = page.getByRole('listbox')
    await expect(options.getByRole('option')).toHaveCount(Object.keys(componentFinishes).length)
    for (const [finish, metadata] of Object.entries(componentFinishes)) {
      await expect(options.getByRole('option', { name: metadata.name, exact: true })).toHaveAttribute('data-option-value', finish)
    }
    await page.keyboard.press('Escape')
    const savedFinish = roomId === 'kitchen' ? 'teal' : 'berry'
    const finishes = ['ocean', 'teal', 'plum', 'lilac', 'lime', 'lemon', 'berry', 'rose'] as const
    for (const finish of [...finishes.filter((finish) => finish !== savedFinish), savedFinish] as const) {
      await chooseOption(control, finish)
      await expect(editor.locator('.room-finish-preview')).toHaveText(componentFinishes[finish].name)
      const channels = componentFinishes[finish].color!.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16))
      await expect(editor.locator('.room-finish-preview span')).toHaveCSS('background-color', `rgb(${channels.join(', ')})`)
    }
    expect(await accounts.store.get(owner.household.id)).toEqual(before)
    await editor.getByRole('button', { name: 'All room objects', exact: true }).click()
    await expect(thumbnail).toHaveAttribute('data-preview-ready', 'true')
    const draftImage = await thumbnail.locator('img').getAttribute('src')
    expect(draftImage).not.toBe(originalImage)
    const applying = page.waitForRequest('**/api/household/room-components')
    await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    const patch = (await applying).postDataJSON()
    await expect(editor).toHaveCount(0)
    const saved = await accounts.store.get(owner.household.id)
    if (!saved) throw new Error('The saved palette household is missing.')
    const receipt = saved.mutationReceipts?.at(-1)
    expect(receipt).toMatchObject({ id: patch.mutationId, memberId: owner.memberId, version: before.version + 1 })
    expect(receipt?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.mutationReceipts).toEqual([...(before.mutationReceipts ?? []), receipt])
    const expected = {
      ...before, version: before.version + 1,
      mutationReceipts: saved.mutationReceipts,
      roomComponents: getRoomComponents(before).map((item) => item.id === component.id ? { ...item, finish: savedFinish, version: item.version + 1 } : item),
    }
    expect(saved).toEqual(expected)
    const savedImages = await savedRoomImages(page)
    expect(savedImages[roomId]).not.toBe(roomImages[roomId])
    const other = roomId === 'kitchen' ? 'bathroom' : 'kitchen'
    expect(savedImages[other]).toBe(roomImages[other])
    await page.reload()
    if (roomId === 'bathroom' && !await page.locator('.bathroom-world').isVisible()) await selectRoom(page, roomId)
    await openRoomEditor(page)
    await expect(thumbnail).toHaveAttribute('data-preview-ready', 'true')
    await expect(thumbnail.locator('img')).toHaveAttribute('src', draftImage!)
    await card.click()
    await expect(control).toHaveAttribute('data-value', savedFinish)
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', style)
  })
}

test('room controls stay separate on a narrow tablet', async ({ page, emptyHousehold: _household }) => {
  await page.setViewportSize({ width: 600, height: 900 })
  await page.goto('/kitchen')
  await expect(page.getByRole('button', { name: 'Room objects', exact: true })).toBeVisible()
  const bounds = await page.locator('.house-tools, .room-caption, .game-identity, .game-resources').evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { name: element.className, x, y, width, height }
    }),
  )
  for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
    const a = bounds[i]
    const b = bounds[j]
    expect(a.x >= b.x + b.width || a.y >= b.y + b.height || a.x + a.width <= b.x || a.y + a.height <= b.y,
      `${a.name} must not overlap ${b.name}`).toBe(true)
  }
  await openPicker(page)
  await expect(page.getByRole('radio', { name: 'Roomlings', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
})

for (const viewport of [{ width: 390, height: 844 }, { width: 374, height: 844 }, { width: 320, height: 568 }]) {
  test(`room presets remain keyboard-accessible and contained at ${viewport.width}px`, async ({ page, emptyHousehold: _household }) => {
    await page.setViewportSize(viewport)
    await page.goto('/kitchen')
    const tools = page.locator('.house-tools')
    await expect(tools).toBeVisible()
    await expect(page.locator('.world-camera-controls')).toBeVisible()
    const controls = await tools.boundingBox()
    const camera = await page.locator('.world-camera-controls').boundingBox()
    expect(controls).not.toBeNull()
    expect(camera).not.toBeNull()
    expect(controls!.y + controls!.height).toBeLessThanOrEqual(camera!.y)
    for (const button of await tools.getByRole('button').all()) {
      const bounds = await button.boundingBox()
      expect(bounds!.width).toBeGreaterThanOrEqual(44)
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
    }
    await page.getByRole('button', { name: 'Close the fridge', exact: true }).click()
    await expect(page.locator('.world-view-label')).toBeVisible()
    const label = await page.locator('.world-view-label').boundingBox()
    expect(label).not.toBeNull()
    expect(controls!.x >= label!.x + label!.width || controls!.y >= label!.y + label!.height
      || controls!.x + controls!.width <= label!.x || controls!.y + controls!.height <= label!.y).toBe(true)
    const picker = await openPicker(page)
    await expect(picker.getByRole('radio', { name: 'Roomlings', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const sage = picker.getByRole('radio', { name: 'Sage', exact: true })
    await expect(sage).toBeChecked()
    await expect(sage).toBeFocused()
    await expect(picker.locator('.room-style-option').filter({ has: page.getByRole('radio', { name: 'Sage', exact: true }) })).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Tab')
    await expect(picker.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    for (const card of await picker.locator('.room-style-option').all()) {
      const bounds = await card.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.width).toBeGreaterThanOrEqual(44)
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
    }
    expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    const apply = picker.getByRole('button', { name: 'Apply for everyone', exact: true })
    await apply.scrollIntoViewIfNeeded()
    await expect(apply).toBeInViewport({ ratio: 1 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Room style', exact: true })).toBeFocused()
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'original')
  })
}
