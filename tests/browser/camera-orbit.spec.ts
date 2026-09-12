import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Page } from '@playwright/test'
import { createRoomComponent, defaultRoomComponents, getRoomComponents } from '../../shared/roomComponents.ts'
import { roomIds } from '../../shared/rooms.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { expect, test } from './account-fixtures.ts'
import { openRoomEditor, openRoomObjects } from './fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'no-preference' })

const frameSchema = z.object({
  room: z.array(z.number()).length(16),
  camera: z.array(z.number()).length(16),
  projection: z.array(z.number()).length(16),
  point: z.tuple([z.number(), z.number()]),
  orbit: z.number(),
})

async function trackCamera(page: Page, objectName: string) {
  await page.evaluate(async (name) => {
    const canvas = document.querySelector('.world-canvas canvas')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The live room canvas is missing.')
    const source = await (await fetch('/src/camera.ts')).text()
    const engine = source.match(/from "(\/node_modules\/\.vite\/deps\/three\.js[^"]*)"/)?.[1]
    if (!engine) throw new Error('Cannot resolve the live room engine.')
    const { Box3, Group, Scene, Vector3 }: typeof import('three') = await import(engine)
    const stopPrevious: unknown = Reflect.get(window, 'stopRoomCameraOrbitProbe')
    if (typeof stopPrevious === 'function') stopPrevious()
    const original = Scene.prototype.onAfterRender
    const frames: { room: number[]; camera: number[]; projection: number[]; point: [number, number]; orbit: number }[] = []
    let localPoint: import('three').Vector3 | undefined
    Reflect.set(window, 'roomCameraOrbitFrames', frames)
    Scene.prototype.onAfterRender = function (...args: Parameters<typeof original>) {
      original.apply(this, args)
      const [renderer, scene, camera] = args
      if (renderer.domElement !== canvas) return
      const room = scene.children.find((object) => object instanceof Group)
      const target = room?.getObjectByName(name)
      if (!room || !target) throw new Error('The focused scene object is missing.')
      localPoint ??= target.worldToLocal(new Box3().setFromObject(target, true).getCenter(new Vector3()))
      const point = target.localToWorld(localPoint.clone()).project(camera)
      frames.push({
        room: room.matrixWorld.toArray(), camera: camera.matrixWorld.toArray(),
        projection: camera.projectionMatrix.toArray(),
        point: [point.x, point.y], orbit: Number(canvas.dataset.cameraOrbit ?? 0),
      })
      if (frames.length > 200) frames.shift()
    }
    Reflect.set(window, 'stopRoomCameraOrbitProbe', () => { Scene.prototype.onAfterRender = original })
  }, objectName)
}

async function dragView(page: Page, tilt = 0) {
  const world = page.locator('.kitchen-world')
  const start = await world.locator('canvas').evaluate((canvas, tilt) => {
    const bounds = canvas.getBoundingClientRect()
    for (const yFraction of [0.55, 0.65, 0.45, 0.75]) for (const xFraction of [0.2, 0.3, 0.4, 0.55, 0.65, 0.75]) {
      const x = bounds.x + bounds.width * xFraction
      const y = bounds.y + bounds.height * yFraction
      if (document.elementFromPoint(x, y) === canvas && document.elementFromPoint(x + 220, y + tilt) === canvas) return { x, y }
    }
    throw new Error('There is no unobstructed drag area in the room.')
  }, tilt)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(start.x + step * 22, start.y + tilt * step / 10)
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  }
  await page.mouse.up()
  await expect(world).toHaveAttribute('data-camera-moving', 'false', { timeout: 15_000 })
  return z.array(frameSchema).parse(await page.evaluate(() => Reflect.get(window, 'roomCameraOrbitFrames')))
}

function expectFixedEditorFraming(frames: z.infer<typeof frameSchema>[]) {
  expect(frames.length).toBeGreaterThan(8)
  expect(new Set(frames.map((frame) => JSON.stringify(frame.camera))).size).toBeGreaterThan(3)
  for (const frame of frames) {
    expect(frame.room).toEqual(frames[0].room)
    const change = Math.max(...frame.projection.map((value, index) => Math.abs(value - frames[0].projection[index])))
    expect(change, 'Orbit must not resize or shift the editor framing.').toBeLessThan(0.0001)
  }
}

for (const roomId of roomIds) {
  test(`${roomId} orbits a stationary focused room without lateral drift`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    const household = await accounts.store.get(owner.household.id)
    if (!household) throw new Error('The isolated orbit household is missing.')
    const slot = roomId === 'kitchen' ? 'kitchen-air-purifier'
      : roomId === 'bathroom' ? 'bathroom-air-purifier' : 'living-room-cleaning-station'
    const object = { ...createRoomComponent('air-purifier', slot, randomUUID()), name: 'Orbit reference' }
    household.roomComponents = [...getRoomComponents(household), object]
    await accounts.store.save(household)
    await page.goto(roomPath(roomId))
    const world = page.locator('.kitchen-world')
    await expect(world.locator('canvas')).toBeVisible()
    await expect(world).toHaveAttribute('data-camera-moving', 'false', { timeout: 15_000 })
    const objects = await openRoomObjects(page)
    await objects.getByRole('button', { name: 'Open Orbit reference details', exact: true }).click()
    await expect(world).toHaveAttribute('data-selected-component', object.id)
    await expect(world).toHaveAttribute('data-camera-moving', 'true')
    await expect(world).toHaveAttribute('data-camera-moving', 'false', { timeout: 15_000 })
    await trackCamera(page, object.name)
    const frames = await dragView(page)
    expect(frames.length).toBeGreaterThan(8)
    expect(Math.max(...frames.map((frame) => Math.abs(frame.orbit)))).toBeGreaterThan(0.5)
    expect(new Set(frames.map((frame) => JSON.stringify(frame.camera))).size).toBeGreaterThan(3)
    for (const frame of frames) {
      expect(frame.room).toEqual(frames[0].room)
      const distance = Math.hypot((frame.point[0] - frames[0].point[0]) * 720, (frame.point[1] - frames[0].point[1]) * 480)
      expect(distance, 'The focus point must not acquire a second, lagging pan.').toBeLessThan(2)
    }
    expect(await accounts.store.get(owner.household.id)).toEqual(household)
  })

  test(`${roomId} editor orbit keeps the room fixed without automatic zoom or reframing`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    const household = await accounts.store.get(owner.household.id)
    if (!household) throw new Error('The isolated editor household is missing.')
    household.roomComponents = defaultRoomComponents()
    await accounts.store.save(household)
    await page.goto(roomPath(roomId))
    const editor = await openRoomEditor(page)
    const world = page.locator('.kitchen-world')
    await expect(world).toHaveAttribute('data-edit-mode', 'true')
    await world.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    await expect(world).toHaveAttribute('data-camera-moving', 'false', { timeout: 15_000 })
    const reference = getRoomComponents(household).find((component) => component.roomId === roomId && component.installed)
    if (!reference) throw new Error('The editor has no fixed reference object.')
    await trackCamera(page, reference.name)
    expectFixedEditorFraming(await dragView(page, 80))

    await editor.getByRole('button', { name: `Edit ${reference.name}`, exact: true }).click()
    await expect(world).toHaveAttribute('data-selected-component', reference.id)
    await expect(world).toHaveAttribute('data-camera-moving', 'false', { timeout: 15_000 })
    await trackCamera(page, reference.name)
    expectFixedEditorFraming(await dragView(page, -100))

    const name = roomId === 'kitchen' ? 'Dishwasher' : roomId === 'bathroom' ? 'Washing machine' : 'Record player'
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await editor.getByLabel('Find an object', { exact: true }).fill(name)
    await editor.getByRole('button', { name: `Preview ${name}`, exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: `Try ${name}`, exact: true })
    await expect(confirmation).toBeVisible()
    await expect(world.locator('canvas')).toHaveAttribute('data-placement-arrow', 'true')
    await expect(world).toHaveAttribute('data-camera-moving', 'false', { timeout: 15_000 })
    await trackCamera(page, name)
    expectFixedEditorFraming(await dragView(page, 60))
    await expect(world.locator('.world-camera-controls')).toContainText('100%')
    expect(await accounts.store.get(owner.household.id)).toEqual(household)
  })
}
