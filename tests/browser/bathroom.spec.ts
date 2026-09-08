import { expect, test } from './account-fixtures.ts'
import type { Page } from '@playwright/test'
import { Group, Mesh, OrthographicCamera, Vector3 } from 'three'
import { bathroomFraming, buildBathroomModel } from '../../src/bathroomModel.ts'
import { baseCameraOffset, cameraProjection } from '../../src/camera.ts'
import { samplePath } from '../../src/roomNavigation.ts'
import { selectRoom, trackDrawing } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

async function frameRoom(page: Page) {
  await page.getByRole('button', { name: 'Frame the whole room', exact: true }).click()
  await expect(page.locator('.bathroom-world')).toHaveAttribute('data-focus', 'room')
  await expect(page.locator('.bathroom-world')).toHaveAttribute('data-camera-moving', 'false')
  await expect(page.locator('.bathroom-world')).toHaveAttribute('data-rendering', 'paused')
}

async function clickFixture(page: Page, point: [number, number, number]) {
  await frameRoom(page)
  const layout = await page.locator('.bathroom-world').evaluate((element) => {
    const canvas = element.querySelector('.world-canvas')!.getBoundingClientRect()
    const stage = element.querySelector('.bathroom-scene-area')!.getBoundingClientRect()
    return { width: canvas.width, height: canvas.height, x: canvas.x, y: canvas.y, area: {
      x: stage.left - canvas.left, y: stage.top - canvas.top, width: stage.width, height: stage.height,
    } }
  })
  const room = new Group()
  const model = buildBathroomModel(room)
  try {
    const framing = bathroomFraming(layout.area.width, layout.area.height, model.bounds)
    const projection = cameraProjection(layout.width, layout.height, layout.area, framing.halfHeight, 1)
    const camera = new OrthographicCamera(projection.left, projection.right, projection.top, projection.bottom, 0.1, 100)
    const center = new Vector3(...framing.center)
    camera.position.copy(center).add(new Vector3(...baseCameraOffset))
    camera.lookAt(center)
    camera.updateMatrixWorld()
    const position = new Vector3(...point).project(camera)
    await page.mouse.click(layout.x + (position.x * .5 + .5) * layout.width, layout.y + (-position.y * .5 + .5) * layout.height)
  } finally {
    room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
    model.materials.forEach((material) => material.dispose())
  }
}

test('bathroom objects open room-specific chores and the shared supply list', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(samplePath('bathroom'))
  await expect(page.locator('.bathroom-world .world-canvas canvas')).toBeVisible()
  for (const area of ['sink', 'mirror', 'toilet', 'bath', 'floor']) {
    await frameRoom(page)
    await page.locator(`[data-bathroom-target="${area}"]`).click()
    await expect(page.getByRole('region', { name: 'Household chores.', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Chore room', exact: true })).toHaveAttribute('data-value', 'bathroom')
    await expect(page.getByRole('combobox', { name: 'Chore area', exact: true })).toHaveAttribute('data-value', area)
    await expect(page.locator('.bathroom-world')).toHaveAttribute('data-focus', area)
    await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  }
  await frameRoom(page)
  await page.locator('[data-bathroom-target="chores"]').click()
  await expect(page.getByRole('combobox', { name: 'Chore area', exact: true })).toHaveAttribute('data-value', '')
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await frameRoom(page)
  await page.locator('[data-bathroom-target="supplies"]').click()
  await expect(page.getByRole('region', { name: 'Bathroom supplies.', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restock Toilet paper', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('Item name', { exact: true })).toHaveValue('Toilet paper')
})

test('bathroom fixtures remain pickable when object labels are hidden', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(samplePath('bathroom'))
  await expect(page.locator('.bathroom-world .world-canvas canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await clickFixture(page, [0.15, 1.9, -2.22])
  await expect(page.getByRole('combobox', { name: 'Chore area', exact: true })).toHaveAttribute('data-value', 'sink')
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await clickFixture(page, [3.92, 2.78, -2.4])
  await expect(page.getByRole('region', { name: 'Bathroom supplies.', exact: true })).toBeVisible()
})

test('bathroom rendering settles, recolors existing geometry and releases the scene on room switching', { tag: '@room' }, async ({ page }) => {
  const drawing = await trackDrawing(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(samplePath('bathroom'))
  const world = page.locator('.bathroom-world')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await expect(world.locator('canvas')).toBeVisible()
  const idle = await drawing()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await drawing()).toEqual(idle)
  await world.locator('canvas').evaluate((canvas) => canvas.setAttribute('data-original-bathroom', 'true'))
  await page.getByRole('button', { name: 'Room style', exact: true }).click()
  await page.getByRole('radio', { name: 'Clay', exact: true }).check()
  const before = await drawing()
  await page.getByRole('button', { name: 'Apply for everyone', exact: true }).click()
  await expect(world).toHaveAttribute('data-room-style', 'clay')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await expect(world.locator('canvas')).toHaveAttribute('data-original-bathroom', 'true')
  expect((await drawing()).shadows).toBe(before.shadows)
  await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
  await expect(world).toHaveAttribute('data-evening', 'true')
  await expect(world).toHaveAttribute('data-rendering', 'paused')
  await selectRoom(page, 'kitchen')
  await expect(world).toHaveCount(0)
  await expect(page.locator('canvas[data-original-bathroom]')).toHaveCount(0)
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-room-style', 'clay')
  await selectRoom(page, 'bathroom')
  await expect(world).toHaveAttribute('data-room-style', 'clay')
  await expect(world.locator('canvas')).toHaveCount(1)
})

test('bathroom drag, wheel and touch zoom do not accidentally open chores', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(samplePath('bathroom'))
  await expect(page.locator('.bathroom-world .world-canvas canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Hide object labels', exact: true }).click()
  await page.mouse.move(160, 430)
  await page.mouse.wheel(0, -160)
  await expect(page.locator('.world-camera-controls')).not.toContainText('100%')
  await frameRoom(page)
  await page.mouse.move(150, 420)
  await page.mouse.down()
  await page.mouse.move(190, 450, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('.room-panel')).toHaveCount(0)
  await frameRoom(page)
  const touch = await page.context().newCDPSession(page)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 430, id: 1 }, { x: 230, y: 430, id: 2 }] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 90, y: 430, id: 1 }, { x: 260, y: 430, id: 2 }] })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('.world-camera-controls')).not.toContainText('100%')
  await expect(page.locator('.room-panel')).toHaveCount(0)
})

test('bathroom context loss retains ordinary chore and restocking actions', { tag: '@room' }, async ({ page }) => {
  await page.goto(samplePath('bathroom'))
  await expect(page.locator('.bathroom-world canvas')).toBeVisible()
  await page.locator('.bathroom-world canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The bathroom canvas is missing.')
    const loss = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
    if (!loss) throw new Error('The browser cannot simulate a lost context.')
    loss.loseContext()
  })
  await expect(page.getByText('The 3D bathroom is unavailable.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Room chores', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Household chores.', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await page.getByRole('button', { name: 'Restock supplies', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restock Hand soap', exact: true })).toBeVisible()
})

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
  test(`bathroom framing and shared room controls fit at ${viewport.width}x${viewport.height}`, { tag: '@room' }, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(samplePath('bathroom'))
    await expect(page.locator('.bathroom-world canvas')).toBeVisible()
    await frameRoom(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: 'Rooms', exact: true })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'Chores', exact: true })).toBeInViewport({ ratio: 1 })
    await page.getByRole('button', { name: 'Chores', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Household chores.', exact: true })).toBeVisible()
    await expect(page.locator('.bathroom-world')).toHaveAttribute('data-camera-moving', 'false')
    await expect(page.locator('.bathroom-world')).toHaveAttribute('data-rendering', 'paused')
    const layout = await page.locator('.game-app').evaluate((element) => {
      const panel = element.querySelector('.room-panel')!.getBoundingClientRect()
      const dock = element.querySelector('.game-dock')!.getBoundingClientRect()
      return Math.max(0, Math.min(panel.right, dock.right) - Math.max(panel.left, dock.left))
        * Math.max(0, Math.min(panel.bottom, dock.bottom) - Math.max(panel.top, dock.top))
    })
    expect(layout).toBe(0)
    await page.getByRole('button', { name: 'Close panel', exact: true }).click()
    await selectRoom(page, 'kitchen')
    await expect(page.locator('.bathroom-world')).toHaveCount(0)
    await expect(page.locator('.kitchen-world .world-canvas canvas')).toBeVisible()
  })
}
