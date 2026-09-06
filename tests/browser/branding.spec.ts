import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { sessionSchema } from '../../src/api.ts'
import type { SavedKitchen } from '../../src/api.ts'
import type { Session } from '../../shared/domain.ts'

async function sampleSession(request: APIRequestContext): Promise<Session> {
  const response = await request.post('/api/demo', { data: {} })
  await expect(response).toBeOK()
  return sessionSchema.parse(await response.json())
}

function savedKitchen(session: Session): SavedKitchen {
  return {
    token: session.token,
    householdId: session.household.id,
    memberId: session.memberId,
    name: session.household.name,
    memberName: session.household.members[0].name,
  }
}

test('the Roomlings rebrand restores existing Coldshare households without replacing them', async ({ page, request }) => {
  const original = await sampleSession(request)
  const kitchen = savedKitchen(original)
  await page.addInitScript(({ token, kitchen }) => {
    localStorage.setItem('coldshare.session', token)
    localStorage.setItem('coldshare.kitchens', JSON.stringify([kitchen]))
  }, { token: original.token, kitchen })

  await page.goto('/')
  await expect(page).toHaveTitle('Roomlings | A home to share')
  await expect(page.locator('.game-hud .brand')).toHaveText('roomlings.')
  await expect(page.locator('.game-house')).toContainText(original.household.name)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(original.token)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))).toEqual([kitchen])
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).toBe(original.token)

  await page.reload()
  await expect(page.locator('.game-house')).toContainText(original.household.name)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(original.token)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.locator('.expense-row')).toHaveCount(original.household.expenses.length)
})

test('Roomlings sessions take precedence over retained legacy browser storage', async ({ page, request }) => {
  const legacy = await sampleSession(request)
  const current = await sampleSession(request)
  const currentKitchen = savedKitchen(current)
  await page.addInitScript(({ oldKitchen, currentKitchen }) => {
    localStorage.setItem('coldshare.session', oldKitchen.token)
    localStorage.setItem('coldshare.kitchens', JSON.stringify([oldKitchen]))
    localStorage.setItem('roomlings.session', currentKitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([currentKitchen]))
  }, { oldKitchen: savedKitchen(legacy), currentKitchen })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Make yourself at home.' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(current.token)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))).toEqual([currentKitchen])
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).toBe(legacy.token)
})
