import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { baseCameraOffset, cameraOrbitOffset, cameraFraming, cameraProjection, fitRoomBounds, fitRoomOrbitBounds, nearestRoomRotation, normalizeRoomRotation, preferredRoomRotation, projectRoomBounds, projectRoomOrbitBounds, roomCameraZoom, roomEntryFraming, roomFramingArea, roomPitchLimits, roomRotationPeriod, roomZoomLimits, stepRoomZoom, usesRoomEntryFraming } from '../src/camera.ts'
import type { SceneFocus } from '../src/camera.ts'
import { roomIds } from '../shared/rooms.ts'
import { Box3, Group, Mesh, OrthographicCamera, Vector3 } from 'three'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { bathroomFraming } from '../src/bathroomModel.ts'

describe('room-first camera framing', () => {
  it('keeps live rooms, public tours and saved previews free of room-root view transforms', async () => {
    for (const file of ['KitchenWorld.tsx', 'ChoreRoomWorld.tsx', 'landing/TourScene.tsx', 'householdRoomPreview.ts']) {
      const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')
      assert.doesNotMatch(source, /\b(?:room|scene)\.(?:rotation|position|scale)\s*[.=]|\b(?:room|scene)\.(?:rotate[XYZ]|translate[XYZ]|applyMatrix4)\(/,
        `${file} must move the camera rather than the room`)
    }
  })

  it('orbits the camera around a fixed focus point without rotating or translating room geometry', () => {
    const room = new Group()
    room.updateMatrixWorld(true)
    const transform = room.matrixWorld.clone()
    const bounds = new Box3(new Vector3(3, 0, -3), new Vector3(4, 1.4, -2))
    const focus = bounds.getCenter(new Vector3())
    const initial = cameraOrbitOffset()
    assert.deepEqual(initial.toArray(), baseCameraOffset)
    const output = new Vector3()
    for (const rotation of [-Math.PI, -0.75, 0, 0.75, Math.PI, Math.PI * 4]) {
      const frame = fitRoomBounds(600, 700, bounds, rotation)
      assert.deepEqual(frame.center, focus.toArray())
      const camera = new OrthographicCamera(-3, 3, 3.5, -3.5, 0.1, 100)
      assert.equal(cameraOrbitOffset(rotation, 0, output), output)
      assert.ok(Math.abs(output.length() - initial.length()) < 0.000001)
      camera.position.copy(focus).add(output)
      camera.lookAt(focus)
      camera.updateMatrixWorld(true)
      const projected = focus.clone().project(camera)
      assert.ok(Math.abs(projected.x) < 0.000001 && Math.abs(projected.y) < 0.000001)
      assert.ok(room.matrixWorld.equals(transform))
      assert.deepEqual(roomEntryFraming(600, 700, { x: 0, y: 0, width: 600, height: 700 }, rotation).center,
        cameraFraming(600, 700, 'room', false).center)
      assert.deepEqual(bathroomFraming(600, 700, bounds, rotation, 0, { closeRoom: true }).center,
        cameraFraming(600, 700, 'room', false).center)
    }
    assert.throws(() => cameraOrbitOffset(NaN), /finite angles/)
    assert.throws(() => cameraOrbitOffset(0, Infinity), /finite angles/)
  })

  it('fits the full editor orbit at a fixed scale for rooms, tall fixtures and flat objects', () => {
    for (const size of [[10, 5, 8], [0.3, 4, 0.4], [3, 0.2, 2], [2, 3, 2], [0, 0, 0]]) {
      const bounds = new Box3(new Vector3(1, 0.3, -4), new Vector3(1 + size[0], 0.3 + size[1], -4 + size[2]))
      const before = bounds.clone()
      const envelope = projectRoomOrbitBounds(bounds)
      assert.deepEqual(envelope.center, bounds.getCenter(new Vector3()).toArray())
      let widest = 0
      let tallest = 0
      for (let turn = 0; turn <= 72; turn++) for (let tilt = 0; tilt <= 20; tilt++) {
        const yaw = turn * Math.PI / 36
        const pitch = roomPitchLimits.min + (roomPitchLimits.max - roomPitchLimits.min) * tilt / 20
        const projected = projectRoomBounds(bounds, yaw, pitch)
        widest = Math.max(widest, projected.horizontal)
        tallest = Math.max(tallest, projected.vertical)
        assert.ok(projected.horizontal <= envelope.horizontal + 1e-10)
        assert.ok(projected.vertical <= envelope.vertical + 1e-10)
        for (const [width, height] of [[1440, 960], [390, 844], [844, 390]]) {
          const framing = fitRoomOrbitBounds(width, height, bounds)
          assert.ok(framing.halfHeight >= projected.vertical)
          assert.ok(framing.halfHeight * width / height >= projected.horizontal)
        }
      }
      assert.ok(envelope.horizontal - widest < 0.01, 'The orbit envelope must not add arbitrary horizontal padding.')
      assert.ok(envelope.vertical - tallest < 0.01, 'The orbit envelope must follow the allowed camera elevations.')
      assert.deepEqual(bounds, before)
    }
    assert.throws(() => projectRoomOrbitBounds(new Box3()), /finite bounds/)
    assert.throws(() => fitRoomOrbitBounds(0, 100, new Box3(new Vector3(), new Vector3(1, 1, 1))), /positive scene dimensions/)
  })

  it('supports complete rotations and takes the shortest path when resetting or selecting an object', () => {
    assert.equal(roomRotationPeriod, Math.PI * 2)
    for (const angle of [0, roomRotationPeriod, -roomRotationPeriod, roomRotationPeriod * 20]) {
      assert.equal(normalizeRoomRotation(angle), 0)
    }
    for (let turns = -4; turns <= 4; turns++) for (const offset of [-3.1, -0.3, 0.3, 3.1]) {
      const current = turns * roomRotationPeriod + offset
      for (const requested of [0, 0.75]) {
        const target = nearestRoomRotation(current, requested)
        assert.ok(Math.abs(target - current) <= Math.PI)
        assert.ok(Math.abs(normalizeRoomRotation(target) - requested) < 0.000001)
      }
    }
    assert.throws(() => normalizeRoomRotation(NaN), /finite angle/)
    assert.throws(() => nearestRoomRotation(0, Infinity), /finite angle/)
  })
  it('preserves entry pixel scale while centering the room beside an editor panel', () => {
    for (const [width, height] of [[1440, 960], [390, 844], [844, 390]]) {
      const full = { x: 0, y: 0, width, height }
      const area = { x: width * 0.4, y: 80, width: width * 0.6 - 40, height: height - 190 }
      const initial = roomEntryFraming(width, height, full)
      const paneled = roomEntryFraming(width, height, area)
      const first = cameraProjection(width, height, full, initial.halfHeight, 1)
      const next = cameraProjection(width, height, area, paneled.halfHeight, 1)
      assert.ok(Math.abs((first.right - first.left) - (next.right - next.left)) < 0.000001)
      assert.ok(Math.abs((first.top - first.bottom) - (next.top - next.bottom)) < 0.000001)
      assert.deepEqual(initial.center, paneled.center)
    }
  })

  it('measures the clear scene area beside existing camera controls without device breakpoints', () => {
    const canvas = { x: 0, y: 0, width: 390, height: 844 }
    const stage = { x: 12, y: 240, width: 366, height: 420 }
    const controls = { x: 322, y: 326, width: 53, height: 270 }
    assert.deepEqual(roomFramingArea(canvas, stage, controls), { x: 12, y: 240, width: 298, height: 420 })
    assert.deepEqual(roomFramingArea(canvas, stage), stage)
    assert.deepEqual(roomFramingArea(canvas, stage, { ...controls, x: 400 }), stage)
    assert.deepEqual(roomFramingArea(canvas, stage, { ...controls, y: 700 }), stage)
    assert.deepEqual(roomFramingArea(canvas, stage, { ...controls, width: 0 }), stage)
    assert.deepEqual(roomFramingArea({ ...canvas, x: 5, y: 20 }, stage, controls), { x: 7, y: 220, width: 298, height: 420 })
  })
  it('uses the full scene width above a horizontal toolbar instead of reserving an empty side column', () => {
    const canvas = { x: 0, y: 0, width: 390, height: 844 }
    const stage = { x: 12, y: 200, width: 366, height: 380 }
    const controls = { x: 228, y: 520, width: 150, height: 54 }
    assert.deepEqual(roomFramingArea(canvas, stage, controls), { x: 12, y: 200, width: 366, height: 308 })
    assert.deepEqual(roomFramingArea(canvas, stage, controls, { width: 180, height: 330 }), { x: 12, y: 200, width: 204, height: 380 })
    assert.deepEqual(roomFramingArea(canvas, stage, controls, { width: 250, height: 280 }), { x: 12, y: 200, width: 366, height: 308 })
    const frame = roomEntryFraming(canvas.width, canvas.height, roomFramingArea(canvas, stage, controls))
    const projection = cameraProjection(canvas.width, canvas.height, roomFramingArea(canvas, stage, controls), frame.halfHeight, 1)
    assert.ok(Math.abs(projection.top - projection.bottom - cameraFraming(canvas.width, canvas.height, 'room', false).halfHeight * 2) < 0.000001)
  })
  it('widens the kitchen and bathroom entry views without changing the living room baseline or focused views', () => {
    for (const roomId of roomIds) {
      const baseline = roomId === 'living-room' ? 1.2 : 1
      assert.equal(roomCameraZoom(1, true, roomId), baseline)
      for (const zoom of [0.5, 0.9, 1, 1.1, 1.5]) {
        assert.ok(Math.abs(roomCameraZoom(zoom, true, roomId) / zoom - baseline) < 1e-12)
        assert.equal(roomCameraZoom(zoom, false, roomId), zoom)
      }
      for (const zoom of [0, -1, NaN, Infinity]) assert.throws(() => roomCameraZoom(zoom, true, roomId), /positive finite/)
    }
  })
  it('steps zoom by exactly ten percentage points and stops at fifty and one hundred fifty percent', () => {
    assert.deepEqual(roomZoomLimits, { min: 0.5, max: 1.5, step: 0.1 })
    let zoom = 0.5
    for (let percent = 60; percent <= 150; percent += 10) {
      zoom = stepRoomZoom(zoom, 1)
      assert.equal(zoom, percent / 100)
    }
    assert.equal(stepRoomZoom(zoom, 1), 1.5)
    for (let percent = 140; percent >= 50; percent -= 10) {
      zoom = stepRoomZoom(zoom, -1)
      assert.equal(zoom, percent / 100)
    }
    assert.equal(stepRoomZoom(zoom, -1), 0.5)
    assert.equal(stepRoomZoom(1.13, 1), 1.23)
    assert.equal(stepRoomZoom(1.13, -1), 1.03)
    assert.equal(stepRoomZoom(1.49, 1), 1.5)
    assert.equal(stepRoomZoom(0.51, -1), 0.5)
    for (const invalid of [NaN, Infinity, -Infinity]) assert.throws(() => stepRoomZoom(invalid, 1), /finite value/)
  })
  it('keeps the immersive phone close-up separate from the measured whole-room overview', () => {
    const close = cameraFraming(390, 636, 'room', false)
    const whole = cameraFraming(390, 636, 'room', true)
    assert.ok(whole.halfHeight / close.halfHeight > 2)
    assert.deepEqual(close.center, [-0.7, 1.6, -0.9])
    assert.deepEqual(cameraFraming(389, 636, 'room', false).center, close.center)
    assert.ok(cameraFraming(390, 636, 'fridge', false).halfHeight < whole.halfHeight)
  })
  it('resets both rooms to exactly their entry magnification at 100%, even after focusing an object or opening a panel', () => {
    const bounds = new Box3(new Vector3(-5, 0, -4), new Vector3(5, 5, 4))
    const initialClose = usesRoomEntryFraming({ focus: 'room' })
    const resetClose = usesRoomEntryFraming({ focus: 'room', selectedComponentId: 'selected-object', panelOpen: true, resetView: true })
    assert.equal(initialClose, true)
    assert.equal(resetClose, initialClose)
    assert.equal(usesRoomEntryFraming({ focus: 'room', selectedComponentId: 'selected-object' }), false)
    assert.equal(usesRoomEntryFraming({ focus: 'room', panelOpen: true }), false)
    assert.equal(usesRoomEntryFraming({ focus: 'sink' }), false)
    for (const [width, height] of [[320, 630], [390, 636], [844, 390], [1440, 778]]) {
      const area = { x: 0, y: 0, width, height }
      for (const roomId of ['kitchen', 'bathroom']) {
        const framing = (closeRoom: boolean) => roomId === 'kitchen'
          ? cameraFraming(width, height, 'room', !closeRoom, { bounds })
          : bathroomFraming(width, height, bounds, 0, 0, { closeRoom })
        const initial = framing(initialClose)
        const reset = framing(resetClose)
        assert.deepEqual(reset, initial)
        assert.deepEqual(cameraProjection(width, height, area, reset.halfHeight, 1),
          cameraProjection(width, height, area, initial.halfHeight, 1))
        assert.notEqual(reset.halfHeight, framing(false).halfHeight)
      }
    }
  })
  it('uses the entry scale for placement previews even with a selected object and compact panel', () => {
    for (const resetView of [false, true]) {
      assert.equal(usesRoomEntryFraming({
        focus: 'room', selectedComponentId: 'candidate', panelOpen: true, placementPreview: true, resetView,
      }), true)
    }
  })
  it('keeps reset framing measured for editor overviews and public tours', () => {
    for (const context of [{ overviewFocus: true }, { publicPreview: true }]) {
      assert.equal(usesRoomEntryFraming({ focus: 'room', ...context }), false)
      assert.equal(usesRoomEntryFraming({ focus: 'room', resetView: true, ...context }), false)
      assert.equal(usesRoomEntryFraming({ focus: 'sink', selectedComponentId: 'object', resetView: true, ...context }), false)
      assert.equal(usesRoomEntryFraming({ focus: 'room', placementPreview: true, ...context }), false)
    }
  })
  it('retains the inward-facing fitted-appliance angle when selecting or resetting a placement preview', () => {
    assert.equal(preferredRoomRotation('kitchen-undercounter'), 0.75)
    assert.equal(preferredRoomRotation('kitchen-small-appliance'), 0)
    assert.equal(preferredRoomRotation('bathroom-laundry'), 0)
    assert.equal(preferredRoomRotation(), 0)
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
    for (const [width, height] of [[1440, 960], [390, 844], [844, 390]]) {
      for (const rotation of [-Math.PI, -Math.PI / 2, -0.75, 0, 0.75, Math.PI / 2, Math.PI]) for (const pitch of [-1.7, 0, 3]) {
        const framing = cameraFraming(width, height, 'room', true, { bounds, rotation, pitch })
        const halfWidth = framing.halfHeight * width / height
        const camera = new OrthographicCamera(-halfWidth, halfWidth, framing.halfHeight, -framing.halfHeight, 0.1, 100)
        const center = new Vector3(...framing.center)
        camera.position.copy(center).add(cameraOrbitOffset(rotation, pitch))
        camera.lookAt(center)
        camera.updateMatrixWorld(true)
        const projected: Vector3[] = []
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new Vector3(x, y, z).project(camera)
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
      for (const zoom of [0.5, 1, 1.5]) {
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
