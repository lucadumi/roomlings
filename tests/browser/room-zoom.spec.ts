import { expect, test } from './account-fixtures.ts'
import type { Page } from '@playwright/test'
import { Matrix4, Vector3 } from 'three'
import { createRoomComponent, getRoomComponents } from '../../shared/roomComponents.ts'
import type { RoomComponent } from '../../shared/roomComponents.ts'
import { cameraFraming, preferredRoomRotation, roomCameraZoom, roomFramingArea } from '../../src/camera.ts'
import { createConfiguredRoomPreview } from '../../src/householdRoomPreview.ts'
import { createPlacementArrow, placementPreviewSize } from '../../src/placementArrow.ts'
import { visibleRoomBounds } from '../../src/roomComponentScene.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { openRoomEditor } from './fixtures.ts'

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
        const name = location ? names.get(location) : undefined
        if ((name === 'projectionMatrix' || name === 'viewMatrix')
          && this.getParameter(this.DRAW_FRAMEBUFFER_BINDING) === null
          && this.canvas instanceof HTMLCanvasElement && this.canvas.closest('.world-canvas')) {
          Reflect.set(window, name === 'projectionMatrix' ? 'roomProjection' : 'roomView', Array.from(values).slice(offset, offset + 16))
        }
        return Reflect.apply(uniformMatrix4fv, this, args)
      },
    })
  })
})

async function expectPlacementVisible(page: Page, components: readonly RoomComponent[], candidate: RoomComponent) {
  const layout = await page.locator('.kitchen-world').evaluate((world) => {
    const box = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }
    const matrix = (name: string): number[] => {
      const values: unknown = Reflect.get(window, name)
      if (!Array.isArray(values) || values.length !== 16 || !values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        throw new Error(`The renderer did not supply ${name}.`)
      }
      return values
    }
    return {
      canvas: box(world.querySelector('.world-canvas')!),
      stage: box(world.querySelector('.chore-room-scene-area') ?? world),
      controls: box(world.querySelector('.world-camera-controls')!),
      projection: matrix('roomProjection'), view: matrix('roomView'),
    }
  })
  const projection = new Matrix4().fromArray(layout.projection).multiply(new Matrix4().fromArray(layout.view))
  const model = createConfiguredRoomPreview(candidate.roomId, 'original', [...components, candidate])
  const arrow = createPlacementArrow(model.room)
  model.scene.add(arrow.object)
  try {
    const bounds = visibleRoomBounds(model.room, model.componentScene.actors.get(candidate.id)!)
    model.room.rotation.y = preferredRoomRotation(candidate.slotId)
    const area = roomFramingArea(layout.canvas, layout.stage, layout.controls,
      placementPreviewSize(bounds, layout.canvas.width, layout.canvas.height, roomCameraZoom(1, true, candidate.roomId), model.room.rotation.y))
    model.room.updateMatrixWorld(true)
    arrow.update(bounds, 400, true)
    arrow.object.updateWorldMatrix(true, false)
    const points: Vector3[] = []
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      points.push(new Vector3(x, y, z).applyMatrix4(model.room.matrixWorld))
    }
    const vertices = arrow.object.geometry.getAttribute('position')
    for (let index = 0; index < vertices.count; index++) {
      points.push(new Vector3().fromBufferAttribute(vertices, index).applyMatrix4(arrow.object.matrixWorld))
    }
    for (const point of points) {
      point.applyMatrix4(projection)
      const x = (point.x * 0.5 + 0.5) * layout.canvas.width
      const y = (-point.y * 0.5 + 0.5) * layout.canvas.height
      const message = `${candidate.roomId}: the full-size object and triangle must fit the unobscured preview`
      expect(x, message).toBeGreaterThan(area.x)
      expect(x, message).toBeLessThan(area.x + area.width)
      expect(y, message).toBeGreaterThan(area.y)
      expect(y, message).toBeLessThan(area.y + area.height)
      expect(Math.abs(point.z), message).toBeLessThan(1)
    }
  } finally {
    arrow.dispose()
    model.dispose()
  }
}

for (const room of ['kitchen', 'bathroom', 'living-room'] as const) {
  for (const viewport of [
    { width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 844, height: 390 }, { width: 1440, height: 960 },
  ]) {
    test(`${room} keeps the same 100% scale in placement previews and zooms by 10% from 50% to 150% on ${viewport.width}px screens`, { tag: '@room' }, async ({ page, emptyHousehold: _household }, testInfo) => {
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
      const baselineZoom = roomCameraZoom(1, true, room)
      const projectedScale = 1 / halfHeight
      const scale = () => page.evaluate(() => {
        const matrix: unknown = Reflect.get(window, 'roomProjection')
        return Array.isArray(matrix) && typeof matrix[5] === 'number' ? matrix[5] : 0
      })
      const expectZoom = async (percent: number) => {
        await expect(controls.locator(':scope > span')).toHaveText(`${percent}%`)
        await expect.poll(scale).toBeCloseTo(baselineZoom * percent / 100 * projectedScale, 5)
      }
      const zoomIn = controls.getByRole('button', { name: 'Zoom in', exact: true })
      const zoomOut = controls.getByRole('button', { name: 'Zoom out', exact: true })
      const reset = controls.getByRole('button', { name: 'Reset room view', exact: true })
      await expectZoom(100)
      for (let percent = 110; percent <= 150; percent += 10) {
        await zoomIn.click()
        await expectZoom(percent)
      }
      await expect(zoomIn).toBeDisabled()
      await expect(zoomOut).toBeEnabled()
      for (let percent = 140; percent >= 50; percent -= 10) {
        await zoomOut.click()
        await expectZoom(percent)
      }
      await expect(zoomOut).toBeDisabled()
      await expect(zoomIn).toBeEnabled()
      await zoomIn.click()
      await expectZoom(60)
      await reset.click()
      await expectZoom(100)
      await expect(world).toHaveAttribute('data-framing', 'close')
      await expect(world).toHaveAttribute('data-camera-moving', 'false')
      await expect.poll(scale).toBeCloseTo(baselineZoom * projectedScale, 5)

      const editor = await openRoomEditor(page)
      await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
      const name = room === 'kitchen' ? 'Dishwasher' : room === 'bathroom' ? 'Washing machine' : 'Speaker'
      await editor.getByRole('button', { name: `Preview ${name}`, exact: true }).click()
      const confirmation = page.getByRole('dialog', { name: `Try ${name}`, exact: true })
      await expect(confirmation).toBeVisible()
      await expect(world.locator('canvas')).toHaveAttribute('data-placement-arrow', 'true')
      await expect(world).toHaveAttribute('data-framing', 'close')
      await expect(world).toHaveAttribute('data-camera-moving', 'false')
      await expectZoom(100)
      const id = await editor.getAttribute('data-placement-preview')
      if (!id) throw new Error('The candidate has no placement identifier.')
      const candidate = room === 'kitchen' ? createRoomComponent('dishwasher', 'kitchen-undercounter', id)
        : room === 'bathroom' ? createRoomComponent('washing-machine', 'bathroom-laundry', id)
          : createRoomComponent('speaker', 'living-room-media-accessory', id)
      await expectPlacementVisible(page, getRoomComponents(_household.household), candidate)
      await page.screenshot({ path: testInfo.outputPath(`${room}-placement-scale.png`), animations: 'disabled' })
      await zoomIn.click()
      await expectZoom(110)
      await zoomOut.click()
      await expectZoom(100)
      await zoomOut.click()
      await expectZoom(90)
      await reset.click()
      await expectZoom(100)
      await expectPlacementVisible(page, getRoomComponents(_household.household), candidate)
      await confirmation.getByRole('button', { name: 'Discard preview', exact: true }).click()
      await expect(confirmation).toHaveCount(0)
      await expect(world.locator('canvas')).toHaveAttribute('data-placement-arrow', 'false')
    })
  }
}
