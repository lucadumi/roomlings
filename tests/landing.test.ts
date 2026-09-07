import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { scrollProgress, tourArea, tourChapters, tourFrame } from '../src/landing/tour.ts'

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
    assert.deepEqual(views[4].bounds, views[0].bounds)
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

  it('fits every object volume inside its scene area at narrow, wide and short aspect ratios', () => {
    for (const [width, height] of [[760, 740], [340, 350], [280, 120], [250, 600], [950, 180]]) {
      for (const progress of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.9, 1]) {
        const frame = tourFrame(progress, width, height)
        const camera = new PerspectiveCamera(frame.fov, width / height, 0.1, Math.max(150, Math.hypot(...frame.position) + 30))
        camera.position.set(...frame.position)
        camera.lookAt(...frame.target)
        camera.updateMatrixWorld()
        for (const x of [frame.bounds[0][0], frame.bounds[1][0]]) for (const y of [frame.bounds[0][1], frame.bounds[1][1]]) for (const z of [frame.bounds[0][2], frame.bounds[1][2]]) {
          const point = new Vector3(x, y, z).project(camera)
          assert.ok(Math.abs(point.x) <= 0.901, `Horizontal fit at ${width}x${height}, ${progress}`)
          assert.ok(Math.abs(point.y) <= 0.901, `Vertical fit at ${width}x${height}, ${progress}`)
          assert.ok(point.z > -1 && point.z < 1)
        }
      }
    }
  })
  it('uses measured CSS areas and leaves room for header and footer controls', () => {
    const layout = { width: 1200, height: 800, start: { x: 520, y: 100, width: 620, height: 650 }, end: { x: 60, y: 100, width: 620, height: 650 }, top: 88, bottom: 720 }
    assert.deepEqual(tourArea(0, layout), { x: 520, y: 100, width: 620, height: 620 })
    assert.deepEqual(tourArea(1, layout), { x: 60, y: 100, width: 620, height: 620 })
    assert.deepEqual(tourArea(1, layout, true), tourArea(0, layout))
    assert.equal(tourArea(0.875, layout).x, 290)
    assert.equal(tourArea(0, { ...layout, start: { ...layout.start, y: 800 } }).height, 0)
    assert.throws(() => tourArea(NaN, layout), /valid measured layout/)
  })
})
