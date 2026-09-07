import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const template = readFileSync(new URL('../../emails/auth-code.html', import.meta.url), 'utf8')

for (const width of [320, 600]) {
  test(`Roomlings code email is readable at ${width}px without links or network requests`, async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await page.setViewportSize({ width, height: 850 })
    for (const code of ['123456', '12345678', '1234567890']) {
      await page.setContent(template.replace('{{ .Token }}', code))
      await expect(page.getByRole('heading', { name: 'Your sign-in code.', exact: true })).toBeVisible()
      await expect(page.locator('#roomlings-code')).toHaveText(code)
      await expect(page.getByRole('link')).toHaveCount(0)
      const sizes = await page.evaluate(() => {
        const code = document.querySelector('#roomlings-code')
        if (!(code instanceof HTMLElement)) throw new Error('The sign-in code is missing.')
        return {
          pageWidth: document.documentElement.clientWidth,
          contentWidth: document.documentElement.scrollWidth,
          codeWidth: code.clientWidth,
          codeContentWidth: code.scrollWidth,
        }
      })
      expect(sizes.contentWidth).toBeLessThanOrEqual(sizes.pageWidth)
      expect(sizes.codeContentWidth).toBeLessThanOrEqual(sizes.codeWidth)
    }
    expect(requests).toEqual([])
  })
}
