import { expect, test } from './account-fixtures.ts'
import { roomIds } from '../../shared/rooms.ts'
import { roomPath } from '../../src/roomNavigation.ts'

for (const roomId of roomIds) {
  test(`${roomId} releases a failed material renderer and keeps household tools available`, { tag: '@room' },
    async ({ page, populatedHousehold: _household }) => {
      await page.addInitScript(() => {
        const contexts = new Set<WebGL2RenderingContext>()
        const blocked = new WeakSet<WebGLShader>()
        const getContext = HTMLCanvasElement.prototype.getContext
        const shaderSource = WebGL2RenderingContext.prototype.shaderSource
        const compileShader = WebGL2RenderingContext.prototype.compileShader
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
          value(this: HTMLCanvasElement, type: string, options?: unknown) {
            const context: unknown = Reflect.apply(getContext, this, [type, options])
            if (context instanceof WebGL2RenderingContext) contexts.add(context)
            return context
          },
        })
        Object.defineProperty(WebGL2RenderingContext.prototype, 'shaderSource', {
          value(this: WebGL2RenderingContext, shader: WebGLShader, source: string) {
            if (/^#define STANDARD\b/m.test(source) && /^#define USE_ENVMAP\b/m.test(source)) blocked.add(shader)
            return Reflect.apply(shaderSource, this, [shader, source])
          },
        })
        Object.defineProperty(WebGL2RenderingContext.prototype, 'compileShader', {
          value(this: WebGL2RenderingContext, shader: WebGLShader) {
            if (blocked.has(shader)) throw new Error('Simulated reflected-material shader failure')
            return Reflect.apply(compileShader, this, [shader])
          },
        })
        Object.defineProperty(window, 'roomMaterialContextStats', {
          get: () => ({ created: contexts.size, active: [...contexts].filter((context) => !context.isContextLost()).length }),
        })
      })
      await page.goto(roomPath(roomId))
      await expect(page.getByRole('status').filter({ hasText: /minus the 3D|The 3D .* is unavailable\./ })).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.world-canvas canvas')).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => Reflect.get(window, 'roomMaterialContextStats'))).toMatchObject({ active: 0 })
      expect(await page.evaluate(() => Reflect.get(window, 'roomMaterialContextStats').created)).toBeGreaterThan(0)
      await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
      await expect(page.getByRole('region', { name: 'The receipt book.', exact: true })).toBeVisible()
    })
}
