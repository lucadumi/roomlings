import type { Locator, Page } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { componentCatalog, createRoomComponent, defaultRoomComponents } from '../../shared/roomComponents.ts'
import type { RoomComponent } from '../../shared/roomComponents.ts'
import { roomCatalog } from '../../shared/rooms.ts'
import { openRoomEditor, openRoomObjects } from './fixtures.ts'

test.use({ providerEnabled: false, reducedMotion: 'reduce' })

const samples = [
  { component: createRoomComponent('seating', 'kitchen-seating', 'thumbnail-stools'), visible: 5, complete: 10 },
  { component: createRoomComponent('curtains', 'kitchen-curtains', 'thumbnail-kitchen-curtains'), visible: 3, complete: 12 },
  { component: createRoomComponent('curtains', 'living-room-curtains', 'thumbnail-living-curtains'), visible: 11, complete: 25 },
  { component: createRoomComponent('cutting-boards', 'kitchen-cutting-boards', 'thumbnail-boards'), visible: 2, complete: 7 },
  { component: createRoomComponent('pet-bowls', 'kitchen-pet-bowls', 'thumbnail-bowls'), visible: 2, complete: 5 },
  { component: createRoomComponent('storage-jars', 'kitchen-drinks', 'thumbnail-jars'), visible: 4, complete: 13 },
]

async function expectedThumbnail(page: Page, component: RoomComponent) {
  return page.evaluate(async (component) => {
    const path = '/src/componentThumbnail.ts'
    const { renderComponentThumbnail } = await import(/* @vite-ignore */ path) as typeof import('../../src/componentThumbnail.ts')
    return renderComponentThumbnail(component, 'original')
  }, component)
}

async function expectThumbnail(card: Locator, image: string) {
  await card.scrollIntoViewIfNeeded()
  await expect(card.locator('.component-preview')).toHaveAttribute('data-preview-ready', 'true', { timeout: 30_000 })
  await expect(card.locator('.component-preview img')).toHaveAttribute('src', image)
}

for (const roomId of ['kitchen', 'living-room'] as const) {
  test(`${roomId} live, editor, catalog and Storage cards use the same single-item thumbnail`, { tag: '@room' },
    async ({ page, accounts, emptyHousehold: owner }, testInfo) => {
      const selected = samples.filter(({ component }) => component.roomId === roomId)
      const stored = selected.map(({ component }) => ({
        ...component, id: `stored-${component.id}`, installed: false, linkedChores: 'pause' as const,
      }))
      const slots = new Set(selected.map(({ component }) => component.slotId))
      await accounts.store.save({
        ...owner.household, roomStyle: 'original',
        roomComponents: [
          ...defaultRoomComponents().filter((component) => !slots.has(component.slotId)),
          ...selected.map(({ component }) => component), ...stored,
        ],
      })
      const before = await accounts.store.get(owner.household.id)
      await page.setViewportSize({ width: 1440, height: 1040 })
      await page.goto(`/rooms/${roomId}`)
      const live = await openRoomObjects(page)
      const images = new Map<string, string>()
      for (const { component } of selected) {
        const image = await expectedThumbnail(page, component)
        images.set(component.kind, image)
        await expectThumbnail(live.getByRole('button', { name: `Open ${component.name} details`, exact: true }), image)
      }
      await page.locator('.room-panel').screenshot({ path: testInfo.outputPath(`${roomId}-live-representatives.png`), animations: 'disabled' })
      const editor = await openRoomEditor(page)
      for (const { component } of selected) {
        await expectThumbnail(editor.getByRole('button', { name: `Edit ${component.name}`, exact: true }), images.get(component.kind)!)
      }
      await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
      for (const { component } of selected.filter(({ component }) => component.kind !== 'storage-jars')) {
        await editor.getByLabel('Find an object', { exact: true }).fill(componentCatalog[component.kind].name)
        await expectThumbnail(editor.getByRole('article', { name: componentCatalog[component.kind].name, exact: true }), images.get(component.kind)!)
      }
      await editor.getByRole('button', { name: 'Storage', exact: true }).click()
      for (const component of stored) {
        await expectThumbnail(editor.locator(`[data-stored-component="${component.id}"]`), images.get(component.kind)!)
      }
      await page.locator('.room-panel').screenshot({ path: testInfo.outputPath(`${roomId}-stored-representatives.png`), animations: 'disabled' })
      await expect(editor).toHaveAccessibleName(`Edit ${roomCatalog[roomId].name} objects`)
      expect(await accounts.store.get(owner.household.id)).toEqual(before)
    })
}

test('rendered representative gallery keeps whole items and uses selected-only contact shadows', { tag: '@room' }, async ({ page }, testInfo) => {
  await page.route(/\/api(?:\/|[?#]|$)/, (route) => route.abort())
  await page.route('**/thumbnail-model-proof', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>Component thumbnail proof</title></head><body></body></html>',
  }))
  await page.setViewportSize({ width: 1080, height: 860 })
  await page.goto('/thumbnail-model-proof')
  const results = await page.evaluate(async (samples) => {
    const thumbnailPath = '/src/componentThumbnail.ts'
    const { buildComponentThumbnail, clearComponentThumbnails, renderComponentThumbnail } =
      await import(/* @vite-ignore */ thumbnailPath) as typeof import('../../src/componentThumbnail.ts')
    type Contact = { position: number[]; size: number[] }
    let contact: Contact | null = null
    const probe = buildComponentThumbnail(samples[0].component, 'original')
    const prototype = Object.getPrototypeOf(probe.root) as import('three').Group
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'add')
    const add = prototype.add
    probe.dispose()
    prototype.add = function (...objects) {
      const shadow = objects.find((object) => object.name === 'Furniture contact shadow')
      if (shadow) contact = { position: shadow.position.toArray(), size: shadow.scale.toArray().slice(0, 2) }
      return add.apply(this, objects)
    }
    document.body.style.cssText = 'margin:0;padding:24px;background:#f7f3e8;color:#373b30;font:16px system-ui'
    const title = document.createElement('h1')
    title.textContent = 'One complete item per list thumbnail'
    title.style.cssText = 'font-size:24px;margin:0 0 18px'
    document.body.append(title)
    const gallery = document.createElement('main')
    gallery.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:20px'
    document.body.append(gallery)
    const result: { slot: string; visible: number; complete: number; bounds: number[]; contact: Contact | null }[] = []
    try {
      for (const sample of samples) {
        const model = buildComponentThumbnail(sample.component, 'original')
        let visible = 0
        let complete = 0
        model.root.traverseVisible((object) => { if ((object as import('three').Mesh).isMesh) visible++ })
        model.root.traverse((object) => { if ((object as import('three').Mesh).isMesh) complete++ })
        const bounds = model.bounds.max.clone().sub(model.bounds.min).toArray()
        model.dispose()
        contact = null
        const image = await renderComponentThumbnail(sample.component, 'original')
        result.push({ slot: sample.component.slotId, visible, complete, bounds, contact })
        const card = document.createElement('figure')
        card.style.cssText = 'margin:0;padding:10px;background:#fffdf8;border-radius:12px'
        const picture = document.createElement('img')
        picture.src = image
        picture.width = 320
        picture.height = 240
        picture.style.cssText = 'width:100%;height:auto'
        const caption = document.createElement('figcaption')
        caption.textContent = `${sample.component.name} · ${sample.component.roomId}`
        card.append(picture, caption)
        gallery.append(card)
      }
    } finally {
      if (descriptor) Object.defineProperty(prototype, 'add', descriptor)
      else Reflect.deleteProperty(prototype, 'add')
      clearComponentThumbnails()
    }
    return result
  }, samples)
  for (const [index, result] of results.entries()) {
    expect(result.visible).toBe(samples[index].visible)
    expect(result.complete).toBe(samples[index].complete)
    if (samples[index].component.kind === 'curtains') expect(result.contact).toBeNull()
    else {
      expect(result.contact).not.toBeNull()
      expect(result.contact!.size[0]).toBeCloseTo(Math.max(0.3, result.bounds[0] * 1.12), 6)
      expect(result.contact!.size[1]).toBeCloseTo(Math.max(0.3, result.bounds[2] * 1.12), 6)
      expect(result.contact!.position[0]).toBeCloseTo(0, 6)
      expect(result.contact!.position[1]).toBeCloseTo(-result.bounds[1] / 2 - 0.025, 6)
      expect(result.contact!.position[2]).toBeCloseTo(0, 6)
    }
  }
  await expect(page.locator('main img')).toHaveCount(samples.length)
  await expect.poll(() => page.locator('main img').evaluateAll((images) =>
    images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
  await testInfo.attach('representative-mesh-and-shadow-evidence', {
    body: JSON.stringify(results, null, 2), contentType: 'application/json',
  })
  await page.screenshot({ path: testInfo.outputPath('single-item-thumbnail-gallery.png'), animations: 'disabled' })
})
