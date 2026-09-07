import type { Page } from '@playwright/test'
import { accountState, browserAccountRequest, expect, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'

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

test('a new visitor sees the landing without a demo session or an unsolicited sign-in dialog', async ({ page }) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url())
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Share a home.')
  await expect(page.getByRole('status').filter({ hasText: 'Checking saved access' })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.game-house')).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  expect(writes).toEqual([])
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
  await dialog.getByRole('button', { name: 'Open A home from the landing', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('A home from the landing')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(demos).toEqual([])
  expect((await accountState(page)).memberships).toHaveLength(1)
  await page.goto('/')
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
  await expect(page.getByRole('alert')).toHaveText('Account access is temporarily unavailable.')
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  await page.unroute('**/api/account')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
})

test('returning through the landing uses a signed-in account when an older browser token has expired', async ({ page, accounts }) => {
  const before = await signedInVisitor(page, accounts)
  const staleToken = 'expired-browser-access-that-is-not-in-this-store'
  await page.evaluate((token) => {
    localStorage.setItem('roomlings.access-mode', 'browser')
    localStorage.setItem('roomlings.session', token)
  }, staleToken)
  await page.goto('/welcome')
  await page.locator('.welcome-hero').getByRole('link', { name: 'Explore the kitchen', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The signed-in home')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('signed-in account')
  expect((await accountState(page)).session?.household).toEqual(before.session?.household)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(staleToken)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.access-mode'))).toBe('account')
  await page.goto('/')
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
  await page.goto('/kitchen')
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
  await page.goto('/')
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Your Roomlings account.')
  await expect(page.getByRole('button', { name: 'Create a kitchen', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('roomlings.access-mode'))).toBe('account')
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).not.toBeNull()
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Your Roomlings account.')
})
