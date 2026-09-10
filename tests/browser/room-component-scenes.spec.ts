import { expect, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'
import type { Page } from '@playwright/test'
import { OrthographicCamera, Vector3 } from 'three'
import type { Box3 } from 'three'
import type { Session } from '../../shared/domain.ts'
import { componentPositionSupported, getRoomComponents } from '../../shared/roomComponents.ts'
import type { RoomComponent } from '../../shared/roomComponents.ts'
import { baseCameraOffset, cameraProjection, fitRoomBounds, roomEntryFraming, roomFramingArea } from '../../src/camera.ts'
import { roomIds } from '../../shared/rooms.ts'
import { createConfiguredRoomPreview } from '../../src/householdRoomPreview.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { componentPlacements, kitchenLayout } from '../../src/roomLayout.ts'
import { completeRoomLayout } from '../room-layout-fixture.ts'
import { chooseOption, openRoomEditor, openRoomObjects, trackDrawing } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

test('switching menus releases object focus and frames the newly selected menu', { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
  await page.goto(roomPath())
  const world = page.locator('.kitchen-world')
  const objects = await openRoomObjects(page)
  await objects.getByRole('button', { name: 'Open Plant details', exact: true }).click()
  await expect(world).toHaveAttribute('data-selected-component', 'default-kitchen-plant-floor')
  await page.getByRole('button', { name: 'Monthly budget', exact: true }).click()
  await expect(world).not.toHaveAttribute('data-selected-component', /.+/)
  await expect(world).toHaveAttribute('data-focus', 'budget')
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(world).toHaveAttribute('data-focus', 'ledger')
  await page.getByRole('button', { name: 'Chores', exact: true }).click()
  await expect(world).toHaveAttribute('data-focus', 'chores')
  await openRoomObjects(page)
  await expect(world).toHaveAttribute('data-focus', 'room')
  await objects.getByRole('button', { name: 'Open Plant details', exact: true }).click()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await expect(world).not.toHaveAttribute('data-selected-component', /.+/)
  await expect(world).toHaveAttribute('data-focus', 'room')
})

for (const roomId of ['kitchen', 'bathroom'] as const) {
  test(`the compact ${roomId} preserves its ordinary installed room without filling optional positions`, { tag: '@room' }, async ({ page, accounts, emptyHousehold }, testInfo) => {
    const before = await accounts.store.get(emptyHousehold.household.id)
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath(roomId))
    const world = page.locator('.kitchen-world')
    await world.getByRole('button', { name: 'Reset room view', exact: true }).click()
    await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    await expect(world).toHaveAttribute('data-component-count', roomId === 'kitchen' ? '20' : '6')
    await page.screenshot({ path: testInfo.outputPath(`${roomId}-default-components.png`), animations: 'disabled' })
    expect((await accounts.store.get(emptyHousehold.household.id))?.roomComponents).toEqual(before?.roomComponents)
  })

  test(`opening the palette from the ${roomId} editor frames the room and restores the draft focus`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath(roomId))
    const editor = await openRoomEditor(page)
    const name = roomId === 'kitchen' ? 'Plant' : 'Bathroom sink'
    const id = roomId === 'kitchen' ? 'default-kitchen-plant-floor' : 'default-bathroom-sink'
    await editor.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
    await editor.getByLabel('Object name', { exact: true }).fill('Keep this draft')
    const world = page.locator('.kitchen-world')
    await expect(world).toHaveAttribute('data-selected-component', id)
    await world.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(world.locator('.world-camera-controls')).toContainText('120%')
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    const before = await world.boundingBox()
    await page.locator('.house-tools').getByRole('button', { name: 'Room style', exact: true }).click()
    const palette = page.getByRole('dialog')
    await expect(palette).toBeVisible()
    await expect(world).toHaveAttribute('data-focus', 'room')
    await expect(world).toHaveAttribute('data-framing', 'whole')
    await expect(world).not.toHaveAttribute('data-selected-component', /.+/)
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    await expect.poll(() => world.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(before!.width)
    await palette.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Keep this draft')
    await expect(world).toHaveAttribute('data-selected-component', id)
    await expect(world).toHaveAttribute('data-framing', 'close')
    await expect(world.locator('.world-camera-controls')).toContainText('120%')
    expect((await accounts.store.get(owner.household.id))?.roomComponents).toEqual(owner.household.roomComponents)
  })
}

async function configureDesignedSlots(accounts: AccountHarness, session: Session, alternateModels = true) {
  const household = await accounts.store.get(session.household.id)
  if (!household) throw new Error('The isolated household was not created.')
  const components = [...getRoomComponents(household), ...completeRoomLayout().filter((component) => !component.id.startsWith('default-'))]
    .map((component): RoomComponent => {
      const variant = !alternateModels ? component.variant : component.slotId === 'bathroom-bath' ? 'shower'
        : component.slotId === 'kitchen-table' ? 'round'
          : component.slotId === 'kitchen-plant-floor' ? 'cactus'
            : component.slotId === 'kitchen-plant-counter' ? 'herbs'
              : component.kind === 'coffee-machine' ? 'filter'
                : component.kind === 'bins' ? 'recycling'
                  : component.kind === 'wall-art' ? 'geometric' : component.variant
      const state = component.kind === 'washing-machine' ? 'running'
        : component.kind === 'dish-rack' ? 'dishes-drying'
          : component.kind === 'drying-rack' ? 'drying'
            : component.kind === 'laundry-basket' ? 'filling-up' : component.state
      return { ...component, variant, state, stateChangedAt: state ? new Date().toISOString() : null, stateChangedBy: state ? session.memberId : null }
    })
  household.roomComponents = components.map((component) => componentPositionSupported(component.slotId, components) ? component : { ...component, installed: false })
  await accounts.store.save(household)
  return household.roomComponents
}

async function roomPoint(page: Page, position: [number, number, number], rotation = 0, roomBounds?: Box3) {
  const layout = await page.locator('.kitchen-world').evaluate((world) => {
    const canvas = world.querySelector('.world-canvas')!.getBoundingClientRect()
    const area = (world.querySelector('.bathroom-scene-area') ?? world).getBoundingClientRect()
    const controls = world.querySelector('.world-camera-controls')!.getBoundingClientRect()
    return {
      x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height,
      panelOpen: world.closest('.game-home')?.getAttribute('data-panel-open') === 'true',
      area: { x: area.x, y: area.y, width: area.width, height: area.height },
      controls: { x: controls.x, y: controls.y, width: controls.width, height: controls.height },
    }
  })
  const area = layout.panelOpen || roomBounds ? roomFramingArea(layout, layout.area, layout.controls)
    : { x: 0, y: 0, width: layout.width, height: layout.height }
  const framing = roomBounds ? fitRoomBounds(area.width, area.height, roomBounds, rotation)
    : roomEntryFraming(layout.width, layout.height, area, rotation)
  const projection = cameraProjection(layout.width, layout.height, area, framing.halfHeight, 1)
  const camera = new OrthographicCamera(projection.left, projection.right, projection.top, projection.bottom, 0.1, 100)
  const axis = new Vector3(0, 1, 0)
  const center = new Vector3(...framing.center)
  camera.position.copy(center).add(new Vector3(...baseCameraOffset))
  camera.lookAt(center)
  camera.updateMatrixWorld(true)
  const projected = new Vector3(...position).applyAxisAngle(axis, rotation).project(camera)
  return { x: layout.x + (projected.x * 0.5 + 0.5) * layout.width, y: layout.y + (-projected.y * 0.5 + 0.5) * layout.height }
}

test('the inward-facing dishwasher stays reachable after turning the connected return', { tag: '@room' }, async ({ page, accounts, emptyHousehold }) => {
  const components = await configureDesignedSlots(accounts, emptyHousehold, false)
  const model = createConfiguredRoomPreview('kitchen', 'original', components)
  const dishwasher = model.componentScene.componentAtSlot('kitchen-undercounter')!
  let point: [number, number, number]
  try {
    point = model.componentScene.actors.get(dishwasher.id)!.localToWorld(new Vector3(0, 0.72, 0.67)).toArray()
  } finally {
    model.dispose()
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath())
  const world = page.locator('.kitchen-world')
  await world.getByRole('button', { name: 'Reset room view', exact: true }).click()
  await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  const canvas = (await world.locator('canvas').boundingBox())!
  const x = canvas.x + canvas.width * 0.35
  const y = canvas.y + canvas.height * 0.7
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 220, y, { steps: 12 })
  await page.mouse.up()
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await expect(page.locator('.room-panel')).toHaveCount(0)
  const screen = await roomPoint(page, point, 0.75)
  await page.mouse.click(screen.x, screen.y)
  await expect(world).toHaveAttribute('data-selected-component', dishwasher.id)
  await expect(page.getByRole('region', { name: `${dishwasher.name} manual state`, exact: true })).toBeVisible()
})

test('the kettle on the relocated stove keeps its physical tea-break action', { tag: '@room' }, async ({ page, accounts, emptyHousehold }) => {
  await configureDesignedSlots(accounts, emptyHousehold, false)
  const before = await accounts.store.get(emptyHousehold.household.id)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath())
  const world = page.locator('.kitchen-world')
  await world.getByRole('button', { name: 'Reset room view', exact: true }).click()
  await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  const point: [number, number, number] = [kitchenLayout.kettle[0], kitchenLayout.kettle[1] + 0.2, kitchenLayout.kettle[2]]
  const screen = await roomPoint(page, point)
  await page.mouse.click(screen.x, screen.y)
  await expect(world).toHaveAttribute('data-focus', 'brew')
  await expect(world.locator('.world-kettle-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.room-panel')).toHaveCount(0)
  expect(await accounts.store.get(emptyHousehold.household.id)).toEqual(before)
})

test('the live kitchen connects the sink counter to the right return and leaves the former island space open', { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath('kitchen'))
  const editor = await openRoomEditor(page)
  const world = page.locator('.kitchen-world')
  const model = createConfiguredRoomPreview('kitchen', 'original')
  const bounds = model.componentScene.bounds.clone()
  model.dispose()
  await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  const join = await roomPoint(page, [4.5, 1.735, -1.905], 0, bounds)
  await page.mouse.click(join.x, join.y)
  await expect(world).toHaveAttribute('data-selected-component', 'default-kitchen-counters')
  await editor.getByRole('button', { name: 'All room objects', exact: true }).click()
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  await expect(world).not.toHaveAttribute('data-selected-component', /.+/)
  const openFloor = await roomPoint(page, [-1.6, 0.005, 1.175], 0, bounds)
  await page.mouse.click(openFloor.x, openFloor.y)
  await expect(world).not.toHaveAttribute('data-selected-component', /.+/)
})

test('Edit room keeps its canvas, isolates color-only changes and never runs the bag action', { tag: '@room' }, async ({ page, populatedHousehold, accounts }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.clock.setFixedTime(new Date())
  const drawing = await trackDrawing(page)
  await page.goto(roomPath())
  const world = page.locator('.kitchen-world')
  const canvas = world.locator('canvas')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await canvas.evaluate((element) => element.setAttribute('data-original-renderer', 'kept'))
  const originalComponents = getRoomComponents(populatedHousehold.household)
  await openRoomEditor(page)
  const editor = page.getByRole('region', { name: 'Edit Kitchen objects', exact: true })
  await expect(world.locator('[data-component-id="default-kitchen-plant-floor"] .hotspot-label')).toHaveText('Plant, Floor planter')
  await expect(world.locator('[data-component-id="default-kitchen-plant-counter"] .hotspot-label')).toHaveText('Plant, Counter planter')
  await editor.getByRole('button', { name: 'Edit Fridge', exact: true }).click()
  await expect(world).toHaveAttribute('data-selected-component', 'default-kitchen-fridge')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  const beforeFinish = await drawing()
  await chooseOption(editor.getByRole('combobox', { name: 'Finish', exact: true }), 'tomato')
  await editor.getByLabel('Object name', { exact: true }).fill('Cold corner')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(beforeFinish.draws)
  expect((await drawing()).shadows).toBe(beforeFinish.shadows)
  await expect(canvas).toHaveAttribute('data-original-renderer', 'kept')

  await editor.getByRole('button', { name: 'All room objects', exact: true }).click()
  await editor.getByRole('button', { name: /^Edit Plant/ }).first().click()
  const beforeModel = await drawing()
  await chooseOption(editor.getByRole('combobox', { name: 'Model', exact: true }), 'cactus')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await expect.poll(async () => (await drawing()).shadows).toBeGreaterThan(beforeModel.shadows)
  await expect(canvas).toHaveAttribute('data-original-renderer', 'kept')

  await editor.getByRole('button', { name: 'All room objects', exact: true }).click()
  await editor.getByRole('button', { name: 'Edit Kettle', exact: true }).click()
  await editor.getByRole('button', { name: 'Remove object', exact: true }).click()
  await editor.getByRole('button', { name: 'Remove from preview', exact: true }).click()
  await expect(world.locator('[data-component-id="default-kitchen-kettle"]')).toHaveCount(0)
  await expect(world).toHaveAttribute('data-component-count', String(originalComponents.filter((component) => component.roomId === 'kitchen').length - 1))

  await world.getByRole('button', { name: 'Reset room view', exact: true }).click()
  await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  const bag = await roomPoint(page, [kitchenLayout.stock[0], kitchenLayout.stock[1] + 0.36, kitchenLayout.stock[2] + 0.2])
  await page.mouse.click(bag.x, bag.y)
  await expect(world).toHaveAttribute('data-selected-component', 'default-kitchen-shopping-bag')
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Shopping bag')
  await expect(page.getByRole('region', { name: 'The shopping bag.', exact: true })).toHaveCount(0)
  await expect(world).toHaveAttribute('data-edit-mode', 'true')

  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(world).toHaveAttribute('data-edit-mode', 'false')
  await expect(world.getByRole('button', { name: 'Put the kettle on', exact: true })).toBeVisible()
  await expect(canvas).toHaveAttribute('data-original-renderer', 'kept')
  expect(getRoomComponents((await accounts.store.get(populatedHousehold.household.id))!)).toEqual(originalComponents)
})

for (const roomId of roomIds) {
  test(`all compatible ${roomId} kinds fit with their original models`, { tag: '@room' }, async ({ page, accounts, emptyHousehold }, testInfo) => {
    const components = await configureDesignedSlots(accounts, emptyHousehold, false)
    const installed = components.filter((component) => component.roomId === roomId && component.installed)
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath(roomId))
    const world = page.locator('.kitchen-world')
    await world.getByRole('button', { name: 'Reset room view', exact: true }).click()
    await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    await expect(world).toHaveAttribute('data-component-count', String(installed.length))
    expect(installed.length).toBe(roomId === 'kitchen' ? 66 : roomId === 'bathroom' ? 34 : 18)
    await page.screenshot({ path: testInfo.outputPath(`${roomId}-all-components-original.png`), animations: 'disabled' })
  })

  test(`the complete designed ${roomId} configuration renders and keeps saved previews private`, { tag: '@room' }, async ({ page, accounts, emptyHousehold }, testInfo) => {
    const failures: string[] = []
    page.on('pageerror', (error) => failures.push(error.message))
    const components = await configureDesignedSlots(accounts, emptyHousehold)
    const installed = components.filter((component) => component.roomId === roomId && component.installed)
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath(roomId))
    const world = page.locator('.kitchen-world')
    await expect(world).toHaveAttribute('data-component-count', String(installed.length))
    await world.getByRole('button', { name: 'Reset room view', exact: true }).click()
    await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    await expect(world.locator('canvas')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath(`${roomId}-designed-components.png`), animations: 'disabled' })

    await page.getByRole('button', { name: 'Room objects', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Installed room objects', exact: true }).getByRole('button')).toHaveCount(new Set(installed.map((component) => component.kind)).size)
    await page.getByRole('button', { name: 'Close panel', exact: true }).click()
    await page.getByRole('button', { name: 'Rooms', exact: true }).click()
    const picker = page.getByRole('menu', { name: 'Rooms', exact: true })
    await expect(picker.getByRole('group', { name: 'Choose a room', exact: true })).toHaveAttribute('data-preview-source', 'saved')
    await expect.poll(() => picker.locator('img').evaluateAll((images) => images.every((image) =>
      image instanceof HTMLImageElement && image.src.startsWith('data:image/png;') && image.complete && image.naturalWidth > 0))).toBe(true)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 390, height: 844 })
    await world.getByRole('button', { name: 'Reset room view', exact: true }).click()
    await expect(world).toHaveAttribute('data-framing', 'close')
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${roomId}-designed-components-narrow.png`), animations: 'disabled' })
    await page.goto('/#tour')
    await expect(page.locator('.welcome-preview-choice img')).toHaveCount(roomIds.length)
    expect(await page.locator('.welcome-preview-choice img').evaluateAll((images) => images.every((image) =>
      image instanceof HTMLImageElement && !image.src.startsWith('data:') && /\/(?:assets|src)\//.test(image.src)))).toBe(true)
    await expect(page.locator('[data-preview-source="saved"]')).toHaveCount(0)
    expect(failures).toEqual([])
  })

  if (roomId !== 'living-room') test(`the expanded ${roomId} object opens from its mesh and saves its own manual state`, { tag: '@room' }, async ({ page, accounts, emptyHousehold }) => {
    const drawing = await trackDrawing(page)
    const components = await configureDesignedSlots(accounts, emptyHousehold)
    const slotId = roomId === 'kitchen' ? 'kitchen-stand-mixer' : 'bathroom-dryer'
    const component = components.find((component) => component.slotId === slotId)!
    const before = await accounts.store.get(emptyHousehold.household.id)
    const placement = componentPlacements[slotId]!
    const point = (roomId === 'kitchen' ? new Vector3(-0.02, 0.615, 0) : new Vector3(0, 0.73, 0.73))
      .applyAxisAngle(new Vector3(0, 1, 0), placement.rotation ?? 0)
      .add(new Vector3(...placement.position)).toArray()
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath(roomId))
    const world = page.locator('.kitchen-world')
    await world.getByRole('button', { name: 'Reset room view', exact: true }).click()
    await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    const screen = await roomPoint(page, point)
    await page.mouse.click(screen.x, screen.y)
    await expect(world).toHaveAttribute('data-selected-component', component.id)
    await expect(page.getByRole('region', { name: `${component.name} manual state`, exact: true })).toBeVisible()
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    const beforeState = await drawing()
    const state = roomId === 'kitchen' ? 'needs-cleaning' : 'running'
    await chooseOption(page.getByRole('combobox', { name: 'Manual state', exact: true }), state)
    await expect.poll(async () => getRoomComponents((await accounts.store.get(emptyHousehold.household.id))!)
      .find((item) => item.id === component.id)?.state).toBe(state)
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    if (roomId === 'bathroom') expect((await drawing()).shadows).toBeGreaterThan(beforeState.shadows)
    else expect((await drawing()).shadows).toBe(beforeState.shadows)
    const saved = await accounts.store.get(emptyHousehold.household.id)
    expect(saved?.expenses).toEqual(before?.expenses)
    expect(saved?.settlements).toEqual(before?.settlements)
    expect(saved?.shopping).toEqual(before?.shopping)
    expect(saved?.chores).toEqual(before?.chores)
    await page.reload()
    const objects = await openRoomObjects(page)
    await objects.getByRole('button', { name: `Open ${component.name} details`, exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Manual state', exact: true })).toHaveAttribute('data-value', state)
    await expect(world).toHaveAttribute('data-selected-component', component.id)
  })
}

test('configured objects remain reachable without WebGL and saved previews never substitute public rooms', { tag: '@room' }, async ({ page, accounts, emptyHousehold }) => {
  const components = await configureDesignedSlots(accounts, emptyHousehold)
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, name: string, ...options: unknown[]) {
      if (name === 'webgl' || name === 'webgl2') return null
      return Reflect.apply(getContext, this, [name, ...options])
    } as typeof getContext
  })
  await page.goto(roomPath())
  await expect(page.getByText('Your kitchen, minus the 3D.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Room objects', exact: true }).click()
  const objects = page.getByRole('list', { name: 'Installed room objects', exact: true })
  await expect(objects.getByRole('button')).toHaveCount(new Set(components.filter((component) => component.roomId === 'kitchen' && component.installed).map((component) => component.kind)).size)
  await objects.getByRole('button', { name: 'Open Coffee machine details', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Coffee machine manual state', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.getByRole('button', { name: 'Rooms', exact: true }).click()
  const picker = page.getByRole('menu', { name: 'Rooms', exact: true })
  await expect(picker.getByText('3D preview unavailable', { exact: true })).toHaveCount(roomIds.length)
  expect(await picker.locator('img').evaluateAll((images) => images.every((image) => !image.getAttribute('src')))).toBe(true)
  await picker.getByRole('menuitemradio', { name: 'Open Bathroom', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('The 3D bathroom is unavailable.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Room objects', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Installed room objects', exact: true }).getByRole('button'))
    .toHaveCount(new Set(components.filter((component) => component.roomId === 'bathroom' && component.installed).map((component) => component.kind)).size)
})
