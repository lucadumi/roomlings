import { expect } from '@playwright/test'
import type { APIRequestContext, Page, Route } from '@playwright/test'
import { sessionSchema } from '../../src/api.ts'
import type { SavedKitchen } from '../../src/api.ts'
import type { Session } from '../../shared/domain.ts'

export async function sampleSession(request: APIRequestContext): Promise<Session> {
  const response = await request.post('/api/demo', { data: {} })
  await expect(response).toBeOK()
  return sessionSchema.parse(await response.json())
}

export async function createHousehold(request: APIRequestContext, name: string, memberName: string): Promise<Session> {
  const response = await request.post('/api/households', {
    data: { name, memberName, currency: 'EUR', budget: 45000 },
  })
  await expect(response).toBeOK()
  return sessionSchema.parse(await response.json())
}

export function savedKitchen(session: Session): SavedKitchen {
  return {
    token: session.token,
    householdId: session.household.id,
    memberId: session.memberId,
    name: session.household.name,
    memberName: session.household.members[0].name,
  }
}

export async function pauseRequest(page: Page, url: string) {
  let receiveRoute!: (route: Route) => void
  const pending = new Promise<Route>((resolve) => { receiveRoute = resolve })
  await page.route(url, receiveRoute)
  return { pending }
}

export async function openShoppingBag(page: Page) {
  await page.getByRole('button', { name: 'Shopping bag, plan and record groceries', exact: true }).click()
  await expect(page.getByRole('region', { name: 'The shopping bag.', exact: true })).toBeVisible()
}

export async function openGroceryForm(page: Page) {
  await openShoppingBag(page)
  await page.getByRole('button', { name: 'Record without a list', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'What is in the bag?', exact: true })).toBeVisible()
}
