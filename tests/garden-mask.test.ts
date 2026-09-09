import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gardenContentMask } from '../src/landing/gardenMask.ts'

test('the garden mask protects measured copy with a solid center and soft outer edge', () => {
  const mask = gardenContentMask(1440, 3000, [{ x: 130, y: 240, width: 500, height: 350 }])
  assert.ok(mask.includes('viewBox="0 0 1440 3000"'))
  assert.ok(mask.includes('feGaussianBlur stdDeviation="8"'))
  assert.ok(mask.includes('x="114" y="224" width="532" height="382"'))
  assert.ok(mask.includes('x="126" y="236" width="508" height="358"'))
  assert.ok(mask.includes('mask="url(#clear)"'))
})

test('the garden mask rejects invalid page and content measurements', () => {
  assert.throws(() => gardenContentMask(0, 1000, []))
  assert.throws(() => gardenContentMask(1440, Infinity, []))
  assert.throws(() => gardenContentMask(1440, 1000, [{ x: NaN, y: 0, width: 10, height: 10 }]))
  assert.throws(() => gardenContentMask(1440, 1000, [{ x: 0, y: 0, width: -1, height: 10 }]))
})
