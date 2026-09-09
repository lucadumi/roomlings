import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, routeAccountApi, test } from './account-fixtures.ts'
import { openRoomObjects, pauseRequest } from './fixtures.ts'
import type { Session } from '../../shared/domain.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

async function remember(page: Page, session: Session | null, legacyKey = false) {
  await page.addInitScript(({ token, legacy }) => {
    if (token) localStorage.setItem(legacy ? 'coldshare.session' : 'roomlings.session', token)
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, contextId: string, options?: unknown) {
        return contextId.startsWith('webgl') ? null : Reflect.apply(original, this, [contextId, options])
      },
    })
  }, { token: session?.token ?? null, legacy: legacyKey })
}

async function openAdmins(page: Page) {
  if (!await page.getByRole('button', { name: 'Household admins', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Household admins', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Household admins.', exact: true })
  await expect(dialog.getByRole('heading', { name: 'Room admins', exact: true })).toBeVisible()
  return dialog
}

test('browser identities confirm delegated rights, retain owner protection and refresh another roommate editing access', async ({ page, accounts, browser, baseURL }) => {
  const owner = await accounts.store.create('The permission home', 'Ada', 'EUR', 45000)
  const ben = { id: randomUUID(), name: 'Ben', color: '#7d9070' }
  const cy = { id: randomUUID(), name: 'Cy', color: '#7c89a1' }
  owner.household.members.push(ben, cy)
  await accounts.store.save(owner.household)
  const roommate = await accounts.store.session(owner.household, ben.id)
  await remember(page, owner, true)
  const second = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
  try {
    const other = await second.newPage()
    await routeAccountApi(other, accounts)
    await remember(other, roommate)
    await other.goto('/kitchen')
    await expect(other.locator('.game-house')).toContainText('The permission home')
    await openRoomObjects(other)
    await expect(other.getByRole('button', { name: 'Edit room', exact: true })).toHaveCount(0)
    await page.goto('/kitchen')
    const dialog = await openAdmins(page)
    await expect(dialog.getByRole('button', { name: /(?:Make Ada an admin|Remove admin rights from Ada)/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Make Ben an admin', exact: true }).click()
    const confirmation = dialog.getByRole('group', { name: 'Make Ben an admin?', exact: true })
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(confirmation).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Make Ben an admin', exact: true })).toBeFocused()
    expect(await accounts.store.accounts.roomRole(owner.household, ben.id)).toBe('member')
    await dialog.getByRole('button', { name: 'Make Ben an admin', exact: true }).click()
    await dialog.getByRole('button', { name: 'Confirm admin access', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await other.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(other.getByRole('button', { name: 'Edit room', exact: true })).toBeVisible()
    const adminDialog = await openAdmins(other)
    await expect(adminDialog.getByRole('button', { name: /(?:Make Ada an admin|Remove admin rights from Ada)/ })).toHaveCount(0)
    await adminDialog.getByRole('button', { name: 'Make Cy an admin', exact: true }).click()
    await adminDialog.getByRole('button', { name: 'Confirm admin access', exact: true }).click()
    await expect(adminDialog).toHaveCount(0)
    expect(await accounts.store.accounts.roomRole(owner.household, cy.id)).toBe('admin')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await openAdmins(page)
    await dialog.getByRole('button', { name: 'Remove admin rights from Ben', exact: true }).click()
    const removal = dialog.getByRole('group', { name: 'Remove admin rights from Ben?', exact: true })
    await expect(removal).toContainText('keep shared shopping, chores, ledger and daily room access')
    await removal.getByRole('button', { name: 'Confirm removal of admin rights', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await other.evaluate(() => window.dispatchEvent(new Event('focus')))
    await openRoomObjects(other)
    await expect(other.getByRole('button', { name: 'Edit room', exact: true })).toHaveCount(0)
    await openAdmins(other)
    await expect(adminDialog.getByText('Ask the owner or an admin if you need room editing access.', { exact: true })).toBeVisible()
    await expect(adminDialog.getByRole('button', { name: /(?:Make .* an admin|Remove admin rights from)/ })).toHaveCount(0)
    expect(await accounts.store.accounts.roomRole(owner.household, owner.memberId)).toBe('owner')
  } finally {
    for (const other of second.pages()) await other.unrouteAll({ behavior: 'wait' })
    await second.close()
  }
})

test('a failed delegation shows the error, leaves roles unchanged and returns keyboard focus for an explicit retry', async ({ page, accounts }) => {
  const owner = await accounts.store.create('An honest permission save', 'Ada', 'EUR', 45000)
  const ben = { id: randomUUID(), name: 'Ben', color: '#7d9070' }
  owner.household.members.push(ben)
  await accounts.store.save(owner.household)
  await remember(page, owner)
  await page.goto('/kitchen')
  const dialog = await openAdmins(page)
  const pending = await pauseRequest(page, `**/api/household/room-access/${ben.id}`)
  await dialog.getByRole('button', { name: 'Make Ben an admin', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm admin access', exact: true }).click()
  const route = await pending.pending
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled()
  expect(await accounts.store.accounts.roomRole(owner.household, ben.id)).toBe('member')
  await route.fulfill({ status: 503, json: { error: 'Admin access was not saved. Please retry.' } })
  await expect(dialog.getByRole('alert')).toContainText('Admin access was not saved. Please retry.')
  await expect(dialog.getByRole('button', { name: 'Make Ben an admin', exact: true })).toBeFocused()
  await expect(page.locator('.toast')).toHaveCount(0)
  expect(await accounts.store.accounts.roomRole(owner.household, ben.id)).toBe('member')
  await page.unroute(`**/api/household/room-access/${ben.id}`)
  await dialog.getByRole('button', { name: 'Make Ben an admin', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm admin access', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await accounts.store.accounts.roomRole(owner.household, ben.id)).toBe('admin')
})

test.describe('account admin labels', () => {
  test.use({ providerEnabled: true })

  test('represents an admin as an admin rather than an owner and keeps owner-only account controls absent', async ({ page, accounts, baseURL }) => {
    if (!baseURL) throw new Error('The isolated account browser needs a base URL.')
    const owner = await accounts.store.create('The account admin home', 'Ada', 'EUR', 45000)
    const ben = { id: randomUUID(), name: 'Ben', color: '#7d9070' }
    owner.household.members.push(ben)
    await accounts.store.save(owner.household)
    const browser = await accounts.store.session(owner.household, ben.id)
    const account = await accounts.store.accounts.signIn({ providerId: randomUUID(), email: 'admin@example.com' }, 'Ada', 'Admin browser')
    await accounts.store.accounts.link(account.session, { token: browser.token })
    await accounts.store.transaction(async () => {
      const household = (await accounts.store.get(owner.household.id))!
      await accounts.store.accounts.setRoomRole(household, owner.memberId, ben.id, 'admin')
      household.version++
      await accounts.store.save(household)
    })
    await page.context().addCookies([{
      name: 'roomlings_session', value: account.token, url: new URL('/api/', baseURL).href, httpOnly: true, sameSite: 'Lax',
    }])
    await remember(page, null)
    await page.goto('/kitchen')
    await openRoomObjects(page)
    await expect(page.getByRole('button', { name: 'Edit room', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'The roommates', exact: true }).click()
    await page.getByRole('button', { name: 'Account and membership', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const membership = dialog.locator('.device-row').filter({ hasText: 'The account admin home' })
    await expect(membership.getByText('Admin', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Manage The account admin home', exact: true }).click()
    await expect(dialog).toHaveAccessibleName('Who shares this kitchen?')
    await expect(dialog.getByText('You are an admin.', { exact: false })).toBeVisible()
    await expect(dialog.getByText('Admin; account linked', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Owner; browser access only', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Make .* owner|Remove .*|Create seven-day invitation/ })).toHaveCount(0)
  })
})
