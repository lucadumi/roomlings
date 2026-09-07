import type { Page } from '@playwright/test'
import { accountState, browserAccountRequest, expect, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'
import { roomPath, samplePath } from '../../src/roomNavigation.ts'
import { openGroceryForm } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

async function signedInVisitor(page: Page, accounts: AccountHarness, createKitchen = true) {
  await page.goto('/')
  const email = 'returning@example.com'
  await accounts.provider.send(email)
  const signedIn = await browserAccountRequest(page, '/account/verify', {
    email, code: accounts.provider.codeFor(email), name: 'Robin', label: 'Returning browser',
  })
  expect(signedIn.status).toBe(200)
  if (createKitchen) {
    const created = await browserAccountRequest(page, '/account/households', {
      name: 'The signed-in home', memberName: 'Robin', currency: 'EUR', budget: 45000,
    })
    expect(created.status).toBe(201)
  }
  return accountState(page)
}

test('the home page does not read account access, create a demo or open a sign-in dialog', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Share a home.')
  await expect(page.getByRole('status').filter({ hasText: 'Checking saved access' })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.game-house')).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  expect(requests).toEqual([])
})

test('the landing carries a new account through sign-in, kitchen creation, return and sign-out', async ({ page, accounts }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const demos: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/demo') demos.push(request.url()) })
  await page.goto('/')
  const start = page.locator('.welcome-hero').getByRole('link', { name: 'Get started', exact: true })
  await start.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email address', { exact: true }).fill('landing@example.com')
  await dialog.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  await expect(dialog.getByLabel('Email sign-in code', { exact: true })).toBeVisible()
  await dialog.getByLabel('Email sign-in code', { exact: true }).fill(accounts.provider.codeFor('landing@example.com'))
  await dialog.getByLabel('Account display name', { exact: true }).fill('Robin')
  await dialog.getByLabel('Name this browser', { exact: true }).fill('My phone')
  await dialog.getByRole('button', { name: 'Verify and sign in', exact: true }).click()
  await expect(dialog.getByLabel('What do you call home?', { exact: true })).toBeVisible()
  await dialog.getByLabel('What do you call home?', { exact: true }).fill('A home from the landing')
  await dialog.getByRole('button', { name: 'Create our kitchen', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('A home from the landing')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`${roomPath()}$`))
  expect(demos).toEqual([])
  expect((await accountState(page)).memberships).toHaveLength(1)
  await page.getByRole('link', { name: 'Roomlings home', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Share a home.')
  await expect(page.locator('.game-house')).toHaveCount(0)
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('A home from the landing')
  await expect(page.locator('.welcome')).toHaveCount(0)
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await page.getByRole('button', { name: 'Account and membership', exact: true }).click()
  await dialog.getByRole('button', { name: 'Sign out this device', exact: true }).click()
  await dialog.getByRole('button', { name: 'Sign out this device', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Share a home.')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.game-house')).toHaveCount(0)
})

test('closing sign-in restores landing focus and a delivery failure never reports a successful sign-in', async ({ page, accounts }) => {
  accounts.provider.failDelivery = true
  await page.goto('/')
  const signIn = page.getByRole('link', { name: 'Sign in', exact: true })
  await signIn.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email address', { exact: true }).fill('landing@example.com')
  await dialog.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Email delivery is temporarily unavailable.')
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveValue('landing@example.com')
  await expect(dialog.getByLabel('Email sign-in code', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/#home-sign-in$/)
  await expect(dialog).toHaveCount(0)
  await expect(signIn).toBeFocused()
  await expect(signIn).toBeInViewport({ ratio: 1 })
  await signIn.click()
  await expect(dialog.getByLabel('Email address', { exact: true })).toBeVisible()
})

test('an unavailable account service leaves the landing readable and exposes a retry instead of making a sample', async ({ page }) => {
  await page.route('**/api/account', (route) => route.fulfill({ status: 503, json: { error: 'Account access is temporarily unavailable.' } }))
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Share a home.')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Account access is temporarily unavailable.')
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  await page.unroute('**/api/account')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('dialog').getByLabel('Email address', { exact: true })).toBeVisible()
})

test('returning through the landing uses a signed-in account when an older browser token has expired', async ({ page, accounts }) => {
  const before = await signedInVisitor(page, accounts)
  const staleToken = 'expired-browser-access-that-is-not-in-this-store'
  await page.evaluate((token) => {
    localStorage.setItem('roomlings.access-mode', 'browser')
    localStorage.setItem('roomlings.session', token)
  }, staleToken)
  await page.goto('/welcome')
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The signed-in home')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('signed-in account')
  expect((await accountState(page)).session?.household).toEqual(before.session?.household)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(staleToken)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.access-mode'))).toBe('account')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Share a home.')
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The signed-in home')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a transient browser-kitchen failure does not silently switch the chosen household to an account kitchen', async ({ page, accounts }) => {
  await signedInVisitor(page, accounts)
  await page.evaluate(() => {
    localStorage.setItem('roomlings.access-mode', 'browser')
    localStorage.setItem('roomlings.session', 'saved-browser-access-that-must-not-be-replaced')
  })
  await page.route('**/api/household', (route) => route.fulfill({ status: 503, json: { error: 'The selected browser kitchen is temporarily unavailable.' } }))
  await page.goto(roomPath())
  await expect(page.getByRole('alert')).toHaveText('The selected browser kitchen is temporarily unavailable.')
  await expect(page.locator('.game-house')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.access-mode'))).toBe('browser')
})

test('a signed-in account without a kitchen remains reachable after browser-only access expires', async ({ page, accounts }) => {
  await signedInVisitor(page, accounts, false)
  await page.evaluate(() => {
    localStorage.setItem('roomlings.access-mode', 'browser')
    localStorage.setItem('coldshare.session', 'expired-coldshare-access-that-is-not-in-this-store')
  })
  await page.goto(roomPath())
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Your Roomlings account.')
  await expect(page.getByRole('button', { name: 'Create a kitchen', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('roomlings.access-mode'))).toBe('account')
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).not.toBeNull()
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Your Roomlings account.')
})

test('a sample can be edited and revisited without changing a signed-in home or its access preference', async ({ page, accounts }) => {
  const before = await signedInVisitor(page, accounts)
  await page.goto(roomPath())
  await expect(page.locator('.game-house')).toContainText('The signed-in home')
  const personalKeys = ['roomlings.session', 'coldshare.session', 'roomlings.kitchens', 'coldshare.kitchens', 'roomlings.access-mode']
  const snapshot = await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), personalKeys)
  await page.getByRole('link', { name: 'Roomlings home', exact: true }).click()
  await page.locator('.welcome-hero').getByRole('link', { name: 'Try the sample', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${samplePath()}$`))
  await expect(page.locator('.game-house')).toContainText('The Sunday House')
  const token = await page.evaluate(() => localStorage.getItem('roomlings.sample-session'))
  expect(token).not.toBeNull()
  await openGroceryForm(page)
  await page.getByLabel('What did you pick up?', { exact: true }).fill('Sample-only groceries')
  await page.getByLabel('Total (EUR)', { exact: true }).fill('5.01')
  await page.getByRole('button', { name: 'Add & split the groceries', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.getByText('Sample-only groceries', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('roomlings.sample-session'))).toBe(token)
  expect(await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), personalKeys)).toEqual(snapshot)
  expect((await accountState(page)).session?.household).toEqual(before.session?.household)
  await page.getByRole('link', { name: 'Roomlings home', exact: true }).click()
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The signed-in home')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('expired samples restart explicitly without reading or replacing personal credentials', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('roomlings.sample-session')) {
      localStorage.setItem('roomlings.sample-session', 'expired-sample-that-is-not-in-this-store')
      localStorage.setItem('coldshare.session', 'personal-access-that-must-be-kept')
      localStorage.setItem('roomlings.access-mode', 'account')
    }
  })
  const accountRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/account')) accountRequests.push(request.url())
  })
  await page.goto(samplePath())
  await expect(page.locator('.game-house')).toContainText('The Sunday House')
  await expect(page.getByRole('status')).toContainText('new private sample')
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).toBe('personal-access-that-must-be-kept')
  expect(await page.evaluate(() => localStorage.getItem('roomlings.access-mode'))).toBe('account')
  expect(accountRequests).toEqual([])
  await page.reload()
  await expect(page.locator('.game-house')).toContainText('The Sunday House')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('revoked account access requires a fresh sign-in and then reopens the same saved room directly', async ({ page, accounts }) => {
  const before = await signedInVisitor(page, accounts)
  await page.goto(roomPath())
  await expect(page.locator('.game-house')).toContainText('The signed-in home')
  const cookie = (await page.context().cookies()).find((item) => item.name === 'roomlings_session')
  if (!cookie) throw new Error('The signed-in cookie is missing.')
  const access = await accounts.store.accounts.authenticate(cookie.value)
  if (!access) throw new Error('The signed-in session is missing.')
  await accounts.store.accounts.logout(access, false)
  await page.reload()
  const dialog = page.getByRole('dialog')
  await expect(page.locator('.game-house')).toHaveCount(0)
  await dialog.getByLabel('Email address', { exact: true }).fill('returning@example.com')
  await dialog.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  await expect(dialog.getByLabel('Email sign-in code', { exact: true })).toBeVisible()
  await dialog.getByLabel('Email sign-in code', { exact: true }).fill(accounts.provider.codeFor('returning@example.com'))
  await dialog.getByLabel('Account display name', { exact: true }).fill('Robin')
  await dialog.getByLabel('Name this browser', { exact: true }).fill('Reopened browser')
  await dialog.getByRole('button', { name: 'Verify and sign in', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.game-house')).toContainText('The signed-in home')
  expect((await accountState(page)).session?.household).toEqual(before.session?.household)
})

test('unimplemented rooms do not create samples or show placeholder controls', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()) })
  await page.goto('/rooms/bathroom')
  await expect(page.getByRole('alert')).toContainText('That room is not available')
  await expect(page.locator('.game-house')).toHaveCount(0)
  expect(requests).toEqual([])
})
