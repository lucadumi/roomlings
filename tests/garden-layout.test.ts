import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gardenLayout } from '../src/landing/gardenLayout.ts'

test('garden anchors follow measured gutters while larger plants remain fully inside the viewport', () => {
  for (const [width, height, edge] of [[1920, 1080, 370], [1440, 960, 130], [1280, 800, 57.6], [768, 1024, 24], [390, 844, 24], [320, 568, 16], [844, 390, 38]] as const) {
    const layout = gardenLayout(width, height, edge, width - edge)
    assert.ok(layout.left.x + layout.left.width <= edge - 12)
    assert.ok(layout.right.x >= width - edge + 12)
    assert.equal(layout.right.x + layout.right.width, width)
    for (const rail of [layout.left, layout.right]) {
      assert.ok(rail.width >= 0)
      assert.ok(Object.values(rail.frame).every(Number.isFinite))
      assert.ok(rail.frame.width > 0 && rail.frame.height > 0)
      assert.ok(Math.abs(rail.frame.height / rail.frame.width - 5 / 3) < 1e-10)
      if (rail.visible) {
        assert.ok(rail.frame.x >= 12)
        assert.ok(rail.frame.x + rail.frame.width <= width - 12)
        assert.ok(rail.frame.width > rail.width)
        assert.ok(rail.frame.y >= 0)
        assert.ok(rail.frame.y + rail.frame.height <= height)
      }
    }
    assert.equal(layout.animate, edge - 12 >= 36)
  }
})

test('garden layout follows asymmetric measured gutters and uses still artwork when space is tight', () => {
  const layout = gardenLayout(1400, 800, 120, 1340)
  assert.equal(layout.left.width, 108)
  assert.equal(layout.right.width, 48)
  assert.ok(layout.left.frame.width >= layout.right.frame.width)
  assert.equal(gardenLayout(390, 844, 24, 366).animate, false)
  const fullWidth = gardenLayout(390, 844, 0, 390)
  assert.equal(fullWidth.left.width, 0)
  assert.equal(fullWidth.right.width, 0)
})

test('invalid garden measurements are rejected instead of producing broken camera frames', () => {
  for (const values of [[0, 800, 0, 0], [1440, -1, 0, 1440], [NaN, 800, 0, 0], [1440, 800, Infinity, 1440], [1440, 800, 200, 100]]) {
    assert.throws(() => gardenLayout(values[0], values[1], values[2], values[3]), /garden needs/)
  }
})
