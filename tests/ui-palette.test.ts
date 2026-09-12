import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const colorValues = (source: string) => [...source.matchAll(/#([0-9a-f]{6})(?:[0-9a-f]{2})?\b/gi)]
  .map((match) => match[1].toLowerCase())

test('global UI tokens keep the original warm Roomlings theme', () => {
  const style = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
  for (const expected of [
    '--palette-ink: #3d405b;',
    '--palette-sage: #81b29a;',
    '--palette-honey: #f2cc8f;',
    '--palette-clay: #e07a5f;',
    '--palette-red: #b8533b;',
    '--paper-texture: radial-gradient(#3d405b18 1.5px, transparent 1.8px);',
    '--action-fill: var(--palette-red);',
  ]) assert.match(style, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(style, /--palette-(?:orange|teal|yellow|charcoal|green):/)
  assert.doesNotMatch(style, /--scene-paper-texture:/)

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="theme-color" content="#f8f6f0" \/>/)
})

test('Patchwork branding retains the selected colors and static light treatment', () => {
  const colors = colorValues(readFileSync(new URL('../src/assets/brand/roomlings-icon-flat.svg', import.meta.url), 'utf8'))
  assert.deepEqual(new Set(colors), new Set(['527861', 'e07a5f', 'f2cc8f', '81b29a']))
  const light = colorValues(readFileSync(new URL('../src/assets/brand/roomlings-icon-light.svg', import.meta.url), 'utf8'))
  assert.deepEqual(new Set(light), new Set(['fcf9f1']))
  const wordmark = colorValues(readFileSync(new URL('../src/assets/brand/roomlings-wordmark.svg', import.meta.url), 'utf8'))
  assert.deepEqual(new Set(wordmark), new Set(['3d405b']))

  const favicon = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
  const flat = readFileSync(new URL('../src/assets/brand/roomlings-icon-flat.svg', import.meta.url), 'utf8')
  assert.equal(favicon, flat)
})

test('avatars continue to render persisted member colors without data mutation', () => {
  const components = readFileSync(new URL('../src/components.tsx', import.meta.url), 'utf8')
  assert.match(components, /style=\{\{ backgroundColor: member\.color \}\}/)
  assert.doesNotMatch(components, /data-tone=/)
})
