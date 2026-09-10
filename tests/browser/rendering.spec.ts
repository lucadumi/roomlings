import { expect, test } from './account-fixtures.ts'
import type { Page } from '@playwright/test'
import { OrthographicCamera, Vector3 } from 'three'
import { baseCameraOffset, cameraFraming, roomCameraZoom } from '../../src/camera.ts'
import { kitchenLayout } from '../../src/roomLayout.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { roomIds } from '../../shared/rooms.ts'
import { trackDrawing } from './fixtures.ts'

test.beforeEach(({ populatedHousehold }) => {
  void populatedHousehold
})

async function frameKitchenBag(page: Page) {
  const world = page.locator('.kitchen-world')
  await page.getByRole('button', { name: 'Reset room view', exact: true }).click()
  await expect(world).toHaveAttribute('data-framing', 'close')
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  const layout = await world.locator('.world-canvas').evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height }
  })
  const framing = cameraFraming(layout.width, layout.height, 'room', false)
  const halfWidth = framing.halfHeight * layout.width / layout.height
  const camera = new OrthographicCamera(-halfWidth, halfWidth, framing.halfHeight, -framing.halfHeight, 0.1, 100)
  camera.zoom = roomCameraZoom(1, true, 'kitchen')
  camera.updateProjectionMatrix()
  const center = new Vector3(...framing.center)
  camera.position.copy(center).add(new Vector3(...baseCameraOffset))
  camera.lookAt(center)
  camera.updateMatrixWorld(true)
  const bag = new Vector3(kitchenLayout.stock[0], kitchenLayout.stock[1] + 0.36, kitchenLayout.stock[2] + 0.2).project(camera)
  return { x: layout.x + (bag.x * 0.5 + 0.5) * layout.width, y: layout.y + (-bag.y * 0.5 + 0.5) * layout.height }
}

test('the full-size kitchen stays within its static-geometry draw-call budget', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await trackDrawing(page)
  await page.goto('/kitchen')
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false')
  const draws = await page.evaluate(() => new Promise<number[]>((resolve) => {
    requestAnimationFrame(() => {
      const frames: number[] = []
      let previous = Number(Reflect.get(window, 'roomlingsFrameDrawCalls'))
      const sample = () => {
        const current = Number(Reflect.get(window, 'roomlingsFrameDrawCalls'))
        frames.push(current - previous)
        previous = current
        if (frames.length === 8) resolve(frames)
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  }))
  expect(Math.min(...draws)).toBeGreaterThan(100)
  expect(Math.max(...draws)).toBeLessThanOrEqual(350)
})

test('reduced-motion rooms stop idle drawing and refresh cached shadows only when an object moves', { tag: '@room' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date())
  const drawing = await trackDrawing(page)
  await page.goto('/kitchen')
  const room = page.locator('.kitchen-world')
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  const idle = await drawing()
  expect(idle.draws).toBeGreaterThan(0)
  expect(idle.shadows).toBeGreaterThan(0)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  expect(await drawing()).toEqual(idle)

  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.locator('.world-camera-controls')).toContainText('110%')
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(idle.draws)
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  const zoomed = await drawing()
  expect(zoomed.shadows).toBe(idle.shadows)

  await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(zoomed.draws)
  await expect(room).toHaveAttribute('data-evening', 'true')
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  expect((await drawing()).shadows).toBe(idle.shadows)

  await page.getByRole('button', { name: 'Room style', exact: true }).click()
  await page.getByRole('radio', { name: 'Sage', exact: true }).check()
  await page.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(room).toHaveAttribute('data-room-style', 'sage')
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  expect((await drawing()).shadows).toBe(idle.shadows)

  await page.getByRole('button', { name: 'Close the fridge', exact: true }).click()
  await expect.poll(async () => (await drawing()).shadows).toBeGreaterThan(idle.shadows)
  await expect(room).toHaveAttribute('data-rendering', 'paused')
  await expect(page.getByRole('button', { name: 'Peek inside', exact: true })).toBeVisible()
})

test('kitchen picking ignores secondary clicks and releases abandoned pointer captures', { tag: '@room' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath())
  const world = page.locator('.kitchen-world')
  const canvas = world.locator('canvas')
  await expect(canvas).toBeVisible()
  await expect(world.getByRole('img')).toHaveAccessibleName(/Object plus markers open chores.*household tools.*360 degrees/)
  const sink = world.locator('.hotspot-sink')
  expect(await sink.getAttribute('aria-label')).toBe(`Chores for ${await sink.locator('.hotspot-label').textContent()}`)
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  let bag = await frameKitchenBag(page)
  await page.mouse.click(bag.x, bag.y, { button: 'right' })
  await expect(page.locator('.room-panel')).toHaveCount(0)
  await page.mouse.click(bag.x, bag.y)
  await expect(page.locator('.room-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  bag = await frameKitchenBag(page)
  await canvas.evaluate((element) => {
    element.addEventListener('gotpointercapture', (event) => {
      element.setAttribute('data-captured-pointer', String((event as PointerEvent).pointerId))
    }, { once: true })
  })
  await page.mouse.move(bag.x, bag.y)
  await page.mouse.down()
  await page.mouse.move(bag.x + 1, bag.y)
  await expect(canvas).toHaveAttribute('data-captured-pointer', /^\d+$/)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const placement = await world.locator('.hotspot-stock').getAttribute('style')
  await canvas.evaluate((element) => {
    const pointerId = Number(element.getAttribute('data-captured-pointer'))
    if (!element.hasPointerCapture(pointerId)) throw new Error('The kitchen must first capture the pressed pointer.')
    element.addEventListener('lostpointercapture', () => element.setAttribute('data-lost-capture', 'true'), { once: true })
    element.releasePointerCapture(pointerId)
  })
  await page.mouse.move(bag.x + 40, bag.y + 20)
  await page.mouse.up()
  await expect(canvas).toHaveAttribute('data-lost-capture', 'true')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await expect(world.locator('.hotspot-stock')).toHaveAttribute('style', placement!)
  await expect(page.locator('.room-panel')).toHaveCount(0)
  await page.mouse.click(bag.x, bag.y)
  await expect(page.locator('.room-panel')).toBeVisible()
})

for (const room of roomIds) {
  test(`${room} pinch zoom stays continuous when one of three contacts is lifted`, { tag: '@room' }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(roomPath(room))
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
    await page.locator('.world-canvas canvas').evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error('The room canvas is missing.')
      const capture = element.setPointerCapture
      // Synthetic contacts have no native pointer capture to acquire.
      element.setPointerCapture = () => {}
      const pointer = (type: string, pointerId: number, clientX: number) => element.dispatchEvent(new PointerEvent(type, {
        pointerId, pointerType: 'touch', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX, clientY: 430, bubbles: true,
      }))
      try {
        pointer('pointerdown', 40, 100)
        pointer('pointerdown', 41, 180)
        pointer('pointerdown', 42, 290)
        pointer('pointermove', 40, 80)
        pointer('pointerup', 40, 80)
        pointer('pointermove', 41, 185)
        pointer('pointermove', 42, 295)
        pointer('pointerup', 41, 185)
        pointer('pointerup', 42, 295)
      } finally {
        element.setPointerCapture = capture
      }
    })
    await expect(page.locator('.world-camera-controls')).toContainText('125%')
    await expect(page.locator('.room-panel')).toHaveCount(0)
  })
}

for (const room of roomIds) {
  test(`${room} hotspots stay inside the unobscured scene while a panel is open`, { tag: '@room' }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath(room))
    await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
    await expect(page.locator('.room-panel')).toBeVisible()
    const labelToggle = page.getByRole('button', { name: 'Hide object labels', exact: true, includeHidden: true })
    await labelToggle.click()
    await expect(page.locator('.world-hotspots')).toBeHidden()
    await page.getByRole('button', { name: 'Show object labels', exact: true }).click()
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 1440, height: 960 }]) {
      await page.setViewportSize(viewport)
      if (viewport.width === 390) await expect(labelToggle).toBeHidden()
      else await expect(labelToggle).toBeVisible()
      await expect(page.locator('.world-hotspots')).toBeVisible()
      await expect.poll(() => page.locator('.kitchen-world').evaluate((world) => {
        const area = world.getBoundingClientRect()
        const visible = [...world.querySelectorAll('.world-hotspot')].filter((button) => getComputedStyle(button).visibility === 'visible')
        return visible.length > 0 && visible.every((button) => {
          const bounds = button.getBoundingClientRect()
          return bounds.left >= area.left && bounds.right <= area.right && bounds.top >= area.top && bounds.bottom <= area.bottom
        })
      })).toBe(true)
    }
  })
}

test('changing to reduced motion refreshes shadows for leaves that return to rest', { tag: '@room' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.clock.setFixedTime(new Date())
  const drawing = await trackDrawing(page)
  await page.goto(roomPath())
  const world = page.locator('.kitchen-world')
  await expect(world.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: 'House rules', exact: true }).click()
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  const before = await drawing()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(async () => (await drawing()).shadows).toBeGreaterThan(before.shadows)
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  const resting = await drawing()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await drawing()).toEqual(resting)
})

test('kitchen context loss stops its renderer and retains the ordinary household tools', { tag: '@room' }, async ({ page }) => {
  await page.goto(roomPath())
  const world = page.locator('.kitchen-world')
  const canvas = world.locator('canvas')
  await expect(canvas).toBeVisible()
  await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('The kitchen canvas is missing.')
    const loss = element.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    if (!loss) throw new Error('The browser cannot simulate a lost context.')
    loss.loseContext()
  })
  await expect(page.getByRole('status').filter({ hasText: 'Your kitchen, minus the 3D.' })).toBeVisible()
  await expect(world.getByRole('status')).toContainText('All household tools still work.')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await expect(canvas).toBeHidden()
  await expect(world.getByRole('img')).toHaveCount(0)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The receipt book.', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.getByRole('button', { name: 'Chores', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Household chores.', exact: true })).toBeVisible()
})
