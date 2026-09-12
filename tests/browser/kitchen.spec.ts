import { expect, routeAccountApi, test } from './account-fixtures.ts'
import type { Page } from '@playwright/test'
import { OrthographicCamera, Vector3 } from 'three'
import { baseCameraOffset, cameraProjection, roomCameraZoom, roomEntryFraming, roomFramingArea } from '../../src/camera.ts'
import { kitchenLayout } from '../../src/roomLayout.ts'
import { sessionSchema } from '../../src/api.ts'
import { localDate } from '../../shared/domain.ts'
import { createHousehold, openGroceryForm, savedKitchen, waitForRoomReady } from './fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

async function frameRoom(page: Page) {
  await page.getByRole('button', { name: 'Reset room view', exact: true }).click()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-framing', 'close')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false')
}

async function clickRoomPoint(page: Page, position: [number, number, number]) {
  const layout = await page.locator('.kitchen-world').evaluate((element) => {
    const canvas = element.querySelector('.world-canvas')!.getBoundingClientRect()
    const stage = element.getBoundingClientRect()
    const controls = element.querySelector('.world-camera-controls')!.getBoundingClientRect()
    return { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height,
      panelOpen: element.closest('.game-home')?.getAttribute('data-panel-open') === 'true',
      area: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
      controls: { x: controls.x, y: controls.y, width: controls.width, height: controls.height },
    }
  })
  const area = layout.panelOpen ? roomFramingArea(layout, layout.area, layout.controls)
    : { x: 0, y: 0, width: layout.width, height: layout.height }
  const framing = roomEntryFraming(layout.width, layout.height, area)
  const zoom = roomCameraZoom(1, true, 'kitchen')
  const projection = cameraProjection(layout.width, layout.height, area, framing.halfHeight, zoom)
  const camera = new OrthographicCamera(projection.left, projection.right, projection.top, projection.bottom, 0.1, 100)
  camera.zoom = zoom
  camera.updateProjectionMatrix()
  const center = new Vector3(...framing.center)
  camera.position.copy(center).add(new Vector3(...baseCameraOffset))
  camera.lookAt(center)
  camera.updateMatrixWorld()
  const projected = new Vector3(...position).project(camera)
  await page.mouse.click(layout.x + (projected.x * 0.5 + 0.5) * layout.width, layout.y + (-projected.y * 0.5 + 0.5) * layout.height)
}

test('fridge, expenses, repayment records, and reload persistence', async ({ page, populatedHousehold: _household }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/kitchen')
  await expect(page.getByRole('link', { name: 'Roomlings home', exact: true })).toBeVisible()
  await expect(page.locator('.world-canvas canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Close the fridge' }).click()
  await expect(page.getByRole('button', { name: 'Peek inside' })).toBeVisible()
  await page.getByRole('button', { name: 'Peek inside' }).click()
  await openGroceryForm(page)
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

test('normal room entry exposes access without creating a household', async ({ page }) => {
  const mutations: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET') mutations.push(new URL(request.url()).pathname)
  })
  await page.goto('/rooms/kitchen')
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Your place, on every device.')
  await expect(page.getByRole('button', { name: 'Use existing browser recovery', exact: true })).toBeVisible()
  await expect(page.locator('.game-house')).toHaveCount(0)
  expect(mutations).toEqual([])
})

test('a new kitchen can be joined from a separate browser session', async ({ page, accounts, browser, baseURL }) => {
  if (!baseURL) throw new Error('The shared-kitchen scenario needs a configured base URL.')
  const owner = await createHousehold(accounts.store, 'The browser house', 'Charlie')
  const invitation = new URL('/rooms/kitchen', baseURL)
  invitation.hash = `join=${encodeURIComponent(owner.household.inviteCode)}`
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  try {
    const roommate = await context.newPage()
    await routeAccountApi(roommate, accounts)
    await roommate.goto(invitation.toString())
    await roommate.getByLabel('Your name', { exact: true }).fill('Dana')
    await roommate.getByRole('button', { name: 'Join the kitchen', exact: true }).click()
    await expect(roommate.locator('.game-house')).toContainText('The browser house')
    await openGroceryForm(roommate)
    await roommate.getByLabel('What did you pick up?').fill('Shared groceries')
    await roommate.getByLabel('Total (EUR)').fill('10')
    await roommate.getByRole('button', { name: 'Add & split the groceries' }).click()
    await expect(roommate.getByRole('dialog')).toHaveCount(0)
  } finally {
    await context.close()
  }
  await page.addInitScript(({ token, kitchen }) => {
    localStorage.setItem('roomlings.session', token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
  }, { token: owner.token, kitchen: savedKitchen(owner) })
  await page.goto('/kitchen')
  await expect(page.locator('.game-house')).toContainText('The browser house')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByText('Shared groceries', { exact: true })).toBeVisible()
  await expect(page.locator('.expense-row').filter({ hasText: 'Shared groceries' })).toContainText('Paid by Dana')
})

test('saved households restore the original roommate and shared expenses after switching', async ({ page, accounts, request }) => {
  const original = await createHousehold(accounts.store, 'The saved house', 'Charlie')
  const other = await createHousehold(accounts.store, 'Another home', 'Riley')
  const joined = await request.post('/api/join', { data: { inviteCode: original.household.inviteCode, name: 'Dana' } })
  await expect(joined).toBeOK()
  const roommate = sessionSchema.parse(await joined.json())
  const expense = await request.post('/api/expenses', {
    headers: { Authorization: `Bearer ${roommate.token}` },
    data: {
      description: 'Saved shared groceries', amount: 1000, category: 'produce', date: localDate(),
      paidBy: roommate.memberId, participants: roommate.household.members.map((member) => member.id),
      version: roommate.household.version,
    },
  })
  await expect(expense).toBeOK()
  await page.addInitScript(({ original, other }) => {
    localStorage.setItem('roomlings.session', original.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([original, other]))
  }, { original: savedKitchen(original), other: savedKitchen(other) })
  await page.goto('/kitchen')
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await page.getByRole('button', { name: 'Another home Return as Riley' }).click()
  await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Riley')
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await page.getByRole('button', { name: 'The saved house Return as Charlie' }).click()
  await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Charlie')
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  const restored = page.locator('.expense-row').filter({ hasText: 'Saved shared groceries' })
  await expect(restored).toBeVisible()
  await expect(restored).toContainText('Paid by Dana')
  await expect(restored).toContainText('2 shares')
})

test('mobile layout has no horizontal overflow and supports keyboard dialogs', async ({ page, populatedHousehold: _household }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/kitchen')
  await expect(page.getByRole('link', { name: 'Roomlings home', exact: true })).toBeVisible()
  await waitForRoomReady(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await openGroceryForm(page)
  await expect(page.getByLabel('What did you pick up?')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a rejected save keeps the expense draft available to retry', async ({ page, populatedHousehold: _household }) => {
  await page.goto('/kitchen')
  await openGroceryForm(page)
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

test('budgets, category filtering, month navigation, and complete ledger export', async ({ page, populatedHousehold: _household }) => {
  await page.goto('/kitchen')
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

test.describe('room controls', { tag: '@room' }, () => {
  test.use({ reducedMotion: 'reduce' })
  test.beforeEach(async ({ page, populatedHousehold: _household }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto('/kitchen')
    await waitForRoomReady(page)
  })

  test('lighting switches between daylight and evening', async ({ page }) => {
    await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-evening', 'true')
    await page.getByRole('button', { name: 'Switch to daylight', exact: true }).click()
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-evening', 'false')
  })

  test('zoom can return to a whole-room view', async ({ page }) => {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(page.locator('.world-camera-controls')).toContainText('110%')
    await frameRoom(page)
    await expect(page.locator('.world-camera-controls')).toContainText('100%')
  })

  test('object labels can be hidden and restored', async ({ page }) => {
    await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
    await expect(page.locator('.world-hotspots')).toBeHidden()
    await page.getByRole('button', { name: 'Show object labels', exact: true }).click()
    await expect(page.locator('.world-hotspots')).toBeVisible()
  })

  test('fridge and kettle shortcuts stay compact as labels and viewports change', async ({ page }) => {
    const actions = page.getByRole('group', { name: 'Kitchen quick actions', exact: true })
    const fridge = actions.locator('.world-fridge-toggle')
    const kettle = actions.getByRole('button', { name: 'Put the kettle on', exact: true })
    for (const width of [1440, 1251, 390, 320]) {
      await page.setViewportSize({ width, height: 960 })
      for (let state = 0; state < 2; state++) {
        const layout = await actions.evaluate((element) => {
          const buttons = [...element.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
          const [first, second] = buttons
          const sameRow = Math.abs(first.top - second.top) < 1
          return {
            gap: sameRow ? second.left - first.right : second.top - first.bottom,
            sizes: buttons.map((bounds) => [bounds.width, bounds.height]),
          }
        })
        expect(layout.gap).toBeCloseTo(8, 1)
        for (const [buttonWidth, buttonHeight] of layout.sizes) {
          expect(buttonWidth).toBeGreaterThanOrEqual(width <= 560 ? 44 : 40)
          expect(buttonHeight).toBeGreaterThanOrEqual(width <= 560 ? 44 : 40)
        }
        const open = await fridge.getAttribute('aria-pressed')
        await fridge.click()
        await expect(fridge).toHaveAttribute('aria-pressed', open === 'true' ? 'false' : 'true')
        if (!state) {
          await kettle.click()
          await expect(kettle).toHaveAttribute('aria-pressed', 'true')
        }
      }
    }
  })

  const hotspots = [
    { action: 'stock', role: 'region', title: 'The shopping bag.' },
    { action: 'ledger', role: 'region', title: 'The receipt book.' },
    { action: 'budget', role: 'region', title: 'The little house pot.' },
    { action: 'roommates', role: 'region', title: 'Your kind of people.' },
    { action: 'settle', role: 'region', title: 'Keep it even.' },
  ] as const

  for (const { action } of hotspots) {
    test(`${action} marker opens object chores and returns to the room`, async ({ page }) => {
      await frameRoom(page)
      const marker = page.locator(`.hotspot-${action}`)
      const id = await marker.getAttribute('data-component-id')
      await marker.click()
      await expect(page.locator('.chores-panel')).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'Chore object', exact: true })).toHaveAttribute('data-value', id!)
      await page.keyboard.press('Escape')
      await expect(page.locator('.chores-panel')).toHaveCount(0)
      await frameRoom(page)
    })
  }
})

test('the ledger remains usable when WebGL is unavailable', async ({ page, populatedHousehold: _household }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, contextId: string, options?: unknown) {
        if (contextId.startsWith('webgl')) return null
        return Reflect.apply(original, this, [contextId, options])
      },
    })
  })
  await page.goto('/kitchen')
  await expect(page.getByText('Your kitchen, minus the 3D.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.locator('.expense-row')).toHaveCount(6)
})

test('the grocery bag and receipt book meshes work without clickable labels', { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/kitchen')
  await waitForRoomReady(page)
  await expect(page.locator('.hotspot-stock')).toBeVisible()
  await frameRoom(page)
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await clickRoomPoint(page, [kitchenLayout.stock[0], kitchenLayout.stock[1] + 0.41, kitchenLayout.stock[2] + 0.27])
  await expect(page.getByRole('region', { name: 'The shopping bag.', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Record without a list', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('What is in the bag?')
  await page.getByLabel('What did you pick up?').fill('Groceries from the 3D bag')
  await page.getByLabel('Total (EUR)').fill('8.70')
  await page.getByRole('button', { name: 'Add & split the groceries' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.toast').getByRole('status')).toHaveText('Grocery run saved.')
  await frameRoom(page)
  await clickRoomPoint(page, [kitchenLayout.ledger[0], kitchenLayout.ledger[1] + 0.1, kitchenLayout.ledger[2]])
  await expect(page.getByRole('region', { name: 'The receipt book.' })).toBeVisible()
  await expect(page.getByText('Groceries from the 3D bag', { exact: true })).toBeVisible()
})

test('the kitchen ignores nonvisual household refreshes while paused and still renders scene updates', { tag: '@room' }, async ({ page, accounts, populatedHousehold }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    let draws = 0
    const original = WebGL2RenderingContext.prototype.drawElements
    Object.defineProperty(WebGL2RenderingContext.prototype, 'drawElements', {
      value(this: WebGL2RenderingContext, ...args: Parameters<WebGL2RenderingContext['drawElements']>) {
        if (this.canvas instanceof HTMLCanvasElement && this.canvas.closest('.world-canvas')) draws++
        return Reflect.apply(original, this, args)
      },
    })
    Object.defineProperty(window, 'roomlingsTestDrawCalls', { get: () => draws })
  })
  await page.goto('/kitchen')
  await waitForRoomReady(page)
  const drawCalls = () => page.evaluate(() => Number(Reflect.get(window, 'roomlingsTestDrawCalls')))
  await expect.poll(drawCalls).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByRole('region', { name: 'The receipt book.' })).toBeVisible()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false')
  const pausedAt = await drawCalls()
  const refreshed = { ...populatedHousehold.household, name: 'A refreshed household name', version: populatedHousehold.household.version + 1 }
  await accounts.store.save(refreshed)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.game-house')).toContainText(refreshed.name)
  await page.waitForTimeout(250)
  expect(await drawCalls()).toBe(pausedAt)
  const latest = await accounts.store.get(refreshed.id)
  if (!latest?.roomComponents) throw new Error('The isolated household needs its persisted room components.')
  const fridge = latest.roomComponents.find((component) => component.slotId === 'kitchen-fridge')
  if (!fridge) throw new Error('The isolated household needs its original fridge.')
  fridge.finish = 'sage'
  fridge.version++
  latest.version++
  await accounts.store.save(latest)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(drawCalls).toBeGreaterThan(pausedAt)
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  const updatedAt = await drawCalls()
  await page.waitForTimeout(250)
  expect(await drawCalls()).toBe(updatedAt)
  await page.keyboard.press('Escape')
  await expect.poll(drawCalls).toBeGreaterThan(updatedAt)
})

test('the phone view gives the room most of the screen and keeps panels below it', { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/kitchen')
  await waitForRoomReady(page)
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

test('wheel zoom and the kettle respond without changing the household ledger', { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/kitchen')
  await waitForRoomReady(page)
  const before = await page.locator('.fund-trigger strong').innerText()
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await page.locator('.world-canvas canvas').hover()
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

test('header and footer wrappers are transparent while their controls keep their own surfaces', { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/kitchen')
  await waitForRoomReady(page)
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

test('touch gestures zoom and turn the room without opening an object', { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/kitchen')
  await waitForRoomReady(page)
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
