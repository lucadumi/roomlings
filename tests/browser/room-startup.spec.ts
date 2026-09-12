import { expect, test } from './account-fixtures.ts'
import type { Page } from '@playwright/test'
import { roomPath } from '../../src/roomNavigation.ts'

test.use({ reducedMotion: 'reduce' })

async function installStartupProbe(page: Page) {
  await page.addInitScript(() => {
    let contexts = 0
    let nextIdle = 0
    const pendingIdle = new Map<number, IdleRequestCallback>()
    const getContext = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, type: string, options?: unknown) {
        if (type.startsWith('webgl')) contexts++
        return Reflect.apply(getContext, this, [type, options])
      },
    })
    window.requestIdleCallback = (callback) => { pendingIdle.set(++nextIdle, callback); return nextIdle }
    window.cancelIdleCallback = (id) => { pendingIdle.delete(id) }
    Reflect.set(window, 'sceneStartupProbe', () => ({ contexts, idle: pendingIdle.size }))
    Reflect.set(window, 'flushStartupIdle', () => {
      const callbacks = [...pendingIdle.values()]
      pendingIdle.clear()
      callbacks.forEach((callback) => callback({ didTimeout: false, timeRemaining: () => 50 }))
    })
  })
}

function startupProbe(page: Page) {
  return page.evaluate(() => {
    const read: () => { contexts: number; idle: number } = Reflect.get(window, 'sceneStartupProbe')
    return read()
  })
}

for (const roomId of ['kitchen', 'bathroom', 'living-room'] as const) {
  test(`${roomId} defers cold GPU work behind accounts and keeps an initialized scene`, { tag: '@room' }, async ({ page, populatedHousehold: _owner }) => {
    await installStartupProbe(page)
    const probe = () => startupProbe(page)
    await page.goto(`${roomPath(roomId)}#account`)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    expect(await probe()).toEqual({ contexts: 0, idle: 0 })

    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    const canvas = page.locator('.world-canvas canvas')
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    await canvas.evaluate((element) => element.setAttribute('data-startup-retained', 'true'))
    await expect.poll(async () => (await probe()).idle).toBeGreaterThan(0)
    const started = await probe()
    await page.getByRole('button', { name: 'The roommates', exact: true }).click()
    await page.getByRole('button', { name: 'Account and membership', exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect.poll(async () => (await probe()).idle).toBe(0)
    await expect(canvas).toHaveAttribute('data-startup-retained', 'true')
    expect((await probe()).contexts).toBe(started.contexts)
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-startup-retained', 'true')
    expect((await probe()).contexts).toBe(started.contexts)
  })
}

test('opening accounts cancels an automatic preload even while its renderer module is loading', { tag: '@room' }, async ({ page, populatedHousehold: _owner }) => {
  await installStartupProbe(page)
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/src/householdRoomPreview.ts*', async (route) => {
    await held
    await route.fulfill({
      contentType: 'text/javascript',
      body: `export async function renderHouseholdRoomPreviews() {
        window.preloadRendererCalls = (window.preloadRendererCalls || 0) + 1;
        return { kitchen: 'ready', bathroom: 'ready', 'living-room': 'ready' };
      }`,
    })
  })
  try {
    await page.goto('/kitchen')
    await expect(page.locator('.world-canvas canvas')).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await startupProbe(page)).idle).toBeGreaterThan(0)
    const loading = page.waitForRequest((request) => new URL(request.url()).pathname === '/src/householdRoomPreview.ts')
    await page.evaluate(() => {
      const flush: () => void = Reflect.get(window, 'flushStartupIdle')
      flush()
    })
    await loading
    await page.getByRole('button', { name: 'The roommates', exact: true }).click()
    await page.getByRole('button', { name: 'Account and membership', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === '/src/householdRoomPreview.ts')
    release()
    await loaded
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    expect(await page.evaluate(() => Reflect.get(window, 'preloadRendererCalls') ?? 0)).toBe(0)
  } finally {
    release()
  }
})

test('canceling between room snapshots stops the remaining renders and releases the context', { tag: '@room' }, async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort())
  await page.goto('/src/householdRoomPreview.ts')
  const result = await page.evaluate(async () => {
    const modulePath = '/src/householdRoomPreview.ts'
    const { renderHouseholdRoomPreviews } = await import(/* @vite-ignore */ modulePath)
    const controller = new AbortController()
    const cancellation = new Error('Stop background room snapshots')
    let snapshots = 0
    const context: { current: WebGL2RenderingContext | null } = { current: null }
    const original = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const result = Reflect.apply(original, this, args)
      snapshots++
      context.current = this.getContext('webgl2')
      controller.abort(cancellation)
      return result
    }
    let aborted = false
    try {
      await renderHouseholdRoomPreviews({
        roomStyle: 'original',
        sizes: { kitchen: { width: 172, height: 118 }, bathroom: { width: 172, height: 118 }, 'living-room': { width: 172, height: 118 } },
      }, controller.signal)
    } catch (cause) {
      if (cause !== cancellation) throw cause
      aborted = true
    } finally {
      HTMLCanvasElement.prototype.toDataURL = original
    }
    return { snapshots, aborted, released: context.current !== null && context.current.isContextLost() }
  })
  expect(result).toEqual({ snapshots: 1, aborted: true, released: true })
})
