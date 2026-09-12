import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { z } from 'zod'
import { createRoomComponent, getRoomComponents } from '../../shared/roomComponents.ts'
import { daylight, eveningLight } from '../../src/lighting.ts'
import { expect, test } from './account-fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

const frameSchema = z.object({
  room: z.array(z.number()).length(16),
  objects: z.array(z.object({
    name: z.string(), visible: z.boolean(), colors: z.array(z.string()),
    click: z.tuple([z.number(), z.number()]).nullable(),
  })),
})

async function renderedObjects(page: Page, names: string[], redraw: () => Promise<unknown>) {
  await page.evaluate(async (names) => {
    const canvas = document.querySelector('.world-canvas canvas')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The live room canvas is missing.')
    const source = await (await fetch('/src/camera.ts')).text()
    const engine = source.match(/from "(\/node_modules\/\.vite\/deps\/three\.js[^"]*)"/)?.[1]
    if (!engine) throw new Error('The live room engine could not be resolved.')
    const { Group, Mesh, MeshStandardMaterial, Raycaster, Scene, Vector2, Vector3 }: typeof import('three') = await import(engine)
    const geometryModule = '/tests/room-layout-fixture.ts'
    const sceneModule = '/src/roomComponentScene.ts'
    const { worldTriangles }: typeof import('../room-layout-fixture.ts') = await import(geometryModule)
    const { isSceneObjectVisible }: typeof import('../../src/roomComponentScene.ts') = await import(sceneModule)
    const original = Scene.prototype.onAfterRender
    Reflect.set(window, 'roomAdditionFrame', null)
    Reflect.set(window, 'restoreRoomAdditionProbe', () => { Scene.prototype.onAfterRender = original })
    Scene.prototype.onAfterRender = function (...args: Parameters<typeof original>) {
      original.apply(this, args)
      const [renderer, scene, camera] = args
      if (renderer.domElement !== canvas) return
      const room = scene.children.find((object) => object instanceof Group)
      if (!room) throw new Error('The live room root is missing.')
      const rect = canvas.getBoundingClientRect()
      const ray = new Raycaster()
      const objects = names.map((name) => {
        const root = room.getObjectByName(name)
        if (!root) throw new Error(`The live room is missing ${name}.`)
        const colors = new Set<string>()
        root.traverseVisible((object) => {
          if (!(object instanceof Mesh)) return
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material instanceof MeshStandardMaterial) colors.add(material.color.getHexString())
          }
        })
        let click: [number, number] | null = null
        for (const triangle of worldTriangles(root)) {
          const point = triangle.getMidpoint(new Vector3()).project(camera)
          if (Math.abs(point.x) >= 1 || Math.abs(point.y) >= 1 || Math.abs(point.z) >= 1) continue
          const x = rect.x + (point.x + 1) * rect.width / 2
          const y = rect.y + (1 - point.y) * rect.height / 2
          if (document.elementFromPoint(x, y) !== canvas) continue
          ray.setFromCamera(new Vector2(point.x, point.y), camera)
          const hit = ray.intersectObject(room, true).find(({ object }) => isSceneObjectVisible(object, room))
          let object = hit?.object
          while (object && object !== root) object = object.parent ?? undefined
          if (object === root) { click = [x, y]; break }
        }
        return { name, visible: isSceneObjectVisible(root, room), colors: [...colors], click }
      })
      Reflect.set(window, 'roomAdditionFrame', { room: room.matrixWorld.toArray(), objects })
    }
  }, names)
  try {
    await redraw()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'roomAdditionFrame'))).not.toBeNull()
    return frameSchema.parse(await page.evaluate(() => Reflect.get(window, 'roomAdditionFrame')))
  } finally {
    if (!page.isClosed()) await page.evaluate(() => {
      const restore: unknown = Reflect.get(window, 'restoreRoomAdditionProbe')
      if (typeof restore === 'function') restore()
    })
  }
}

test('both kitchen windows share lighting and the extractor opens the existing hob chores', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }, testInfo) => {
  const before = await accounts.store.get(owner.household.id)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/kitchen')
  const world = page.locator('.kitchen-world')
  await expect(world.locator('canvas')).toBeVisible({ timeout: 20_000 })
  await expect(world).toHaveAttribute('data-rendering', 'paused', { timeout: 20_000 })
  const names = ['Kitchen window cutaway', 'Kitchen left window cutaway', 'Kitchen extractor hood']
  const day = await renderedObjects(page, names, () => world.getByRole('button', { name: 'Zoom out', exact: true }).click())
  for (const object of day.objects) {
    expect(object.visible).toBe(true)
    expect(object.click, `${object.name} needs an exposed clickable surface`).not.toBeNull()
  }
  for (const window of day.objects.slice(0, 2)) expect(window.colors).toContain(daylight.window.slice(1))
  await page.screenshot({ path: testInfo.outputPath('kitchen-window-and-hood.png'), animations: 'disabled' })
  const [x, y] = day.objects[1].click!
  const evening = await renderedObjects(page, names, () => page.mouse.click(x, y))
  for (const window of evening.objects.slice(0, 2)) expect(window.colors).toContain(eveningLight.window.slice(1))
  expect(evening.room).toEqual(day.room)
  await page.mouse.click(...evening.objects[2].click!)
  await expect(page.locator('.chores-panel')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Chore object', exact: true })).toHaveAttribute('data-value', 'default-kitchen-hob')
  expect(await accounts.store.get(owner.household.id)).toEqual(before)
})

test('the two upright speakers share media-unit care and leave the record player in place', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }, testInfo) => {
  const household = await accounts.store.get(owner.household.id)
  if (!household) throw new Error('The isolated speaker household is missing.')
  const record = createRoomComponent('record-player', 'living-room-media-accessory', randomUUID())
  household.roomComponents = [...getRoomComponents(household), record]
  await accounts.store.save(household)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/rooms/living-room')
  const world = page.locator('.kitchen-world')
  await expect(world.locator('canvas')).toBeVisible({ timeout: 20_000 })
  await expect(world).toHaveAttribute('data-rendering', 'paused', { timeout: 20_000 })
  const frame = await renderedObjects(page, ['Left media speaker', 'Right media speaker', record.name],
    () => world.getByRole('button', { name: 'Zoom out', exact: true }).click())
  for (const object of frame.objects) {
    expect(object.visible).toBe(true)
    expect(object.click, `${object.name} must remain reachable`).not.toBeNull()
  }
  expect(frame.objects[0].colors).toContain('35393b')
  expect(frame.objects[1].colors).toEqual(frame.objects[0].colors)
  await page.screenshot({ path: testInfo.outputPath('speakers-with-record-player.png'), animations: 'disabled' })
  await page.mouse.click(...frame.objects[1].click!)
  await expect(page.locator('.chores-panel')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Chore object', exact: true })).toHaveAttribute('data-value', 'default-living-room-media-unit')
  expect(await accounts.store.get(owner.household.id)).toEqual(household)
})
