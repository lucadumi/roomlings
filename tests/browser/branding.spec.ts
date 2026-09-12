import { expect, test } from './account-fixtures.ts'
import type { Locator, Page, Route } from '@playwright/test'
import type { Session } from '../../shared/domain.ts'
import { createHousehold, openGroceryForm, pauseRequest, savedKitchen, waitForTourReady } from './fixtures.ts'
import { createPopulatedHousehold } from '../household-fixture.ts'

async function restoreKitchen(page: Page, session: Session) {
  await page.addInitScript((kitchen) => {
    localStorage.setItem('roomlings.session', kitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
  }, savedKitchen(session))
}

type HeldResponse = { status: number; json: unknown }
type HeldAction = HeldResponse | 'continue' | 'abort'
const heldRequests = new WeakMap<Page, Set<() => Promise<void>>>()

// Strict Mode can issue another initial GET before the first one finishes.
async function holdApiRequests(page: Page, url: string) {
  let notify!: () => void
  let resume!: (action: HeldAction) => void
  const pending = new Promise<void>((resolve) => { notify = resolve })
  const gate = new Promise<HeldAction>((resolve) => { resume = resolve })
  const active = new Set<Promise<void>>()
  const handler = (route: Route) => {
    notify()
    const handled = (async () => {
      const action = await gate
      if (action === 'abort') await route.abort()
      else if (action === 'continue') await route.fallback()
      else await route.fulfill(action)
    })()
    active.add(handled)
    return handled.finally(() => active.delete(handled))
  }
  await page.route(url, handler)
  let finished = false
  const cleanup = heldRequests.get(page) ?? new Set<() => Promise<void>>()
  heldRequests.set(page, cleanup)
  const finish = async (action: HeldAction) => {
    if (finished) return
    finished = true
    resume(action)
    try {
      while (active.size) await Promise.all(active)
    } finally {
      // Disabling interception first would automatically release pending requests.
      await page.unroute(url, handler)
      cleanup.delete(abort)
    }
  }
  const abort = () => finish('abort')
  cleanup.add(abort)
  return { pending, release: (response?: HeldResponse) => finish(response ?? 'continue') }
}

test.afterEach(async ({ page }) => {
  for (const abort of heldRequests.get(page) ?? []) await abort()
  heldRequests.delete(page)
})

async function expectLoadedImage(image: Locator) {
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element: HTMLImageElement) =>
    element.complete && element.naturalWidth > 0 && element.naturalHeight > 0,
  )).toBe(true)
}

function imageSource(image: Locator) {
  return image.evaluate((element: HTMLImageElement) => element.currentSrc || element.src)
}

async function imageType(image: Locator) {
  const source = await imageSource(image)
  if (source.startsWith('data:')) return source.slice(5).split(/[;,]/, 1)[0]
  return image.page().evaluate(async (url) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`The brand image returned HTTP ${response.status}.`)
    return response.headers.get('content-type')?.split(';')[0]
  }, source)
}

async function readSvg(page: Page, source: string) {
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',')
    const metadata = source.slice(5, comma)
    if (!/^image\/svg\+xml(?:;|$)/.test(metadata)) throw new Error('The branding data URL is not SVG.')
    const body = source.slice(comma + 1)
    return metadata.endsWith(';base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body)
  }
  return page.evaluate(async (url) => {
    const response = await fetch(url)
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/svg+xml')) {
      throw new Error('The branding asset is not a successfully loaded SVG.')
    }
    return response.text()
  }, source)
}

function svgGeometry(page: Page, markup: string) {
  return page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml')
    if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') {
      throw new Error('The branding asset is not valid SVG.')
    }
    const attributes = ['d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'points', 'cx', 'cy', 'r']
    return {
      viewBox: document.documentElement.getAttribute('viewBox')?.trim().split(/\s+/).map(Number),
      shapes: [...document.querySelectorAll('path, rect, polygon, circle, ellipse')].map((element) => [
        element.localName,
        ...attributes.map((attribute) => element.getAttribute(attribute)?.trim().replace(/\s+/g, ' ') ?? null),
      ]),
      paths: document.querySelectorAll('path').length,
      text: document.querySelectorAll('text').length,
      raster: document.querySelectorAll('image, foreignObject, canvas').length,
      outline: document.querySelector('svg > g > path')?.getAttribute('d') ?? null,
    }
  }, markup)
}

async function expectBrandFits(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const width = document.documentElement.clientWidth
    return {
      overflow: document.documentElement.scrollWidth > width,
      clipped: [...document.querySelectorAll('.brand, .brand img')].filter((element) => {
        const box = element.getBoundingClientRect()
        return box.width > 0 && (box.left < -1 || box.right > width + 1)
      }).map((element) => element.className),
    }
  })).toEqual({ overflow: false, clipped: [] })
}

async function expectLoader(loader: Locator) {
  await expectLoadedImage(loader)
  await expect(loader).toHaveAttribute('alt', '')
  await expect(loader).toHaveAttribute('aria-hidden', 'true')
  await expect(loader).toHaveAttribute('width', /^[1-9]\d*$/)
  await expect(loader).toHaveAttribute('height', /^[1-9]\d*$/)
  await expect(loader).toHaveCSS('animation-name', 'none')
  await expect(loader).toHaveCSS('transform', 'none')
  expect(await loader.evaluate((element) => ({
    spinning: !!element.closest('.spin'),
    animations: element.getAnimations().length,
  }))).toEqual({ spinning: false, animations: 0 })
  expect(await imageType(loader)).toBe('image/svg+xml')
}

async function expectStaticSvg(page: Page, markup: string, tone: 'color' | 'light') {
  const browser = page.context().browser()
  if (!browser) throw new Error('SVG checks need an isolated browser context.')
  const isolated = await browser.newPage({ reducedMotion: 'no-preference' })
  try {
    await isolated.goto(`data:image/svg+xml,${encodeURIComponent(markup)}`)
    expect(await isolated.locator('svg').evaluate((element: SVGSVGElement) => {
      const box = element.viewBox.baseVal
      return [box.x, box.y, box.width, box.height]
    })).toEqual([0, 0, 256, 256])
    await expect(isolated.locator('image, foreignObject, canvas, animate, animateTransform, animateMotion')).toHaveCount(0)
    expect(await isolated.evaluate(() => document.getAnimations().length)).toBe(0)
    const fills = await isolated.evaluate(() => [...new Set(
      [...document.querySelectorAll('path')].filter((element) => !element.closest('defs'))
        .map((element) => getComputedStyle(element).fill),
    )])
    expect(fills.sort()).toEqual(tone === 'light' ? ['rgb(252, 249, 241)'] : [
      'rgb(129, 178, 154)', 'rgb(224, 122, 95)', 'rgb(242, 204, 143)', 'rgb(82, 120, 97)',
    ].sort())
    await isolated.emulateMedia({ reducedMotion: 'reduce' })
    expect(await isolated.evaluate(() => document.getAnimations().length)).toBe(0)
  } finally {
    await isolated.close()
  }
}

test('the Roomlings rebrand restores existing Coldshare households without replacing them', async ({ page, accounts }) => {
  const original = await createPopulatedHousehold(accounts.store)
  const kitchen = savedKitchen(original)
  await page.addInitScript(({ token, kitchen }) => {
    localStorage.setItem('coldshare.session', token)
    localStorage.setItem('coldshare.kitchens', JSON.stringify([kitchen]))
  }, { token: original.token, kitchen })

  await page.goto('/kitchen')
  await expect(page).toHaveTitle('Roomlings \u00b7 A home to share')
  await expect(page.getByRole('link', { name: 'Roomlings home', exact: true })).toBeVisible()
  await expect(page.locator('.game-house')).toContainText(original.household.name)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(original.token)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))).toEqual([kitchen])
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).toBe(original.token)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('coldshare.kitchens') ?? '[]'))).toEqual([kitchen])

  await page.reload()
  await expect(page.locator('.game-house')).toContainText(original.household.name)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(original.token)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.locator('.expense-row')).toHaveCount(original.household.expenses.length)
})

test('Roomlings sessions take precedence over retained legacy browser storage', async ({ page, accounts }) => {
  const legacy = await createHousehold(accounts.store, 'The legacy household', 'Legacy roommate')
  const current = await createHousehold(accounts.store, 'The current household', 'Current roommate')
  const currentKitchen = savedKitchen(current)
  await page.addInitScript(({ oldKitchen, currentKitchen }) => {
    localStorage.setItem('coldshare.session', oldKitchen.token)
    localStorage.setItem('coldshare.kitchens', JSON.stringify([oldKitchen]))
    localStorage.setItem('roomlings.session', currentKitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([currentKitchen]))
  }, { oldKitchen: savedKitchen(legacy), currentKitchen })

  await page.goto('/kitchen')
  await expect(page.getByRole('link', { name: 'Roomlings home', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(current.token)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))).toEqual([currentKitchen])
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).toBe(legacy.token)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('coldshare.kitchens') ?? '[]'))).toEqual([savedKitchen(legacy)])
})

test('flat Patchwork branding keeps accessible links and fits phones, tablets and landscape', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/welcome')
  await expect(page).toHaveTitle('Roomlings \u00b7 Share a home. Not the hassle.')
  const header = page.locator('.welcome-header .brand')
  const footer = page.locator('.welcome footer .brand')
  for (const brand of [header, footer]) {
    await expect(brand).toHaveRole('link')
    await expect(brand).toHaveAccessibleName(/Roomlings/i)
    expect(new URL((await brand.getAttribute('href'))!, page.url()).pathname).toBe('/welcome')
    await expect(brand.getByRole('img')).toHaveCount(0)
    await expect(brand.locator('span.roomlings-brand')).toHaveText('')
    await expect(brand.locator('.roomlings-brand')).toHaveCSS('animation-name', 'none')
    await expectLoadedImage(brand.locator('img.roomlings-wordmark'))
    await expect(brand.locator('canvas, svg, .spin')).toHaveCount(0)
  }
  const identities = await Promise.all([header, footer].map(async (brand) => ({
    href: await brand.getAttribute('href'),
    label: await brand.getAttribute('aria-label'),
  })))
  await expect(header.locator('.roomlings-brand')).toHaveAttribute('data-variant', 'featured')
  await expect(footer.locator('.roomlings-brand')).toHaveAttribute('data-variant', 'compact')
  await expect(header.locator('picture')).toHaveCount(0)
  await expect(footer.locator('picture')).toHaveCount(0)
  const featured = header.locator('img.roomlings-brand-icon')
  const compact = footer.locator('img.roomlings-brand-icon')
  expect(await imageType(compact)).toBe('image/svg+xml')
  for (const viewport of [
    { width: 1280, height: 800 }, { width: 641, height: 720 }, { width: 640, height: 720 },
    { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => imageType(featured)).toBe('image/svg+xml')
    expect(await imageSource(featured)).toBe(await imageSource(compact))
    await expectLoadedImage(featured)
    await expectLoadedImage(compact)
    await expectBrandFits(page)
    for (const [index, brand] of [header, footer].entries()) {
      await expect(brand).toHaveAttribute('href', identities[index].href!)
      await expect(brand).toHaveAttribute('aria-label', identities[index].label!)
    }
  }
})

test('the favicon uses the flat mark and both landing wordmarks are real outlined SVG assets', async ({ page }) => {
  await page.goto('/welcome')
  const icon = page.locator('.welcome footer .brand img.roomlings-brand-icon')
  await expectLoadedImage(icon)
  const flat = await svgGeometry(page, await readSvg(page, await imageSource(icon)))
  expect(flat.viewBox).toEqual([0, 0, 256, 256])
  expect(flat.paths).toBeGreaterThan(0)
  expect(flat.text).toBe(0)
  expect(flat.raster).toBe(0)
  const favicon = page.locator('link[rel~="icon"]')
  await expect(favicon).toHaveCount(1)
  const faviconSource = await favicon.evaluate((element: HTMLLinkElement) => element.href)
  expect(await svgGeometry(page, await readSvg(page, faviconSource))).toEqual(flat)
  const wordmarks = page.locator('.brand img.roomlings-wordmark')
  await expect(wordmarks).toHaveCount(2)
  const sources = await Promise.all((await wordmarks.all()).map(imageSource))
  expect(sources[0]).toBe(sources[1])
  const outlined = await svgGeometry(page, await readSvg(page, sources[0]))
  expect(outlined.paths).toBeGreaterThan(0)
  expect(outlined.text).toBe(0)
  expect(outlined.raster).toBe(0)
  expect(outlined.viewBox![2]).toBeGreaterThan(outlined.viewBox![3])
})

test('the in-app brand stays compact, accessible and unclipped after orientation changes', async ({ page, accounts }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await restoreKitchen(page, await createHousehold(accounts.store, 'The branded household', 'You'))
  await page.goto('/kitchen')
  const brand = page.locator('.game-hud .brand')
  await expect(brand).toHaveRole('link')
  await expect(brand).toHaveAccessibleName('Roomlings home')
  await expect(brand).toHaveAttribute('href', '/')
  await expect(brand.getByRole('img')).toHaveCount(0)
  await expect(brand.locator('span.roomlings-brand')).toHaveAttribute('data-variant', 'compact')
  await expect(brand.locator('.roomlings-brand')).toHaveCSS('animation-name', 'none')
  await expect(brand.locator('picture, canvas, svg, .spin')).toHaveCount(0)
  expect(await imageType(brand.locator('img.roomlings-brand-icon'))).toBe('image/svg+xml')
  for (const viewport of [
    { width: 320, height: 568 }, { width: 640, height: 360 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport)
    await expectLoadedImage(brand.locator('img.roomlings-brand-icon'))
    await expectLoadedImage(brand.locator('img.roomlings-wordmark'))
    await expectBrandFits(page)
    await expect(brand).toBeVisible()
  }
})

for (const module of ['App', 'Welcome', 'KitchenWorld', 'BathroomWorld'] as const) {
  test(`the ${module} lazy boundary shows only the 2D scene loader until its import resolves`,
    module === 'KitchenWorld' || module === 'BathroomWorld' ? { tag: '@room' } : {},
    async ({ page, accounts }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      if (module !== 'Welcome') {
        const session = await createHousehold(accounts.store, 'The lazy household', 'You')
        await restoreKitchen(page, session)
      }
      const pending = await pauseRequest(page, `**/{${module}.tsx*,${module}-*.js}`)
      await page.goto(module === 'Welcome' ? '/' : module === 'BathroomWorld' ? '/rooms/bathroom' : '/kitchen', { waitUntil: 'commit' })
      const route = await pending.pending
      const status = page.locator('.scene-loading[role="status"]')
      await expect(status).toHaveText(module === 'KitchenWorld' ? 'Opening the kitchen...' : module === 'BathroomWorld' ? 'Opening the bathroom...' : 'Opening Roomlings...')
      await expectLoader(status.locator('img.roomlings-loader'))
      await expect(status.locator('canvas, svg, .spin, [role="progressbar"]')).toHaveCount(0)
      await route.continue()
      if (module === 'Welcome') {
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Share a home.')
      } else {
        await expect(page.locator('.game-house')).toContainText('The lazy household')
      }
      await expect(page.locator('.scene-loading')).toHaveCount(0)
      if (module === 'KitchenWorld' || module === 'BathroomWorld') await expect(page.locator('.world-canvas canvas')).toBeVisible()
    })
}

test('the pending tour keeps its Patchwork loader static while the room motion toggle still works', { tag: '@room' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1280, height: 800 })
  const pending = await pauseRequest(page, '**/{TourScene.tsx*,TourScene-*.js}')
  await page.goto('/welcome', { waitUntil: 'commit' })
  await page.locator('.welcome-stage').scrollIntoViewIfNeeded()
  const route = await pending.pending
  const status = page.locator('.welcome-explore-loading[role="status"]')
  const loader = status.locator('img.roomlings-loader')
  await expectLoader(loader)
  const loadingText = await status.innerText()
  expect(loadingText.trim()).not.toBe('')
  const originalSource = await imageSource(loader)
  const original = await svgGeometry(page, await readSvg(page, originalSource))
  const toggle = page.getByRole('button', { name: 'Reduced motion', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(await imageSource(loader)).toBe(originalSource)
  await expect(status).toHaveText(loadingText)
  const staticMarkup = await readSvg(page, await imageSource(loader))
  expect(await svgGeometry(page, staticMarkup)).toEqual(original)
  await expectStaticSvg(page, staticMarkup, 'color')
  await route.continue()
  await waitForTourReady(page)
  await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-rendering', 'paused')
  await expect(status.locator('img.roomlings-loader')).toHaveCount(0)
})

test('an initial account check announces loading before exposing the sign-in form', async ({ page }) => {
  const pending = await holdApiRequests(page, '**/api/account')
  await page.goto('/#account', { waitUntil: 'commit' })
  await pending.pending
  const dialog = page.getByRole('dialog')
  const status = dialog.getByRole('status').filter({ has: page.locator('img.roomlings-loader') })
  await expect(status).toHaveClass(/\bloading-status\b/)
  await expect(status).toContainText(/account/i)
  await expectLoader(status.locator('img.roomlings-loader'))
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveCount(0)
  await pending.release()
  await expect(status).toHaveCount(0)
  await expect(dialog.getByLabel('Email address', { exact: true })).toBeVisible()
})

test('static Patchwork loaders follow real requests and preserve failed-save retries', async ({ page }) => {
  const initial = await holdApiRequests(page, '**/api/account')
  await page.goto('/rooms/kitchen', { waitUntil: 'commit' })
  await initial.pending
  const checking = page.getByRole('status').filter({ hasText: 'Checking saved access' })
  await expectLoader(checking.locator('img.roomlings-loader'))
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(checking).not.toContainText(/\d+\s*%/)
  const normalMarkup = await readSvg(page, await imageSource(checking.locator('img.roomlings-loader')))
  const faviconSource = await page.locator('link[rel~="icon"]').evaluate((element: HTMLLinkElement) => element.href)
  expect(await svgGeometry(page, normalMarkup)).toEqual(await svgGeometry(page, await readSvg(page, faviconSource)))
  await initial.release({ status: 503, json: { error: 'Account access is temporarily unavailable.' } })
  await expect(checking).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveText('Account access is temporarily unavailable.')
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  const retry = await holdApiRequests(page, '**/api/account')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await retry.pending
  await expectLoader(checking.locator('img.roomlings-loader'))
  await retry.release()
  await expect(checking).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email address', { exact: true }).fill('branding@example.com')
  // A resolved request must not wait for a cosmetic timer.
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 60_000))
  const sending = await holdApiRequests(page, '**/api/account/code')
  await dialog.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  await sending.pending
  const busy = dialog.getByRole('button').filter({ has: page.locator('img.roomlings-loader') })
  await expect(busy).toBeDisabled()
  await expect(busy).not.toHaveAccessibleName(/Roomlings/i)
  await expectLoader(busy.locator('img.roomlings-loader'))
  const lightMarkup = await readSvg(page, await imageSource(busy.locator('img.roomlings-loader')))
  const lightGeometry = await svgGeometry(page, lightMarkup)
  const normalGeometry = await svgGeometry(page, normalMarkup)
  expect(lightGeometry.viewBox).toEqual(normalGeometry.viewBox)
  expect(lightGeometry.outline).toBe(normalGeometry.outline)
  expect(lightMarkup).not.toBe(normalMarkup)
  await sending.release({ status: 503, json: { error: 'Email delivery is temporarily unavailable.' } })
  await expect(dialog.getByRole('alert')).toHaveText('Email delivery is temporarily unavailable.')
  await expect(dialog.locator('img.roomlings-loader')).toHaveCount(0)
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveValue('branding@example.com')
  await expect(dialog.getByLabel('Email sign-in code', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Send sign-in code', exact: true })).toBeEnabled()
  const resend = await holdApiRequests(page, '**/api/account/code')
  await dialog.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  await resend.pending
  await expectLoader(busy.locator('img.roomlings-loader'))
  await resend.release()
  await expect(dialog.getByLabel('Email sign-in code', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.locator('img.roomlings-loader, .spin')).toHaveCount(0)
  await expectStaticSvg(page, normalMarkup, 'color')
  await expectStaticSvg(page, lightMarkup, 'light')
})

test('browser-access loading and refresh icons recover from failure without pretending a refresh succeeded', async ({ page, accounts }) => {
  await restoreKitchen(page, await createHousehold(accounts.store, 'The branding access home', 'Robin'))
  await page.goto('/kitchen')
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  const initial = await holdApiRequests(page, '**/api/access')
  await page.getByRole('button', { name: 'Recovery and devices', exact: true }).click()
  await initial.pending
  const dialog = page.getByRole('dialog', { name: 'Your browser access.', exact: true })
  const loading = dialog.getByRole('status').filter({ has: page.locator('img.roomlings-loader') })
  await expect(loading).toHaveClass(/\bloading-status\b/)
  await expect(loading).toContainText(/access/i)
  await expectLoader(loading.locator('img.roomlings-loader'))
  await initial.release()
  await expect(loading).toHaveCount(0)
  await expect(dialog.getByLabel('Name this browser', { exact: true })).toHaveValue('Saved browser')

  const refresh = dialog.getByRole('button', { name: 'Refresh browser sessions', exact: true })
  await expect(refresh.locator('svg')).toBeVisible()
  await expect(refresh.locator('img.roomlings-loader')).toHaveCount(0)
  const idleName = await refresh.getAttribute('aria-label')
  const pending = await holdApiRequests(page, '**/api/access')
  await refresh.click()
  await pending.pending
  await expect(refresh).toBeDisabled()
  await expect(refresh).toHaveAccessibleName(idleName!)
  await expectLoader(refresh.locator('img.roomlings-loader'))
  await expect(refresh.locator('svg')).toHaveCount(0)
  await pending.release({ status: 503, json: { error: 'Browser access is temporarily unavailable.' } })
  await expect(dialog.getByRole('alert')).toHaveText('Browser access is temporarily unavailable.')
  await expect(dialog.locator('img.roomlings-loader')).toHaveCount(0)
  await expect(refresh).toBeEnabled()
  await expect(refresh.locator('svg')).toBeVisible()
  await expect(dialog.getByLabel('Name this browser', { exact: true })).toHaveValue('Saved browser')
  const refreshed = page.waitForResponse('**/api/access')
  await refresh.click()
  expect((await refreshed).ok()).toBe(true)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(refresh.locator('img.roomlings-loader')).toHaveCount(0)
  await expect(refresh.locator('svg')).toBeVisible()
})

test('a pending grocery save uses the 2D loader and keeps the draft and retry on failure', async ({ page, accounts }) => {
  await restoreKitchen(page, await createHousehold(accounts.store, 'The branding grocery home', 'Robin'))
  await page.goto('/kitchen')
  await openGroceryForm(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('What did you pick up?', { exact: true }).fill('Keep these branding-test groceries')
  await dialog.getByLabel('Total (EUR)', { exact: true }).fill('4.20')
  const pending = await pauseRequest(page, '**/api/expenses')
  await dialog.getByRole('button', { name: 'Add & split the groceries', exact: true }).click()
  const route = await pending.pending
  const busy = dialog.getByRole('button').filter({ has: page.locator('img.roomlings-loader') })
  await expect(busy).toBeDisabled()
  await expectLoader(busy.locator('img.roomlings-loader'))
  await expect(dialog.locator('.spin, canvas')).toHaveCount(0)
  await route.fulfill({ status: 503, json: { error: 'The groceries could not be saved. Please try again.' } })
  await expect(dialog.getByRole('alert')).toHaveText('The groceries could not be saved. Please try again.')
  await expect(dialog.locator('img.roomlings-loader')).toHaveCount(0)
  await expect(dialog.getByLabel('What did you pick up?', { exact: true })).toHaveValue('Keep these branding-test groceries')
  await expect(dialog.getByLabel('Total (EUR)', { exact: true })).toHaveValue('4.20')
  await expect(page.getByText('Keep these branding-test groceries', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/expenses')
  await dialog.getByRole('button', { name: 'Add & split the groceries', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.locator('.expense-row').filter({ hasText: 'Keep these branding-test groceries' })).toHaveCount(1)
})
