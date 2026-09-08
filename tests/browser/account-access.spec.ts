import { randomUUID } from 'node:crypto'
import type { Page, Route } from '@playwright/test'
import { balances, localDate } from '../../shared/domain.ts'
import type { SavedKitchen } from '../../src/api.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { savedKitchen } from './fixtures.ts'
import { accountState, browserAccountRequest, expect, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'

test.use({ reducedMotion: 'reduce' })

async function remember(page: Page, kitchens: SavedKitchen[], options: {
  prefix?: 'roomlings' | 'coldshare'; token?: string; mode?: 'account' | 'browser'
} = {}) {
  await page.addInitScript(({ kitchens, options }) => {
    if (localStorage.getItem('access-regression.seeded')) return
    const prefix = options.prefix ?? 'roomlings'
    localStorage.setItem(`${prefix}.kitchens`, JSON.stringify(kitchens))
    if (options.token) localStorage.setItem(`${prefix}.session`, options.token)
    if (options.mode) localStorage.setItem('roomlings.access-mode', options.mode)
    localStorage.setItem('access-regression.seeded', 'true')
  }, { kitchens, options })
}

async function revokedKitchen(accounts: AccountHarness, name = 'The retained household') {
  const original = await accounts.store.create(name, 'Ada', 'EUR', 45000)
  const roommate = { id: randomUUID(), name: 'Ben', color: '#7d9070' }
  original.household.members.push(roommate)
  original.household.expenses.push({
    id: randomUUID(), description: 'An original shared receipt', amount: 1201,
    paidBy: original.memberId, participants: [original.memberId, roommate.id],
    category: 'produce', date: localDate(), createdAt: new Date().toISOString(),
  })
  await accounts.store.save(original.household)
  const access = await accounts.store.authenticate(original.token)
  if (!access) throw new Error('The original browser was not created.')
  const recovery = await accounts.store.rotateRecovery(access, { version: 0, revokeOthers: false })
  if (!recovery || recovery === 'conflict') throw new Error('The recovery code was not created.')
  const keeper = await accounts.store.recover(recovery.code, 'Another saved browser')
  const keptAccess = keeper && await accounts.store.authenticate(keeper.token)
  if (!keptAccess) throw new Error('A second browser is needed to revoke the original.')
  await accounts.store.revokeDevice(keptAccess, access.sessionId)
  expect(await accounts.store.authenticate(original.token)).toBeNull()
  return { original, code: recovery.code }
}

async function signIn(page: Page, accounts: AccountHarness) {
  await page.goto('/#account')
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email address', { exact: true }).fill('access@example.com')
  await dialog.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  await expect(dialog.getByLabel('Email sign-in code', { exact: true })).toBeVisible()
  await dialog.getByLabel('Email sign-in code', { exact: true }).fill(accounts.provider.codeFor('access@example.com'))
  await dialog.getByLabel('Account display name', { exact: true }).fill('Ada Account')
  await dialog.getByRole('button', { name: 'Verify and sign in', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Your Roomlings account.')
}

test('retains expired Coldshare shortcuts and recovers the same roommate and ledger', async ({ page, accounts }) => {
  const { original, code } = await revokedKitchen(accounts)
  await remember(page, [savedKitchen(original)], { prefix: 'coldshare', token: original.token })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(roomPath())
  const dialog = page.getByRole('dialog')
  const recover = dialog.getByRole('button', { name: 'Recover access to The retained household', exact: true })
  await expect(dialog.getByText('Access expired', { exact: true })).toBeVisible()
  await expect(recover).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Open saved The retained household', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('coldshare.kitchens') ?? '[]')[0].expired)).toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).toBe(original.token)
  await page.reload()
  await expect(recover).toBeVisible()
  await recover.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveAccessibleName('Come back as yourself.')
  await dialog.getByLabel('Recovery code', { exact: true }).fill(code)
  await dialog.getByLabel('Name this browser', { exact: true }).fill('Recovered phone')
  await dialog.getByRole('button', { name: 'Recover my access', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.game-house')).toContainText(original.household.name)
  await expect(page.locator('.player-button')).toHaveAttribute('aria-label', 'The roommates, playing as Ada')
  const restored = await accounts.store.get(original.household.id)
  expect(restored).toEqual(original.household)
  if (!restored) throw new Error('Recovery lost the original ledger.')
  expect([...balances(restored)]).toEqual([...balances(original.household)])
  const shortcuts: SavedKitchen[] = await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))
  expect(shortcuts).toHaveLength(1)
  expect(shortcuts[0].memberId).toBe(original.memberId)
  expect(shortcuts[0].token).not.toBe(original.token)
  expect(shortcuts[0].expired).toBeUndefined()
  expect((await accountState(page)).account).toBeNull()
  await page.reload()
  await expect(page.locator('.game-house')).toContainText(original.household.name)
})

test('does not replace a requested recovery form when expired access finishes loading', async ({ page, accounts }) => {
  const { original, code } = await revokedKitchen(accounts)
  await remember(page, [savedKitchen(original)], { token: original.token })
  let receive!: (route: Route) => void
  const pending = new Promise<Route>((resolve) => { receive = resolve })
  await page.route('**/api/household', receive)
  await page.goto(`${roomPath()}#recover`)
  const oldAccess = await pending
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Recovery code', { exact: true }).fill(code)
  await dialog.getByLabel('Name this browser', { exact: true }).fill('An uninterrupted draft')
  const response = page.waitForResponse('**/api/household')
  await oldAccess.fallback()
  await (await response).finished()
  await expect(dialog).toHaveAccessibleName('Come back as yourself.')
  await expect(dialog.getByLabel('Recovery code', { exact: true })).toHaveValue(code)
  await expect(dialog.getByLabel('Name this browser', { exact: true })).toHaveValue('An uninterrupted draft')
  await expect(dialog.getByLabel('Name this browser', { exact: true })).toBeFocused()
  await page.unroute('**/api/household')
  await dialog.getByRole('button', { name: 'Recover my access', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText(original.household.name)
})

test('keeps a temporarily unavailable shortcut retryable without changing the chosen access', async ({ page, accounts }) => {
  const original = await accounts.store.create('The offline shortcut', 'Ada', 'EUR', 45000)
  await remember(page, [savedKitchen(original)], { mode: 'account' })
  await page.route('**/api/household', (route) => route.fulfill({
    status: 503, json: { error: 'This kitchen is temporarily unavailable. Try again.' },
  }))
  await page.goto(roomPath())
  const dialog = page.getByRole('dialog')
  const open = dialog.getByRole('button', { name: 'Open saved The offline shortcut', exact: true })
  await open.click()
  await expect(dialog.getByRole('alert')).toContainText('temporarily unavailable')
  await expect(open).toBeEnabled()
  await expect(dialog.getByText('Access expired', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]')[0].expired)).toBeUndefined()
  expect(await page.evaluate(() => localStorage.getItem('roomlings.access-mode'))).toBe('account')
  await page.unroute('**/api/household')
  await open.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.game-house')).toContainText(original.household.name)
})

test('rechecks a rejected startup on explicit retry instead of reusing the expired result', async ({ page, accounts }) => {
  const original = await accounts.store.create('The retried household', 'Ada', 'EUR', 45000)
  await remember(page, [savedKitchen(original)], { token: original.token })
  await page.route('**/api/household', (route) => route.fulfill({
    status: 401, json: { error: 'The saved browser access was rejected.' },
  }))
  await page.goto('/kitchen')
  await expect(page.getByRole('alert')).toContainText('no longer active')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]')[0].expired)).toBe(true)
  await page.unroute('**/api/household')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText(original.household.name)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]')[0].expired)).toBeUndefined()
})

test('offers recovery after a rejected kitchen switch without discarding the current household', async ({ page, accounts }) => {
  const current = await accounts.store.create('The current household', 'Riley', 'EUR', 45000)
  const { original, code } = await revokedKitchen(accounts)
  await remember(page, [savedKitchen(current), savedKitchen(original)], { token: current.token })
  await page.goto(roomPath())
  await expect(page.locator('.game-house')).toContainText(current.household.name)
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  const shortcuts = page.locator('.saved-kitchens')
  await shortcuts.getByRole('button', { name: /The retained household/ }).click()
  await expect(shortcuts).toContainText('Access expired')
  await expect(page.locator('.game-house')).toContainText(current.household.name)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(current.token)
  await shortcuts.getByRole('button', { name: 'Recover access to The retained household', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Recovery code', { exact: true }).fill(code)
  await page.getByRole('button', { name: 'Recover my access', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText(original.household.name)
  const saved: SavedKitchen[] = await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))
  expect(saved).toHaveLength(2)
  expect(saved.some((kitchen) => kitchen.token === current.token)).toBe(true)
})

test('retains retired example shortcuts without offering them as household access', async ({ page, accounts }) => {
  const personal = await accounts.store.create('The available household', 'Ada', 'EUR', 45000)
  const retired = {
    token: 'retired-example-access-token-1234567890',
    householdId: randomUUID(),
    memberId: randomUUID(),
    name: 'The retired example',
    memberName: 'You',
    demo: true,
  }
  await page.addInitScript(({ retired, personal }) => {
    localStorage.setItem('roomlings.session', personal.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([retired, personal]))
    localStorage.setItem('roomlings.access-mode', 'browser')
  }, { retired, personal: savedKitchen(personal) })
  await page.goto(roomPath())
  await expect(page.locator('.game-house')).toContainText(personal.household.name)
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await expect(page.getByText(retired.name, { exact: true })).toHaveCount(0)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))
  expect(stored).toHaveLength(2)
  expect(stored).toContainEqual(retired)
})

test('keeps account sign-in and original history when a saved link needs recovery', async ({ page, accounts }) => {
  const { original, code } = await revokedKitchen(accounts)
  await remember(page, [savedKitchen(original)])
  await signIn(page, accounts)
  const before = await accountState(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Link existing kitchen access', exact: true }).click()
  await dialog.getByRole('button', { name: 'Link Ada in The retained household', exact: true }).click()
  await dialog.getByRole('button', { name: 'Link this identity', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('invalid or revoked')
  await expect(dialog.getByText('Access expired', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Link Ada in The retained household', exact: true })).toHaveCount(0)
  expect((await accountState(page)).account?.id).toBe(before.account?.id)
  await dialog.getByRole('button', { name: 'Recover access to The retained household', exact: true }).click()
  await expect(dialog.getByLabel('Existing roommate recovery code', { exact: true })).toBeFocused()
  await dialog.getByLabel('Existing roommate recovery code', { exact: true }).fill(code)
  await dialog.getByRole('button', { name: 'Link recovery identity to my account', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Open The retained household', exact: true })).toBeVisible()
  const linked = await accountState(page)
  expect(linked.memberships).toHaveLength(1)
  expect(linked.session?.memberId).toBe(original.memberId)
  expect(linked.session?.household.expenses).toEqual(original.household.expenses)
  expect(linked.session?.household.members).toEqual(original.household.members)
  expect(await accounts.store.authenticate(original.token)).toBeNull()
})

for (const outcome of ['succeeds', 'fails'] as const) {
  test(`ignores a delayed recovery that ${outcome} after a newer account selection`, async ({ page, accounts }) => {
    const { code } = await revokedKitchen(accounts)
    await signIn(page, accounts)
    const created = await browserAccountRequest(page, '/account/households', {
      name: 'The chosen account home', memberName: 'Ada Account', currency: 'EUR', budget: 45000,
    })
    expect(created.status).toBe(201)
    await page.goto(`${roomPath()}#recover`)
    await expect(page.locator('.game-house')).toContainText('The chosen account home')
    let receive!: (route: Route) => void
    const pending = new Promise<Route>((resolve) => { receive = resolve })
    await page.route('**/api/recover', receive)
    await page.getByRole('dialog').getByLabel('Recovery code', { exact: true }).fill(code)
    await page.getByRole('button', { name: 'Recover my access', exact: true }).click()
    const delayed = await pending
    await page.evaluate(() => { location.hash = 'account' })
    await page.getByRole('dialog').getByRole('button', { name: 'Open The chosen account home', exact: true }).click()
    const response = page.waitForResponse('**/api/recover')
    if (outcome === 'succeeds') await delayed.fallback()
    else await delayed.fulfill({ status: 503, json: { error: 'The older recovery request failed.' } })
    await (await response).finished()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.locator('.game-house')).toContainText('The chosen account home')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('roomlings.access-mode'))).toBe('account')
    expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBeNull()
  })
}
