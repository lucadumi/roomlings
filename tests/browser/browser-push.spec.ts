import type { Page } from '@playwright/test'
import { roomPath } from '../../src/roomNavigation.ts'
import { expect, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'

test.use({ reducedMotion: 'reduce', browserPushEnabled: true })

// Headless browsers have no real push service, so permission and subscription are stubbed in the page.
async function stubPushService(page: Page) {
  await page.addInitScript(() => {
    let subscription: PushSubscription | null = null
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' })
    Notification.requestPermission = async () => 'granted'
    const fake = {
      endpoint: 'https://push.example.com/send/roomlings-test',
      toJSON: () => ({ endpoint: 'https://push.example.com/send/roomlings-test', keys: { p256dh: `B${'a'.repeat(86)}`, auth: 'abcdefghijklmnopqrstuv' } }),
      unsubscribe: async () => { subscription = null; return true },
    } as unknown as PushSubscription
    PushManager.prototype.getSubscription = async () => subscription
    PushManager.prototype.subscribe = async () => (subscription = fake)
  })
}

async function signInWithKitchen(page: Page, accounts: AccountHarness) {
  await page.goto('/kitchen#account')
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email address', { exact: true }).fill('ada@example.com')
  await dialog.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  await dialog.getByLabel('Email sign-in code', { exact: true }).fill(accounts.provider.codeFor('ada@example.com'))
  await dialog.getByLabel('Account display name', { exact: true }).fill('Ada')
  await dialog.getByRole('button', { name: 'Verify and sign in', exact: true }).click()
  await dialog.getByRole('button', { name: 'Create a kitchen', exact: true }).click()
  await dialog.getByLabel('What do you call home?', { exact: true }).fill('The alert home')
  await dialog.getByRole('button', { name: 'Create our kitchen', exact: true }).click()
  await dialog.getByRole('button', { name: 'Open The alert home', exact: true }).click()
  await expect(page.locator('.game-house')).toContainText('The alert home')
}

const browserDevices = (accounts: AccountHarness) => accounts.store['db'].prepare('SELECT COUNT(*) AS count FROM browser_push_devices').get()

test('an account turns browser alerts on and off and chooses alert types', async ({ page, accounts }) => {
  await stubPushService(page)
  await signInWithKitchen(page, accounts)
  await page.locator('.inbox-trigger').click()
  const alerts = page.getByRole('region', { name: 'Alerts in this browser', exact: true })
  await expect(alerts).toContainText('Get your chore turns and shared money as alerts.')
  await alerts.getByRole('button', { name: 'Turn on', exact: true }).click()
  await expect(alerts.getByRole('button', { name: 'Turn off', exact: true })).toBeVisible()
  expect(Number((await browserDevices(accounts))?.count)).toBe(1)

  await alerts.getByRole('checkbox', { name: 'Money', exact: true }).uncheck()
  await expect(alerts.getByRole('checkbox', { name: 'Money', exact: true })).not.toBeChecked()
  const household = (await accounts.store['db'].prepare('SELECT household_id FROM account_memberships').get())!
  const preferences = await accounts.store['db'].prepare('SELECT chores, money FROM notification_preferences WHERE household_id = ?').get(household.household_id)
  expect(preferences).toMatchObject({ chores: 1, money: 0 })

  await alerts.getByRole('button', { name: 'Turn off', exact: true }).click()
  await expect(alerts.getByRole('button', { name: 'Turn on', exact: true })).toBeVisible()
  expect(Number((await browserDevices(accounts))?.count)).toBe(0)
})

test('an alert link opens the notifications panel', async ({ page, accounts }) => {
  await stubPushService(page)
  await signInWithKitchen(page, accounts)
  await page.goto(`${roomPath()}#notifications`)
  await expect(page.getByRole('heading', { name: 'Notifications.', exact: true })).toBeVisible()
  await expect(page).not.toHaveURL(/#notifications/)
})

test('a failed registration says so and leaves browser alerts off', async ({ page, accounts }) => {
  await stubPushService(page)
  await signInWithKitchen(page, accounts)
  await page.route('**/api/account/browser-push', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Alerts are resting.' }),
  }))
  await page.locator('.inbox-trigger').click()
  const alerts = page.getByRole('region', { name: 'Alerts in this browser', exact: true })
  await alerts.getByRole('button', { name: 'Turn on', exact: true }).click()
  await expect(alerts).toContainText('Alerts are resting.')
  await expect(alerts.getByRole('button', { name: 'Turn on', exact: true })).toBeVisible()
  expect(Number((await browserDevices(accounts))?.count)).toBe(0)
})
