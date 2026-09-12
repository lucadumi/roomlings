import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { brandDimensions } from '../src/assets/brand/dimensions.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('runtime Patchwork icons and favicon use the editable 2D sources', () => {
  const flat = read('design/roomlings-logo/source/icon-flat.svg')
  const mono = read('design/roomlings-logo/source/icon-mono.svg')
  assert.equal(read('src/assets/brand/roomlings-icon-flat.svg'), flat)
  assert.equal(read('public/favicon.svg'), flat)
  assert.equal(read('src/assets/brand/roomlings-icon-light.svg'), mono.replaceAll('#3d405b', '#fcf9f1'))
  assert.match(flat, /viewBox="0 0 256 256"/)
  assert.match(flat, /M65 42Q45 42 42 65L35 189Q34 209 56 212/)
  assert.deepEqual(brandDimensions.icon, { width: 256, height: 256 })
})

test('the Baloo 2 wordmark has real glyph outlines and matching intrinsic dimensions', () => {
  const metadata = JSON.parse(read('design/roomlings-logo/geometry.json'))
  assert.deepEqual(metadata.font, { family: 'Baloo 2', weight: 650, trackingEm: -0.025 })
  assert.equal(metadata.letters.map((letter: { character: string }) => letter.character).join(''), 'roomlings')
  assert.equal(metadata.loader, 'static')
  const wordmark = read('src/assets/brand/roomlings-wordmark.svg')
  const viewBox = wordmark.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  assert.ok(viewBox)
  assert.deepEqual(brandDimensions.wordmark, { width: Number(viewBox[1]), height: Number(viewBox[2]) })
  assert.equal((wordmark.match(/<path\b/g) ?? []).length, 9)
  assert.doesNotMatch(wordmark, /<(?:text|image|foreignObject|canvas)\b/)
})

test('branding has no remaining 3D assets or animated loader path', () => {
  for (const path of [
    'src/assets/brand/roomlings-icon-3d.png',
    'src/assets/brand/roomlings-loader.svg',
    'src/assets/brand/roomlings-loader-light.svg',
    'design/roomlings-logo/roomlings-logo.blend',
    'design/roomlings-logo/build_logo.py',
    'design/roomlings-logo/build_loader.mjs',
  ]) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, `${path} should be retired`)
  assert.doesNotMatch(read('src/Branding.tsx'), /icon3d|<picture|roomlings-loader(?:-light)?\.svg/)
  for (const path of ['src/assets/brand/roomlings-icon-flat.svg', 'src/assets/brand/roomlings-icon-light.svg', 'src/branding.css']) {
    assert.doesNotMatch(read(path), /@keyframes|animation\s*:|<animate|<filter/)
  }
})
