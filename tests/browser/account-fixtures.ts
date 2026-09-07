import { randomInt, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import type { Page } from '@playwright/test'
import { expect, test as base } from '@playwright/test'
import { accountStateSchema } from '../../shared/accounts.ts'
import type { AccountState } from '../../shared/accounts.ts'
import { Store } from '../../server/store.ts'
import { createApp } from '../../server/app.ts'
import { ApiError } from '../../server/errors.ts'
import type { AccountProvider } from '../../server/provider.ts'
import { retryAccountDeletions } from '../../server/accounts-api.ts'

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

export const test = base.extend<{ accounts: AccountHarness }>({
  accounts: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error('Account browser flows need a configured base URL.')
    const store = new Store(':memory:')
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
      provider, appOrigin: new URL(baseURL).origin, allowLocalDevelopment: true,
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
      store.close()
    }
  },
  page: async ({ page, accounts }, use) => {
    await routeAccountApi(page, accounts)
    await use(page)
  },
})

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
