import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Page } from '@playwright/test'
import { createRoomComponent, defaultRoomComponents, getRoomComponents } from '../../shared/roomComponents.ts'
import { roomIds } from '../../shared/rooms.ts'
import { roomFramingArea } from '../../src/camera.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { expect, test } from './account-fixtures.ts'
import { openRoomEditor, openRoomObjects, waitForRoomReady } from './fixtures.ts'

// Only the measured focus and orbit interactions need motion, not scene/editor setup.
test.use({ providerEnabled: false, reducedMotion: 'reduce' })

const frameSchema = z.object({
  room: z.array(z.number()).length(16),
  camera: z.array(z.number()).length(16),
  projection: z.array(z.number()).length(16),
  point: z.tuple([z.number(), z.number()]),
  silhouette: z.tuple([z.number(), z.number(), z.number(), z.number()]),
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
    const scenePath = '/src/roomComponentScene.ts'
    const { visibleRoomBounds }: typeof import('../../src/roomComponentScene.ts') = await import(scenePath)
    const stopPrevious: unknown = Reflect.get(window, 'stopRoomCameraOrbitProbe')
    if (typeof stopPrevious === 'function') stopPrevious()
    const original = Scene.prototype.onAfterRender
    const frames: { room: number[]; camera: number[]; projection: number[]; point: [number, number]
      silhouette: [number, number, number, number]; orbit: number }[] = []
    let localPoint: import('three').Vector3 | undefined
    let corners: import('three').Vector3[] | undefined
    Reflect.set(window, 'roomCameraOrbitFrames', frames)
    Scene.prototype.onAfterRender = function (...args: Parameters<typeof original>) {
      original.apply(this, args)
      const [renderer, scene, camera] = args
      if (renderer.domElement !== canvas) return
      const room = scene.children.find((object) => object instanceof Group)
      const target = room?.getObjectByName(name)
      if (!room || !target) throw new Error('The focused scene object is missing.')
      localPoint ??= target.worldToLocal(new Box3().setFromObject(target, true).getCenter(new Vector3()))
      const bounds = (corners ??= (() => {
        const box = visibleRoomBounds(room)
        return [box.min.x, box.max.x].flatMap((x) => [box.min.y, box.max.y]
          .flatMap((y) => [box.min.z, box.max.z].map((z) => new Vector3(x, y, z))))
      })())
      const silhouette: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
      for (const corner of bounds) {
        const projected = corner.clone().applyMatrix4(room.matrixWorld).project(camera)
        silhouette[0] = Math.min(silhouette[0], projected.x)
        silhouette[1] = Math.min(silhouette[1], projected.y)
        silhouette[2] = Math.max(silhouette[2], projected.x)
        silhouette[3] = Math.max(silhouette[3], projected.y)
      }
      const point = target.localToWorld(localPoint.clone()).project(camera)
      frames.push({
        room: room.matrixWorld.toArray(), camera: camera.matrixWorld.toArray(),
        projection: camera.projectionMatrix.toArray(),
        point: [point.x, point.y], silhouette, orbit: Number(canvas.dataset.cameraOrbit ?? 0),
      })
      if (frames.length > 200) frames.shift()
    }
    Reflect.set(window, 'stopRoomCameraOrbitProbe', () => { Scene.prototype.onAfterRender = original })
  }, objectName)
}

// The clear area beside an open panel, in the normalised device coordinates the probe records.
async function clearArea(page: Page) {
  const layout = await page.locator('.kitchen-world').evaluate((element) => {
    const rectangle = ({ x, y, width, height }: DOMRect) => ({ x, y, width, height })
    return {
      canvas: rectangle(element.querySelector('.world-canvas')!.getBoundingClientRect()),
      stage: rectangle(element.getBoundingClientRect()),
      controls: rectangle(element.querySelector('.world-camera-controls')!.getBoundingClientRect()),
    }
  })
  const area = roomFramingArea(layout.canvas, layout.stage, layout.controls)
  return {
    left: area.x * 2 / layout.canvas.width - 1,
    right: (area.x + area.width) * 2 / layout.canvas.width - 1,
    top: 1 - area.y * 2 / layout.canvas.height,
    bottom: 1 - (area.y + area.height) * 2 / layout.canvas.height,
  }
}

async function cameraFrames(page: Page) {
  return z.array(frameSchema).parse(await page.evaluate(() => Reflect.get(window, 'roomCameraOrbitFrames')))
}

async function settleView(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page.locator('.kitchen-world')).toHaveAttribute('data-camera-moving', 'false', { timeout: 15_000 })
}

async function dragView(page: Page, tilt = 0, { animated = true } = {}) {
  const world = page.locator('.kitchen-world')
  const canvas = world.locator('canvas')
  const start = await canvas.evaluate((element, { tilt, animated }) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('The live room canvas is missing.')
    const bounds = element.getBoundingClientRect()
    for (const yFraction of [0.55, 0.65, 0.45, 0.75]) for (const xFraction of [0.2, 0.3, 0.4, 0.55, 0.65, 0.75]) {
      const x = bounds.x + bounds.width * xFraction
      const y = bounds.y + bounds.height * yFraction
      if (document.elementFromPoint(x, y) === element && document.elementFromPoint(x + 220, y + tilt) === element) {
        if (animated) element.addEventListener('pointerdown', (event) => {
          element.dataset.orbitTestPointerId = String(event.pointerId)
        }, { once: true })
        return { x, y }
      }
    }
    throw new Error('There is no unobstructed drag area in the room.')
  }, { tilt, animated })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.emulateMedia({ reducedMotion: animated ? 'no-preference' : 'reduce' })
  if (animated) {
    // Sample the captured pointer in-browser without drawing extra poses between protocol calls.
    await canvas.evaluate(async (element, { x, y, tilt }) => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error('The live room canvas is missing.')
      const pointerId = Number(element.dataset.orbitTestPointerId)
      delete element.dataset.orbitTestPointerId
      if (!Number.isInteger(pointerId) || !element.hasPointerCapture(pointerId)) throw new Error('The native drag did not capture its pointer.')
      for (let step = 1; step <= 10; step++) {
        element.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, pointerId, pointerType: 'mouse', isPrimary: true, buttons: 1, button: -1,
          clientX: x + step * 22, clientY: y + tilt * step / 10,
        }))
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    }, { ...start, tilt })
  }
  await page.mouse.move(start.x + 220, start.y + tilt)
  if (!animated) await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  await page.mouse.up()
  await expect(world).toHaveAttribute('data-camera-moving', 'false', { timeout: 15_000 })
  const frames = await cameraFrames(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  return frames
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
  test(`${roomId} eases focus and panel projection without moving the room`, { tag: '@room' }, async ({ page, emptyHousehold: owner }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.goto(roomPath(roomId))
    await waitForRoomReady(page)
    await settleView(page)
    const reference = getRoomComponents(owner.household).find((component) => component.roomId === roomId && component.installed)
    if (!reference) throw new Error('The focus transition needs a room reference.')
    await trackCamera(page, reference.name)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openRoomObjects(page)
    await expect.poll(async () => (await cameraFrames(page)).length).toBeGreaterThan(3)
    await settleView(page)
    const frames = await cameraFrames(page)
    expect(new Set(frames.map((frame) => JSON.stringify(frame.projection))).size).toBeGreaterThan(3)
    for (const frame of frames) {
      expect(frame.room).toEqual(frames[0].room)
      expect(frame.projection.every(Number.isFinite)).toBe(true)
    }
    await expect(page.locator('.kitchen-world')).toHaveAttribute('data-rendering', 'paused')
  })

  test(`${roomId} frames the whole room beside the object panel and holds it there while orbiting`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    const household = await accounts.store.get(owner.household.id)
    if (!household) throw new Error('The isolated object panel household is missing.')
    household.roomComponents = defaultRoomComponents()
    await accounts.store.save(household)
    await page.goto(roomPath(roomId))
    await waitForRoomReady(page)
    const panel = await openRoomObjects(page)
    await expect(page.locator('.room-panel')).toHaveAttribute('data-panel-side', 'left')
    await expect(panel).toBeVisible()
    await settleView(page)
    const reference = getRoomComponents(household).find((component) => component.roomId === roomId && component.installed)
    if (!reference) throw new Error('The object panel has no fixed reference object.')
    await trackCamera(page, reference.name)
    const frames = await dragView(page, 80)
    expectFixedEditorFraming(frames)
    await expect(page.locator('.world-camera-controls')).toContainText('100%')
    const area = await clearArea(page)
    for (const [left, bottom, right, top] of frames.map((frame) => frame.silhouette)) {
      expect(left, 'The whole room must stay clear of the panel.').toBeGreaterThan(area.left - 0.02)
      expect(right, 'The whole room must stay inside the scene.').toBeLessThan(area.right + 0.02)
      expect(bottom, 'The whole room must stay above the dock.').toBeGreaterThan(area.bottom - 0.02)
      expect(top, 'The whole room must stay below the header.').toBeLessThan(area.top + 0.02)
      // A fitted room still fills its side of the screen instead of shrinking to a token model.
      expect(right - left).toBeGreaterThan((area.right - area.left) * 0.5)
      expect(top - bottom).toBeGreaterThan((area.top - area.bottom) * 0.3)
    }
    expect(await accounts.store.get(owner.household.id)).toEqual(household)
  })

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
    await waitForRoomReady(page)
    const world = page.locator('.kitchen-world')
    await expect(world).toHaveAttribute('data-camera-moving', 'false', { timeout: 15_000 })
    const objects = await openRoomObjects(page)
    await settleView(page)
    await trackCamera(page, object.name)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(async () => (await cameraFrames(page)).length).toBeGreaterThan(0)
    const beforeFocus = (await cameraFrames(page)).at(-1)!.camera
    await objects.getByRole('button', { name: 'Open Orbit reference details', exact: true }).click()
    await expect(world).toHaveAttribute('data-selected-component', object.id)
    // A slow frame can finish focusing before a transient moving flag can be observed.
    await expect.poll(async () => (await cameraFrames(page))
      .some((frame) => JSON.stringify(frame.camera) !== JSON.stringify(beforeFocus))).toBe(true)
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

  for (const stage of ['whole room', 'focused object', 'placement trial'] as const) test(`${roomId} editor orbit keeps the ${stage} fixed without automatic zoom or reframing`, { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    const household = await accounts.store.get(owner.household.id)
    if (!household) throw new Error('The isolated editor household is missing.')
    household.roomComponents = defaultRoomComponents()
    await accounts.store.save(household)
    await page.goto(roomPath(roomId))
    await waitForRoomReady(page)
    const editor = await openRoomEditor(page)
    const world = page.locator('.kitchen-world')
    await expect(world).toHaveAttribute('data-edit-mode', 'true')
    await world.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    await settleView(page)
    const reference = getRoomComponents(household).find((component) => component.roomId === roomId && component.installed)
    if (!reference) throw new Error('The editor has no fixed reference object.')
    await trackCamera(page, reference.name)
    let name = reference.name
    if (stage !== 'whole room') {
      await dragView(page, 80, { animated: false })
      await editor.getByRole('button', { name: `Edit ${reference.name}`, exact: true }).click()
      await expect(world).toHaveAttribute('data-selected-component', reference.id)
      await settleView(page)
    }
    if (stage === 'placement trial') {
      await dragView(page, -100, { animated: false })
      name = roomId === 'kitchen' ? 'Dishwasher' : roomId === 'bathroom' ? 'Washing machine' : 'Wall art'
      await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
      await editor.getByLabel('Find an object', { exact: true }).fill(name)
      await editor.getByRole('button', { name: `Preview ${name}`, exact: true }).click()
      await expect(page.getByRole('dialog', { name: `Try ${name}`, exact: true })).toBeVisible()
      await expect(world.locator('canvas')).toHaveAttribute('data-placement-arrow', 'true')
    }
    await settleView(page)
    await trackCamera(page, name)
    expectFixedEditorFraming(await dragView(page, stage === 'whole room' ? 80 : stage === 'focused object' ? -100 : 60))
    await expect(world.locator('.world-camera-controls')).toContainText('100%')
    expect(await accounts.store.get(owner.household.id)).toEqual(household)
  })
}
