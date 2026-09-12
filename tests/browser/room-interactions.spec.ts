import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { componentChoreArea, createRoomComponent, getRoomComponents } from '../../shared/roomComponents.ts'
import { roomIds } from '../../shared/rooms.ts'
import { normalizeRoomRotation } from '../../src/camera.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { openRoomEditor, openRoomObjects, trackDrawing } from './fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

async function turnRoom(page: Page, amount: number) {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Room rotation needs a measured viewport.')
  const direction = Math.sign(amount)
  const steps = Math.ceil(Math.abs(amount) / (viewport.width * 0.5 * 0.004))
  const angle = Math.abs(amount) / steps
  for (let step = 0; step < steps; step++) {
    const start = viewport.width * (direction > 0 ? 0.25 : 0.75)
    const y = viewport.height * 0.55
    await page.mouse.move(start, y)
    await page.mouse.down()
    await page.mouse.move(start + direction * angle / 0.004, y)
    await page.mouse.up()
  }
  await page.mouse.move(5, 5)
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
}

for (const roomId of roomIds) for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`${roomId} rotates beyond a full turn with opposite walls visible at ${viewport.width}px`, { tag: '@room' }, async ({ page, emptyHousehold: _owner }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.clock.setFixedTime(new Date())
    const drawing = await trackDrawing(page)
    await page.goto(roomPath(roomId))
    const world = page.locator('.kitchen-world')
    const canvas = world.locator('canvas')
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-hidden-walls', 'front,right')
    const initial = await drawing()
    for (const [index, hidden] of ['left,front', 'back,left', 'back,right', 'front,right', 'left,front'].entries()) {
      await turnRoom(page, Math.PI / 2)
      await expect(canvas).toHaveAttribute('data-hidden-walls', hidden)
      const angle = Number(await canvas.getAttribute('data-room-rotation'))
      expect(Math.abs(normalizeRoomRotation(angle - (index + 1) * Math.PI / 2))).toBeLessThan(0.0001)
      if (viewport.width === 1440 && index < 4) await page.screenshot({ path: testInfo.outputPath(`${roomId}-angle-${index + 1}.png`), animations: 'disabled' })
    }
    expect((await drawing()).shadows).toBeGreaterThan(initial.shadows)
    const turned = await drawing()
    await world.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    await expect(canvas).toHaveAttribute('data-hidden-walls', 'left,front')
    expect((await drawing()).shadows).toBe(turned.shadows)
    await world.getByRole('button', { name: 'Reset room view', exact: true }).click()
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    await expect(canvas).toHaveAttribute('data-hidden-walls', 'front,right')
    expect(Math.abs(Number(await canvas.getAttribute('data-room-rotation')))).toBeLessThan(0.0001)
    await expect(world.locator('.world-camera-controls > span')).toHaveText('100%')
    await expect(page.locator('.room-panel')).toHaveCount(0)
  })
}

for (const roomId of roomIds) {
  test(`${roomId} keeps wall cutaways after discarding an object trial`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    const before = await accounts.store.get(owner.household.id)
    await page.goto(roomPath(roomId))
    const editor = await openRoomEditor(page)
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    const name = roomId === 'kitchen' ? 'Dishwasher' : roomId === 'bathroom' ? 'Washing machine' : 'Record player'
    await editor.getByRole('button', { name: `Preview ${name}`, exact: true }).click()
    const canvas = page.locator('.world-canvas canvas')
    await expect(canvas).toHaveAttribute('data-placement-arrow', 'true')
    await turnRoom(page, Math.PI)
    const hidden = await canvas.getAttribute('data-hidden-walls')
    expect(hidden).toBeTruthy()
    await page.getByRole('dialog', { name: `Try ${name}`, exact: true }).getByRole('button', { name: 'Discard preview', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-placement-arrow', 'false')
    await expect(canvas).toHaveAttribute('data-hidden-walls', hidden!)
    expect(await accounts.store.get(owner.household.id)).toEqual(before)
  })

  test(`${roomId} default and added component plus markers open their chores rather than editing`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
    const household = await accounts.store.get(owner.household.id)
    if (!household) throw new Error('The isolated household is missing.')
    const added = roomId === 'kitchen' ? createRoomComponent('coffee-machine', 'kitchen-coffee', randomUUID())
      : roomId === 'bathroom' ? createRoomComponent('washing-machine', 'bathroom-laundry', randomUUID())
        : createRoomComponent('speaker', 'living-room-media-accessory', randomUUID())
    household.roomComponents = [...getRoomComponents(household), added]
    await accounts.store.save(household)
    const defaultId = roomId === 'kitchen' ? 'default-kitchen-shopping-bag' : roomId === 'bathroom' ? 'default-bathroom-sink' : 'default-living-room-sofa'
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath(roomId))
    for (const id of [defaultId, added.id]) {
      const world = page.locator('.kitchen-world')
      await world.getByRole('button', { name: 'Reset room view', exact: true }).click()
      const marker = world.locator(`.world-hotspot[data-component-id="${id}"]`)
      await expect(marker).toHaveAttribute('aria-label', /^Chores for /)
      await marker.click()
      const component = household.roomComponents.find((item) => item.id === id)!
      await expect(page.locator('.chores-panel')).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'Chore object', exact: true })).toHaveAttribute('data-value', id)
      await expect(page.getByRole('combobox', { name: 'Chore area', exact: true })).toHaveAttribute('data-value', componentChoreArea(component) ?? '')
      await expect(page.locator('.room-editor, .room-objects-panel')).toHaveCount(0)
      await page.getByRole('button', { name: 'Close panel', exact: true }).click()
    }
    const objects = await openRoomObjects(page)
    await objects.getByRole('button', { name: `Open ${added.name} details`, exact: true }).click()
    await objects.getByRole('button', { name: 'Edit this object', exact: true }).click()
    await expect(page.locator('.room-editor')).toBeVisible()
  })
}

test('room chore markers do not discard unsaved component edits', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(roomPath())
  const editor = await openRoomEditor(page)
  await editor.getByRole('button', { name: 'Edit Dining table', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('Keep this table draft')
  await expect(editor).toContainText('1 object has unapplied changes.')
  await page.locator('.world-hotspot[data-component-id="default-kitchen-table"]').click()
  await expect(editor.getByRole('alert')).toContainText('Apply or cancel')
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Keep this table draft')
  await expect(page.locator('.chores-panel')).toHaveCount(0)
  expect((await accounts.store.get(owner.household.id))?.roomComponents).toEqual(owner.household.roomComponents)
})
