import { randomUUID } from 'node:crypto'
import { expect, rememberBrowserHousehold, test } from './account-fixtures.ts'
import { componentCatalog, createRoomComponent, getRoomComponents } from '../../shared/roomComponents.ts'
import { roomCatalog, roomIds } from '../../shared/rooms.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { chooseOption, openRoomEditor, openRoomObjects, selectRoom, trackDrawing } from './fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

for (const roomId of roomIds) {
  test(`${roomId} placement uses a short two-action dialog and stays private until applied`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }, testInfo) => {
    const name = roomId === 'kitchen' ? 'Dishwasher' : roomId === 'bathroom' ? 'Washing machine' : 'Speaker'
    const count = roomId === 'kitchen' ? 20 : roomId === 'bathroom' ? 6 : 13
    const before = await accounts.store.get(owner.household.id)
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath(roomId))
    const editor = await openRoomEditor(page)
    const world = page.locator('.kitchen-world')
    const canvas = await world.locator('canvas').elementHandle()
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await editor.getByLabel('Find an object', { exact: true }).fill(name)
    const picture = editor.getByRole('button', { name: `Preview ${name} in the room`, exact: true })
    await picture.click()
    const confirmation = page.getByRole('dialog', { name: `Try ${name}`, exact: true })
    await expect(confirmation).toBeVisible()
    await expect(confirmation.getByRole('button')).toHaveCount(2)
    await expect(confirmation.locator('p, input, [role="combobox"]')).toHaveCount(0)
    await expect(confirmation.getByRole('button', { name: 'Place object', exact: true })).toBeFocused()
    expect((await confirmation.boundingBox())!.height).toBeLessThan(220)
    const firstId = await editor.getAttribute('data-placement-preview')
    if (!firstId) throw new Error('The pending object has no preview identifier.')
    await expect(world).toHaveAttribute('data-component-count', String(count + 1))
    await expect(world).toHaveAttribute('data-selected-component', firstId)
    await expect(world.locator('.world-hotspot')).toHaveCount(0)
    await expect(world.getByRole('button', { name: 'Show object labels', exact: true })).toBeDisabled()
    await expect(world.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
    await expect(world).toHaveAttribute('data-rendering', 'paused')
    await expect(world.locator('canvas')).toHaveAttribute('data-placement-arrow', 'true')
    await expect(world.locator('.world-camera-controls')).toContainText('100%')
    await page.screenshot({ path: testInfo.outputPath(`${roomId}-hologram-placement.png`), animations: 'disabled' })
    expect(await accounts.store.get(owner.household.id)).toEqual(before)
    await confirmation.getByRole('button', { name: 'Discard preview', exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(world).toHaveAttribute('data-component-count', String(count))
    await expect(world.locator('canvas')).toHaveAttribute('data-placement-arrow', 'false')
    await expect(world.locator('.world-hotspot')).toHaveCount(count)
    await expect(world.getByRole('button', { name: 'Hide object labels', exact: true })).toBeEnabled()
    await expect(picture).toBeFocused()
    await expect(editor.getByLabel('Find an object', { exact: true })).toHaveValue(name)
    await world.getByRole('button', { name: 'Hide object labels', exact: true }).click()
    await picture.click()
    const id = await editor.getAttribute('data-placement-preview')
    if (!id) throw new Error('The second placement has no identifier.')
    expect(id).not.toBe(firstId)
    await confirmation.getByRole('button', { name: 'Place object', exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(editor).not.toHaveAttribute('data-placement-preview', /.+/)
    await expect(world.locator('canvas')).toHaveAttribute('data-placement-arrow', 'false')
    await expect(world.locator('.world-hotspots')).toHaveClass(/hide-labels/)
    await expect(world.getByRole('button', { name: 'Show object labels', exact: true })).toBeEnabled()
    expect(await accounts.store.get(owner.household.id)).toEqual(before)
    await chooseOption(editor.getByRole('combobox', { name: 'Finish', exact: true }), 'teal')
    await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    await expect(editor).toHaveCount(0)
    const saved = await accounts.store.get(owner.household.id)
    expect(saved?.roomComponents?.find((component) => component.id === id)).toMatchObject({ roomId, installed: true, finish: 'teal' })
    for (const key of ['expenses', 'settlements', 'shopping', 'chores', 'members'] as const) expect(saved?.[key]).toEqual(before?.[key])
    expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true)
    await page.reload()
    await openRoomObjects(page)
    await page.getByRole('button', { name: `Open ${name} details`, exact: true }).click()
    await expect(page.getByRole('region', { name: `${roomCatalog[roomId].name} objects`, exact: true })).toContainText('Teal')
  })
}

test('the floating bathroom triangle animates without repainting shadows and stops after dismissal', { tag: '@room' }, async ({ page, emptyHousehold: _owner }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 960 })
  const drawing = await trackDrawing(page)
  await page.goto(roomPath('bathroom'))
  const editor = await openRoomEditor(page)
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByRole('button', { name: 'Preview Washing machine', exact: true }).click()
  const world = page.locator('.bathroom-world')
  await expect(world.locator('canvas')).toHaveAttribute('data-placement-arrow', 'true')
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  const animated = await drawing()
  await expect.poll(async () => (await drawing()).draws).toBeGreaterThan(animated.draws)
  expect((await drawing()).shadows).toBe(animated.shadows)
  await expect(world).toHaveAttribute('data-rendering', 'active')
  await page.getByRole('dialog', { name: 'Try Washing machine', exact: true })
    .getByRole('button', { name: 'Discard preview', exact: true }).click()
  await expect(world.locator('canvas')).toHaveAttribute('data-placement-arrow', 'false')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
})

for (const [kind, slotId] of [
  ['first-aid-kit', 'bathroom-first-aid'],
  ['tissue-box', 'bathroom-tissue-box'],
  ['hair-dryer', 'bathroom-hair-dryer'],
  ['bathroom-stool', 'bathroom-stool'],
  ['toothbrush-holder', 'bathroom-vanity-accessory'],
  ['ironing-board', 'bathroom-ironing-board'],
  ['drying-rack', 'bathroom-drying-rack'],
] as const) {
  test(`${kind} starts in its correctly sized bathroom position and keeps it after placement`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(roomPath('bathroom'))
    const editor = await openRoomEditor(page)
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    const name = componentCatalog[kind].name
    const picture = editor.getByRole('button', { name: `Preview ${name} in the room`, exact: true })
    await expect(picture).toHaveAttribute('aria-description', 'Place or discard next.')
    await picture.click()
    const id = await editor.getAttribute('data-placement-preview')
    if (!id) throw new Error('The bathroom preview has no object identifier.')
    const confirmation = page.getByRole('dialog', { name: `Try ${name}`, exact: true })
    await expect(page.locator('.bathroom-world canvas')).toHaveAttribute('data-placement-arrow', 'true')
    await expect(page.locator('.bathroom-world')).toHaveAttribute('data-rendering', 'paused')
    await page.screenshot({ path: testInfo.outputPath(`${kind}-true-size-bathroom-preview.png`), animations: 'disabled' })
    expect((await accounts.store.get(owner.household.id))?.roomComponents).toEqual(owner.household.roomComponents)
    await confirmation.getByRole('button', { name: 'Place object', exact: true }).click()
    await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    await expect(editor).toHaveCount(0)
    const saved = await accounts.store.get(owner.household.id)
    expect(saved?.roomComponents?.find((component) => component.id === id)).toMatchObject({ kind, slotId, installed: true })
    await page.reload()
    const objects = await openRoomObjects(page)
    await objects.getByRole('button', { name: `Open ${name} details`, exact: true }).click()
    await expect(page.locator('.bathroom-world')).toHaveAttribute('data-selected-component', id)
  })
}

test('restoring a bathroom accessory preserves its original generic position and saved identity', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  const archived = { ...createRoomComponent('first-aid-kit', 'bathroom-vanity-accessory', randomUUID()), installed: false, finish: 'berry' as const }
  const household = await accounts.store.get(owner.household.id)
  if (!household) throw new Error('The isolated household is missing.')
  household.roomComponents = [...getRoomComponents(household), archived]
  await accounts.store.save(household)
  await page.goto(roomPath('bathroom'))
  const editor = await openRoomEditor(page)
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByRole('button', { name: 'Preview restoring First-aid kit', exact: true }).click()
  await expect(editor).toHaveAttribute('data-placement-preview', archived.id)
  await page.getByRole('dialog', { name: 'Try First-aid kit', exact: true }).getByRole('button', { name: 'Place object', exact: true }).click()
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const saved = (await accounts.store.get(owner.household.id))?.roomComponents?.filter((component) => component.kind === archived.kind)
  expect(saved).toHaveLength(1)
  expect(saved?.[0]).toMatchObject({ id: archived.id, slotId: archived.slotId, finish: 'berry', installed: true })
})

test.describe('placement draft safety without WebGL', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value(this: HTMLCanvasElement, name: string, options?: unknown) {
          return name.startsWith('webgl') ? null : Reflect.apply(original, this, [name, options])
        },
      })
    })
  })

  test('Escape discards only the trial, keeps other edits and restores catalog focus on a narrow screen', async ({ page, accounts, emptyHousehold: owner }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/kitchen')
    const editor = await openRoomEditor(page)
    await editor.getByRole('button', { name: 'Edit Dining table', exact: true }).click()
    await editor.getByLabel('Object name', { exact: true }).fill('Keep this table edit')
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await editor.getByLabel('Find an object', { exact: true }).fill('Coffee machine')
    const picture = editor.getByRole('button', { name: 'Preview Coffee machine in the room', exact: true })
    await picture.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Try Coffee machine', exact: true })
    await expect(dialog.getByRole('button', { name: 'Place object', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(dialog.getByRole('button', { name: 'Discard preview', exact: true })).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(picture).toBeFocused()
    await expect(editor).toContainText('1 object has unapplied changes.')
    await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    const saved = await accounts.store.get(owner.household.id)
    expect(saved?.roomComponents?.find((component) => component.kind === 'table')?.name).toBe('Keep this table edit')
    expect(saved?.roomComponents?.some((component) => component.kind === 'coffee-machine')).toBe(false)
  })

  test('discarding a restore trial keeps an earlier removal, while accepting it can undo that removal', async ({ page, accounts, emptyHousehold: owner }) => {
    await page.goto('/kitchen')
    const editor = await openRoomEditor(page)
    await editor.getByRole('button', { name: 'Edit Kettle', exact: true }).click()
    await editor.getByRole('button', { name: 'Remove object', exact: true }).click()
    await editor.getByRole('button', { name: 'Remove from preview', exact: true }).click()
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await editor.getByLabel('Find an object', { exact: true }).fill('Kettle')
    await editor.getByRole('button', { name: 'Preview restoring Kettle', exact: true }).click()
    await page.getByRole('dialog', { name: 'Try Kettle', exact: true }).getByRole('button', { name: 'Discard preview', exact: true }).click()
    await expect(editor).toContainText('1 object has unapplied changes.')
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-component-count', '19')
    await editor.getByRole('button', { name: 'Preview restoring Kettle', exact: true }).click()
    await page.getByRole('dialog', { name: 'Try Kettle', exact: true }).getByRole('button', { name: 'Place object', exact: true }).click()
    await expect(editor.getByRole('button', { name: 'Apply for everyone', exact: true })).toBeDisabled()
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-component-count', '20')
    expect((await accounts.store.get(owner.household.id))?.roomComponents).toEqual(owner.household.roomComponents)
  })

  test('a remotely occupied position blocks placement without drawing or saving a conflicting object', async ({ page, accounts, emptyHousehold: owner }) => {
    await page.goto('/kitchen')
    const editor = await openRoomEditor(page)
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await editor.getByRole('button', { name: 'Preview Dishwasher', exact: true }).click()
    const household = await accounts.store.get(owner.household.id)
    if (!household) throw new Error('The isolated household is missing.')
    const occupied = createRoomComponent('oven', 'kitchen-undercounter', randomUUID())
    household.roomComponents = [...getRoomComponents(household), occupied]
    household.version++
    await accounts.store.save(household)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const dialog = page.getByRole('dialog', { name: 'Try Dishwasher', exact: true })
    await expect(dialog.getByRole('alert')).toContainText('now occupied')
    await expect(dialog.getByRole('button', { name: 'Place object', exact: true })).toBeDisabled()
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-component-count', '21')
    await dialog.getByRole('button', { name: 'Discard preview', exact: true }).click()
    await expect(editor.getByRole('article', { name: 'Dishwasher', exact: true })).toHaveAttribute('data-availability', 'occupied')
    expect((await accounts.store.get(owner.household.id))?.roomComponents).toEqual(household.roomComponents)
  })

  test('room changes discard trials and the catalog keeps laundry out of the kitchen', async ({ page, accounts, emptyHousehold: owner }) => {
    await page.goto('/kitchen')
    const editor = await openRoomEditor(page)
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await expect(editor.getByRole('article', { name: 'Washing machine', exact: true })).toHaveCount(0)
    await expect(editor.getByRole('article', { name: 'Dryer', exact: true })).toHaveCount(0)
    await editor.getByRole('button', { name: 'Preview Coffee machine', exact: true }).click()
    await selectRoom(page, 'bathroom')
    await expect(page.locator('.game-app')).toHaveAttribute('data-page', 'overview')
    await expect(page.locator('[data-placement-preview]:not([data-placement-preview="false"])')).toHaveCount(0)
    await openRoomEditor(page)
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await expect(editor.getByRole('article', { name: 'Washing machine', exact: true })).toBeVisible()
    await expect(editor.getByRole('article', { name: 'Dryer', exact: true })).toBeVisible()
    await expect(editor.getByRole('article', { name: 'Coffee machine', exact: true })).toHaveCount(0)
    expect((await accounts.store.get(owner.household.id))?.roomComponents).toEqual(owner.household.roomComponents)
  })

  test('placed-object details open the existing removal confirmation and retain the saved identity', async ({ page, accounts, emptyHousehold: owner }) => {
    await page.goto('/kitchen')
    const objects = await openRoomObjects(page)
    await objects.getByRole('button', { name: 'Open Kettle details', exact: true }).click()
    await objects.getByRole('button', { name: 'Remove object', exact: true }).click()
    const editor = page.locator('.room-editor')
    await expect(editor.getByRole('group', { name: 'Remove Kettle', exact: true })).toBeVisible()
    await editor.getByRole('button', { name: 'Remove from preview', exact: true }).click()
    expect((await accounts.store.get(owner.household.id))?.roomComponents).toEqual(owner.household.roomComponents)
    await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect((await accounts.store.get(owner.household.id))?.roomComponents?.find((component) => component.id === 'default-kitchen-kettle')?.installed).toBe(false)
    await openRoomObjects(page)
    await objects.getByRole('button', { name: 'Open Fridge details', exact: true }).click()
    await expect(objects.getByRole('button', { name: 'Remove object', exact: true })).toHaveCount(0)
  })

  test('losing admin access disables placement but still allows discarding the preview', async ({ page, accounts, request }) => {
    const owner = await accounts.store.create('The shared placement permissions', 'Ada', 'EUR', 45000)
    const member = { id: randomUUID(), name: 'Ben', color: '#8da48a' }
    owner.household.members.push(member)
    await accounts.store.save(owner.household)
    const admin = await accounts.store.session(owner.household, member.id)
    const promoted = await request.patch(`/api/household/room-access/${member.id}`, {
      headers: { Authorization: `Bearer ${owner.token}` }, data: { version: owner.household.version, role: 'admin' },
    })
    await expect(promoted).toBeOK()
    await rememberBrowserHousehold(page, admin)
    await page.goto('/kitchen')
    const editor = await openRoomEditor(page)
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await editor.getByRole('button', { name: 'Preview Coffee machine', exact: true }).click()
    const household = await accounts.store.get(owner.household.id)
    const revoked = await request.patch(`/api/household/room-access/${member.id}`, {
      headers: { Authorization: `Bearer ${owner.token}` }, data: { version: household?.version, role: 'member' },
    })
    await expect(revoked).toBeOK()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const dialog = page.getByRole('dialog', { name: 'Try Coffee machine', exact: true })
    await expect(dialog.getByRole('button', { name: 'Place object', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Discard preview', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Discard preview', exact: true }).click()
    await expect(editor.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await accounts.store.get(owner.household.id))?.roomComponents?.some((component) => component.kind === 'coffee-machine')).toBe(false)
  })
})
