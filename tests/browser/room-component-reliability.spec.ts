import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, rememberBrowserHousehold, test } from './account-fixtures.ts'
import { getRoomComponents } from '../../shared/roomComponents.ts'
import { openRoomEditor, openRoomObjects } from './fixtures.ts'

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

async function editTable(page: Page) {
  await openRoomEditor(page)
  const editor = page.getByRole('region', { name: 'Edit Kitchen objects', exact: true })
  await editor.getByRole('button', { name: 'Edit Dining table', exact: true }).click()
  return editor
}

test('the shared header keeps its existing tools while Edit room stays inside the object menu', async ({ page, emptyHousehold: _owner }) => {
  await page.goto('/kitchen')
  const tools = page.locator('.house-tools')
  await expect(tools.getByRole('button', { name: 'Room objects', exact: true })).toBeVisible()
  await expect(tools.getByRole('button', { name: 'Edit room', exact: true })).toHaveCount(0)
  await expect(tools.getByRole('button')).toHaveCount(4)
  await expect(tools.getByRole('button', { name: 'Room objects', exact: true })).toHaveText('')
  for (const name of ['Room style', 'How to play', 'House rules']) {
    await tools.getByRole('button', { name, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  const objects = await openRoomObjects(page)
  await expect(objects.getByRole('button', { name: 'Edit room', exact: true })).toBeVisible()
  await expect(objects.getByRole('button', { name: 'Edit room', exact: true }).locator('svg')).toHaveClass(/lucide-pencil/)
})

test('Back leaves either editor section for the live object list without saving the private draft', async ({ page, accounts, emptyHousehold: owner }) => {
  await page.goto('/kitchen')
  for (const section of ['installed', 'catalog']) {
    const editor = await editTable(page)
    await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Dining table')
    await expect(editor.getByRole('button', { name: 'Apply for everyone', exact: true })).toBeDisabled()
    await editor.getByLabel('Object name', { exact: true }).fill('A private table preview')
    if (section === 'catalog') await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    const back = editor.getByRole('button', { name: 'Back to room objects', exact: true })
    await back.focus()
    await page.keyboard.press('Enter')
    await expect(editor).toHaveCount(0)
    await expect(page.locator('.game-home')).toHaveAttribute('data-edit-mode', 'false')
    await expect(page.getByRole('region', { name: 'Components.', exact: true })).toBeFocused()
    const objects = page.getByRole('region', { name: 'Kitchen objects', exact: true })
    await expect(objects.getByRole('button', { name: 'Open Dining table details', exact: true })).toBeVisible()
    await expect(objects.getByRole('button', { name: 'Edit room', exact: true })).toBeVisible()
    await expect(page.locator('.room-panel-mode')).toHaveText('Live room')
    const saved = await accounts.store.get(owner.household.id)
    expect(saved?.version).toBe(owner.household.version)
    expect(saved?.roomComponents).toEqual(owner.household.roomComponents)
  }
})

test('Back waits for a room save and becomes available after a failed apply', async ({ page, accounts, emptyHousehold: owner }) => {
  await page.goto('/kitchen')
  const editor = await editTable(page)
  await editor.getByLabel('Object name', { exact: true }).fill('A private table preview')
  let releaseSave!: () => void
  const pendingSave = new Promise<void>((resolve) => { releaseSave = resolve })
  await page.route('**/api/household/room-components', async (route) => {
    await pendingSave
    await route.fulfill({ status: 503, json: { error: 'The room could not be saved. Try again.' } })
  })
  try {
    await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
    const back = editor.getByRole('button', { name: 'Back to room objects', exact: true })
    await expect(editor).toHaveAttribute('aria-busy', 'true')
    for (const control of await editor.locator('.room-editor-toolbar button').all()) await expect(control).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(editor).toBeVisible()
    releaseSave()
    await expect(editor.getByRole('alert')).toContainText('The room could not be saved')
    await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('A private table preview')
    await expect(back).toBeEnabled()
    await back.click()
    await expect(editor).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Kitchen objects', exact: true })).toBeVisible()
    expect((await accounts.store.get(owner.household.id))?.roomComponents).toEqual(owner.household.roomComponents)
  } finally {
    releaseSave()
  }
})

test('opening admins preserves the mounted room draft and Escape closes only the dialog', async ({ page, accounts, emptyHousehold: owner }) => {
  await page.goto('/kitchen')
  const editor = await editTable(page)
  const input = editor.getByLabel('Object name', { exact: true })
  await input.fill('A private table preview')
  const originalInput = await input.elementHandle()
  await editor.getByRole('button', { name: 'Room admins', exact: true }).click()
  const admins = page.getByRole('dialog', { name: 'Household admins.', exact: true })
  await expect(admins).toBeVisible()
  await expect(page.locator('.room-editor')).toHaveCount(1)
  await expect(page.locator('.room-editor')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(admins).toHaveCount(0)
  await expect(editor).toBeVisible()
  await expect(input).toHaveValue('A private table preview')
  expect(await originalInput?.evaluate((element) => element.isConnected)).toBe(true)
  await expect(editor.getByRole('button', { name: 'Room admins', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  const saved = await accounts.store.get(owner.household.id)
  expect(saved?.roomComponents).toEqual(owner.household.roomComponents)
})

test('revoking admin access locks an open draft without discarding it or trapping Cancel', async ({ page, accounts, request }) => {
  const owner = await accounts.store.create('The shared room permissions', 'Ada', 'EUR', 45000)
  const member = { id: randomUUID(), name: 'Ben', color: '#8da48a' }
  owner.household.members.push(member)
  await accounts.store.save(owner.household)
  const admin = await accounts.store.session(owner.household, member.id)
  const promoted = await request.patch(`/api/household/room-access/${member.id}`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: { version: owner.household.version, role: 'admin' },
  })
  await expect(promoted).toBeOK()
  await rememberBrowserHousehold(page, admin)
  await page.goto('/kitchen')
  const editor = await editTable(page)
  await editor.getByLabel('Object name', { exact: true }).fill('Ben keeps this draft')
  const household = await accounts.store.get(owner.household.id)
  const revoked = await request.patch(`/api/household/room-access/${member.id}`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: { version: household?.version, role: 'member' },
  })
  await expect(revoked).toBeOK()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(editor.getByRole('alert')).toContainText('Your draft is still here')
  await expect(editor.getByLabel('Object name', { exact: true })).toHaveValue('Ben keeps this draft')
  await expect(editor.getByLabel('Object name', { exact: true })).toBeDisabled()
  await expect(editor.getByRole('button', { name: 'Apply for everyone', exact: true })).toBeDisabled()
  await expect(editor.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
  await expect(editor.getByRole('button', { name: 'Back to room objects', exact: true })).toBeEnabled()
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit room', exact: true })).toHaveCount(0)
  const saved = await accounts.store.get(owner.household.id)
  expect(getRoomComponents(saved ?? {}).find((component) => component.slotId === 'kitchen-table')?.name).toBe('Dining table')
  await expect(page.getByRole('button', { name: 'Room objects', exact: true })).toBeVisible()
})

test('failed room permissions leave daily controls usable and expose a working retry', async ({ page, accounts, emptyHousehold: owner }) => {
  await page.route('**/api/household/room-access', (route) => route.fulfill({
    status: 503, json: { error: 'Room permissions are temporarily unavailable.' },
  }))
  await page.goto('/kitchen')
  await expect(page.getByRole('alert')).toContainText('Room permissions are temporarily unavailable.')
  await expect(page.getByRole('button', { name: 'Edit room', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Room objects', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Kitchen objects', exact: true })).toBeVisible()
  await page.unroute('**/api/household/room-access')
  await page.getByRole('button', { name: 'Retry room access', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect((await openRoomObjects(page)).getByRole('button', { name: 'Edit room', exact: true })).toBeVisible()
  const saved = await accounts.store.get(owner.household.id)
  expect(saved?.roomComponents).toEqual(owner.household.roomComponents)
})

test('canceling an unconfirmed committed edit starts a fresh mutation for the next draft', async ({ page, accounts, emptyHousehold: owner }) => {
  await page.goto('/kitchen')
  const editor = await editTable(page)
  await editor.getByLabel('Object name', { exact: true }).fill('Breakfast table')
  let committedId = ''
  await page.route('**/api/household/room-components', async (route) => {
    committedId = route.request().postDataJSON().mutationId
    const response = await route.fetch({ url: `${accounts.origin}/api/household/room-components` })
    expect(response.status()).toBe(200)
    await route.fulfill({ status: 503, json: { error: 'The save response was lost. Your request is unconfirmed.' } })
  })
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('save response was lost')
  expect(getRoomComponents((await accounts.store.get(owner.household.id)) ?? {}).find((component) => component.slotId === 'kitchen-table')?.name).toBe('Breakfast table')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.unroute('**/api/household/room-components')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await openRoomEditor(page)
  await editor.getByRole('button', { name: 'Edit Breakfast table', exact: true }).click()
  await editor.getByLabel('Object name', { exact: true }).fill('Evening table')
  const request = page.waitForRequest('**/api/household/room-components')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  expect((await request).postDataJSON().mutationId).not.toBe(committedId)
  await expect(editor).toHaveCount(0)
  expect(getRoomComponents((await accounts.store.get(owner.household.id)) ?? {}).find((component) => component.slotId === 'kitchen-table')?.name).toBe('Evening table')
})

test('the same unresolved room draft retains its mutation across an informational dialog', async ({ page, accounts, emptyHousehold: owner }) => {
  await page.goto('/kitchen')
  const editor = await editTable(page)
  await editor.getByLabel('Object name', { exact: true }).fill('One confirmed table')
  let firstId = ''
  await page.route('**/api/household/room-components', async (route) => {
    firstId = route.request().postDataJSON().mutationId
    await route.fulfill({ status: 503, json: { error: 'The room change could not be confirmed.' } })
  })
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('could not be confirmed')
  await editor.getByRole('button', { name: 'Room admins', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.unroute('**/api/household/room-components')
  const request = page.waitForRequest('**/api/household/room-components')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  expect((await request).postDataJSON().mutationId).toBe(firstId)
  await expect(editor).toHaveCount(0)
  expect((await accounts.store.get(owner.household.id))?.version).toBe(1)
})

test('reviewing a changed draft after a lost commit permits a new confirmed edit', async ({ page, accounts, emptyHousehold: owner }) => {
  await page.goto('/kitchen')
  const editor = await editTable(page)
  await editor.getByLabel('Object name', { exact: true }).fill('First saved table')
  let committedId = ''
  let intercepted = false
  await page.route('**/api/household/room-components', async (route) => {
    if (intercepted) { await route.fallback(); return }
    intercepted = true
    committedId = route.request().postDataJSON().mutationId
    const response = await route.fetch({ url: `${accounts.origin}/api/household/room-components` })
    expect(response.status()).toBe(200)
    await route.fulfill({ status: 503, json: { error: 'The confirmation was lost.' } })
  })
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('confirmation was lost')
  await editor.getByLabel('Object name', { exact: true }).fill('Reviewed table')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Keep my draft', exact: true })).toBeVisible()
  await editor.getByRole('button', { name: 'Keep my draft', exact: true }).click()
  const request = page.waitForRequest('**/api/household/room-components')
  await editor.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  expect((await request).postDataJSON().mutationId).not.toBe(committedId)
  await expect(editor).toHaveCount(0)
  expect(getRoomComponents((await accounts.store.get(owner.household.id)) ?? {}).find((component) => component.slotId === 'kitchen-table')?.name).toBe('Reviewed table')
})
