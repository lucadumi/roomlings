import { randomUUID } from 'node:crypto'
import type { APIRequestContext, Locator } from '@playwright/test'
import { billingDate, householdSchema } from '../../shared/domain.ts'
import type { Household, Session } from '../../shared/domain.ts'
import { componentCatalog, createRoomComponent, getRoomComponents, roomComponentLimit } from '../../shared/roomComponents.ts'
import type { RoomComponent, RoomComponentsPatch } from '../../shared/roomComponents.ts'
import { roomCatalog } from '../../shared/rooms.ts'
import { componentConfiguration } from '../../src/componentConfiguration.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { expect, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'
import { chooseOption, openRoomEditor } from './fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, type: string, options?: unknown) {
        return type.startsWith('webgl') ? null : Reflect.apply(original, this, [type, options])
      },
    })
  })
})

async function current(accounts: AccountHarness, owner: Session): Promise<Household> {
  const household = await accounts.store.get(owner.household.id)
  if (!household) throw new Error('The isolated editor household is missing.')
  return household
}

function change(component: RoomComponent) {
  return { ...componentConfiguration(component), componentVersion: component.version }
}

async function expectZoneFilters(editor: Locator, labels: readonly string[]) {
  const buttons = editor.getByRole('navigation', { name: 'Filter object zones', exact: true }).getByRole('button')
  await expect(buttons).toHaveText(['All zones', ...labels])
  for (const button of await buttons.all()) {
    await expect(button).not.toHaveAttribute('title', /\d+\s+of\s+\d+/)
    await expect(button).not.toHaveAttribute('aria-label', /\d+\s+of\s+\d+/)
  }
}

async function mutate(
  request: APIRequestContext, accounts: AccountHarness, owner: Session, path: string,
  body: Record<string, unknown>, method = 'POST',
) {
  const response = await request.fetch(`/api${path}`, {
    method, headers: { Authorization: `Bearer ${owner.token}` },
    data: { ...body, version: (await current(accounts, owner)).version },
  })
  await expect(response).toBeOK()
  return householdSchema.parse((await response.json()).household)
}

const counterAdditions = [
  ['coffee-machine', 'kitchen-coffee'], ['toaster', 'kitchen-toaster'], ['blender', 'kitchen-blender'],
  ['microwave', 'kitchen-small-appliance'], ['stand-mixer', 'kitchen-stand-mixer'],
  ['cutting-boards', 'kitchen-cutting-boards'], ['paper-towel-holder', 'kitchen-paper-towels'],
] as const

test('old living-room bins appear only in Storage and cannot be placed again', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  const household = await current(accounts, owner)
  const bin = { ...createRoomComponent('bins', 'living-room-bins', randomUUID()), name: 'Old lounge bin' }
  household.roomComponents = [...getRoomComponents(household), bin]
  await accounts.store.save(household)
  await page.goto(roomPath('living-room'))
  const editor = await openRoomEditor(page)
  await expect(editor.getByRole('button', { name: 'Edit Old lounge bin', exact: true })).toHaveCount(0)
  await expect(page.locator('.living-room-world')).toHaveAttribute('data-component-count', '12')
  await editor.getByRole('button', { name: 'Storage', exact: true }).click()
  const card = editor.locator(`[data-stored-component="${bin.id}"]`)
  await expect(card).toContainText(bin.name)
  await expect(card.getByRole('button', { name: /^Bring back/ })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByLabel('Find an object', { exact: true }).fill('bin')
  await expect(editor.getByRole('article', { name: 'Bin', exact: true })).toHaveCount(0)
  expect(getRoomComponents(await current(accounts, owner)).find((component) => component.id === bin.id))
    .toEqual({ ...bin, installed: false })
})

test('zone filters have names only and catalog Preview keeps the selected actual instance and accepted drafts', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  const before = await current(accounts, owner)
  await page.goto('/kitchen')
  const editor = await openRoomEditor(page)
  await expectZoneFilters(editor, ['Floor', 'Counter', 'Table', 'Wall', 'Fitted'])
  await editor.getByRole('button', { name: 'Edit Plant', exact: true }).click()
  await editor.getByRole('group', { name: 'Plant objects', exact: true }).getByRole('button', { name: 'Plant 2', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('Counter herbs')
  await editor.getByRole('button', { name: 'Counter', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Add objects', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.getByRole('article', { name: 'Plant', exact: true })).toHaveCount(1)
  await expect(editor.getByRole('article', { name: componentCatalog['pet-bowls'].name, exact: true })).toHaveCount(0)
  await expect(editor.getByRole('article', { name: 'Wall art', exact: true })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Preview Plant', exact: true }).click()
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-selected-component', 'default-kitchen-plant-counter')
  await expect(page.locator('.game-app')).toHaveAttribute('data-component-detail', 'false')
  await expect(editor).toHaveAttribute('data-editor-section', 'catalog')
  await expect(editor).toHaveAttribute('data-pending-count', '1')
  const picture = editor.getByRole('button', { name: 'Preview Coffee machine in the room', exact: true })
  await picture.click()
  await expect(editor).toHaveAttribute('data-pending-count', '1')
  await page.getByRole('dialog', { name: 'Try Coffee machine', exact: true }).getByRole('button', { name: 'Discard preview', exact: true }).click()
  await expect(picture).toBeFocused()
  await expect(editor.getByRole('button', { name: 'Counter', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await picture.click()
  const id = await editor.getAttribute('data-placement-preview')
  await editor.getByRole('button', { name: 'Place object', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Counter', exact: true })).toHaveText('Counter')
  await expect(editor).toHaveAttribute('data-pending-count', '2')
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByRole('button', { name: 'Preview Coffee machine', exact: true }).click()
  await expect(editor).toHaveAttribute('data-editor-section', 'catalog')
  await expect(page.getByRole('dialog', { name: 'Try Coffee machine', exact: true })).toHaveCount(0)
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-selected-component', id!)
  await expect(editor).toHaveAttribute('data-pending-count', '2')
  await editor.getByRole('button', { name: 'All zones', exact: true }).click()
  await expect(editor.getByRole('article', { name: componentCatalog['pet-bowls'].name, exact: true })).toBeVisible()
  expect(await current(accounts, owner)).toEqual(before)
})

test('Storage pauses care and supplies, and an explicit occupied-slot swap brings back the chosen owned ID', { tag: '@room' }, async ({ page, accounts, request, emptyHousehold: owner }) => {
  const household = await current(accounts, owner)
  const plant = { ...createRoomComponent('plant', 'bathroom-vanity-accessory', randomUUID()), name: 'Vanity plant' }
  const chosen = {
    ...createRoomComponent('soap-dispenser', 'bathroom-vanity-accessory', randomUUID()),
    name: 'Guest soap', finish: 'berry' as const, supplies: [{ id: 'soap', name: 'Guest soap refill', quantity: '2 bottles' }],
  }
  const other = { ...createRoomComponent('soap-dispenser', 'bathroom-soap-dispenser', randomUUID()), name: 'Backup soap', installed: false }
  household.roomComponents = [
    ...getRoomComponents(household), { ...plant, installed: false }, chosen, other,
    createRoomComponent('hair-dryer', 'bathroom-hair-dryer', randomUUID()),
    createRoomComponent('storage-jars', 'bathroom-storage-jars', randomUUID()),
  ]
  await accounts.store.save(household)
  const today = billingDate(household.billingTimeZone)
  let latest = await mutate(request, accounts, owner, '/chores', {
    title: 'Refill the guest soap', notes: 'Keep its saved routine', roomId: 'bathroom', area: null, componentId: chosen.id,
    dueDate: today, repeatDays: 7, rotation: [owner.memberId], turn: 0,
  })
  const care = latest.chores.items.find((chore) => chore.componentId === chosen.id)!
  await mutate(request, accounts, owner, `/chores/${care.id}/complete`, { choreVersion: care.version })
  await mutate(request, accounts, owner, '/chores', {
    title: 'Wipe the shared basin', notes: '', roomId: 'bathroom', area: 'sink', componentId: null,
    dueDate: today, repeatDays: 1, rotation: [owner.memberId], turn: 0,
  })
  await mutate(request, accounts, owner, '/shopping/items', {
    name: 'Guest soap refill', quantity: '1 bottle', componentSource: { componentId: chosen.id, supplyId: 'soap' },
  })
  latest = await mutate(request, accounts, owner, '/household/room-components', {
    roomId: 'bathroom', changes: [{ ...change(chosen), installed: false, linkedChores: 'pause' }, change(plant)],
  }, 'PATCH')
  const before = await current(accounts, owner)
  expect(before.chores.history).toHaveLength(1)
  await page.goto(roomPath('bathroom'))
  const dock = page.getByRole('navigation', { name: 'Household tools', exact: true })
  await expect(dock.getByRole('button', { name: 'Chores', exact: true }).locator('.tool-count')).toHaveText('1')
  await dock.getByRole('button', { name: 'Chores', exact: true }).click()
  const pausedCare = page.getByRole('article', { name: 'Refill the guest soap', exact: true })
  await expect(pausedCare).toContainText('Paused in Storage')
  await expect(pausedCare.getByRole('button', { name: 'Mark done', exact: true })).toBeDisabled()
  await expect(page.getByRole('article', { name: 'Wipe the shared basin', exact: true }).getByRole('button', { name: 'Mark done', exact: true })).toBeEnabled()
  await expect(page.locator('.chore-toolbar')).toContainText('1 due / 1 scheduled / 1 paused in Storage')
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Completion: Refill the guest soap', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restock room supplies', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Supplies paused in Storage', exact: true })).toContainText('Guest soap')
  await expect(page.getByRole('button', { name: 'Restock Guest soap refill', exact: true })).toHaveCount(0)
  const editor = await openRoomEditor(page)
  await expectZoneFilters(editor, ['Floor', 'Counter', 'Wall', 'Fitted', 'Bath'])
  await editor.getByRole('button', { name: 'Storage', exact: true }).click()
  await expect(editor.getByRole('region', { name: 'Soap dispenser in Storage', exact: true })).toBeVisible()
  await editor.getByRole('button', { name: 'Bring back Guest soap', exact: true }).click()
  await expect(editor).toHaveAttribute('data-placement-preview', chosen.id)
  await expect(editor).toHaveAttribute('data-inspection-preview', 'true')
  await expect(editor).toHaveAttribute('data-pending-count', '0')
  const trial = page.getByRole('dialog', { name: 'Try Guest soap', exact: true })
  await expect(trial.getByText(`Occupied by ${plant.name}.`, { exact: true })).toBeVisible()
  await expect(trial).not.toContainText('Counter 4 of 4')
  await expect(trial.getByRole('button', { name: 'Place object', exact: true })).toBeDisabled()
  await trial.getByRole('button', { name: 'Choose a swap or another position', exact: true }).click()
  await expect(trial.getByRole('combobox', { name: 'Placement position', exact: true })).toHaveAttribute('data-value', chosen.slotId)
  await trial.getByRole('checkbox', { name: `Put ${plant.name} in Storage`, exact: true }).check()
  await expect(trial.getByRole('checkbox', { checked: true })).toHaveCount(1)
  await expect(editor).toHaveAttribute('data-pending-count', '0')
  expect(await current(accounts, owner)).toEqual(before)
  await trial.getByRole('button', { name: 'Stage swap', exact: true }).click()
  await expect(editor).toHaveAttribute('data-pending-count', '2')
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue(chosen.name)
  await expect(editor.getByRole('combobox', { name: 'Finish', exact: true })).toHaveAttribute('data-value', chosen.finish)
  await expect(editor.getByLabel('Supply quantity 1', { exact: true })).toHaveValue('2 bottles')
  const applying = page.waitForRequest('**/api/household/room-components')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  const patch: RoomComponentsPatch = (await applying).postDataJSON()
  expect(patch.changes.map((component) => component.id).sort()).toEqual([chosen.id, plant.id].sort())
  expect(patch.changes.find((component) => component.id === plant.id)).toMatchObject({ installed: false, linkedChores: 'pause' })
  await expect(editor).toHaveCount(0)
  const saved = await current(accounts, owner)
  expect(getRoomComponents(saved).find((component) => component.id === chosen.id)).toMatchObject({ ...chosen, installed: true, version: 2 })
  expect(getRoomComponents(saved).find((component) => component.id === other.id)).toEqual(other)
  expect(getRoomComponents(saved)).toHaveLength(getRoomComponents(latest).length)
  for (const key of ['chores', 'shopping', 'expenses', 'settlements'] as const) expect(saved[key]).toEqual(before[key])
  await dock.getByRole('button', { name: 'Chores', exact: true }).click()
  await expect(pausedCare).not.toContainText('Paused in Storage')
  await expect(pausedCare.getByRole('button', { name: 'Mark done', exact: true })).toBeEnabled()
})

test('legacy over-cap rooms require every named Storage choice and keep the same draft after a failed apply', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  const household = await current(accounts, owner)
  household.roomComponents = [...getRoomComponents(household), ...counterAdditions.map(([kind, slot]) => createRoomComponent(kind, slot, randomUUID()))]
  await accounts.store.save(household)
  const before = await current(accounts, owner)
  await page.goto('/kitchen')
  const editor = await openRoomEditor(page)
  await expect(editor.getByRole('button', { name: 'Counter', exact: true })).toHaveText('Counter')
  await expect(editor.getByRole('alert')).toHaveCount(0)
  await editor.getByRole('button', { name: 'Edit Dining table', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('Keep this table')
  await editor.getByRole('button', { name: 'All room objects', exact: true }).click()
  await editor.getByRole('button', { name: 'Edit Coffee machine', exact: true }).click()
  await chooseOption(editor.getByRole('combobox', { name: 'Finish', exact: true }), 'teal')
  await expect(editor.getByRole('button', { name: 'Apply for everyone', exact: true })).toBeEnabled()
  await editor.getByRole('button', { name: 'Counter', exact: true }).click()
  await editor.getByRole('button', { name: 'Preview Air fryer', exact: true }).click()
  const candidateId = await editor.getAttribute('data-placement-preview')
  const trial = page.getByRole('dialog', { name: 'Try Air fryer', exact: true })
  await expect(editor).toHaveAttribute('data-inspection-preview', 'true')
  await expect(editor).toHaveAttribute('data-pending-count', '2')
  await trial.getByRole('button', { name: 'Choose a swap or another position', exact: true }).click()
  for (const name of ['Coffee machine', 'Toaster']) {
    await trial.getByRole('checkbox', { name: `Put ${name} in Storage`, exact: true }).check()
    await expect(trial.getByRole('button', { name: 'Stage swap', exact: true })).toBeDisabled()
  }
  await trial.getByRole('checkbox', { name: 'Put Blender in Storage', exact: true }).check()
  await expect(trial.getByRole('button', { name: 'Stage swap', exact: true })).toBeEnabled()
  expect(await current(accounts, owner)).toEqual(before)
  await trial.getByRole('button', { name: 'Stage swap', exact: true }).click()
  await expect(editor).toHaveAttribute('data-pending-count', '5')
  const failed: (RoomComponentsPatch & { mutationId: string })[] = []
  await page.route('**/api/household/room-components', async (route) => {
    failed.push(route.request().postDataJSON())
    await route.fulfill({ status: 503, json: { error: 'The Storage swap was not saved. Try again.' } })
  })
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('Storage swap was not saved')
  await expect(editor).toHaveAttribute('data-pending-count', '5')
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-selected-component', candidateId!)
  expect(await current(accounts, owner)).toEqual(before)
  await page.unroute('**/api/household/room-components')
  const retrying = page.waitForRequest('**/api/household/room-components')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  expect((await retrying).postDataJSON()).toEqual(failed[0])
  await expect(editor).toHaveCount(0)
  const saved = await current(accounts, owner)
  const storedIds = failed[0].changes.filter((component) => !component.installed).map((component) => component.id)
  expect(storedIds).toHaveLength(3)
  for (const id of storedIds) expect(getRoomComponents(before).some((component) => component.id === id)).toBe(true)
  expect(getRoomComponents(saved).find((component) => component.kind === 'coffee-machine')).toMatchObject({ installed: false, finish: 'teal' })
  expect(getRoomComponents(saved).find((component) => component.id === candidateId)).toMatchObject({ kind: 'air-fryer', installed: true })
  expect(getRoomComponents(saved).find((component) => component.kind === 'table')?.name).toBe('Keep this table')
  for (const key of ['chores', 'shopping', 'expenses', 'settlements'] as const) expect(saved[key]).toEqual(before[key])
})

test('a normal trial blocked by a remote zone addition remains a conflict rather than becoming a swap', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  const household = await current(accounts, owner)
  household.roomComponents = [...getRoomComponents(household), ...counterAdditions.slice(0, 4).map(([kind, slot]) => createRoomComponent(kind, slot, randomUUID()))]
  await accounts.store.save(household)
  await page.goto('/kitchen')
  const editor = await openRoomEditor(page)
  await editor.getByRole('button', { name: 'Edit Dining table', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('My table draft')
  await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
  await editor.getByRole('button', { name: 'Preview Air fryer', exact: true }).click()
  await expect(editor).toHaveAttribute('data-inspection-preview', 'false')
  const latest = await current(accounts, owner)
  latest.roomComponents = [...getRoomComponents(latest), createRoomComponent('stand-mixer', 'kitchen-stand-mixer', randomUUID())]
  latest.version++
  await accounts.store.save(latest)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(editor.getByRole('alert')).toContainText('Make room first')
  await expect(editor.getByRole('button', { name: 'Place object', exact: true })).toBeDisabled()
  await expect(editor.getByRole('button', { name: 'Choose a swap or another position', exact: true })).toHaveCount(0)
  await expect(editor).toHaveAttribute('data-inspection-preview', 'false')
  await expect(editor).toHaveAttribute('data-pending-count', '1')
  await editor.getByRole('button', { name: 'Discard preview', exact: true }).click()
  await expect(editor.locator('.room-editor-footer [role="status"]')).toHaveText('1 object has unapplied changes.')
  expect(await current(accounts, owner)).toEqual(latest)
})

test('retired stored objects explain their placement restriction and keep editable settings without Bring back', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  const household = await current(accounts, owner)
  const retired = { ...createRoomComponent('speaker', 'living-room-media-accessory', randomUUID()), name: 'Saved speaker', installed: false }
  household.roomComponents = [...getRoomComponents(household), retired]
  await accounts.store.save(household)
  await page.goto(roomPath('living-room'))
  const editor = await openRoomEditor(page)
  await expectZoneFilters(editor, ['Floor', 'Counter', 'Table', 'Wall'])
  await editor.getByRole('button', { name: 'Storage', exact: true }).click()
  const card = editor.locator(`[data-stored-component="${retired.id}"]`)
  await expect(card).toContainText('cannot be moved or brought back')
  await expect(card.getByRole('button', { name: /^Bring back/ })).toHaveCount(0)
  await card.getByRole('button', { name: 'Edit stored Saved speaker', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('Kept speaker settings')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(getRoomComponents(await current(accounts, owner)).find((component) => component.id === retired.id))
    .toMatchObject({ installed: false, name: 'Kept speaker settings' })
})

for (const limit of ['identity', 'owned objects'] as const) {
  test(`a blocked ${limit} limit still permits read-only Preview without manufacturing Storage history`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
    const household = await current(accounts, owner)
    if (limit === 'owned objects') {
      const components = [...getRoomComponents(household)]
      while (components.length < roomComponentLimit) {
        components.push({ ...createRoomComponent('tissue-box', 'bathroom-tissue-box', randomUUID()), installed: false })
      }
      household.roomComponents = components
      await accounts.store.save(household)
    }
    const before = await current(accounts, owner)
    await page.goto('/kitchen')
    const editor = await openRoomEditor(page)
    if (limit === 'identity') await page.evaluate(() => {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined })
    })
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await editor.getByRole('button', { name: 'Preview Coffee machine', exact: true }).click()
    await expect(editor).toHaveAttribute('data-inspection-preview', 'true')
    await expect(editor).toHaveAttribute('data-pending-count', '0')
    await expect(editor.getByRole('button', { name: 'Place object', exact: true })).toBeDisabled()
    await expect(editor).toContainText(limit === 'identity' ? 'HTTPS or localhost' : 'saved-object limit')
    if (limit === 'owned objects') {
      await editor.getByRole('button', { name: 'Choose a swap or another position', exact: true }).click()
      await editor.getByRole('checkbox', { name: 'Put Plant 2 in Storage', exact: true }).check()
      await expect(editor.getByRole('button', { name: 'Stage swap', exact: true })).toBeDisabled()
    }
    await editor.getByRole('button', { name: 'Discard preview', exact: true }).click()
    await expect(editor.locator('.room-editor-footer [role="status"]')).toHaveText('No unapplied changes.')
    expect(await current(accounts, owner)).toEqual(before)
  })
}

test('opening an existing bathroom preserves its layout and keeps the Storage introduction concise', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
  const household = await current(accounts, owner)
  household.roomComponents = getRoomComponents(household).map((component) => component.roomId === 'bathroom'
    && !component.id.startsWith('default-') ? { ...component, installed: false } : component)
  await accounts.store.save(household)
  const before = await current(accounts, owner)
  await page.goto(roomPath('bathroom'))
  const editor = await openRoomEditor(page)
  await expect(editor.getByRole('button', { name: 'Apply for everyone', exact: true })).toBeDisabled()
  await expect(editor.getByText('Room templates', { exact: true })).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Room colors', exact: true })).toBeEnabled()
  await editor.getByRole('button', { name: 'Storage', exact: true }).click()
  await expect(editor.getByText('Stored objects keep their history. Supplies and linked chores resume when you bring them back.', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: `Edit ${roomCatalog.bathroom.name} objects`, exact: true })).toBeVisible()
  expect(await current(accounts, owner)).toEqual(before)
})
