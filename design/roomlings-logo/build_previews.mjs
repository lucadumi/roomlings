import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const root = dirname(fileURLToPath(import.meta.url))
const repository = join(root, '../..')
const exports = join(root, 'exports')
const renders = join(root, 'renders')
await mkdir(renders, { recursive: true })
const font = await readFile(join(root, 'fonts/Roomlings-DM-Sans.ttf'))
await writeFile(join(exports, 'preview-font.css'), `@font-face{font-family:"Roomlings DM Sans";font-style:normal;font-weight:500;src:url(data:font/ttf;base64,${font.toString('base64')}) format("truetype")}\n`)

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    const svg = await readFile(join(exports, 'roomlings-icon-flat.svg'), 'utf8')
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
    await page.screenshot({ path: join(exports, `roomlings-icon-flat-${size}.png`), omitBackground: true })
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto(pathToFileURL(join(root, 'preview.html')).href)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0)
  await page.locator('#identity-board').screenshot({ path: join(renders, 'roomlings-logo-board.png') })
  await copyFile(join(renders, 'roomlings-logo-board.png'), join(repository, 'docs/images/roomlings-identity.png'))
  await page.setViewportSize({ width: 390, height: 844 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
} finally {
  await browser.close()
}
console.log('Rendered the 2D identity board and static small-size exports.')
