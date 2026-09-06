import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { scrollProgress, tourChapters, tourFrame } from '../src/landing/tour.ts'

describe('the Step inside scroll story', () => {
  it('follows actual chapter positions, including unequal heights and restored scrolling', () => {
    const stops = [0, 900, 1800, 2800, 3700]
    assert.equal(scrollProgress(-30, stops), 0)
    assert.equal(scrollProgress(0, stops), 0)
    assert.equal(scrollProgress(450, stops), 0.125)
    assert.equal(scrollProgress(2300, stops), 0.625)
    assert.equal(scrollProgress(3700, stops), 1)
    assert.equal(scrollProgress(9000, stops), 1)
    assert.equal(scrollProgress(100, [100, 900]), 0)
  })

  it('rejects invalid measurements rather than producing invalid camera transforms', () => {
    for (const stops of [[], [0], [0, 0], [100, 20], [0, NaN], [0, Infinity]]) {
      assert.throws(() => scrollProgress(10, stops), /increasing chapter positions/)
    }
    assert.throws(() => scrollProgress(NaN, [0, 100]), /increasing chapter positions/)
    for (const [progress, width, height] of [[NaN, 100, 100], [0, 0, 100], [0, 100, -1], [0, Infinity, 100]]) {
      assert.throws(() => tourFrame(progress, width, height), /positive viewport/)
    }
  })

  it('visits distinct kitchen objects and returns to the complete room', () => {
    const views = tourChapters.map((_, index) => tourFrame(index / 4, 1440, 960))
    assert.deepEqual(views[1].target, [-2.5, 1.9, -1.8])
    assert.deepEqual(views[2].target, [1, 1.62, 1.45])
    assert.deepEqual(views[3].target, [0.1, 2.1, -2.3])
    assert.ok(new Vector3(...views[4].target).distanceTo(new Vector3(...views[0].target)) < 0.000001)
    assert.ok(views[1].door > views[0].door)
    assert.ok(views[2].paper > views[1].paper)
    assert.ok(views[3].coins > views[2].coins)
    assert.ok(views[4].evening > views[0].evening)
    assert.ok(views[4].screen[0] < 0.5)
  })

  it('keeps the entire reduced-motion scene stationary at every scroll position', () => {
    for (const [width, height] of [[1440, 960], [768, 1024], [1024, 1366], [390, 844]]) {
      const start = tourFrame(0, width, height, true)
      for (const progress of [0.1, 0.25, 0.5, 0.75, 0.91, 1]) {
        assert.deepEqual(tourFrame(progress, width, height, true), start)
      }
    }
  })

  it('has continuous, reversible choreography throughout the native scroll range', () => {
    for (const [width, height] of [[1440, 960], [768, 1024], [390, 844], [320, 568]]) {
      let previous = tourFrame(0, width, height)
      for (let step = 1; step <= 1000; step++) {
        const next = tourFrame(step / 1000, width, height)
        assert.ok([...next.position, ...next.target, next.fov, ...next.screen].every(Number.isFinite))
        assert.ok(new Vector3(...next.position).distanceTo(new Vector3(...previous.position)) < 0.6)
        assert.ok(next.door >= 0 && next.door <= 1)
        assert.ok(next.coins >= 0 && next.coins <= 1)
        assert.deepEqual(tourFrame(step / 1000, width, height), next)
        previous = next
      }
    }
    assert.deepEqual(tourFrame(-1, 1440, 960), tourFrame(0, 1440, 960))
    assert.deepEqual(tourFrame(2, 1440, 960), tourFrame(1, 1440, 960))
  })

  it('places the focus beside desktop copy and below phone copy without distorting the perspective', () => {
    for (const [width, height] of [[1440, 960], [768, 1024], [1024, 1366], [390, 844]]) {
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const frame = tourFrame(progress, width, height)
        const camera = new PerspectiveCamera(frame.fov, width / height, 0.1, 150)
        camera.position.set(...frame.position)
        camera.lookAt(...frame.target)
        camera.setViewOffset(width, height, (0.5 - frame.screen[0]) * width, (0.5 - frame.screen[1]) * height, width, height)
        camera.updateMatrixWorld()
        const projected = new Vector3(...frame.target).project(camera)
        assert.ok(Math.abs(projected.x * 0.5 + 0.5 - frame.screen[0]) < 0.00001)
        assert.ok(Math.abs(-projected.y * 0.5 + 0.5 - frame.screen[1]) < 0.00001)
        if (width < 1000 || width / height <= 1.15) {
          assert.equal(frame.screen[0], 0.5)
          assert.ok(frame.screen[1] >= 0.65)
        }
      }
    }
  })
})
