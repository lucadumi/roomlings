import { expect } from '@playwright/test'
import type { APIRequestContext, Locator, Page, Route } from '@playwright/test'
import { sessionSchema } from '../../src/api.ts'
import type { SavedKitchen } from '../../src/api.ts'
import type { Session } from '../../shared/domain.ts'
import { roomCatalog } from '../../shared/rooms.ts'
import type { RoomId } from '../../shared/rooms.ts'

export async function trackDrawing(page: Page) {
  await page.addInitScript(() => {
    let draws = 0
    let shadowDraws = 0
    const framebuffers = new WeakMap<WebGL2RenderingContext, WebGLFramebuffer | null>()
    const bindFramebuffer = WebGL2RenderingContext.prototype.bindFramebuffer
    Object.defineProperty(WebGL2RenderingContext.prototype, 'bindFramebuffer', {
      value(this: WebGL2RenderingContext, target: number, framebuffer: WebGLFramebuffer | null) {
        if (target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER) framebuffers.set(this, framebuffer)
        return Reflect.apply(bindFramebuffer, this, [target, framebuffer])
      },
    })
    for (const method of ['drawElements', 'drawArrays'] as const) {
      const original = WebGL2RenderingContext.prototype[method]
      Object.defineProperty(WebGL2RenderingContext.prototype, method, {
        value(this: WebGL2RenderingContext, ...args: number[]) {
          draws++
          if (framebuffers.get(this)) shadowDraws++
          return Reflect.apply(original, this, args)
        },
      })
    }
    Object.defineProperty(window, 'roomlingsFrameDrawCalls', { get: () => draws })
    Object.defineProperty(window, 'roomlingsShadowDrawCalls', { get: () => shadowDraws })
  })
  return () => page.evaluate(() => ({
    draws: Number(Reflect.get(window, 'roomlingsFrameDrawCalls')),
    shadows: Number(Reflect.get(window, 'roomlingsShadowDrawCalls')),
  }))
}

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

export async function selectRoom(page: Page, roomId: RoomId) {
  await page.getByRole('button', { name: 'Rooms', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Rooms', exact: true })
  await picker.getByRole('button', { name: `Open ${roomCatalog[roomId].name}`, exact: true }).click()
  await expect(picker).toHaveCount(0)
}

export async function chooseOption(control: Locator, value: string | { label: string }) {
  await control.click()
  const menu = control.page().getByRole('listbox')
  const option = typeof value === 'string'
    ? menu.locator(`[data-option-value=${JSON.stringify(value)}]`)
    : menu.getByRole('option', { name: value.label, exact: true })
  const expected = await option.getAttribute('data-option-value')
  if (expected === null) throw new Error('The dropdown option has no value.')
  await option.click()
  await expect(menu).toHaveCount(0)
  await expect(control).toHaveAttribute('data-value', expected)
}
