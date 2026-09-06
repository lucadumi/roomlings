import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cameraFraming, cameraProjection } from '../src/camera.ts'
import type { SceneFocus } from '../src/camera.ts'
import { OrthographicCamera, Vector3 } from 'three'

describe('room-first camera framing', () => {
  it('starts phones more than twice as close as the whole-room overview', () => {
    const close = cameraFraming(390, 636, 'room', false)
    const whole = cameraFraming(390, 636, 'room', true)
    assert.ok(whole.halfHeight / close.halfHeight > 2)
    assert.deepEqual(close.center, [-0.7, 1.6, -0.9])
  })
  it('keeps a whole-room framing available at every supported size', () => {
    for (const [width, height] of [[320, 630], [390, 636], [768, 690], [1440, 778]]) {
      const framing = cameraFraming(width, height, 'room', true)
      assert.ok(framing.halfHeight >= 4.65)
      assert.ok(framing.halfHeight * width / height >= 6.8)
    }
  })
  it('provides finite, centered views for every interactive object', () => {
    const focuses: SceneFocus[] = ['room', 'fridge', 'stock', 'ledger', 'budget', 'roommates', 'settle', 'brew']
    for (const focus of focuses) {
      for (const [width, height] of [[390, 636], [390, 255], [960, 778]]) {
        const framing = cameraFraming(width, height, focus, false)
        assert.ok(framing.halfHeight > 0)
        assert.ok(framing.center.every(Number.isFinite))
      }
    }
  })
  it('rejects invalid viewport dimensions instead of creating broken camera matrices', () => {
    for (const [width, height] of [[0, 100], [100, 0], [-1, 100], [NaN, 100], [100, Infinity]]) {
      assert.throws(() => cameraFraming(width, height, 'room', false), /positive viewport/)
    }
  })
  it('keeps focus centered beside or above panels even when zooming on a full-screen canvas', () => {
    const layouts = [
      { width: 1440, height: 960, area: { x: 0, y: 76, width: 955, height: 778 } },
      { width: 390, height: 844, area: { x: 0, y: 80, width: 390, height: 255 } },
    ]
    for (const layout of layouts) {
      for (const zoom of [0.65, 1, 1.9]) {
        const projection = cameraProjection(layout.width, layout.height, layout.area, 3, zoom)
        const camera = new OrthographicCamera(projection.left, projection.right, projection.top, projection.bottom, 0.1, 100)
        camera.position.z = 10
        camera.zoom = zoom
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld()
        const point = new Vector3(0, 0, 0).project(camera)
        const x = (point.x * 0.5 + 0.5) * layout.width
        const y = (-point.y * 0.5 + 0.5) * layout.height
        assert.ok(Math.abs(x - (layout.area.x + layout.area.width / 2)) < 0.001)
        assert.ok(Math.abs(y - (layout.area.y + layout.area.height / 2)) < 0.001)
      }
    }
  })
})
