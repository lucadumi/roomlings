import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Box3, Mesh, OrthographicCamera, Raycaster, Vector2, Vector3 } from 'three'
import { balances } from '../../shared/domain.ts'
import { createRoomComponent, getRoomComponents } from '../../shared/roomComponents.ts'
import { baseCameraOffset, cameraProjection, roomCameraZoom, roomEntryFraming, roomFramingArea } from '../../src/camera.ts'
import { createConfiguredRoomPreview } from '../../src/householdRoomPreview.ts'
import { isSceneObjectVisible } from '../../src/roomComponentScene.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { expect, test } from './account-fixtures.ts'
import { chooseOption, openRoomEditor, openRoomObjects, selectRoom, trackDrawing } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

async function frameRoom(page: Page) {
  await page.getByRole('button', { name: 'Reset room view', exact: true }).click()
  const world = page.locator('.living-room-world')
  await expect(world).toHaveAttribute('data-focus', 'room')
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
}

async function objectPoint(page: Page, id: string) {
  const layout = await page.locator('.living-room-world .world-canvas').evaluate((element) => {
    const canvas = element.getBoundingClientRect()
    const stage = element.previousElementSibling?.getBoundingClientRect()
    if (!stage) throw new Error('The measured living room scene area is missing.')
    const controls = element.parentElement!.querySelector('.world-camera-controls')!.getBoundingClientRect()
    return { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height,
      panelOpen: element.closest('.game-home')?.getAttribute('data-panel-open') === 'true',
      area: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
      controls: { x: controls.x, y: controls.y, width: controls.width, height: controls.height },
    }
  })
  const preview = createConfiguredRoomPreview('living-room', 'original')
  try {
    preview.scene.updateMatrixWorld(true)
    const area = layout.panelOpen ? roomFramingArea(layout, layout.area, layout.controls)
      : { x: 0, y: 0, width: layout.width, height: layout.height }
    const frame = roomEntryFraming(layout.width, layout.height, area)
    const zoom = roomCameraZoom(1, true)
    const projection = cameraProjection(layout.width, layout.height, area, frame.halfHeight, zoom)
    const camera = new OrthographicCamera(projection.left, projection.right, projection.top, projection.bottom, 0.1, 100)
    camera.zoom = zoom
    camera.updateProjectionMatrix()
    const center = new Vector3(...frame.center)
    camera.position.copy(center).add(new Vector3(...baseCameraOffset))
    camera.lookAt(center)
    camera.updateMatrixWorld(true)
    const actor = id === 'window' ? preview.room.getObjectByName('Recessed lounge window') : preview.componentScene.actors.get(id)
    if (!actor) throw new Error('The requested living room object is missing.')
    const raycaster = new Raycaster()
    const points: Vector3[] = []
    actor.traverseVisible((object) => {
      if (object instanceof Mesh) points.push(new Box3().setFromObject(object).getCenter(new Vector3()).project(camera))
    })
    const point = points.find((point) => {
      raycaster.setFromCamera(new Vector2(point.x, point.y), camera)
      const hit = raycaster.intersectObject(preview.room, true).find(({ object }) => isSceneObjectVisible(object, preview.room))
      if (!hit) return false
      if (id === 'window') {
        for (let object = hit.object; object !== preview.room && object.parent; object = object.parent) {
          if (object.userData.roomLightSwitch) return true
        }
        return false
      }
      return preview.componentScene.componentForObject(hit.object)?.id === id
    })
    if (!point) throw new Error('The living room object needs a visible, pickable surface.')
    return { x: layout.x + (point.x * 0.5 + 0.5) * layout.width, y: layout.y + (-point.y * 0.5 + 0.5) * layout.height }
  } finally { preview.dispose() }
}

test('the living room opens at the shared room scale and preserves the household across navigation', { tag: '@room' }, async ({ page, accounts, populatedHousehold }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const before = await accounts.store.get(populatedHousehold.household.id)
  await page.goto(roomPath('living-room'))
  const world = page.locator('.living-room-world')
  await expect(world.locator('canvas')).toBeVisible()
  await expect(world).toHaveAttribute('data-focus', 'room')
  await expect(world).toHaveAttribute('data-framing', 'close')
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toContainText('Living room')
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  await page.screenshot({ path: testInfo.outputPath('living-room-opening.png'), animations: 'disabled' })
  await frameRoom(page)
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('living-room-whole.png'), animations: 'disabled' })
  await selectRoom(page, 'kitchen')
  await expect(world).toHaveCount(0)
  await selectRoom(page, 'bathroom')
  await expect(page.locator('.bathroom-world canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Rooms', exact: true }).click()
  await page.keyboard.press('End')
  await expect(page.getByRole('menuitemradio', { name: 'Open Living room', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${roomPath('living-room')}$`))
  await expect(world.locator('canvas')).toHaveCount(1)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`${roomPath('bathroom')}$`))
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(populatedHousehold.token)
  expect(await accounts.store.get(populatedHousehold.household.id)).toEqual(before)
})

test('the living room window switches day and night without opening chores or changing household data', { tag: '@room' }, async ({ page, accounts, populatedHousehold }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const before = await accounts.store.get(populatedHousehold.household.id)
  await page.goto(roomPath('living-room'))
  await frameRoom(page)
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  const window = await objectPoint(page, 'window')
  await page.mouse.click(window.x, window.y)
  const world = page.locator('.living-room-world')
  await expect(world).toHaveAttribute('data-evening', 'true')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await expect(world.getByRole('button', { name: 'Switch to daylight', exact: true })).toBeVisible()
  await expect(page.locator('.room-panel')).toHaveCount(0)
  await page.mouse.click(window.x, window.y)
  await expect(world).toHaveAttribute('data-evening', 'false')
  await expect(world).toHaveAttribute('data-focus', 'room')
  expect(await accounts.store.get(populatedHousehold.household.id)).toEqual(before)
})

test('the sofa and TV remain directly pickable with their labels hidden', { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath('living-room'))
  await frameRoom(page)
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  const sofa = await objectPoint(page, 'default-living-room-sofa')
  await page.mouse.click(sofa.x, sofa.y)
  await expect(page.getByRole('combobox', { name: 'Chore area', exact: true })).toHaveAttribute('data-value', 'seating')
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await frameRoom(page)
  const television = await objectPoint(page, 'default-living-room-tv')
  await page.mouse.click(television.x, television.y)
  await expect(page.locator('.room-objects-panel').getByRole('heading', { name: 'TV', exact: true })).toBeVisible()
})

test('living room objects open their own chore areas and shared supply shortcuts', { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath('living-room'))
  for (const [target, area] of [['sofa', 'seating'], ['surfaces', 'surfaces'], ['plants', 'plants'], ['floor', 'floor'], ['bins', 'bins']]) {
    await frameRoom(page)
    await page.locator(`[data-living-room-target="${target}"]`).click()
    await expect(page.getByRole('region', { name: 'Household chores.', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Chore room', exact: true })).toHaveAttribute('data-value', 'living-room')
    await expect(page.getByRole('combobox', { name: 'Chore area', exact: true })).toHaveAttribute('data-value', area)
    await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  }
  await frameRoom(page)
  await page.locator('[data-living-room-target="chores"]').click()
  await expect(page.getByRole('combobox', { name: 'Chore area', exact: true })).toHaveAttribute('data-value', '')
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await frameRoom(page)
  await page.locator('[data-living-room-target="supplies"]').click()
  await expect(page.getByRole('region', { name: 'Living room supplies.', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restock Floor cleaner', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('Item name', { exact: true })).toHaveValue('Floor cleaner')
})

test('removed and substituted living room objects expose only their actual actions', { tag: '@room' }, async ({ page, accounts, emptyHousehold }) => {
  const household = await accounts.store.get(emptyHousehold.household.id)
  if (!household) throw new Error('The isolated household is missing.')
  const purifier = createRoomComponent('air-purifier', 'living-room-plant', randomUUID())
  household.roomComponents = [...getRoomComponents(household).map((component) =>
    component.id === 'default-living-room-plant' || component.id === 'default-living-room-tv'
      ? { ...component, installed: false } : component), purifier]
  await accounts.store.save(household)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath('living-room'))
  await frameRoom(page)
  const world = page.locator('.living-room-world')
  await expect(world.locator('[data-living-room-target="plants"]')).toHaveCount(0)
  await expect(world.locator('[data-component-id="default-living-room-tv"]')).toHaveCount(0)
  const object = world.getByRole('button', { name: 'Open Air purifier', exact: true })
  await object.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.room-objects-panel').getByRole('heading', { name: 'Air purifier', exact: true })).toBeVisible()
  await expect(page.locator('.room-objects-panel')).not.toContainText('Water the plant')
})

test('living room drafts stay private through cancellation and failed saves and persist after applying', { tag: '@room' }, async ({ page, accounts, populatedHousehold }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath('living-room'))
  const original = await accounts.store.get(populatedHousehold.household.id)
  if (!original) throw new Error('The isolated household is missing.')
  const editor = await openRoomEditor(page)
  await editor.getByRole('button', { name: 'Edit Sofa', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('A private sofa')
  await chooseOption(editor.getByRole('combobox', { name: 'Model', exact: true }), 'straight')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await accounts.store.get(original.id)).toEqual(original)

  await openRoomEditor(page)
  await editor.getByRole('button', { name: 'Edit Sofa', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('Our reading sofa')
  await chooseOption(editor.getByRole('combobox', { name: 'Model', exact: true }), 'straight')
  await chooseOption(editor.getByRole('combobox', { name: 'Finish', exact: true }), 'tomato')
  await page.route('**/api/household/room-components', async (route) => {
    await route.fulfill({ status: 503, json: { error: 'The room could not be saved. Try again.' } })
  })
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('The room could not be saved')
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Our reading sofa')
  expect(await accounts.store.get(original.id)).toEqual(original)
  await page.unroute('**/api/household/room-components')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const saved = await accounts.store.get(original.id)
  if (!saved) throw new Error('The saved household is missing.')
  expect(getRoomComponents(saved).find((component) => component.id === 'default-living-room-sofa'))
    .toMatchObject({ name: 'Our reading sofa', variant: 'straight', finish: 'tomato', version: 1 })
  expect(saved.roomComponents?.filter((component) => component.roomId !== 'living-room'))
    .toEqual(original.roomComponents?.filter((component) => component.roomId !== 'living-room'))
  expect(saved.expenses).toEqual(original.expenses)
  expect(saved.chores).toEqual(original.chores)
  expect(balances(saved)).toEqual(balances(original))
  await page.reload()
  await openRoomEditor(page)
  await editor.getByRole('button', { name: 'Edit Our reading sofa', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'Model', exact: true })).toHaveAttribute('data-value', 'straight')
  await expect(editor.getByRole('combobox', { name: 'Finish', exact: true })).toHaveAttribute('data-value', 'tomato')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(populatedHousehold.token)
})

test('sofa state, supply shopping and completed care stay separate from shared balances', { tag: '@room' }, async ({ page, accounts, emptyHousehold }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath('living-room'))
  const objects = await openRoomObjects(page)
  await objects.getByRole('button', { name: 'Open Sofa details', exact: true }).click()
  await chooseOption(objects.getByRole('combobox', { name: 'Manual state', exact: true }), 'needs-tidying')
  await objects.getByRole('button', { name: 'Restock Upholstery cleaner', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Add to shopping list', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await objects.getByRole('button', { name: 'Add Vacuum the sofa', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Room object', exact: true })).toHaveAttribute('data-value', 'default-living-room-sofa')
  await dialog.getByRole('button', { name: 'Create chore', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await objects.getByRole('button', { name: 'Open object chores', exact: true }).click()
  await page.getByRole('article', { name: 'Vacuum the sofa', exact: true }).getByRole('button', { name: 'Mark done', exact: true }).click()
  await dialog.getByRole('button', { name: 'Record completion', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const saved = await accounts.store.get(emptyHousehold.household.id)
  if (!saved) throw new Error('The saved household is missing.')
  expect(saved.chores.history[0]).toMatchObject({ roomId: 'living-room', area: 'seating', componentId: 'default-living-room-sofa' })
  expect(saved.shopping.items[0].componentSources?.[0]).toMatchObject({ roomId: 'living-room', componentId: 'default-living-room-sofa' })
  expect(getRoomComponents(saved).find((component) => component.id === 'default-living-room-sofa')?.state).toBe('needs-tidying')
  expect(saved.expenses).toEqual([])
  expect(saved.settlements).toEqual([])
})

test('living room rendering sleeps and reuses shadows when only the camera or finish changes', { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
  const drawing = await trackDrawing(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath('living-room'))
  const world = page.locator('.living-room-world')
  await frameRoom(page)
  const idle = await drawing()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await drawing()).toEqual(idle)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  expect((await drawing()).shadows).toBe(idle.shadows)
  await world.locator('canvas').evaluate((canvas) => canvas.setAttribute('data-original-living-room', 'true'))
  await page.getByRole('button', { name: 'Room style', exact: true }).click()
  await page.getByRole('radio', { name: 'Clay', exact: true }).check()
  const before = await drawing()
  await page.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(world).toHaveAttribute('data-room-style', 'clay')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await expect(world.locator('canvas')).toHaveAttribute('data-original-living-room', 'true')
  expect((await drawing()).shadows).toBe(before.shadows)
  await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
  await expect(world).toHaveAttribute('data-evening', 'true')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
})

test('living room context loss keeps chores, shopping and object details available', { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
  await page.goto(roomPath('living-room'))
  await expect(page.locator('.living-room-world canvas')).toBeVisible()
  await page.locator('.living-room-world canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The living room canvas is missing.')
    const loss = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    if (!loss) throw new Error('The browser cannot simulate a lost context.')
    loss.loseContext()
  })
  await expect(page.getByText('The 3D living room is unavailable.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Room chores', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Chore room', exact: true })).toHaveAttribute('data-value', 'living-room')
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.getByRole('button', { name: 'Restock supplies', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restock Floor cleaner', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  const objects = await openRoomObjects(page)
  await objects.getByRole('button', { name: 'Open TV details', exact: true }).click()
  await expect(objects.getByRole('heading', { name: 'TV', exact: true })).toBeVisible()
  await expect(objects.getByRole('button', { name: 'Add Dust the TV and remote', exact: true })).toBeVisible()
})

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`living room controls fit at ${viewport.width}x${viewport.height}`, { tag: '@room' }, async ({ page, populatedHousehold: _household }) => {
    await page.setViewportSize(viewport)
    await page.goto(roomPath('living-room'))
    await expect(page.locator('.living-room-world canvas')).toBeVisible()
    await frameRoom(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toBeInViewport({ ratio: 1 })
    await page.getByRole('button', { name: 'Chores', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Household chores.', exact: true })).toBeVisible()
    await expect(page.locator('.living-room-world')).toHaveAttribute('data-camera-moving', 'false')
    await page.getByRole('button', { name: 'Close panel', exact: true }).click()
    await page.getByRole('button', { name: 'How to play', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Your shared living room.', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).not.toContainText('Peek in the fridge')
  })
}

test('the living room landing tour has working chapters without reading or replacing household access', { tag: '@room' }, async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url())
  })
  await page.goto('/#living-room-sofa')
  const tour = page.locator('#tour')
  await expect(tour).toHaveAttribute('data-room', 'living-room')
  await expect(tour).toHaveAttribute('data-scene', 'ready')
  await expect(tour).toHaveAttribute('data-chapter', 'living-room-sofa')
  await expect(tour.getByRole('radio', { name: 'Living room', exact: true })).toBeChecked()
  const navigation = tour.getByRole('navigation', { name: 'Living room tour', exact: true })
  await navigation.getByRole('button', { name: 'Supply shelf', exact: true }).click()
  await expect(tour).toHaveAttribute('data-chapter', 'living-room-supplies')
  await expect(tour.locator('.welcome-tour-copy[data-active="true"]')).toContainText('No cost is recorded')
  await expect(tour.locator('.living-room-preview-world')).toHaveAttribute('data-rendering', 'paused')
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1440, height: 960 }]) {
    await page.setViewportSize(viewport)
    await navigation.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await expect(navigation).toBeInViewport({ ratio: 1 })
    expect(await tour.locator('.welcome-tour-pin').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect(apiRequests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})
