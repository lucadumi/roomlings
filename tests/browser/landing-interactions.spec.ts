import { Box3, Group, Mesh, OrthographicCamera, Vector3 } from 'three'
import type { Page } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { pauseRequest } from './fixtures.ts'
import { buildKitchenModel } from '../../src/kitchenModel.ts'
import { buildBathroomModel } from '../../src/bathroomModel.ts'
import { baseCameraOffset, cameraFraming } from '../../src/camera.ts'
import { tourCameraFraming } from '../../src/landing/tourCamera.ts'
import { roomTourChapters } from '../../src/landing/roomTourChapters.ts'

test.use({ reducedMotion: 'reduce' })

async function kitchenPoint(page: Page, action: 'stock' | 'ledger' | 'budget' | 'settle') {
  const room = new Group()
  const model = buildKitchenModel(room)
  try {
    const bounds = await page.locator('.welcome-canvas canvas').boundingBox()
    if (!bounds) throw new Error('The kitchen canvas is missing.')
    const frame = tourCameraFraming(0, bounds.width, bounds.height, true)
    const halfWidth = frame.halfHeight * bounds.width / bounds.height
    const camera = new OrthographicCamera(-halfWidth, halfWidth, frame.halfHeight, -frame.halfHeight, 0.1, 150)
    camera.position.set(...frame.center).add(new Vector3(...baseCameraOffset))
    camera.lookAt(new Vector3(...frame.center))
    camera.updateMatrixWorld(true)
    const actor = model.scenery.actors.get(action)
    if (!actor) throw new Error('The kitchen object is missing.')
    const point = new Box3().setFromObject(actor).getCenter(new Vector3()).project(camera)
    return { x: bounds.x + (point.x * 0.5 + 0.5) * bounds.width, y: bounds.y + (-point.y * 0.5 + 0.5) * bounds.height }
  } finally {
    room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
    model.materials.forEach((material) => material.dispose())
  }
}

async function bathroomPoint(page: Page, target: 'sink' | 'mirror' | 'toilet' | 'bath' | 'chores' | 'supplies') {
  const room = new Group()
  const model = buildBathroomModel(room)
  try {
    const bounds = await page.locator('.bathroom-preview-canvas canvas').boundingBox()
    if (!bounds) throw new Error('The bathroom canvas is missing.')
    const frame = cameraFraming(bounds.width, bounds.height, 'room', true)
    const halfWidth = frame.halfHeight * bounds.width / bounds.height
    const camera = new OrthographicCamera(-halfWidth, halfWidth, frame.halfHeight, -frame.halfHeight, 0.1, 100)
    camera.position.set(...frame.center).add(new Vector3(...baseCameraOffset))
    camera.lookAt(new Vector3(...frame.center))
    camera.updateMatrixWorld(true)
    const actor = model.actors.get(target)
    if (!actor) throw new Error('The bathroom fixture is missing.')
    const point = new Box3().setFromObject(actor).getCenter(new Vector3()).project(camera)
    return { x: bounds.x + (point.x * 0.5 + 0.5) * bounds.width, y: bounds.y + (-point.y * 0.5 + 0.5) * bounds.height }
  } finally {
    room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
    model.materials.forEach((material) => material.dispose())
  }
}

test('kitchen objects are explorable without opening a household', { tag: '@room' }, async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()) })
  await page.goto('/#tour')
  const tour = page.locator('.welcome-tour')
  await expect(tour).toHaveAttribute('data-scene', 'ready')
  for (const [action, chapter] of [['stock', 'groceries'], ['ledger', 'receipts'], ['budget', 'house-pot'], ['settle', 'come-in']] as const) {
    const point = await kitchenPoint(page, action)
    const previous = await tour.getAttribute('data-chapter')
    await page.mouse.click(point.x, point.y, { button: 'right' })
    await expect(tour).toHaveAttribute('data-chapter', previous!)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + 30, point.y + 15)
    await page.mouse.up()
    await expect(tour).toHaveAttribute('data-chapter', previous!)
    await page.mouse.click(point.x, point.y)
    await expect(tour).toHaveAttribute('data-chapter', chapter)
  }
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('bathroom fixtures and keyboard controls explore the real 3D room without data access', { tag: '@room' }, async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()) })
  await page.goto('/#tour-bathroom')
  const preview = page.locator('.welcome-tour')
  await expect(preview).toHaveAttribute('data-scene', 'ready')
  await expect(preview.locator('.bathroom-preview-canvas canvas')).toBeVisible()
  for (const target of ['sink', 'mirror', 'toilet', 'bath', 'chores', 'supplies'] as const) {
    const point = await bathroomPoint(page, target)
    await page.mouse.click(point.x, point.y)
    await expect(preview).toHaveAttribute('data-chapter', `bathroom-${target}`)
  }
  await preview.getByRole('button', { name: 'Floor', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(preview).toHaveAttribute('data-chapter', 'bathroom-floor')
  await preview.getByRole('button', { name: 'Whole bathroom', exact: true }).click()
  await expect(preview).toHaveAttribute('data-chapter', 'bathroom-room')
  const point = await bathroomPoint(page, 'sink')
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 35, point.y + 20)
  await page.mouse.up()
  await expect(preview).toHaveAttribute('data-chapter', 'bathroom-room')
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

for (const [room, module] of [['kitchen', 'TourScene'], ['bathroom', 'BathroomWorld']] as const) {
  test(`${room} shows a real rendering loader until the module and first frame are ready`, { tag: '@room' }, async ({ page }) => {
    const pending = await pauseRequest(page, `**/{${module}.tsx*,${module}-*.js}`)
    await page.goto(room === 'kitchen' ? '/#tour' : '/#tour-bathroom', { waitUntil: 'commit' })
    const route = await pending.pending
    const loading = page.getByRole('status').filter({ hasText: `Loading the ${room}...` })
    await expect(loading).toBeVisible()
    const svg = await loading.locator('img').evaluate(async (image) => {
      if (!(image instanceof HTMLImageElement)) throw new Error('The room loader is missing.')
      return (await fetch(image.src)).text()
    })
    expect(svg).toContain('<svg')
    expect(svg).not.toMatch(/@keyframes|<animate/)
    await route.continue()
    await expect(loading).toHaveCount(0)
    await expect(page.locator('.welcome-tour')).toHaveAttribute('data-scene', 'ready')
  })
}

test('bathroom rendering failure leaves fixture exploration available', { tag: '@room' }, async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, contextId: string, options?: unknown) {
        if (contextId.startsWith('webgl')) return null
        return Reflect.apply(original, this, [contextId, options])
      },
    })
  })
  await page.goto('/#tour-bathroom')
  const preview = page.locator('.welcome-tour')
  await expect(preview).toHaveAttribute('data-scene', 'unavailable')
  await expect(preview.locator('.welcome-explore-loading')).toHaveCount(0)
  await expect(preview.locator('.welcome-static')).toBeVisible()
  await preview.getByRole('button', { name: 'Mirror', exact: true }).click()
  await expect(preview).toHaveAttribute('data-chapter', 'bathroom-mirror')
  await expect(preview.getByRole('link', { name: /^Open (kitchen|bathroom)$/ })).toHaveCount(0)
})

test('both room overviews use the same template, angle and world scale', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/#tour')
  const tour = page.locator('.welcome-tour')
  await expect(tour).toHaveAttribute('data-scene', 'ready')
  const kitchen = page.locator('.welcome-canvas')
  const angle = await kitchen.getAttribute('data-camera-angle')
  const scale = await kitchen.getAttribute('data-camera-scale')
  const bounds = await page.locator('.welcome-stage-shell').boundingBox()
  await tour.getByRole('radio', { name: 'Bathroom', exact: true }).check()
  await expect(tour).toHaveAttribute('data-scene', 'ready')
  const bathroom = page.locator('.bathroom-preview-canvas')
  await expect(bathroom).toHaveAttribute('data-camera-angle', angle!)
  await expect(bathroom).toHaveAttribute('data-camera-scale', scale!)
  const next = await page.locator('.welcome-stage-shell').boundingBox()
  expect(next?.width).toBe(bounds?.width)
  expect(next?.height).toBe(bounds?.height)
  await expect(tour.locator('.welcome-tour-track')).toHaveCount(1)
  await expect(tour.locator('.welcome-tour-card')).toHaveCount(1)
  await expect(tour.getByRole('link', { name: /^Open (kitchen|bathroom)$/ })).toHaveCount(0)
})

for (const room of ['kitchen', 'bathroom'] as const) {
  test(`${room} follows the shared native scroll animation in both directions`, { tag: '@room' }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(room === 'kitchen' ? '/#tour' : '/#tour-bathroom')
    const tour = page.locator('.welcome-tour')
    const track = tour.locator('.welcome-tour-track')
    await expect(tour).toHaveAttribute('data-scene', 'ready')
    await expect(track).toHaveAttribute('data-flow', 'false')
    const chapters = roomTourChapters[room]
    const renderer = page.locator(room === 'kitchen' ? '.welcome-canvas' : '.bathroom-preview-canvas')
    for (const index of [1, chapters.length - 1, 0]) {
      const fraction = index / (chapters.length - 1)
      await track.evaluate((element, fraction) => {
        const card = element.querySelector('.welcome-tour-pin')
        if (!card) throw new Error('The shared exploration card is missing.')
        const start = scrollY + element.getBoundingClientRect().top - parseFloat(getComputedStyle(card).top)
        const travel = element.getBoundingClientRect().height - card.getBoundingClientRect().height
        window.scrollTo({ top: start + travel * fraction, behavior: 'instant' })
      }, fraction)
      await expect(tour).toHaveAttribute('data-chapter', chapters[index].id)
      await expect.poll(async () => Number(await renderer.getAttribute('data-tour-position'))).toBeCloseTo(fraction, 2)
    }
  })
}

for (const width of [1440, 320]) {
  test(`the closing invitation keeps a single direct CTA at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const requests: string[] = []
    page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()) })
    await page.goto('/#get-started')
    const letter = page.locator('#get-started')
    const entry = letter.getByRole('link', { name: 'Start sharing', exact: true })
    await expect(entry).toBeVisible()
    await expect(letter.getByRole('button')).toHaveCount(0)
    await expect(letter.getByRole('link')).toHaveCount(1)
    await expect(entry).toHaveAttribute('href', '/rooms/kitchen#account=create')
    expect(await letter.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect(requests).toEqual([])
  })
}
