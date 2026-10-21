import { expect, test } from './account-fixtures.ts'
import { contactEmail } from '../../src/landing/legal.ts'

test.use({ reducedMotion: 'reduce' })

test('privacy, terms and contact open from the footer without reading household access', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url())
  })
  await page.goto('/')
  for (const [name, path] of [['Privacy', '/privacy'], ['Terms', '/terms'], ['Contact', '/contact']]) {
    await page.getByRole('contentinfo').getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
    await expect(page).toHaveTitle(`${name} · Roomlings`)
    await expect(page.getByRole('contentinfo').getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: 'Back to home', exact: true })).toHaveAttribute('href', '/')
  }
  await page.getByRole('link', { name: 'Back to home', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Share a home.')
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('the legal pages name the operator, contact address, age and authority', async ({ page }) => {
  await page.goto('/privacy')
  const privacy = page.getByRole('main')
  await expect(privacy).toContainText('Luca Dumitrescu in the Netherlands')
  await expect(privacy).toContainText('Last updated 17 October 2026')
  await expect(privacy.getByRole('link', { name: 'Autoriteit Persoonsgegevens', exact: true })).toHaveAttribute('href', /^https:\/\/autoriteitpersoonsgegevens\.nl\//)
  await expect(privacy.getByRole('link', { name: contactEmail }).first()).toHaveAttribute('href', `mailto:${contactEmail}`)
  await page.goto('/terms')
  await expect(page.getByRole('main')).toContainText('You must be 16 or older.')
  await expect(page.getByRole('main')).toContainText('Dutch law applies.')
  await page.goto('/contact/')
  await expect(page.getByRole('main').getByRole('link', { name: contactEmail })).toHaveAttribute('href', `mailto:${contactEmail}`)
  await expect(page.getByText('Last updated')).toHaveCount(0)
})

test('the side index follows the reader and links to each section', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/privacy')
  const index = page.getByRole('navigation', { name: 'On this page', exact: true })
  await expect(index.getByRole('link')).toHaveText([
    'What we keep', "What we don't do", 'Why we use it', 'Who helps us', 'How long we keep it',
    'Your browser', 'Your rights', 'Age', 'Changes',
  ])
  await expect(index.getByRole('link', { name: 'What we keep', exact: true })).toHaveAttribute('aria-current', 'location')
  await index.getByRole('link', { name: 'Your rights', exact: true }).click()
  await expect(page).toHaveURL(/\/privacy#your-rights$/)
  await expect(page.getByRole('heading', { name: 'Your rights', exact: true })).toBeInViewport()
  await expect(index.getByRole('link', { name: 'Your rights', exact: true })).toHaveAttribute('aria-current', 'location')
  await expect(index).toBeInViewport()
  await page.goto('/terms#law')
  await expect(page.getByRole('heading', { name: 'Law', exact: true })).toBeInViewport()
  await expect(page.getByRole('navigation', { name: 'On this page', exact: true }).getByRole('link', { name: 'Law', exact: true }))
    .toHaveAttribute('aria-current', 'location')
})

test('the index stays in view at every width', async ({ page }) => {
  for (const [width, height] of [[1440, 900], [800, 900], [700, 800], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/terms')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms')
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    const index = page.getByRole('navigation', { name: 'On this page', exact: true })
    await expect(index, `${width}x${height}`).toBeInViewport()
    const marked = index.getByRole('link', { name: 'Changes', exact: true })
    await expect(marked).toHaveAttribute('aria-current', 'location')
    await expect(marked, `${width}x${height}`).toBeInViewport()
    // On phones the strip scrolls sideways; the marked link must sit fully inside it.
    if (width <= 640) expect(await marked.evaluate((link) => {
      const box = link.getBoundingClientRect()
      const frame = link.closest('ol')!.getBoundingClientRect()
      return box.left >= frame.left - 1 && box.right <= frame.right + 1
    }), `${width}x${height}`).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${width}x${height}`).toBe(false)
  }
})

test('legal pages fit narrow screens and keep keyboard entry to the content', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy')
  for (const [width, height] of [[1440, 960], [768, 1024], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${width}x${height}`).toBe(false)
    const edges = await page.evaluate(() => [
      document.querySelector('.welcome-header')!.getBoundingClientRect().left,
      document.querySelector('#legal-content')!.getBoundingClientRect().left,
    ])
    expect(edges[1], `${width}x${height}`).toBe(edges[0])
    expect(edges[1], `${width}x${height}`).toBeGreaterThanOrEqual(16)
  }
  await page.getByRole('link', { name: 'Skip to content', exact: true }).focus()
  await expect(page.locator('.welcome-skip')).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.locator('#legal-content')).toBeFocused()
})
