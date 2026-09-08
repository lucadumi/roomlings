import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const root = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({
  options: { repository: { type: 'string', default: process.cwd() } },
})
const require = createRequire(join(resolve(values.repository), 'package.json'))
const { chromium } = require('@playwright/test')
const output = join(root, 'loader')
const frames = join(output, 'frames')
const fps = 30
const frameCount = 60

await mkdir(frames, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    reducedMotion: 'no-preference',
  })
  await page.goto(pathToFileURL(join(output, 'roomlings-loader.svg')).href)
  await page.locator('.threshold').evaluate(element => {
    const animation = element.getAnimations()[0]
    if (!animation) throw new Error('The 2D threshold animation is missing.')
    animation.pause()
    animation.currentTime = 0
  })
  for (let frame = 0; frame < frameCount; frame++) {
    await page.locator('.threshold').evaluate((element, time) => {
      element.getAnimations()[0].currentTime = time
      return getComputedStyle(element).transform
    }, frame * 1000 / fps)
    await page.screenshot({
      path: join(frames, `threshold-${String(frame + 1).padStart(4, '0')}.png`),
      omitBackground: true,
    })
  }
} finally {
  await browser.close()
}

await writeFile(join(output, 'motion.json'), JSON.stringify({
  name: 'Threshold pulse',
  treatment: '2D, flat colors, no perspective or shading',
  durationMs: 2000,
  fps,
  frameCount,
  movingPart: 'Tomato threshold only',
  viewBox: [0, 0, 128, 128],
  liftSvgUnits: 8,
  keyframesMs: [0, 1000, 2000],
  translateY: [0, -8, 0],
  easingPerHalf: [0.37, 0, 0.63, 1],
  reducedMotion: 'Static mark, threshold at rest',
  progress: 'Indeterminate',
}, null, 2) + '\n')
console.log('Rendered 60 frames directly from the 2D SVG and saved its motion specification.')
