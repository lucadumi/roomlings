import { randomUUID } from 'node:crypto'
import type { Page, Route } from '@playwright/test'
import { accountCookieName } from '../../server/accounts-api.ts'
import { accountRecoveryCodeSchema, accountStateSchema } from '../../shared/accounts.ts'
import { localDate } from '../../shared/domain.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import {
  accountState, browserAccountRequest, closeAccountContext, expect, routeAccountApi, test,
} from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'

test.use({ reducedMotion: 'reduce' })

async function signedIn(page: Page, accounts: AccountHarness, withKitchen = true) {
  await page.goto('/')
  await accounts.provider.send('recovery@example.com')
  const login = await browserAccountRequest(page, '/account/verify', {
    email: 'recovery@example.com', code: accounts.provider.codeFor('recovery@example.com'),
    name: 'Ada', label: 'Original account browser',
  })
  expect(login.status).toBe(200)
  if (withKitchen) {
    const created = await browserAccountRequest(page, '/account/households', {
      name: 'The account recovery home', memberName: 'Ada', currency: 'EUR', budget: 45000,
    })
    expect(created.status).toBe(201)
    const state = accountStateSchema.parse(created.body)
    if (!state.session) throw new Error('The original kitchen was not created.')
    const household = state.session.household
    household.members.push({ id: randomUUID(), name: 'Ben', color: '#7d9070' })
    household.expenses.push({
      id: randomUUID(), description: 'An existing shared receipt', amount: 1201, paidBy: state.session.memberId,
      participants: household.members.map((member) => member.id), category: 'produce',
      date: localDate(), createdAt: new Date().toISOString(),
    })
    await accounts.store.save(household)
  }
  await page.goto(`${roomPath()}#account`)
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Your Roomlings account.')
  return accountState(page)
}

async function currentSession(page: Page, accounts: AccountHarness) {
  const cookie = (await page.context().cookies()).find((item) => item.name === accountCookieName)
  if (!cookie) throw new Error('The isolated account cookie is missing.')
  const session = await accounts.store.accounts.authenticate(cookie.value)
  if (!session) throw new Error('The isolated account session is unavailable.')
  return session
}

async function openCodes(page: Page) {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Manage recovery codes', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Your account recovery codes.')
  await expect(dialog.getByRole('button', { name: 'Generate recovery codes', exact: true })).toBeVisible()
}

async function generateCodes(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Generate recovery codes', exact: true }).click()
  const output = page.getByRole('dialog').getByLabel('Your account recovery codes', { exact: true })
  await expect(output).toBeVisible()
  const codes = (await output.inputValue()).split('\n')
  expect(codes).toHaveLength(10)
  expect(new Set(codes).size).toBe(10)
  expect(codes.every((code) => accountRecoveryCodeSchema.safeParse(code).success)).toBe(true)
  return codes
}

async function enterRecovery(page: Page, code: string, label = 'Recovered browser') {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Use an account recovery code', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Recover your account.')
  await dialog.getByLabel('Email address', { exact: true }).fill('recovery@example.com')
  await dialog.getByLabel('Account recovery code', { exact: true }).fill(code)
  await dialog.getByLabel('Name this browser', { exact: true }).fill(label)
  await dialog.getByRole('button', { name: 'Recover my account', exact: true }).click()
}

test('copies a one-time code set and restores the same account on another device without email', async ({ page, accounts, browser, baseURL }) => {
  if (!baseURL) throw new Error('Account recovery needs the isolated browser origin.')
  await page.setViewportSize({ width: 390, height: 844 })
  const before = await signedIn(page, accounts)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await openCodes(page)
  const codes = await generateCodes(page)
  const dialog = page.getByRole('dialog')
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await dialog.getByRole('button', { name: 'Copy all recovery codes', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Recovery codes copied', exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(codes.join('\n'))
  expect(await page.evaluate((values) => values.some((code) =>
    [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) => String(value).includes(code))), codes)).toBe(false)
  expect(codes.some((code) => page.url().includes(code))).toBe(false)
  await dialog.getByRole('button', { name: 'I saved these codes', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: '10 unused recovery codes', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Your account recovery codes', { exact: true })).toHaveCount(0)

  accounts.provider.failDelivery = true
  const phoneContext = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
  try {
    const phone = await phoneContext.newPage()
    await routeAccountApi(phone, accounts)
    const emailRequests: string[] = []
    phone.on('request', (request) => {
      if (/\/api\/account\/(?:code|verify)$/.test(new URL(request.url()).pathname)) emailRequests.push(request.url())
    })
    await phone.goto(roomPath())
    await enterRecovery(phone, codes[0].toUpperCase(), 'Recovered phone')
    await expect(phone.getByRole('dialog')).toHaveCount(0)
    await expect(phone.locator('.game-house')).toContainText('The account recovery home')
    const recovered = await accountState(phone)
    expect(recovered.account).toEqual(before.account)
    expect(recovered.memberships).toEqual(before.memberships)
    expect(recovered.session).toEqual(before.session)
    expect((await accountState(page)).account?.id).toBe(before.account?.id)
    expect(emailRequests).toEqual([])
    await phone.reload()
    await expect(phone.locator('.game-house')).toContainText('The account recovery home')
    await expect(phone.getByRole('dialog')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Refresh recovery code status', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: '9 unused recovery codes', exact: true })).toBeVisible()
  } finally {
    await closeAccountContext(phoneContext)
  }
})

test('account recovery opens the requested bathroom with the same household and ledger', async ({ page, accounts }) => {
  const before = await signedIn(page, accounts)
  const session = await currentSession(page, accounts)
  const generated = await accounts.store.accounts.generateRecoveryCodes(session, 0)
  expect((await browserAccountRequest(page, '/account/logout', { all: false })).status).toBe(200)
  await page.goto(roomPath('bathroom'))
  await enterRecovery(page, generated.codes[0])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toContainText('Bathroom')
  await expect(page).toHaveURL(new RegExp(`${roomPath('bathroom')}$`))
  const restored = await accountState(page)
  expect(restored.account).toEqual(before.account)
  expect(restored.session).toEqual(before.session)
  expect(restored.memberships).toEqual(before.memberships)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toContainText('Bathroom')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('keeps recovery input through failures, distinguishes kitchen codes and returns to email without losing the address', async ({ page, accounts }) => {
  await signedIn(page, accounts, false)
  const session = await currentSession(page, accounts)
  const generated = await accounts.store.accounts.generateRecoveryCodes(session, 0)
  expect((await browserAccountRequest(page, '/account/logout', { all: false })).status).toBe(200)
  await page.reload()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email address', { exact: true }).fill('recovery@example.com')
  await dialog.getByRole('button', { name: 'Use an account recovery code', exact: true }).click()
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveValue('recovery@example.com')
  await dialog.getByRole('button', { name: 'Use email sign-in', exact: true }).click()
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveValue('recovery@example.com')
  await dialog.getByRole('button', { name: 'Use an account recovery code', exact: true }).click()
  await dialog.getByLabel('Account recovery code', { exact: true }).fill(`roomlings-${'a'.repeat(43)}`)
  await dialog.getByRole('button', { name: 'Recover my account', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('not an email code or a kitchen recovery code')
  await page.route('**/api/account/recover', (route) => route.fulfill({
    status: 503, json: { error: 'Account recovery is temporarily unavailable.' },
  }))
  await dialog.getByLabel('Account recovery code', { exact: true }).fill(generated.codes[0])
  await dialog.getByLabel('Name this browser', { exact: true }).fill('Retained browser name')
  await dialog.getByRole('button', { name: 'Recover my account', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('temporarily unavailable')
  await expect(dialog.getByLabel('Account recovery code', { exact: true })).toHaveValue(generated.codes[0])
  await expect(dialog.getByLabel('Name this browser', { exact: true })).toHaveValue('Retained browser name')
  expect((await accountState(page)).account).toBeNull()
  await page.unroute('**/api/account/recover')
  await dialog.getByRole('button', { name: 'Recover my account', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Your Roomlings account.')
  await expect(dialog.getByRole('status')).toContainText('cannot be reused')
  expect((await accountState(page)).account?.id).toBe(session.accountId)
  expect((await browserAccountRequest(page, '/account/logout', { all: false })).status).toBe(200)
  await page.reload()
  await enterRecovery(page, generated.codes[0])
  await expect(dialog.getByRole('alert')).toHaveText('Recovery code invalid or used. Try another code.')
  await expect(dialog.getByLabel('Account recovery code', { exact: true })).toHaveValue(generated.codes[0])
})

test('handles failed generation, replacement and revocation without claiming success or losing valid codes', async ({ page, accounts }) => {
  await signedIn(page, accounts, false)
  const session = await currentSession(page, accounts)
  await page.setViewportSize({ width: 320, height: 568 })
  await openCodes(page)
  const dialog = page.getByRole('dialog')
  await page.route('**/api/account/recovery', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: 'Recovery codes could not be saved.' } }) : route.fallback())
  await dialog.getByRole('button', { name: 'Generate recovery codes', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('could not be saved')
  await expect(dialog.getByLabel('Your account recovery codes', { exact: true })).toHaveCount(0)
  expect((await accounts.store.accounts.recoveryState(session)).remaining).toBe(0)
  await page.unroute('**/api/account/recovery')
  const first = await generateCodes(page)
  await dialog.getByRole('button', { name: 'I saved these codes', exact: true }).click()
  await page.route('**/api/account/recovery', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: 'Replacement was not saved.' } }) : route.fallback())
  await dialog.getByRole('button', { name: 'Replace recovery codes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Replace recovery codes', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('not saved')
  expect((await accounts.store.accounts.recoveryState(session)).remaining).toBe(10)
  await page.unroute('**/api/account/recovery')
  await dialog.getByRole('button', { name: 'Replace recovery codes', exact: true }).click()
  const replacement = (await dialog.getByLabel('Your account recovery codes', { exact: true }).inputValue()).split('\n')
  expect(replacement).toHaveLength(10)
  expect(replacement.some((code) => first.includes(code))).toBe(false)
  await dialog.getByRole('button', { name: 'I saved these codes', exact: true }).click()
  await page.route('**/api/account/recovery', (route) => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 503, json: { error: 'The recovery codes were not revoked.' } }) : route.fallback())
  await dialog.getByRole('button', { name: 'Revoke recovery codes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Revoke recovery codes', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('not revoked')
  expect((await accounts.store.accounts.recoveryState(session)).remaining).toBe(10)
  await page.unroute('**/api/account/recovery')
  await dialog.getByRole('button', { name: 'Revoke recovery codes', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: '0 unused recovery codes', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Generate recovery codes', exact: true })).toBeVisible()
  expect((await accountState(page)).account?.id).toBe(session.accountId)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})

test('returns to recovery settings after fresh account-code authentication without automatically replacing the set', async ({ page, accounts }) => {
  await signedIn(page, accounts)
  await openCodes(page)
  const codes = await generateCodes(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'I saved these codes', exact: true }).click()
  await page.route('**/api/account/recovery', (route) => route.request().method() === 'POST'
    ? route.fulfill({
      status: 401, json: { error: 'Sign in again before changing recovery codes.', code: 'REAUTHENTICATION_REQUIRED' },
    }) : route.fallback())
  await dialog.getByRole('button', { name: 'Replace recovery codes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Replace recovery codes', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Use an account recovery code', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Use an account recovery code', exact: true }).click()
  await expect(dialog.getByLabel('Email address', { exact: true })).toBeDisabled()
  await dialog.getByLabel('Account recovery code', { exact: true }).fill(codes[0])
  await dialog.getByRole('button', { name: 'Recover my account', exact: true }).click()
  await expect(dialog).toHaveAccessibleName('Your account recovery codes.')
  await expect(dialog.getByRole('heading', { name: '9 unused recovery codes', exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Your account recovery codes', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/account/recovery')
  await dialog.getByRole('button', { name: 'Replace recovery codes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Replace recovery codes', exact: true }).click()
  await expect(dialog.getByLabel('Your account recovery codes', { exact: true })).toBeVisible()
})

test('retains an account invitation through recovery-code sign-in', async ({ page, accounts }) => {
  const guest = await signedIn(page, accounts, false)
  const session = await currentSession(page, accounts)
  const recovery = await accounts.store.accounts.generateRecoveryCodes(session, 0)
  const host = await accounts.store.accounts.signIn({ providerId: randomUUID(), email: 'host@example.com' }, 'Host', 'Host browser')
  const created = await accounts.store.accounts.createHousehold(host.session, {
    name: 'The invitation home', memberName: 'Host', currency: 'EUR', budget: 45000,
  })
  if (!created.session) throw new Error('The host kitchen was not created.')
  const invitation = await accounts.store.accounts.invite(host.session, created.session.household.id, created.session.household.version, 7)
  expect((await browserAccountRequest(page, '/account/logout', { all: false })).status).toBe(200)
  await page.goto(`${roomPath()}#account-invite=${encodeURIComponent(invitation.code)}`)
  await enterRecovery(page, recovery.codes[0])
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Account invitation link or code', { exact: true })).toHaveValue(invitation.code)
  expect((await accountState(page)).account?.id).toBe(guest.account?.id)
  expect((await accountState(page)).memberships).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Accept kitchen invitation', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.game-house')).toContainText('The invitation home')
  expect((await accountState(page)).memberships).toHaveLength(1)
})

test('hides displayed recovery codes when the account session is revoked during an ordinary refresh', async ({ page, accounts }) => {
  await signedIn(page, accounts)
  const session = await currentSession(page, accounts)
  await openCodes(page)
  const codes = await generateCodes(page)
  await accounts.store.accounts.logout(session, false)
  await expect(page.getByRole('dialog').getByLabel('Your account recovery codes', { exact: true })).toHaveCount(0, { timeout: 20_000 })
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Send sign-in code', exact: true })).toBeVisible()
  expect(codes.some((code) => page.url().includes(code))).toBe(false)
  expect((await accounts.store.accounts.recoverAccount({ email: 'recovery@example.com', code: codes[0], label: 'Still an unused backup' })).session.accountId).toBe(session.accountId)
})

test('ignores a private code-generation response after the browser changes to another account', async ({ page, accounts }) => {
  await signedIn(page, accounts)
  await openCodes(page)
  let receive!: (route: Route) => void
  const pending = new Promise<Route>((resolve) => { receive = resolve })
  await page.route('**/api/account/recovery', (route) => {
    if (route.request().method() === 'POST') receive(route)
    else void route.fallback()
  })
  await page.getByRole('button', { name: 'Generate recovery codes', exact: true }).click()
  const delayed = await pending
  const response = await delayed.fetch({ url: `${accounts.origin}/api/account/recovery` })
  expect(response.status()).toBe(200)
  const switcher = await page.context().newPage()
  try {
    await routeAccountApi(switcher, accounts)
    await switcher.goto('/')
    await accounts.provider.send('other@example.com')
    const changed = await browserAccountRequest(switcher, '/account/verify', {
      email: 'other@example.com', code: accounts.provider.codeFor('other@example.com'), name: 'Another account', label: 'Other browser',
    })
    expect(changed.status).toBe(200)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('dialog').getByText('other@example.com (verified)', { exact: false })).toBeVisible()
    const completed = page.waitForResponse((item) => item.url().endsWith('/api/account/recovery') && item.request().method() === 'POST')
    await delayed.fulfill({ response })
    await (await completed).finished()
    await expect(page.getByRole('dialog').getByLabel('Your account recovery codes', { exact: true })).toHaveCount(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Manage recovery codes', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: '0 unused recovery codes', exact: true })).toBeVisible()
  } finally {
    await switcher.unrouteAll({ behavior: 'wait' })
    await switcher.close()
  }
})
