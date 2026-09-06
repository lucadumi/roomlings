import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { OrthographicCamera, Vector3 } from 'three'
import { baseCameraOffset, cameraFraming } from '../../src/camera.ts'

async function frameRoom(page: Page) {
  await page.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false')
}

async function clickRoomPoint(page: Page, position: [number, number, number]) {
  const box = await page.locator('.world-canvas').boundingBox()
  if (!box) throw new Error('The kitchen canvas is not visible.')
  const framing = cameraFraming(box.width, box.height, 'room', true)
  const aspect = box.width / box.height
  const camera = new OrthographicCamera(-framing.halfHeight * aspect, framing.halfHeight * aspect, framing.halfHeight, -framing.halfHeight, 0.1, 100)
  const center = new Vector3(...framing.center)
  camera.position.copy(center).add(new Vector3(...baseCameraOffset))
  camera.lookAt(center)
  camera.updateMatrixWorld()
  const projected = new Vector3(...position).project(camera)
  await page.mouse.click(box.x + (projected.x * 0.5 + 0.5) * box.width, box.y + (-projected.y * 0.5 + 0.5) * box.height)
}

test('fridge, expenses, repayment records, and reload persistence', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.game-hud .brand')).toHaveText('roomlings.')
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Close the fridge' }).click()
  await expect(page.getByRole('button', { name: 'Peek inside' })).toBeVisible()
  await page.getByRole('button', { name: 'Peek inside' }).click()
  await page.getByRole('button', { name: 'Stock the fridge, add a grocery run', exact: true }).click()
  await page.getByLabel('What did you pick up?').fill('Browser test tomatoes')
  await page.getByLabel('Total (EUR)').fill('12.03')
  await page.getByRole('button', { name: 'Add & split the groceries' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByText('Browser test tomatoes', { exact: true })).toBeVisible()
  const grocery = page.locator('.expense-row').filter({ hasText: 'Browser test tomatoes' })
  await expect(grocery).toContainText('Paid by You')
  await grocery.locator('summary').click()
  await expect(grocery.locator('.expense-share')).toHaveCount(4)
  await page.reload()
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByText('Browser test tomatoes', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.locator('.game-dock').getByRole('button', { name: 'Settle up', exact: true }).click()
  await page.getByRole('button', { name: 'Record paid', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toContainText('does not move money')
  await page.getByRole('button', { name: 'Yes, record payment' }).click()
  await expect(page.locator('.history-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByRole('button', { name: 'Undo payment record' }).click()
  await expect(page.locator('.history-row')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Browser test tomatoes', exact: true }).click()
  await page.getByRole('button', { name: 'Remove grocery run', exact: true }).click()
  await expect(page.getByText('Browser test tomatoes', { exact: true })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('a new kitchen can be joined from a separate browser session', async ({ page, browser }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Make it yours' }).click()
  await page.getByLabel('What do you call home?').fill('The browser house')
  await page.getByLabel('Your name', { exact: true }).fill('Charlie')
  await page.getByRole('button', { name: 'Create our kitchen' }).click()
  await expect(page.locator('.game-demo')).toHaveCount(0)
  await page.getByRole('button', { name: 'Invite a roommate', exact: false }).first().click()
  const invitation = await page.getByLabel('Your private kitchen invitation').inputValue()
  const context = await browser.newContext()
  const roommate = await context.newPage()
  await roommate.goto(invitation)
  await roommate.getByLabel('Your name', { exact: true }).fill('Dana')
  await roommate.getByRole('button', { name: 'Join the kitchen', exact: true }).click()
  await expect(roommate.locator('.game-house')).toContainText('The browser house')
  await roommate.getByRole('button', { name: 'Stock the fridge, add a grocery run', exact: true }).click()
  await roommate.getByLabel('What did you pick up?').fill('Shared groceries')
  await roommate.getByLabel('Total (EUR)').fill('10')
  await roommate.getByRole('button', { name: 'Add & split the groceries' }).click()
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByText('Shared groceries', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await page.getByRole('button', { name: 'The Sunday House Return as You' }).click()
  await expect(page.locator('.game-demo')).toBeVisible()
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await page.getByRole('button', { name: 'The browser house Return as Charlie' }).click()
  await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Charlie')
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByText('Shared groceries', { exact: true })).toBeVisible()
  await context.close()
})

test('mobile layout has no horizontal overflow and supports keyboard dialogs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.game-hud .brand')).toHaveText('roomlings.')
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Stock the fridge, add a grocery run', exact: true }).click()
  await expect(page.getByLabel('What did you pick up?')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a rejected save keeps the expense draft available to retry', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Stock the fridge, add a grocery run', exact: true }).click()
  await page.getByLabel('What did you pick up?').fill('Keep this grocery draft')
  await page.getByLabel('Total (EUR)').fill('4.20')
  await page.route('**/api/expenses', async (route) => {
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'A roommate just changed the kitchen. It has been refreshed; please try again.' }) })
  })
  await page.getByRole('button', { name: 'Add & split the groceries' }).click()
  await expect(page.getByRole('alert')).toContainText('A roommate just changed the kitchen')
  await expect(page.getByLabel('What did you pick up?')).toHaveValue('Keep this grocery draft')
  await page.unroute('**/api/expenses')
  await page.getByRole('button', { name: 'Add & split the groceries' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByText('Keep this grocery draft', { exact: true })).toBeVisible()
})

test('budgets, category filtering, month navigation, and complete ledger export', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Monthly budget', exact: true }).click()
  await page.getByRole('button', { name: 'Edit monthly budget', exact: true }).click()
  await page.getByRole('textbox', { name: 'Monthly budget', exact: true }).fill('100')
  await page.getByRole('button', { name: 'Save the house rules', exact: true }).click()
  await expect(page.locator('.budget-labels')).toContainText('over budget')
  await page.getByRole('button', { name: 'Previous month', exact: true }).click()
  await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('button', { name: 'Next month', exact: true }).click()
  await expect(page.getByRole('meter')).not.toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await page.locator('.category-tabs').getByRole('button', { name: 'Fruit & veg', exact: true }).click()
  await expect(page.locator('.expense-row')).toHaveCount(2)
  await page.getByLabel('Search grocery runs').fill('farmers')
  await expect(page.locator('.expense-row')).toHaveCount(1)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export ledger', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('roomlings-ledger.csv')
  const stream = await download.createReadStream()
  let csv = ''
  for await (const chunk of stream) csv += chunk.toString()
  expect(csv).toContain('The big weekly shop')
  expect(csv).toContain('Farmers market finds')
  expect(csv.split('\r\n')).toHaveLength(7)
})

test('the room offers functional object interactions, lighting, camera controls, and labels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-evening', 'true')
  await page.getByRole('button', { name: 'Switch to daylight', exact: true }).click()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-evening', 'false')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.locator('.world-camera-controls')).toContainText('120%')
  await frameRoom(page)
  await expect(page.locator('.world-camera-controls')).toContainText('100%')
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await expect(page.locator('.world-hotspots')).toBeHidden()
  await page.getByRole('button', { name: 'Show object labels', exact: true }).click()
  await page.locator('.hotspot-stock').click()
  await expect(page.getByRole('dialog')).toContainText('What is in the bag?')
  await page.keyboard.press('Escape')
  await frameRoom(page)
  await page.locator('.hotspot-ledger').click()
  await expect(page.getByRole('region', { name: 'The receipt book.' })).toBeVisible()
  await page.keyboard.press('Escape')
  await frameRoom(page)
  await page.locator('.hotspot-budget').click()
  await expect(page.getByRole('region', { name: 'The little house pot.' })).toBeVisible()
  await page.keyboard.press('Escape')
  await frameRoom(page)
  await page.locator('.hotspot-roommates').click()
  await expect(page.getByRole('region', { name: 'Your kind of people.' })).toBeVisible()
  await page.keyboard.press('Escape')
  await frameRoom(page)
  await page.locator('.hotspot-settle').click()
  await expect(page.getByRole('region', { name: 'Keep it even.' })).toBeVisible()
})

test('the ledger remains usable when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, contextId: string, options?: unknown) {
        if (contextId.startsWith('webgl')) return null
        return Reflect.apply(original, this, [contextId, options])
      },
    })
  })
  await page.goto('/')
  await expect(page.getByText('Your kitchen, minus the 3D.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.locator('.expense-row')).toHaveCount(6)
})

test('the grocery bag and receipt book meshes work without clickable labels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/')
  await expect(page.locator('.hotspot-stock')).toBeVisible()
  await frameRoom(page)
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await clickRoomPoint(page, [-0.4, 1.92, 1.37])
  await expect(page.getByRole('dialog')).toContainText('What is in the bag?')
  await page.getByLabel('What did you pick up?').fill('Groceries from the 3D bag')
  await page.getByLabel('Total (EUR)').fill('8.70')
  await page.getByRole('button', { name: 'Add & split the groceries' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Fridge stocked')
  await frameRoom(page)
  await clickRoomPoint(page, [0.96, 1.64, 1.65])
  await expect(page.getByRole('region', { name: 'The receipt book.' })).toBeVisible()
  await expect(page.getByText('Groceries from the 3D bag', { exact: true })).toBeVisible()
})

test('the kitchen stops drawing behind a finance panel and resumes when it closes', async ({ page }) => {
  await page.addInitScript(() => {
    let draws = 0
    const original = WebGL2RenderingContext.prototype.drawElements
    Object.defineProperty(WebGL2RenderingContext.prototype, 'drawElements', {
      value(this: WebGL2RenderingContext, ...args: Parameters<WebGL2RenderingContext['drawElements']>) {
        draws++
        return Reflect.apply(original, this, args)
      },
    })
    Object.defineProperty(window, 'roomlingsTestDrawCalls', { get: () => draws })
  })
  await page.goto('/')
  const drawCalls = () => page.evaluate(() => Number(Reflect.get(window, 'roomlingsTestDrawCalls')))
  await expect.poll(drawCalls).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByRole('region', { name: 'The receipt book.' })).toBeVisible()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false')
  const pausedAt = await drawCalls()
  await page.waitForTimeout(250)
  expect(await drawCalls()).toBe(pausedAt)
  await page.keyboard.press('Escape')
  await expect.poll(drawCalls).toBeGreaterThan(pausedAt)
})

test('the phone view gives the room most of the screen and keeps panels below it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false')
  const canvas = await page.locator('.world-canvas').boundingBox()
  expect(canvas).not.toBeNull()
  expect(canvas!.height / 844).toBeGreaterThan(0.7)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const solidSamples = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    requestAnimationFrame(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.world-canvas canvas')
      const gl = canvas?.getContext('webgl2')
      if (!gl) { reject(new Error('The scene did not create a WebGL2 context.')); return }
      const pixel = new Uint8Array(4)
      let solid = 0
      for (const x of [0.2, 0.4, 0.6, 0.8]) {
        for (const y of [0.2, 0.4, 0.6, 0.8]) {
          gl.readPixels(Math.floor(gl.drawingBufferWidth * x), Math.floor(gl.drawingBufferHeight * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
          if (pixel[3] > 230) solid++
        }
      }
      resolve(solid)
    })
  }))
  expect(solidSamples).toBeGreaterThanOrEqual(8)
  await page.getByRole('button', { name: 'Monthly budget', exact: true }).click()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  const sceneBox = await page.locator('.kitchen-world').boundingBox()
  const panelBox = await page.getByRole('region', { name: 'The little house pot.' }).boundingBox()
  expect(sceneBox!.y + sceneBox!.height).toBeLessThanOrEqual(panelBox!.y)
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Your kind of people.' })).toBeVisible()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-focus', 'roommates')
  await page.keyboard.press('Escape')
  await expect(page.locator('.room-panel')).toHaveCount(0)
})

test('wheel zoom and the kettle respond without changing the household ledger', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  const before = await page.locator('.fund-trigger strong').innerText()
  await page.mouse.move(550, 330)
  await page.mouse.wheel(0, -180)
  await expect(page.locator('.world-camera-controls')).not.toContainText('100%')
  await page.locator('.world-kettle-toggle').click()
  await expect(page.locator('.world-kettle-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-focus', 'brew')
  await expect(page.locator('.fund-trigger strong')).toHaveText(before)
  await expect(page.locator('.room-panel')).toHaveCount(0)
  await page.getByRole('button', { name: 'Monthly budget', exact: true }).click()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  await expect(page.locator('.world-kettle-toggle')).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 })
})

test('header and footer wrappers are transparent while their controls keep their own surfaces', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  for (const selector of ['.game-hud', '.game-bottom']) {
    await expect(page.locator(selector)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator(selector)).toHaveCSS('background-image', 'none')
  }
  await expect(page.locator('.game-dock')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.fund-trigger')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const canvas = await page.locator('.world-canvas').boundingBox()
  expect(canvas!.y).toBeLessThanOrEqual(0)
  expect(canvas!.height).toBeGreaterThanOrEqual(page.viewportSize()!.height)
  await page.getByRole('button', { name: 'Monthly budget', exact: true }).click()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  for (const selector of ['.game-hud', '.game-bottom']) {
    await expect(page.locator(selector)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator(selector)).toHaveCSS('background-image', 'none')
  }
  const focusedCanvas = await page.locator('.world-canvas').boundingBox()
  expect(focusedCanvas!.x).toBe(0)
  expect(focusedCanvas!.y).toBe(0)
  expect(focusedCanvas!.width).toBe(page.viewportSize()!.width)
  expect(focusedCanvas!.height).toBe(page.viewportSize()!.height)
})

test('touch gestures zoom and turn the room without opening an object', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  const touch = await page.context().newCDPSession(page)
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 130, y: 350, id: 1 }, { x: 230, y: 350, id: 2 }],
  })
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 105, y: 350, id: 1 }, { x: 255, y: 350, id: 2 }],
  })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('.world-camera-controls')).toContainText('150%')
  await expect(page.locator('.room-panel')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.mouse.move(170, 380)
  await page.mouse.down()
  await page.mouse.move(170, 430, { steps: 20 })
  await page.mouse.up()
  await expect(page.locator('.room-panel')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await touch.detach()
})
