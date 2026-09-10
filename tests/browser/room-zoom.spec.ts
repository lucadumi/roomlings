import { expect, test } from './account-fixtures.ts'
import { cameraFraming, roomCameraZoom } from '../../src/camera.ts'
import { roomPath } from '../../src/roomNavigation.ts'

test.use({ reducedMotion: 'reduce' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const names = new WeakMap<WebGLUniformLocation, string>()
    const getUniformLocation = WebGL2RenderingContext.prototype.getUniformLocation
    Object.defineProperty(WebGL2RenderingContext.prototype, 'getUniformLocation', {
      value(this: WebGL2RenderingContext, program: WebGLProgram, name: string) {
        const location = getUniformLocation.call(this, program, name)
        if (location) names.set(location, name)
        return location
      },
    })
    const uniformMatrix4fv = WebGL2RenderingContext.prototype.uniformMatrix4fv
    Object.defineProperty(WebGL2RenderingContext.prototype, 'uniformMatrix4fv', {
      value(this: WebGL2RenderingContext, ...args: Parameters<WebGL2RenderingContext['uniformMatrix4fv']>) {
        const [location, , values, offset = 0] = args
        if (location && names.get(location) === 'projectionMatrix'
          && this.getParameter(this.DRAW_FRAMEBUFFER_BINDING) === null
          && this.canvas instanceof HTMLCanvasElement && this.canvas.closest('.world-canvas')) {
          Reflect.set(window, 'roomProjection', Array.from(values).slice(offset, offset + 16))
        }
        return Reflect.apply(uniformMatrix4fv, this, args)
      },
    })
  })
})

for (const room of ['kitchen', 'bathroom', 'living-room'] as const) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
    test(`${room} uses the same 100% room scale on ${viewport.width}px screens`, { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
      await page.setViewportSize(viewport)
      await page.goto(roomPath(room))
      const world = page.locator('.kitchen-world')
      const controls = world.locator('.world-camera-controls')
      await expect(world.locator('canvas')).toBeVisible()
      await expect(world).toHaveAttribute('data-rendering', 'paused')
      await expect(world).toHaveAttribute('data-framing', 'close')
      await expect(world).toHaveAttribute('data-focus', 'room')
      await expect(controls.locator(':scope > span')).toHaveText('100%')
      await page.evaluate(() => document.fonts.ready)
      const area = await world.evaluate((element) => {
        const canvas = element.querySelector('.world-canvas')!.getBoundingClientRect()
        return { width: canvas.width, height: canvas.height }
      })
      const halfHeight = cameraFraming(area.width, area.height, 'room', false).halfHeight
      const baselineZoom = roomCameraZoom(1, true)
      const projectedScale = 1 / halfHeight
      const scale = () => page.evaluate(() => {
        const matrix: unknown = Reflect.get(window, 'roomProjection')
        return Array.isArray(matrix) && typeof matrix[5] === 'number' ? matrix[5] : 0
      })
      await expect.poll(scale).toBeCloseTo(baselineZoom * projectedScale, 5)
      await controls.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await expect(controls.locator(':scope > span')).toHaveText('120%')
      await expect.poll(scale).toBeCloseTo(baselineZoom * 1.2 * projectedScale, 5)
      await controls.getByRole('button', { name: 'Reset room view', exact: true }).click()
      await expect(controls.locator(':scope > span')).toHaveText('100%')
      await expect(world).toHaveAttribute('data-framing', 'close')
      await expect(world).toHaveAttribute('data-camera-moving', 'false')
      await expect.poll(scale).toBeCloseTo(baselineZoom * projectedScale, 5)
    })
  }
}
