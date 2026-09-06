import { expect } from '@playwright/test'
import type { APIRequestContext, Page, Route } from '@playwright/test'
import { sessionSchema } from '../../src/api.ts'
import type { SavedKitchen } from '../../src/api.ts'
import type { Session } from '../../shared/domain.ts'

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
