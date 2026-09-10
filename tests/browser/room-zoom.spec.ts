import { expect, test } from './account-fixtures.ts'
import { cameraFraming } from '../../src/camera.ts'
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

for (const room of ['kitchen', 'bathroom'] as const) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
    test(`${room} renders the former 120% scale at 100% on ${viewport.width}px screens`, { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
      await page.setViewportSize(viewport)
      await page.goto(roomPath(room))
      const world = page.locator('.kitchen-world')
      const controls = world.locator('.world-camera-controls')
      await expect(world.locator('canvas')).toBeVisible()
      await expect(world).toHaveAttribute('data-rendering', 'paused')
      await expect(world).toHaveAttribute('data-framing', 'close')
      await expect(controls.locator(':scope > span')).toHaveText('100%')
      await page.evaluate(() => document.fonts.ready)
      const area = await world.evaluate((element) => {
        const canvas = element.querySelector('.world-canvas')!.getBoundingClientRect()
        const scene = (element.querySelector('.bathroom-scene-area') ?? element.querySelector('.world-canvas'))!.getBoundingClientRect()
        return { width: scene.width, height: scene.height, canvasHeight: canvas.height }
      })
      const halfHeight = cameraFraming(area.width, area.height, 'room', false).halfHeight
      const projectedScale = area.height / (halfHeight * area.canvasHeight)
      const scale = () => page.evaluate(() => {
        const matrix: unknown = Reflect.get(window, 'roomProjection')
        return Array.isArray(matrix) && typeof matrix[5] === 'number' ? matrix[5] : 0
      })
      await expect.poll(scale).toBeCloseTo(1.2 * projectedScale, 5)
      await controls.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await expect(controls.locator(':scope > span')).toHaveText('120%')
      await expect.poll(scale).toBeCloseTo(1.44 * projectedScale, 5)
      await controls.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
      await expect(controls.locator(':scope > span')).toHaveText('100%')
      await expect(world).toHaveAttribute('data-framing', 'whole')
      await expect(world).toHaveAttribute('data-camera-moving', 'false')
    })
  }
}
