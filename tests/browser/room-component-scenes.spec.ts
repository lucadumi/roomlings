import { expect, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'
import type { Page } from '@playwright/test'
import { OrthographicCamera, Vector3 } from 'three'
import type { Session } from '../../shared/domain.ts'
import { componentPositionSupported, createRoomComponent, getRoomComponents, roomSlots } from '../../shared/roomComponents.ts'
import type { RoomComponent } from '../../shared/roomComponents.ts'
import { baseCameraOffset, cameraFraming, cameraProjection } from '../../src/camera.ts'
import { createConfiguredRoomPreview } from '../../src/householdRoomPreview.ts'
import { roomPath } from '../../src/roomNavigation.ts'
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

async function configureDesignedSlots(accounts: AccountHarness, session: Session) {
  const household = await accounts.store.get(session.household.id)
  if (!household) throw new Error('The isolated household was not created.')
  const components = [...getRoomComponents(household), ...roomSlots.filter((slot) => !slot.defaultKind).map((slot) =>
    createRoomComponent(slot.kinds[0], slot.id, `render-${slot.id}`))]
    .map((component): RoomComponent => {
      const variant = component.slotId === 'bathroom-bath' ? 'shower'
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

async function kitchenPoint(page: Page, components: readonly RoomComponent[], position: [number, number, number]) {
  const layout = await page.locator('.kitchen-world').evaluate((world) => {
    const canvas = world.querySelector('.world-canvas')!.getBoundingClientRect()
    const area = world.getBoundingClientRect()
    return {
      x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height,
      area: { x: area.x - canvas.x, y: area.y - canvas.y, width: area.width, height: area.height },
    }
  })
  const model = createConfiguredRoomPreview('kitchen', 'original', components)
  try {
    const framing = cameraFraming(layout.area.width, layout.area.height, 'room', true, { bounds: model.componentScene.bounds })
    const projection = cameraProjection(layout.width, layout.height, layout.area, framing.halfHeight, 1)
    const camera = new OrthographicCamera(projection.left, projection.right, projection.top, projection.bottom, 0.1, 100)
    const center = new Vector3(...framing.center)
    camera.position.copy(center).add(new Vector3(...baseCameraOffset))
    camera.lookAt(center)
    camera.updateMatrixWorld(true)
    const projected = new Vector3(...position).project(camera)
    return { x: layout.x + (projected.x * 0.5 + 0.5) * layout.width, y: layout.y + (-projected.y * 0.5 + 0.5) * layout.height }
  } finally {
    model.dispose()
  }
}

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

  await world.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
  await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  const bag = await kitchenPoint(page, originalComponents, [-0.4, 1.87, 1.3])
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

for (const roomId of ['kitchen', 'bathroom'] as const) {
  test(`the complete designed ${roomId} configuration renders and keeps saved previews private`, { tag: '@room' }, async ({ page, accounts, emptyHousehold }, testInfo) => {
    const failures: string[] = []
    page.on('pageerror', (error) => failures.push(error.message))
    const components = await configureDesignedSlots(accounts, emptyHousehold)
    const installed = components.filter((component) => component.roomId === roomId && component.installed)
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath(roomId))
    const world = page.locator('.kitchen-world')
    await expect(world).toHaveAttribute('data-component-count', String(installed.length))
    await world.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
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
    await world.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
    await expect(world).toHaveAttribute('data-framing', 'whole')
    await expect(world).toHaveAttribute('data-camera-moving', 'false')
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${roomId}-designed-components-narrow.png`), animations: 'disabled' })
    await page.goto('/#tour')
    await expect(page.locator('.welcome-preview-choice img')).toHaveCount(2)
    expect(await page.locator('.welcome-preview-choice img').evaluateAll((images) => images.every((image) =>
      image instanceof HTMLImageElement && !image.src.startsWith('data:') && /\/(?:assets|src)\//.test(image.src)))).toBe(true)
    await expect(page.locator('[data-preview-source="saved"]')).toHaveCount(0)
    expect(failures).toEqual([])
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
  await expect(picker.getByText('3D preview unavailable', { exact: true })).toHaveCount(2)
  expect(await picker.locator('img').evaluateAll((images) => images.every((image) => !image.getAttribute('src')))).toBe(true)
  await picker.getByRole('menuitemradio', { name: 'Open Bathroom', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('The 3D bathroom is unavailable.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Room objects', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Installed room objects', exact: true }).getByRole('button'))
    .toHaveCount(new Set(components.filter((component) => component.roomId === 'bathroom' && component.installed).map((component) => component.kind)).size)
})
