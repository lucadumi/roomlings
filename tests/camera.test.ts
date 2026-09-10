import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { baseCameraOffset, cameraFraming, cameraProjection, roomCameraZoom } from '../src/camera.ts'
import type { SceneFocus } from '../src/camera.ts'
import { Box3, Group, Mesh, OrthographicCamera, Vector3 } from 'three'
import { buildKitchenModel } from '../src/kitchenModel.ts'

describe('room-first camera framing', () => {
  it('uses the former 120 percent scale as the default 100 percent room view', () => {
    assert.equal(roomCameraZoom(1, true), 1.2)
    for (const zoom of [0.65, 1, 1.2, 1.9]) {
      assert.ok(Math.abs(roomCameraZoom(zoom, true) / zoom - 1.2) < 1e-12)
      assert.equal(roomCameraZoom(zoom, false), zoom)
    }
    for (const zoom of [0, -1, NaN, Infinity]) assert.throws(() => roomCameraZoom(zoom, true), /positive finite/)
  })
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
  it('fits the modeled kitchen floor and walls after turning or tilting the whole-room view', (context) => {
    const room = new Group()
    const model = buildKitchenModel(room)
    model.doors.forEach((door, index) => { door.rotation.y = index ? -1.72 : -1.97 })
    const bounds = new Box3().setFromObject(room)
    context.after(() => {
      room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
      model.materials.forEach((material) => material.dispose())
    })
    const axis = new Vector3(0, 1, 0)
    for (const [width, height] of [[1440, 960], [390, 844], [844, 390]]) {
      for (const rotation of [-0.75, 0, 0.75]) for (const pitch of [-1.7, 0, 3]) {
        const framing = cameraFraming(width, height, 'room', true, { bounds, rotation, pitch })
        const halfWidth = framing.halfHeight * width / height
        const camera = new OrthographicCamera(-halfWidth, halfWidth, framing.halfHeight, -framing.halfHeight, 0.1, 100)
        const center = new Vector3(...framing.center).applyAxisAngle(axis, rotation)
        camera.position.copy(center).add(new Vector3(baseCameraOffset[0], baseCameraOffset[1] + pitch, baseCameraOffset[2]))
        camera.lookAt(center)
        camera.updateMatrixWorld(true)
        const projected: Vector3[] = []
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new Vector3(x, y, z).applyAxisAngle(axis, rotation).project(camera)
          projected.push(point)
          assert.ok(Math.abs(point.x) < 1, `The room must fit horizontally at ${width}x${height}, ${rotation}, ${pitch}`)
          assert.ok(Math.abs(point.y) < 1, `The room must fit vertically at ${width}x${height}, ${rotation}, ${pitch}`)
          assert.ok(point.z > -1 && point.z < 1)
        }
        for (const coordinate of ['x', 'y'] as const) {
          const values = projected.map((point) => point[coordinate])
          assert.ok(Math.abs(Math.min(...values) + Math.max(...values)) < 0.000001,
            `Whole-room ${coordinate} bounds must stay centered rather than add empty space to one side`)
        }
      }
    }
  })
  it('provides finite, centered views for every interactive object', () => {
    const focuses: SceneFocus[] = ['room', 'fridge', 'stock', 'ledger', 'budget', 'roommates', 'settle', 'brew', 'chores', 'supplies', 'sink', 'counters', 'floor']
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
    for (const wholeRoomView of [{ bounds: new Box3() }, { rotation: NaN }, { pitch: Infinity }]) {
      assert.throws(() => cameraFraming(390, 844, 'room', true, wholeRoomView), /finite bounds and camera angles/)
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
