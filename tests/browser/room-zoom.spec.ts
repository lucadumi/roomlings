import { expect, test } from './account-fixtures.ts'
import { cameraFraming } from '../../src/camera.ts'
import { getRoomComponents } from '../../shared/roomComponents.ts'
import { createConfiguredRoomPreview } from '../../src/householdRoomPreview.ts'
import { livingRoomFraming } from '../../src/livingRoomModel.ts'
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
    const description = room === 'living-room' ? 'keeps its original 100% sofa framing' : 'renders the former 120% scale at 100%'
    test(`${room} ${description} on ${viewport.width}px screens`, { tag: '@room' }, async ({ page, emptyHousehold }) => {
      await page.setViewportSize(viewport)
      await page.goto(roomPath(room))
      const world = page.locator('.kitchen-world')
      const controls = world.locator('.world-camera-controls')
      await expect(world.locator('canvas')).toBeVisible()
      await expect(world).toHaveAttribute('data-rendering', 'paused')
      await expect(world).toHaveAttribute('data-framing', 'close')
      await expect(world).toHaveAttribute('data-focus', room === 'living-room' ? 'sofa' : 'room')
      await expect(controls.locator(':scope > span')).toHaveText('100%')
      await page.evaluate(() => document.fonts.ready)
      const area = await world.evaluate((element) => {
        const canvas = element.querySelector('.world-canvas')!.getBoundingClientRect()
        const scene = (element.querySelector('.chore-room-scene-area') ?? element.querySelector('.world-canvas'))!.getBoundingClientRect()
        return { width: scene.width, height: scene.height, canvasHeight: canvas.height }
      })
      let halfHeight = cameraFraming(area.width, area.height, 'room', false).halfHeight
      if (room === 'living-room') {
        const components = getRoomComponents(emptyHousehold.household)
        const sofa = components.find((component) => component.slotId === 'living-room-sofa' && component.installed)
        if (!sofa) throw new Error('The living room fixture needs its default sofa.')
        const preview = createConfiguredRoomPreview(room, emptyHousehold.household.roomStyle, components)
        try {
          preview.scene.updateMatrixWorld(true)
          const bounds = preview.componentScene.getBounds(sofa.id)
          if (!bounds) throw new Error('The living room sofa bounds are missing.')
          halfHeight = Math.max(2.05, livingRoomFraming(area.width, area.height, bounds).halfHeight)
        } finally { preview.dispose() }
      }
      const baselineZoom = room === 'living-room' ? 1 : 1.2
      const projectedScale = area.height / (halfHeight * area.canvasHeight)
      const scale = () => page.evaluate(() => {
        const matrix: unknown = Reflect.get(window, 'roomProjection')
        return Array.isArray(matrix) && typeof matrix[5] === 'number' ? matrix[5] : 0
      })
      await expect.poll(scale).toBeCloseTo(baselineZoom * projectedScale, 5)
      await controls.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await expect(controls.locator(':scope > span')).toHaveText('120%')
      await expect.poll(scale).toBeCloseTo(baselineZoom * 1.2 * projectedScale, 5)
      await controls.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
      await expect(controls.locator(':scope > span')).toHaveText('100%')
      await expect(world).toHaveAttribute('data-framing', 'whole')
      await expect(world).toHaveAttribute('data-camera-moving', 'false')
    })
  }
}
