import { randomUUID } from 'node:crypto'
import type { APIRequestContext, Page } from '@playwright/test'
import { billingDate, householdSchema } from '../../shared/domain.ts'
import type { Household, Session } from '../../shared/domain.ts'
import { createRoomComponent, getRoomComponents } from '../../shared/roomComponents.ts'
import type { ComponentKind, RoomComponent, RoomComponentChange, RoomSlotId } from '../../shared/roomComponents.ts'
import { expect, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'
import { chooseOption, openRoomEditor } from './fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, type: string, options?: unknown) {
        if (type.startsWith('webgl')) return null
        return Reflect.apply(original, this, [type, options])
      },
    })
  })
})

async function current(accounts: AccountHarness, session: Session): Promise<Household> {
  const household = await accounts.store.get(session.household.id)
  if (!household) throw new Error('The isolated component household is missing.')
  return household
}

function configuration(component: RoomComponent, overrides: Partial<RoomComponentChange> = {}): RoomComponentChange {
  const { version, state: _state, stateChangedAt: _at, stateChangedBy: _by, ...fields } = component
  return { ...fields, componentVersion: version, ...overrides }
}

async function change(request: APIRequestContext, accounts: AccountHarness, session: Session, path: string, body: Record<string, unknown>, method = 'PATCH') {
  const household = await current(accounts, session)
  const response = await request.fetch(`/api${path}`, {
    method, headers: { Authorization: `Bearer ${session.token}` }, data: { ...body, version: household.version },
  })
  await expect(response).toBeOK()
  return householdSchema.parse((await response.json()).household)
}

async function install(request: APIRequestContext, accounts: AccountHarness, session: Session, kind: ComponentKind, slotId: RoomSlotId) {
  const component = createRoomComponent(kind, slotId, randomUUID())
  const household = await change(request, accounts, session, '/household/room-components', {
    roomId: component.roomId, changes: [configuration(component, { componentVersion: null })],
  })
  return getRoomComponents(household).find((item) => item.id === component.id)!
}

async function openEditor(page: Page) {
  await openRoomEditor(page)
  const editor = page.getByRole('region', { name: 'Edit Kitchen objects', exact: true })
  await expect(editor).toBeVisible()
  return editor
}

async function openObject(page: Page, name: string) {
  await page.getByRole('button', { name: 'Room objects', exact: true }).click()
  await page.getByRole('button', { name: `Open ${name} details`, exact: true }).click()
  const panel = page.getByRole('region', { name: 'Kitchen objects', exact: true })
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible()
  return panel
}

test('room drafts cancel cleanly and keep their model, finish, supplies and identifier after a failed apply', async ({ page, accounts, emptyHousehold: owner }) => {
  const original = await current(accounts, owner)
  await page.goto('/kitchen')
  const editor = await openEditor(page)
  await expect(editor.getByRole('button', { name: 'Apply for everyone', exact: true })).toBeDisabled()
  await editor.getByRole('button', { name: 'Edit Dining table', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('Breakfast table')
  await chooseOption(editor.getByRole('combobox', { name: 'Model', exact: true }), 'round')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await current(accounts, owner)).roomComponents).toEqual(original.roomComponents)
  await expect(page.getByRole('button', { name: 'Room objects', exact: true })).toBeFocused()

  await openEditor(page)
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByLabel('Find an object', { exact: true }).fill('Coffee machine')
  await editor.getByRole('button', { name: 'Add Coffee machine', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('Morning coffee')
  await chooseOption(editor.getByRole('combobox', { name: 'Model', exact: true }), 'capsule')
  await chooseOption(editor.getByRole('combobox', { name: 'Finish', exact: true }), 'tomato')
  await editor.getByRole('button', { name: 'Use suggested supplies', exact: true }).click()
  await expect(editor.getByLabel('Supply name 1', { exact: true })).toHaveValue('Coffee capsules')
  await editor.getByLabel('Supply quantity 1', { exact: true }).fill('2 boxes')
  const before = await current(accounts, owner)
  expect(before.shopping.items).toEqual([])
  expect(before.chores.items).toEqual([])
  expect(before.expenses).toEqual([])
  let failedId = ''
  await page.route('**/api/household/room-components', async (route) => {
    failedId = route.request().postDataJSON().changes[0].id
    await route.fulfill({ status: 503, json: { error: 'The room could not be saved. Try again.' } })
  })
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('The room could not be saved')
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Morning coffee')
  await expect(editor.getByRole('combobox', { name: 'Model', exact: true })).toHaveAttribute('data-value', 'capsule')
  expect((await current(accounts, owner)).roomComponents).toEqual(original.roomComponents)
  await page.unroute('**/api/household/room-components')
  const applying = page.waitForRequest('**/api/household/room-components')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  const patch = (await applying).postDataJSON()
  expect(patch.changes).toHaveLength(1)
  expect(patch.changes[0].id).toBe(failedId)
  expect(patch.changes[0].componentVersion).toBeNull()
  for (const key of ['state', 'stateChangedAt', 'stateChangedBy', 'version']) expect(patch.changes[0]).not.toHaveProperty(key)
  await expect(editor).toHaveCount(0)
  const saved = await current(accounts, owner)
  const coffee = getRoomComponents(saved).find((component) => component.id === failedId)!
  expect(coffee).toMatchObject({ name: 'Morning coffee', variant: 'capsule', finish: 'tomato', installed: true })
  expect(coffee.supplies[0]).toMatchObject({ name: 'Coffee capsules', quantity: '2 boxes' })
  expect(saved.shopping).toEqual(before.shopping)
  expect(saved.chores).toEqual(before.chores)
  expect(saved.expenses).toEqual(before.expenses)
  await page.reload()
  await openEditor(page)
  await editor.getByRole('button', { name: 'Edit Morning coffee', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'Finish', exact: true })).toHaveAttribute('data-value', 'tomato')
})

test('daily object states, shopping shortcuts and chore suggestions use the existing shared records', async ({ page, accounts, request, emptyHousehold: owner }) => {
  const dishwasher = await install(request, accounts, owner, 'dishwasher', 'kitchen-undercounter')
  await page.goto('/kitchen')
  const panel = await openObject(page, 'Dishwasher')
  await expect(panel).toContainText('not detected by an appliance')
  await chooseOption(panel.getByRole('combobox', { name: 'Manual state', exact: true }), 'running')
  await expect(panel.getByRole('combobox', { name: 'Manual state', exact: true })).toHaveAttribute('data-value', 'running')
  let household = await current(accounts, owner)
  expect(getRoomComponents(household).find((component) => component.id === dishwasher.id)?.state).toBe('running')
  expect(household.chores.history).toEqual([])
  expect(household.shopping.items).toEqual([])
  expect(household.expenses).toEqual([])

  await panel.getByRole('button', { name: 'Restock Dishwasher tablets', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Quantity', { exact: true }).fill('2 boxes')
  await dialog.getByRole('button', { name: 'Add to shopping list', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByRole('article', { name: 'Dishwasher tablets', exact: true })).toContainText('2 boxes already on the shared list')
  household = await current(accounts, owner)
  expect(household.shopping.items[0].componentSources).toEqual([{
    componentId: dishwasher.id, supplyId: 'dishwasher-tablets', roomId: 'kitchen', componentName: 'Dishwasher',
  }])
  expect(household.expenses).toEqual([])
  await panel.getByRole('button', { name: 'Add Empty the dishwasher', exact: true }).click()
  await expect(dialog.getByLabel('Chore name', { exact: true })).toHaveValue('Empty the dishwasher')
  await expect(dialog.getByRole('combobox', { name: 'Room object', exact: true })).toHaveAttribute('data-value', dishwasher.id)
  await expect(dialog.getByRole('combobox', { name: 'Repeat', exact: true })).toHaveAttribute('data-value', '1')
  await dialog.getByRole('button', { name: 'Create chore', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByRole('region', { name: 'Chores for Dishwasher', exact: true })).toContainText('Empty the dishwasher')
  await panel.getByRole('button', { name: 'Open object chores', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Chore object', exact: true })).toHaveAttribute('data-value', dishwasher.id)
  await page.getByRole('article', { name: 'Empty the dishwasher', exact: true }).getByRole('button', { name: 'Mark done', exact: true }).click()
  await dialog.getByRole('button', { name: 'Record completion', exact: true }).click()
  household = await current(accounts, owner)
  expect(household.chores.items[0].componentId).toBe(dishwasher.id)
  expect(household.chores.history[0]).toMatchObject({ componentId: dishwasher.id, componentName: 'Dishwasher' })
  expect(getRoomComponents(household).find((component) => component.id === dishwasher.id)?.state).toBe('running')
  expect(household.expenses).toEqual([])
})

test('shopping source names stay with purchased items after an object is renamed', async ({ page, accounts, request, emptyHousehold: owner }) => {
  const coffee = await install(request, accounts, owner, 'coffee-machine', 'kitchen-coffee')
  await page.goto('/kitchen')
  const panel = await openObject(page, 'Coffee machine')
  await panel.getByRole('button', { name: 'Restock Coffee beans', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Add to shopping list', exact: true }).click()
  await panel.getByRole('button', { name: 'Open shopping list', exact: true }).click()
  const item = page.getByRole('article', { name: 'Coffee beans', exact: true })
  await expect(item).toContainText('For Kitchen: Coffee machine')
  await item.getByRole('checkbox', { name: 'Picked up Coffee beans', exact: true }).click()
  await expect(item.getByRole('checkbox', { name: 'Picked up Coffee beans', exact: true })).toBeChecked()
  await page.getByRole('button', { name: /^Basket / }).click()
  await page.getByRole('button', { name: 'Finish shopping', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Total (EUR)', { exact: true }).fill('8.49')
  await page.getByRole('dialog').getByRole('button', { name: 'Record shopping run', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await change(request, accounts, owner, '/household/room-components', {
    roomId: 'kitchen', changes: [configuration(coffee, { name: 'The morning corner' })],
  })
  await page.reload()
  await page.getByRole('button', { name: 'Shopping bag, plan and record groceries', exact: true }).click()
  await page.getByRole('button', { name: 'Past runs', exact: true }).click()
  const run = page.locator('.shopping-run')
  await run.locator('summary').click()
  await expect(run).toContainText('For Kitchen: Coffee machine')
  await expect(run).not.toContainText('The morning corner')
  const saved = await current(accounts, owner)
  expect(saved.shopping.runs[0].items[0].componentSources?.[0].componentName).toBe('Coffee machine')
  expect(saved.expenses[0].amount).toBe(849)
})

test('a room conflict keeps edited fields, includes unedited remote settings, and never sends manual state', async ({ page, accounts, request, emptyHousehold: owner }) => {
  const coffee = await install(request, accounts, owner, 'coffee-machine', 'kitchen-coffee')
  await page.goto('/kitchen')
  const editor = await openEditor(page)
  await editor.getByRole('button', { name: 'Edit Coffee machine', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('Our coffee nook')
  const plant = getRoomComponents(await current(accounts, owner)).find((component) => component.slotId === 'kitchen-plant-counter')!
  let household = await change(request, accounts, owner, '/household/room-components', {
    roomId: 'kitchen', changes: [configuration(coffee, { name: 'Coffee station', finish: 'sage' }), configuration(plant, { name: 'Fresh herbs' })],
  })
  const latestCoffee = getRoomComponents(household).find((component) => component.id === coffee.id)!
  await change(request, accounts, owner, `/room-components/${coffee.id}/state`, { componentVersion: latestCoffee.version, state: 'needs-cleaning' })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(editor.getByRole('alert')).toContainText('changed while you were editing')
  await expect(editor.getByRole('button', { name: 'Apply for everyone', exact: true })).toBeDisabled()
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Our coffee nook')
  await editor.getByRole('button', { name: 'Keep my draft', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'Finish', exact: true })).toHaveAttribute('data-value', 'sage')
  await editor.getByRole('button', { name: 'All room objects', exact: true }).click()
  await editor.getByRole('button', { name: 'Edit Plant', exact: true }).click()
  await editor.getByRole('group', { name: 'Plant positions', exact: true }).getByRole('button', { name: 'Counter planter', exact: true }).click()
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Fresh herbs')
  const applying = page.waitForRequest('**/api/household/room-components')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  const patch = (await applying).postDataJSON()
  expect(patch.changes).toHaveLength(1)
  expect(patch.changes[0]).not.toHaveProperty('state')
  await expect(editor).toHaveCount(0)
  household = await current(accounts, owner)
  expect(getRoomComponents(household).find((component) => component.id === coffee.id)).toMatchObject({
    name: 'Our coffee nook', finish: 'sage', state: 'needs-cleaning',
  })
  expect(getRoomComponents(household).find((component) => component.id === plant.id)?.name).toBe('Fresh herbs')
})

test('shared slots require removal choices and restoring an object reuses its saved identity', async ({ page, accounts, request, emptyHousehold: owner }) => {
  const dishwasher = await install(request, accounts, owner, 'dishwasher', 'kitchen-undercounter')
  await change(request, accounts, owner, '/chores', {
    title: 'Empty the dishwasher', notes: '', roomId: 'kitchen', area: null, componentId: dishwasher.id,
    dueDate: billingDate('UTC'), repeatDays: 1, rotation: [owner.memberId], turn: 0,
  }, 'POST')
  await page.goto('/kitchen')
  const editor = await openEditor(page)
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByLabel('Find an object', { exact: true }).fill('Washing machine')
  const washingMachine = editor.getByRole('article', { name: 'Washing machine', exact: true })
  await expect(washingMachine).toContainText('occupied by Dishwasher')
  await expect(washingMachine.getByRole('button', { name: 'Add Washing machine', exact: true })).toHaveCount(0)
  await washingMachine.getByRole('button', { name: 'Review Dishwasher', exact: true }).click()
  await editor.getByRole('button', { name: 'Remove object', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Remove from preview', exact: true })).toBeDisabled()
  await chooseOption(editor.getByRole('combobox', { name: 'Linked chores', exact: true }), 'archive')
  await editor.getByRole('button', { name: 'Remove from preview', exact: true }).click()
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByRole('button', { name: 'Add Washing machine', exact: true }).click()
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor).toHaveCount(0)
  let household = await current(accounts, owner)
  expect(getRoomComponents(household).find((component) => component.id === dishwasher.id)?.installed).toBe(false)
  expect(household.chores.items[0].archived).toBe(true)
  const replacement = getRoomComponents(household).find((component) => component.kind === 'washing-machine')!
  expect(replacement.installed).toBe(true)
  await page.getByRole('button', { name: 'Chores', exact: true }).click()
  await page.getByRole('button', { name: 'Archived', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Empty the dishwasher', exact: true })).toContainText('This object has been removed')
  await expect(page.getByRole('button', { name: 'Restore chore', exact: true })).toBeDisabled()

  await openEditor(page)
  await editor.getByRole('button', { name: 'Edit Washing machine', exact: true }).click()
  await editor.getByRole('button', { name: 'Remove object', exact: true }).click()
  await editor.getByRole('button', { name: 'Remove from preview', exact: true }).click()
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByLabel('Find an object', { exact: true }).fill('Dishwasher')
  await editor.getByRole('button', { name: 'Restore Dishwasher', exact: true }).click()
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor).toHaveCount(0)
  household = await current(accounts, owner)
  expect(getRoomComponents(household).filter((component) => component.kind === 'dishwasher')).toHaveLength(1)
  expect(getRoomComponents(household).find((component) => component.id === dishwasher.id)?.installed).toBe(true)
  expect(getRoomComponents(household).find((component) => component.id === replacement.id)?.installed).toBe(false)
  expect(household.chores.items[0].archived).toBe(true)
  expect(household.expenses).toEqual([])
  expect(household.shopping.items).toEqual([])
})

test('changing a chore location clears old object selections and object filters include legacy room chores', async ({ page, accounts, request, emptyHousehold: owner }) => {
  await page.goto('/kitchen')
  await page.getByRole('button', { name: 'Chores', exact: true }).click()
  await page.getByRole('button', { name: 'Add chore', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Chore name', { exact: true }).fill('Wipe the basin')
  await chooseOption(dialog.getByRole('combobox', { name: 'Room object', exact: true }), 'default-kitchen-sink')
  await expect(dialog.getByRole('combobox', { name: 'Area', exact: true })).toHaveAttribute('data-value', 'sink')
  await chooseOption(dialog.getByRole('combobox', { name: 'Room', exact: true }), 'bathroom')
  await expect(dialog.getByRole('combobox', { name: 'Room object', exact: true })).toHaveAttribute('data-value', '')
  await chooseOption(dialog.getByRole('combobox', { name: 'Room object', exact: true }), 'default-bathroom-mirror')
  await chooseOption(dialog.getByRole('combobox', { name: 'Area', exact: true }), 'sink')
  await expect(dialog.getByRole('combobox', { name: 'Room object', exact: true })).toHaveAttribute('data-value', '')
  await dialog.getByRole('button', { name: 'Create chore', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await current(accounts, owner)).chores.items[0]).toMatchObject({ roomId: 'bathroom', area: 'sink', componentId: null })
  await chooseOption(page.getByRole('combobox', { name: 'Chore room', exact: true }), 'bathroom')
  await chooseOption(page.getByRole('combobox', { name: 'Chore object', exact: true }), 'default-bathroom-sink')
  await expect(page.getByRole('article', { name: 'Wipe the basin', exact: true })).toBeVisible()
  await change(request, accounts, owner, '/chores', {
    title: 'Check the basin plug', notes: '', roomId: 'bathroom', area: null, componentId: 'default-bathroom-sink',
    dueDate: billingDate('UTC'), repeatDays: 7, rotation: [owner.memberId], turn: 0,
  }, 'POST')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('article', { name: 'Check the basin plug', exact: true })).toBeVisible()
})

test('narrow keyboard editing validates supply names and Escape never saves a draft', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  const original = await current(accounts, owner)
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/kitchen')
  const editor = await openEditor(page)
  await editor.getByRole('button', { name: 'Edit Fridge', exact: true }).click()
  await expect(editor.getByLabel('Object name', { exact: true })).toBeFocused()
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveCSS('font-size', '16px')
  await editor.getByRole('button', { name: 'Add supply shortcut', exact: true }).click()
  await expect(editor.getByLabel('Supply name 2', { exact: true })).toBeFocused()
  await editor.getByLabel('Supply name 2', { exact: true }).fill('ＳＵＲＦＡＣＥ　ＣＬＥＡＮＥＲ')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('distinct name')
  await editor.getByLabel('Supply name 2', { exact: true }).fill('Cleaning cloths')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.room-panel').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const finish = editor.getByRole('combobox', { name: 'Finish', exact: true })
  await finish.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox', { name: 'Finish', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor).toBeVisible()
  await expect(finish).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Room objects', exact: true })).toBeFocused()
  expect((await current(accounts, owner)).roomComponents).toEqual(original.roomComponents)
})
