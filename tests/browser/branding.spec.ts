import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { Session } from '../../shared/domain.ts'
import { test as accountTest } from './account-fixtures.ts'
import { createHousehold, openGroceryForm, pauseRequest, sampleSession, savedKitchen } from './fixtures.ts'

async function restoreKitchen(page: Page, session: Session) {
  await page.addInitScript((kitchen) => {
    localStorage.setItem('roomlings.session', kitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
  }, savedKitchen(session))
}

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

async function expectSvgMotion(page: Page, markup: string, mode: 'normal' | 'light' | 'static') {
  const browser = page.context().browser()
  if (!browser) throw new Error('SVG animation checks need an isolated browser context.')
  const isolated = await browser.newPage({ reducedMotion: 'no-preference' })
  try {
    await isolated.goto(`data:image/svg+xml,${encodeURIComponent(markup)}`)
    await expect(isolated.locator('svg')).toHaveAttribute('viewBox', '0 0 128 128')
    await expect(isolated.locator('image, foreignObject, canvas, animate, animateTransform, animateMotion')).toHaveCount(0)
    if (mode === 'static') {
      expect(await isolated.evaluate(() => document.getAnimations().length)).toBe(0)
      return
    }

    await expect(isolated.locator('rect.threshold')).toHaveCount(1)
    await expect.poll(() => isolated.evaluate(() => document.getAnimations().length)).toBe(1)
    const motion = await isolated.evaluate(async () => {
      const animation = document.getAnimations()[0]
      if (!(animation.effect instanceof KeyframeEffect)) throw new Error('The threshold needs a CSS animation.')
      const effect = animation.effect
      const threshold = document.querySelector('rect.threshold')!
      const stationary = [...document.querySelectorAll('svg, g, path, rect')].filter((element) => element !== threshold)
      const timing = effect.getTiming()
      const keyframes = effect.getKeyframes().map(({ computedOffset, easing }) => ({ offset: computedOffset, easing }))
      animation.pause()
      await animation.ready
      const samples: { threshold: number[]; stationary: string[] }[] = []
      for (const time of [0, 500, 1000, 1500, 2000]) {
        animation.currentTime = time
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const transform = getComputedStyle(threshold).transform
        const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform)
        samples.push({
          threshold: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
          stationary: stationary.map((element) => getComputedStyle(element).transform),
        })
      }
      return {
        thresholdOnly: effect.target === threshold,
        duration: timing.duration,
        delay: timing.delay,
        infinite: timing.iterations === Infinity,
        direction: timing.direction,
        keyframes,
        samples,
        fills: [...new Set([...document.querySelectorAll('path, rect')].map((element) => getComputedStyle(element).fill))],
      }
    })
    expect(motion.thresholdOnly).toBe(true)
    expect(motion.duration).toBe(2000)
    expect(motion.delay).toBe(0)
    expect(motion.infinite).toBe(true)
    expect(motion.direction).toBe('normal')
    expect(motion.keyframes.map((frame) => frame.offset)).toEqual([0, 0.5, 1])
    expect(motion.keyframes.slice(0, 2).map((frame) => frame.easing)).toEqual([
      'cubic-bezier(0.37, 0, 0.63, 1)', 'cubic-bezier(0.37, 0, 0.63, 1)',
    ])
    for (const [index, lift] of [0, -4, -8, -4, 0].entries()) {
      const sample = motion.samples[index]
      expect(sample.threshold.slice(0, 5)).toEqual([1, 0, 0, 1, 0])
      expect(sample.threshold[5]).toBeCloseTo(lift, 2)
      expect(sample.stationary).toEqual(motion.samples[0].stationary)
    }
    expect(motion.fills).toHaveLength(mode === 'light' ? 1 : 2)

    await isolated.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(() => isolated.evaluate(() => document.getAnimations().length)).toBe(0)
    expect(await isolated.locator('rect.threshold').evaluate((element) => {
      const transform = getComputedStyle(element).transform
      return new DOMMatrixReadOnly(transform === 'none' ? undefined : transform).isIdentity
    })).toBe(true)
  } finally {
    await isolated.close()
  }
}

test('the Roomlings rebrand restores existing Coldshare households without replacing them', async ({ page, request }) => {
  const original = await sampleSession(request)
  const kitchen = savedKitchen(original)
  await page.addInitScript(({ token, kitchen }) => {
    localStorage.setItem('coldshare.session', token)
    localStorage.setItem('coldshare.kitchens', JSON.stringify([kitchen]))
  }, { token: original.token, kitchen })

  await page.goto('/')
  await expect(page).toHaveTitle('Roomlings | A home to share')
  await expect(page.locator('.game-hud .brand').getByRole('img', { name: 'Roomlings', exact: true })).toBeVisible()
  await expect(page.locator('.game-house')).toContainText(original.household.name)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(original.token)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))).toEqual([kitchen])
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).toBe(original.token)

  await page.reload()
  await expect(page.locator('.game-house')).toContainText(original.household.name)
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(original.token)
  await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
  await expect(page.locator('.expense-row')).toHaveCount(original.household.expenses.length)
})

test('Roomlings sessions take precedence over retained legacy browser storage', async ({ page, request }) => {
  const legacy = await sampleSession(request)
  const current = await sampleSession(request)
  const currentKitchen = savedKitchen(current)
  await page.addInitScript(({ oldKitchen, currentKitchen }) => {
    localStorage.setItem('coldshare.session', oldKitchen.token)
    localStorage.setItem('coldshare.kitchens', JSON.stringify([oldKitchen]))
    localStorage.setItem('roomlings.session', currentKitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([currentKitchen]))
  }, { oldKitchen: savedKitchen(legacy), currentKitchen })

  await page.goto('/')
  await expect(page.locator('.game-hud .brand').getByRole('img', { name: 'Roomlings', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(current.token)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomlings.kitchens') ?? '[]'))).toEqual([currentKitchen])
  expect(await page.evaluate(() => localStorage.getItem('coldshare.session'))).toBe(legacy.token)
})

test('landing branding keeps accessible links and fits phones, the icon breakpoint and landscape', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/welcome')
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
  await expect(header.locator('picture.roomlings-brand-icon source')).toHaveAttribute('media', /^\(max-width:\s*640px\)$/)
  await expect(footer.locator('picture')).toHaveCount(0)
  const featured = header.locator('picture.roomlings-brand-icon img')
  const compact = footer.locator('img.roomlings-brand-icon')
  expect(await imageType(compact)).toBe('image/svg+xml')
  for (const viewport of [
    { width: 1280, height: 800 }, { width: 641, height: 720 }, { width: 640, height: 720 },
    { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => imageType(featured)).toBe(viewport.width <= 640 ? 'image/svg+xml' : 'image/png')
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
  expect(flat.viewBox).toEqual([0, 0, 128, 128])
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

test('the in-app brand stays compact, accessible and unclipped after orientation changes', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await restoreKitchen(page, await sampleSession(request))
  await page.goto('/')
  const brand = page.locator('.game-hud .brand')
  await expect(brand.getByRole('img', { name: 'Roomlings', exact: true })).toHaveCount(1)
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
    await expect(brand.getByRole('img', { name: 'Roomlings', exact: true })).toBeVisible()
  }
})

for (const module of ['App', 'Welcome', 'KitchenWorld'] as const) {
  test(`the ${module} lazy boundary shows only the 2D scene loader until its import resolves`,
    module === 'KitchenWorld' ? { tag: '@room' } : {},
    async ({ page, request }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      if (module !== 'Welcome') await restoreKitchen(page, await sampleSession(request))
      const pending = await pauseRequest(page, `**/{${module}.tsx*,${module}-*.js}`)
      await page.goto(module === 'Welcome' ? '/' : '/kitchen', { waitUntil: 'commit' })
      const route = await pending.pending
      const status = page.locator('.scene-loading[role="status"]')
      await expect(status).toHaveText('Putting the kettle on...')
      await expectLoader(status.locator('img.roomlings-loader'))
      await expect(status.locator('canvas, svg, .spin, [role="progressbar"]')).toHaveCount(0)
      await route.continue()
      if (module === 'Welcome') {
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Share a home.')
      } else {
        await expect(page.locator('.game-house')).toContainText('The Sunday House')
      }
      await expect(page.locator('.scene-loading')).toHaveCount(0)
      if (module === 'KitchenWorld') await expect(page.locator('.world-canvas canvas')).toBeVisible()
    })
}

test('the pending kitchen tour obeys its own reduced-motion toggle without changing loading state', { tag: '@room' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1280, height: 800 })
  const pending = await pauseRequest(page, '**/{TourScene.tsx*,TourScene-*.js}')
  await page.goto('/welcome', { waitUntil: 'commit' })
  await page.locator('.welcome-stage').scrollIntoViewIfNeeded()
  const route = await pending.pending
  const status = page.locator('.welcome-scene-status[role="status"]')
  const loader = status.locator('img.roomlings-loader')
  await expectLoader(loader)
  const loadingText = await status.innerText()
  expect(loadingText.trim()).not.toBe('')
  const animatedSource = await imageSource(loader)
  const animated = await svgGeometry(page, await readSvg(page, animatedSource))
  const toggle = page.getByRole('button', { name: 'Reduced motion', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => imageSource(loader)).not.toBe(animatedSource)
  await expect(status).toHaveText(loadingText)
  const staticMarkup = await readSvg(page, await imageSource(loader))
  expect(await svgGeometry(page, staticMarkup)).toEqual(animated)
  await expectSvgMotion(page, staticMarkup, 'static')
  await route.continue()
  await expect(page.locator('.welcome-tour')).toHaveAttribute('data-scene', 'ready')
  await expect(page.locator('.welcome-canvas')).toHaveAttribute('data-rendering', 'paused')
  await expect(status.locator('img.roomlings-loader')).toHaveCount(0)
})

accountTest('an initial account check announces loading before exposing the sign-in form', async ({ page }) => {
  const pending = await pauseRequest(page, '**/api/account')
  await page.goto('/#account', { waitUntil: 'commit' })
  const route = await pending.pending
  const dialog = page.getByRole('dialog')
  const status = dialog.getByRole('status').filter({ has: page.locator('img.roomlings-loader') })
  await expect(status).toHaveClass(/\bloading-status\b/)
  await expect(status).toContainText(/account/i)
  await expectLoader(status.locator('img.roomlings-loader'))
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveCount(0)
  await route.fallback()
  await expect(status).toHaveCount(0)
  await expect(dialog.getByLabel('Email address', { exact: true })).toBeVisible()
  await page.unroute('**/api/account')
})

accountTest('account and primary-button loaders follow real requests, preserve retries and animate only their thresholds', async ({ page }) => {
  const initial = await pauseRequest(page, '**/api/account')
  await page.goto('/', { waitUntil: 'commit' })
  const initialRoute = await initial.pending
  const checking = page.getByRole('status').filter({ hasText: 'Checking saved access' })
  await expectLoader(checking.locator('img.roomlings-loader'))
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(checking).not.toContainText(/\d+\s*%/)
  const normalMarkup = await readSvg(page, await imageSource(checking.locator('img.roomlings-loader')))
  const faviconSource = await page.locator('link[rel~="icon"]').evaluate((element: HTMLLinkElement) => element.href)
  expect(await svgGeometry(page, normalMarkup)).toEqual(await svgGeometry(page, await readSvg(page, faviconSource)))
  await initialRoute.fulfill({ status: 503, json: { error: 'Account access is temporarily unavailable.' } })
  await expect(checking).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveText('Account access is temporarily unavailable.')
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  await page.unroute('**/api/account')
  const retry = await pauseRequest(page, '**/api/account')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  const retryRoute = await retry.pending
  await expectLoader(checking.locator('img.roomlings-loader'))
  await retryRoute.fallback()
  await expect(checking).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.unroute('**/api/account')

  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email address', { exact: true }).fill('branding@example.com')
  // A resolved request must not wait for a decorative animation cycle or a cosmetic timer.
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 60_000))
  const sending = await pauseRequest(page, '**/api/account/code')
  await dialog.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  const sendRoute = await sending.pending
  const busy = dialog.getByRole('button').filter({ has: page.locator('img.roomlings-loader') })
  await expect(busy).toBeDisabled()
  await expect(busy).not.toHaveAccessibleName(/Roomlings/i)
  await expectLoader(busy.locator('img.roomlings-loader'))
  const lightMarkup = await readSvg(page, await imageSource(busy.locator('img.roomlings-loader')))
  expect(await svgGeometry(page, lightMarkup)).toEqual(await svgGeometry(page, normalMarkup))
  expect(lightMarkup).not.toBe(normalMarkup)
  await sendRoute.fulfill({ status: 503, json: { error: 'Email delivery is temporarily unavailable.' } })
  await expect(dialog.getByRole('alert')).toHaveText('Email delivery is temporarily unavailable.')
  await expect(dialog.locator('img.roomlings-loader')).toHaveCount(0)
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveValue('branding@example.com')
  await expect(dialog.getByLabel('Email sign-in code', { exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Send sign-in code', exact: true })).toBeEnabled()
  await page.unroute('**/api/account/code')
  const resend = await pauseRequest(page, '**/api/account/code')
  await dialog.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  const resendRoute = await resend.pending
  await expectLoader(busy.locator('img.roomlings-loader'))
  await resendRoute.fallback()
  await expect(dialog.getByLabel('Email sign-in code', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.locator('img.roomlings-loader, .spin')).toHaveCount(0)
  await page.unroute('**/api/account/code')
  await expectSvgMotion(page, normalMarkup, 'normal')
  await expectSvgMotion(page, lightMarkup, 'light')
})

test('browser-access loading and refresh icons recover from failure without pretending a refresh succeeded', async ({ page, request }) => {
  await restoreKitchen(page, await createHousehold(request, 'The branding access home', 'Robin'))
  await page.goto('/')
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  const initial = await pauseRequest(page, '**/api/access')
  await page.getByRole('button', { name: 'Recovery and devices', exact: true }).click()
  const initialRoute = await initial.pending
  const dialog = page.getByRole('dialog', { name: 'Your browser access.', exact: true })
  const loading = dialog.getByRole('status').filter({ has: page.locator('img.roomlings-loader') })
  await expect(loading).toHaveClass(/\bloading-status\b/)
  await expect(loading).toContainText(/access/i)
  await expectLoader(loading.locator('img.roomlings-loader'))
  await initialRoute.continue()
  await expect(loading).toHaveCount(0)
  await expect(dialog.getByLabel('Name this browser', { exact: true })).toHaveValue('Saved browser')
  await page.unroute('**/api/access')

  const refresh = dialog.getByRole('button', { name: /^Refresh (?:browser )?access$/ })
  await expect(refresh.locator('svg')).toBeVisible()
  await expect(refresh.locator('img.roomlings-loader')).toHaveCount(0)
  const idleName = await refresh.getAttribute('aria-label')
  const pending = await pauseRequest(page, '**/api/access')
  await refresh.click()
  const refreshRoute = await pending.pending
  await expect(refresh).toBeDisabled()
  await expect(refresh).toHaveAccessibleName(idleName!)
  await expectLoader(refresh.locator('img.roomlings-loader'))
  await expect(refresh.locator('svg')).toHaveCount(0)
  await refreshRoute.fulfill({ status: 503, json: { error: 'Browser access is temporarily unavailable.' } })
  await expect(dialog.getByRole('alert')).toHaveText('Browser access is temporarily unavailable.')
  await expect(dialog.locator('img.roomlings-loader')).toHaveCount(0)
  await expect(refresh).toBeEnabled()
  await expect(refresh.locator('svg')).toBeVisible()
  await expect(dialog.getByLabel('Name this browser', { exact: true })).toHaveValue('Saved browser')
  await page.unroute('**/api/access')
  const refreshed = page.waitForResponse('**/api/access')
  await refresh.click()
  expect((await refreshed).ok()).toBe(true)
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(refresh.locator('img.roomlings-loader')).toHaveCount(0)
  await expect(refresh.locator('svg')).toBeVisible()
})

test('a pending grocery save uses the 2D loader and keeps the draft and retry on failure', async ({ page, request }) => {
  await restoreKitchen(page, await createHousehold(request, 'The branding grocery home', 'Robin'))
  await page.goto('/')
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
