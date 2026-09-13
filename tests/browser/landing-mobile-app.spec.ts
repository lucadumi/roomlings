import type { Page } from '@playwright/test'
import { devices } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import { waitForTourReady } from './fixtures.ts'
import { roomPath } from '../../src/roomNavigation.ts'

test.use({ reducedMotion: 'reduce' })

async function expectMobileAppLanding(page: Page, device: 'ios' | 'mobile' = 'ios') {
  await expect(page.locator('.welcome')).toHaveAttribute('data-mobile-app', 'true')
  await expect(page.locator('.welcome')).toHaveAttribute('data-device', device)
  const start = page.locator('.welcome-hero').getByRole('button', { name: 'Download', exact: true })
  await expect(start).toBeVisible()
  await expect(start).toBeDisabled()
  await expect(start).not.toHaveAttribute('href')
  await expect(start).toHaveAccessibleDescription(device === 'ios'
    ? 'For iPhone and iPad. Currently in development.'
    : 'For iPhone and iPad only. Not available on Android.')
  await expect(page.locator('.welcome-header-actions')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Mobile app', exact: true })).toHaveCount(0)
  await expect(page.locator('.welcome-navigation').getByRole('link')).toHaveText(['Your home', 'Explore rooms', 'Questions'])
  await expect(page.locator('.welcome-navigation')).toHaveCSS('border-top-width', '0px')
  await expect(page.locator('.welcome-header')).toHaveCSS('border-bottom-width', '2px')
  await expect(page.getByRole('link', { name: /^(Sign in|Get started|Create our household|Start sharing|Continue in browser)$/ })).toHaveCount(0)
  await expect(page.locator('.welcome a[href^="/"]')).toHaveCount(0)
  await expect(page.locator('.welcome a[href*="apps.apple.com"], .welcome a[href*="play.google.com"]')).toHaveCount(0)
  const letter = page.locator('#get-started')
  await expect(letter.getByRole('heading')).toHaveText('Make room for your people.')
  await expect(letter).toContainText('Create a household, invite your roommates and give everyone their own way back in.')
  await expect(letter.getByRole('link')).toHaveCount(0)
  await expect(letter.getByRole('button', { name: 'Start sharing', exact: true })).toBeDisabled()
  await expect(letter.getByRole('button')).not.toHaveAttribute('href')
  return start
}

async function expectWebLanding(page: Page) {
  await expect(page.locator('.welcome')).toHaveAttribute('data-mobile-app', 'false')
  await expect(page.locator('.welcome')).toHaveAttribute('data-device', 'desktop')
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', roomPath())
  await expect(page.locator('.welcome-header-actions').getByRole('link')).toHaveText(['Sign in'])
  await expect(page.locator('.welcome-header').getByRole('link', { name: 'Get started', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Get started', exact: true })).toHaveCount(1)
  await expect(page.locator('.welcome-hero').getByRole('link', { name: 'Get started', exact: true })).toHaveAttribute('href', `${roomPath()}#account=create`)
  await expect(page.locator('#get-started').getByRole('link', { name: 'Start sharing', exact: true })).toHaveAttribute('href', `${roomPath()}#account=create`)
  await expect(page.locator('.welcome-action-note')).toHaveText('Less chasing. More time together.')
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0)
  await expect(page.locator('.welcome a[href="/#recover"]')).toHaveCount(1)
}

for (const [name, width, height] of [
  ['small phone', 320, 568],
  ['phone', 390, 844],
  ['tablet', 768, 1024],
  ['iPad Air tablet', 820, 1180],
  ['large tablet', 1024, 1366],
] as const) {
  test.describe(name, () => {
    test.use({
      viewport: { width, height },
      userAgent: devices[width < 760 ? 'iPhone 13' : 'iPad Pro 11'].userAgent,
      isMobile: true,
      hasTouch: true,
    })

    test('the mobile app landing stays app-only in both orientations', async ({ page }, testInfo) => {
      const requests: string[] = []
      const errors: string[] = []
      let downloads = 0
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
      })
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('download', () => downloads++)
      await page.goto('/welcome')
      for (const viewport of [{ width, height }, { width: height, height: width }]) {
        await page.setViewportSize(viewport)
        const start = await expectMobileAppLanding(page)
        await page.evaluate(() => document.fonts.ready)
        await start.scrollIntoViewIfNeeded()
        const layout = await page.locator('.welcome-hero').evaluate((hero) => {
          const copy = hero.querySelector('.welcome-hero-copy')?.getBoundingClientRect()
          const art = hero.querySelector('.welcome-home-frame')?.getBoundingClientRect()
          const header = document.querySelector('.welcome-header')?.getBoundingClientRect()
          if (!copy || !art || !header) throw new Error('The landing layout is missing.')
          const style = getComputedStyle(hero)
          const paddingTop = parseFloat(style.paddingTop)
          return {
            minimum: parseFloat(style.minHeight),
            height: hero.getBoundingClientRect().height,
            contentHeight: Math.max(copy.height, art.height) + paddingTop + parseFloat(style.paddingBottom),
            sideBySide: copy.right <= art.left,
            leadingGap: Math.min(copy.top, art.top) - header.bottom,
            paddingTop,
            headerHeight: header.height,
          }
        })
        if (viewport.width >= 760 && viewport.height >= viewport.width) {
          expect(layout.minimum).toBe(0)
          expect(layout.sideBySide).toBe(true)
          expect(Math.abs(layout.height - layout.contentHeight)).toBeLessThanOrEqual(1)
          expect(Math.abs(layout.leadingGap - layout.paddingTop)).toBeLessThanOrEqual(1)
        } else {
          expect(Math.abs(layout.minimum - (viewport.height - layout.headerHeight))).toBeLessThanOrEqual(1)
        }
        await page.screenshot({ path: testInfo.outputPath(`app-landing-${viewport.width}.png`), animations: 'disabled' })
        const url = page.url()
        for (const button of [start, page.locator('#get-started').getByRole('button', { name: 'Start sharing', exact: true })]) {
          await button.scrollIntoViewIfNeeded()
          const bounds = await button.boundingBox()
          if (!bounds) throw new Error('The disabled landing button is missing.')
          await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
          await expect(page).toHaveURL(url)
          await expect(page.getByRole('dialog')).toHaveCount(0)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      }
      await page.getByText('When can I download the mobile app?', { exact: true }).click()
      await expect(page.locator('.welcome-faq details[open]')).toContainText('not available to download yet')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
      expect(requests).toEqual([])
      expect(errors).toEqual([])
      expect(downloads).toBe(0)
    })
  })
}

test('desktop browsers keep web entry at phone, tablet and desktop viewport sizes', async ({ page }) => {
  await page.goto('/')
  for (const width of [3840, 2560, 1920, 1440, 1366, 1051, 1050, 1025, 1024, 801, 800, 760, 759, 561, 560, 390, 320, 1366]) {
    await page.setViewportSize({ width, height: 960 })
    await expectWebLanding(page)
    await expect(page.locator('.welcome-navigation')).toHaveCSS('border-top-width', width <= 1050 ? '1px' : '0px')
    await expect(page.locator('.welcome-hero')).not.toHaveCSS('min-height', '0px')
  }
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

for (const maxTouchPoints of [0, 5]) {
  test.describe(maxTouchPoints ? 'iPadOS desktop mode' : 'Desktop Mac', () => {
    test.use({ userAgent: devices['Desktop Safari'].userAgent, isMobile: false, hasTouch: false })

    test('the mobile app landing follows device identity with a fine pointer in both orientations', async ({ page }, testInfo) => {
      await page.addInitScript((touchPoints) => {
        Object.defineProperties(navigator, {
          platform: { get: () => 'MacIntel' },
          maxTouchPoints: { get: () => touchPoints },
        })
      }, maxTouchPoints)
      await page.goto('/welcome')
      expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches && matchMedia('(hover: hover)').matches)).toBe(true)
      for (const viewport of [{ width: 1366, height: 1024 }, { width: 1024, height: 1366 }, { width: 1366, height: 1024 }]) {
        await page.setViewportSize(viewport)
        if (maxTouchPoints) {
          await expectMobileAppLanding(page)
          const hero = page.locator('.welcome-hero')
          if (viewport.height > viewport.width) await expect(hero).toHaveCSS('min-height', '0px')
          else await expect(hero).not.toHaveCSS('min-height', '0px')
          await page.evaluate(() => document.fonts.ready)
          await page.locator('.welcome-header').scrollIntoViewIfNeeded()
          await page.screenshot({ path: testInfo.outputPath(`ipad-desktop-mode-${viewport.width}.png`), animations: 'disabled' })
        } else {
          await expectWebLanding(page)
          await expect(page.locator('.welcome-hero')).not.toHaveCSS('min-height', '0px')
        }
      }
      await page.reload()
      if (maxTouchPoints) await expectMobileAppLanding(page)
      else await expectWebLanding(page)
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
    })
  })
}

test.describe('Android', () => {
  test.use({ userAgent: devices['Pixel 7'].userAgent, isMobile: true, hasTouch: true })

  test('Android phones and tablets get the iOS-only notice instead of browser access', async ({ page }) => {
    await page.goto('/')
    for (const viewport of [{ width: 412, height: 839 }, { width: 839, height: 412 }, { width: 800, height: 1280 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport)
      await expectMobileAppLanding(page, 'mobile')
    }
    await page.getByText('When can I download the mobile app?', { exact: true }).click()
    await expect(page.locator('.welcome-faq details[open]')).toContainText('There is no Android app')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  })

  test('Android cannot open a household through a direct room link', async ({ page, populatedHousehold }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
    })
    await page.goto(`${roomPath()}#join=${encodeURIComponent(populatedHousehold.household.inviteCode)}`)
    await expectMobileAppLanding(page, 'mobile')
    await expect(page.locator('.game-house')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(requests).toEqual([])
  })
})

test.describe('iPhone entry', () => {
  test.use({
    userAgent: devices['iPhone 13'].userAgent,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })

  test('the mobile app landing replaces the browser household and keeps saved access stored', async ({ page, populatedHousehold }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
    })
    await page.goto('/')
    await page.evaluate((token) => localStorage.setItem('roomlings.session', token), populatedHousehold.token)
    await page.goto(roomPath())
    await expectMobileAppLanding(page)
    await expect(page.locator('.game-house')).toHaveCount(0)
    await page.goto('/')
    await expectMobileAppLanding(page)
    expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).toBe(populatedHousehold.token)
    expect(requests).toEqual([])
  })

  test('direct account entry links stay on the mobile app landing', async ({ page }) => {
    for (const url of [roomPath(), `${roomPath()}#account=create`, '/#recover', '/kitchen', '/rooms/bathroom']) {
      await page.goto(url)
      await expectMobileAppLanding(page)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByLabel('Email address', { exact: true })).toHaveCount(0)
    }
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  })

  test('the mobile app landing keeps public room exploration working', { tag: '@room' }, async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
    })
    await page.goto('/')
    await expectMobileAppLanding(page)
    await page.locator('.welcome-hero').getByRole('link', { name: 'Explore rooms', exact: true }).click()
    await expect(page).toHaveURL(/\/#tour$/)
    await waitForTourReady(page)
    await page.getByRole('button', { name: 'Monthly budget', exact: true }).click()
    await expect(page.locator('.welcome-tour')).toHaveAttribute('data-chapter', 'house-pot')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
    expect(requests).toEqual([])
  })
})
