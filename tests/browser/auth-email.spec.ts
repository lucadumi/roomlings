import { readFileSync } from 'node:fs'
import { expect, test } from './account-fixtures.ts'

const template = readFileSync(new URL('../../emails/auth-code.html', import.meta.url), 'utf8')
const markUrl = template.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1] ?? ''
const requestedMark = new URL(markUrl).href
const markFile = new URL('../../design/roomlings-logo/exports/roomlings-icon-flat-256.png', import.meta.url)

async function measure(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const code = document.querySelector('#roomlings-code')
    if (!(code instanceof HTMLElement)) throw new Error('The sign-in code is missing.')
    return {
      pageWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      codeWidth: code.clientWidth,
      codeContentWidth: code.scrollWidth,
    }
  })
}

for (const width of [320, 600]) {
  test(`Roomlings code email is readable at ${width}px without links or extra network requests`, async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await page.route(markUrl, (route) => route.fulfill({ contentType: 'image/png', body: readFileSync(markFile) }))
    await page.setViewportSize({ width, height: 850 })
    for (const code of ['123456', '12345678', '1234567890']) {
      await page.setContent(template.replace('{{ .Token }}', code))
      await expect(page.getByRole('heading', { name: 'Your sign-in code.', exact: true })).toBeVisible()
      await expect(page.locator('#roomlings-code')).toHaveText(code)
      await expect(page.getByRole('link')).toHaveCount(0)
      const sizes = await measure(page)
      expect(sizes.contentWidth).toBeLessThanOrEqual(sizes.pageWidth)
      expect(sizes.codeContentWidth).toBeLessThanOrEqual(sizes.codeWidth)
    }
    const mark = page.locator('#roomlings-mark')
    await expect(mark).toBeVisible()
    expect(await mark.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    expect([...new Set(requests)]).toEqual([requestedMark])
  })
}

test('Roomlings code email still reads as Roomlings when the mark is blocked', async ({ page }) => {
  await page.route(markUrl, (route) => route.abort())
  await page.setViewportSize({ width: 320, height: 850 })
  await page.setContent(template.replace('{{ .Token }}', '1234567890'))
  await expect(page.getByRole('heading', { name: 'Your sign-in code.', exact: true })).toBeVisible()
  await expect(page.locator('#roomlings-wordmark')).toHaveText('roomlings.')
  await expect(page.locator('#roomlings-code')).toHaveText('1234567890')
  const sizes = await measure(page)
  expect(sizes.contentWidth).toBeLessThanOrEqual(sizes.pageWidth)
  expect(sizes.codeContentWidth).toBeLessThanOrEqual(sizes.codeWidth)
})
