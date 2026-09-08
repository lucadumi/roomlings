import { randomInt, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import type { BrowserContext, Page } from '@playwright/test'
import { expect, test as base } from '@playwright/test'
import { accountStateSchema } from '../../shared/accounts.ts'
import type { AccountState } from '../../shared/accounts.ts'
import type { Session } from '../../shared/domain.ts'
import type { Store } from '../../server/store.ts'
import { createApp } from '../../server/app.ts'
import { ApiError } from '../../server/errors.ts'
import type { AccountProvider } from '../../server/provider.ts'
import { retryAccountDeletions } from '../../server/accounts-api.ts'
import { databaseFixture } from '../database-fixture.ts'
import { createPopulatedHousehold } from '../household-fixture.ts'
import { savedKitchen } from './fixtures.ts'

export { expect }

export class TestMailbox {
  failDelivery = false
  failDelete = false
  deleted: string[] = []
  private codes = new Map<string, string>()
  private subjects = new Map<string, string>()

  async send(email: string): Promise<void> {
    if (this.failDelivery) throw new ApiError(503, 'Email delivery is temporarily unavailable.')
    this.codes.set(email, String(randomInt(100_000, 1_000_000)))
  }

  codeFor(email: string): string {
    const code = this.codes.get(email)
    if (!code) throw new Error('The browser did not request an email code.')
    return code
  }

  async verify(email: string, code: string): Promise<{ id: string; email: string }> {
    if (!this.codes.has(email) || this.codes.get(email) !== code) throw new ApiError(401, 'That email code is invalid or expired.')
    this.codes.delete(email)
    const id = this.subjects.get(email) ?? randomUUID()
    this.subjects.set(email, id)
    return { id, email }
  }

  async remove(id: string): Promise<void> {
    if (this.failDelete) throw new ApiError(503, 'Provider deletion is temporarily unavailable.')
    this.deleted.push(id)
    for (const [email, subject] of this.subjects) {
      if (subject === id) { this.subjects.delete(email); this.codes.delete(email) }
    }
  }
}

export type AccountHarness = { origin: string; store: Store; provider: TestMailbox; retryDeletions: () => Promise<void> }

export const test = base.extend<{
  accounts: AccountHarness
  emptyHousehold: Session
  populatedHousehold: Session
  providerEnabled: boolean
}>({
  providerEnabled: [true, { option: true }],
  accounts: async ({ baseURL, providerEnabled }, use) => {
    if (!baseURL) throw new Error('Account browser flows need a configured base URL.')
    const database = await databaseFixture()
    const store = database.store
    const mailbox = new TestMailbox()
    const provider: AccountProvider = {
      sendCode: (email) => mailbox.send(email),
      verifyCode: async (email, code) => {
        const identity = await mailbox.verify(email, code)
        return { providerId: identity.id, email: identity.email }
      },
      deleteUser: (id) => mailbox.remove(id),
    }
    const server = createApp(store, {
      ...(providerEnabled ? { provider } : {}),
      appOrigin: new URL(baseURL).origin,
      allowLocalDevelopment: true,
    }).listen(0, '127.0.0.1')
    try {
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('The isolated account API did not open a TCP port.')
      await use({ origin: `http://127.0.0.1:${address.port}`, store, provider: mailbox, retryDeletions: () => retryAccountDeletions(store, provider) })
    } finally {
      if (server.listening) {
        const closed = once(server, 'close')
        server.close()
        await closed
      }
      await database.close()
    }
  },
  request: async ({ accounts, playwright }, use) => {
    const request = await playwright.request.newContext({ baseURL: accounts.origin })
    try {
      await use(request)
    } finally {
      await request.dispose()
    }
  },
  page: async ({ page, accounts }, use) => {
    await routeAccountApi(page, accounts)
    await use(page)
    if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' })
  },
  emptyHousehold: async ({ page, accounts }, use) => {
    const session = await accounts.store.create('The browser household', 'You', 'EUR', 45000)
    await rememberBrowserHousehold(page, session)
    await use(session)
  },
  populatedHousehold: async ({ page, accounts }, use) => {
    const session = await createPopulatedHousehold(accounts.store)
    await rememberBrowserHousehold(page, session)
    await use(session)
  },
})

export async function rememberBrowserHousehold(page: Page, session: Session): Promise<void> {
  await page.addInitScript((kitchen) => {
    localStorage.setItem('roomlings.session', kitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
    localStorage.setItem('roomlings.access-mode', 'browser')
  }, savedKitchen(session))
}

export async function closeAccountContext(context: BrowserContext): Promise<void> {
  for (const page of context.pages()) {
    if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' })
  }
  await context.close()
}

export async function routeAccountApi(page: Page, accounts: AccountHarness): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: `${accounts.origin}${url.pathname}${url.search}`, maxRedirects: 0 })
    await route.fulfill({ response })
  })
}

export async function accountState(page: Page): Promise<AccountState> {
  const result: unknown = await page.evaluate(async () => {
    const response = await fetch('/api/account', { headers: { 'X-Roomlings-Request': '1' }, credentials: 'same-origin' })
    if (!response.ok) throw new Error(`Account access returned HTTP ${response.status}.`)
    return response.json()
  })
  return accountStateSchema.parse(result)
}

export async function browserAccountRequest(page: Page, path: string, body?: unknown, method?: string): Promise<{ status: number; body: unknown }> {
  const state = await accountState(page)
  return page.evaluate(async ({ path, body, method, csrfToken, householdId }) => {
    const response = await fetch(`/api${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: {
        'X-Roomlings-Request': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(householdId ? { 'X-Roomlings-Household': householdId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }, { path, body, method, csrfToken: state.csrfToken, householdId: state.session?.household.id })
}
