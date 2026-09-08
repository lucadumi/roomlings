import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { householdSchema } from '../../shared/domain.ts'
import { sessionSchema } from '../../src/api.ts'
import { createHousehold, pauseRequest, sampleSession, savedKitchen } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

async function openPicker(page: Page) {
  await page.getByRole('button', { name: 'Room style', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Make the room feel like home.', exact: true })
  await expect(picker).toBeVisible()
  return picker
}

async function strongColorChange(page: Page, before: Buffer, after: Buffer) {
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
    for (let i = 0; i < pixels[0].length; i += 4) {
      const difference = Math.max(
        Math.abs(pixels[0][i] - pixels[1][i]),
        Math.abs(pixels[0][i + 1] - pixels[1][i + 1]),
        Math.abs(pixels[0][i + 2] - pixels[1][i + 2]),
      )
      if (difference >= 30) changed++
    }
    return changed / (pixels[0].length / 4)
  }, [before.toString('base64'), after.toString('base64')])
}

test('presets require confirmation and sync to another roommate without WebGL', async ({ page, browser, request, baseURL }) => {
  const owner = await createHousehold(request, 'A room of our own', 'Rowan')
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
    await other.goto('/kitchen')
    await expect(other.locator('.game-house')).toContainText('A room of our own')
    await page.goto('/kitchen')
    await expect(page.getByText('Your kitchen, minus the 3D.', { exact: true })).toBeVisible()
    const picker = await openPicker(page)
    await expect(picker.getByRole('radio', { name: 'Original', exact: true })).toBeChecked()
    await expect(picker.getByRole('button', { name: 'Apply for everyone', exact: true })).toBeDisabled()
    await picker.getByRole('radio', { name: 'Clay', exact: true }).check()
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Room style', exact: true })).toBeFocused()
    await openPicker(page)
    await expect(picker.getByRole('radio', { name: 'Original', exact: true })).toBeChecked()
    await picker.getByRole('radio', { name: 'Sage', exact: true }).check()
    await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('Room style saved for everyone.')
    await page.reload()
    await openPicker(page)
    await expect(picker.getByRole('radio', { name: 'Sage', exact: true })).toBeChecked()
    await expect(picker.getByRole('radio', { name: 'Sage', exact: true })).toBeFocused()
    await other.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(other.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'sage')
    await openPicker(other)
    await expect(other.getByRole('radio', { name: 'Sage', exact: true })).toBeChecked()
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

test('a delayed failed preset save keeps the room, draft and dismissal state honest', async ({ page }) => {
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

test('a stale save retains the selection while showing the updated shared room', async ({ page, request }) => {
  const original = await sampleSession(request)
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
  await route.continue()
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

test('switching saved kitchens loads each household preset without replacing its identity', async ({ page, request }) => {
  const sage = await createHousehold(request, 'The sage kitchen', 'Rowan')
  const linen = await createHousehold(request, 'The linen kitchen', 'Alex')
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

test('saved finishes repaint the same scene and restore Original without resetting the room', { tag: '@room' }, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.clock.setFixedTime(new Date())
  await page.goto('/kitchen')
  const room = page.locator('.kitchen-world')
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  const canvas = await page.locator('.world-canvas canvas').elementHandle()
  expect(canvas).not.toBeNull()
  await page.getByRole('button', { name: 'Close the fridge', exact: true }).click()
  await page.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  const screenshot = async () => {
    const sheet = await page.addStyleTag({
      content: '.game-app * { visibility: hidden !important; } .game-app .game-home, .game-app .world-canvas, .game-app canvas { visibility: visible !important; }',
    })
    try {
      await expect(page.locator('.house-tools')).toBeHidden()
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }))
      return await page.screenshot()
    } finally {
      await sheet.evaluate((element) => element.parentNode?.removeChild(element))
    }
  }
  const original = await screenshot()
  const seen = [original]
  for (const name of ['Sage', 'Clay', 'Linen', 'Original']) {
    const picker = await openPicker(page)
    await picker.getByRole('radio', { name, exact: true }).check()
    await picker.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(room).toHaveAttribute('data-room-style', name.toLowerCase())
    await expect(room).toHaveAttribute('data-rendering', 'paused')
    await expect(room).toHaveAttribute('data-framing', 'whole')
    await expect(room).toHaveAttribute('data-evening', 'true')
    await expect(page.locator('.world-camera-controls')).toContainText('120%')
    await expect(page.getByRole('button', { name: 'Peek inside', exact: true })).toBeVisible()
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true)
    const image = await screenshot()
    if (name === 'Original') {
      if (!image.equals(original)) {
        await testInfo.attach('original-before', { body: original, contentType: 'image/png' })
        await testInfo.attach('original-restored', { body: image, contentType: 'image/png' })
      }
      expect(image.equals(original)).toBe(true)
    } else {
      for (const previous of seen) expect(image.equals(previous)).toBe(false)
      expect(await strongColorChange(page, original, image), `${name} should strongly recolor at least 30% of the room view`).toBeGreaterThanOrEqual(0.3)
      seen.push(image)
    }
  }
})

test('room controls and the sample invitation stay separate on a narrow tablet', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 })
  await page.goto('/kitchen')
  await expect(page.getByRole('button', { name: 'Room style', exact: true })).toBeVisible()
  const bounds = await page.locator('.house-tools, .game-demo, .room-caption').evaluateAll((elements) =>
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
  await expect(page.getByRole('radio', { name: 'Original', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Make it yours', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Make room for your people.', exact: true })).toBeVisible()
})

for (const viewport of [{ width: 390, height: 844 }, { width: 374, height: 844 }, { width: 320, height: 568 }]) {
  test(`room presets remain keyboard-accessible and contained at ${viewport.width}px`, async ({ page }) => {
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
    await expect(picker.getByRole('radio', { name: 'Original', exact: true })).toBeFocused()
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
