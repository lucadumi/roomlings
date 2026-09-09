import { expect, test } from './account-fixtures.ts'

test.use({ reducedMotion: 'reduce' })

test('the footer navigates the public page without reading or changing household access', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
  })
  await page.clock.setFixedTime(new Date('2031-06-15T12:00:00Z'))
  for (const path of ['/', '/welcome']) {
    await page.goto(path)
    const footer = page.getByRole('contentinfo')
    await expect(footer.getByRole('navigation', { name: 'Footer', exact: true })).toBeVisible()
    await expect(footer.getByRole('link')).toHaveCount(4)
    await expect(footer.getByRole('heading')).toHaveCount(0)
    await expect(footer.getByText('\u00a9 2031 Roomlings', { exact: true })).toBeVisible()
    const planned = footer.getByRole('group', { name: 'Planned pages', exact: true })
    await expect(planned.getByText('Coming soon:', { exact: true })).toBeVisible()
    for (const name of ['About', 'Privacy', 'Terms', 'Contact']) {
      await expect(planned.getByText(name, { exact: true })).toBeVisible()
    }
    await expect(planned.locator('a, button, [tabindex]')).toHaveCount(0)
    await page.evaluate(() => document.fonts.ready)
    for (const [label, hash, heading] of [
      ['Your home', '#how-it-works', 'Your home, shared.'],
      ['Explore rooms', '#tour', 'Explore the rooms'],
      ['Questions', '#questions', 'Questions'],
    ]) {
      const link = footer.getByRole('link', { name: label, exact: true })
      await expect(link).toHaveAttribute('href', hash)
      await link.click()
      await expect(page).toHaveURL(new RegExp(`${path}${hash}$`))
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeInViewport()
    }
    await footer.getByRole('link', { name: 'Roomlings, back to the beginning', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
  }
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`footer links follow keyboard order with ${reducedMotion}`, { tag: '@room' }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto('/#welcome-footer')
    const footer = page.getByRole('contentinfo')
    await page.evaluate(() => document.fonts.ready)
    // A fractional document edge can prevent a 100% footer intersection.
    await expect.poll(() => page.evaluate(() => Math.abs(document.documentElement.scrollHeight - innerHeight - scrollY))).toBeLessThanOrEqual(1)
    await footer.getByRole('link', { name: 'Roomlings, back to the beginning', exact: true }).focus()
    for (const name of ['Your home', 'Explore rooms', 'Questions']) {
      await page.keyboard.press('Tab')
      const link = footer.getByRole('link', { name, exact: true })
      await expect(link).toBeFocused()
      await expect(link).toHaveCSS('outline-style', 'solid')
      await expect(link).toBeInViewport({ ratio: 1 })
    }
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(footer.getByRole('link', { name: 'Roomlings, back to the beginning', exact: true })).toBeFocused()
    await expect(page.locator('html')).toHaveCSS('scroll-behavior', reducedMotion === 'reduce' ? 'auto' : 'smooth')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport()
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused()
  })
}

test('the compact footer keeps the paper background and fits narrow screens without clipping', { tag: '@room' }, async ({ page }) => {
  await page.goto('/#welcome-footer')
  const footer = page.getByRole('contentinfo')
  await expect(footer).toBeVisible()
  await expect(footer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(footer).toHaveCSS('background-image', 'none')
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: 'html { scrollbar-gutter: stable; }' })
  for (const [width, height] of [[1440, 960], [768, 1024], [759, 600], [390, 844], [320, 360], [844, 390]]) {
    await page.setViewportSize({ width, height })
    const layout = await footer.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const header = document.querySelector('.welcome-header')!.getBoundingClientRect()
      const brand = element.querySelector('.brand')!.getBoundingClientRect()
      const navigation = element.querySelector('nav')!.getBoundingClientRect()
      const copyright = element.querySelector('p')!.getBoundingClientRect()
      return {
        left: bounds.left, right: bounds.right, height: bounds.height,
        header: { left: header.left, right: header.right },
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        brand: { bottom: brand.bottom, right: brand.right },
        navigation: { top: navigation.top, left: navigation.left, right: navigation.right },
        copyright: { left: copyright.left, bottom: copyright.bottom },
        clipped: [...element.querySelectorAll('a, p, .welcome-footer-planned > span')].filter((item) => {
          const box = item.getBoundingClientRect()
          return box.left < 0 || box.right > document.documentElement.clientWidth || item.scrollWidth > item.clientWidth + 1
        }).map((item) => item.textContent?.trim()),
      }
    })
    expect(layout.left).toBe(layout.header.left)
    expect(layout.right).toBe(layout.header.right)
    expect(layout.height).toBeLessThanOrEqual(width < 760 ? 200 : 130)
    expect(layout.overflow, `${width}x${height}`).toBe(false)
    expect(layout.clipped, `${width}x${height}`).toEqual([])
    if (width < 760) {
      expect(layout.navigation.top).toBeGreaterThan(Math.max(layout.brand.bottom, layout.copyright.bottom))
    } else {
      expect(layout.navigation.left).toBeGreaterThan(layout.brand.right)
      expect(layout.copyright.left).toBeGreaterThan(layout.navigation.right)
    }
  }
  await page.setViewportSize({ width: 320, height: 568 })
  await page.addStyleTag({ content: '.welcome-footer p, .welcome-footer .welcome-text-link, .welcome-footer-planned { font-size: 24px; }' })
  expect(await footer.evaluate((element) => ({
    page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    text: [...element.querySelectorAll('a, p, .welcome-footer-planned > span')].some((item) => item.scrollWidth > item.clientWidth + 1),
  }))).toEqual({ page: false, text: false })
})
