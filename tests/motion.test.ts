import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { CameraProjectionMotion, dampTo, frameSeconds, springTo, springVector3To } from '../src/motion.ts'

describe('room animation timing', () => {
  it('retains elapsed time on slow frames without creating a negative step', () => {
    assert.equal(frameSeconds(100, 600), 0.5)
    assert.equal(frameSeconds(100, 2100), 2)
    assert.equal(frameSeconds(100, 90), 0)
    assert.throws(() => frameSeconds(NaN, 100), /finite timestamps/)
    assert.throws(() => frameSeconds(100, Infinity), /finite timestamps/)
  })

  it('moves the same distance at low, normal and high frame rates', () => {
    for (const fps of [2, 10, 30, 60, 120]) {
      let position = 0
      for (let frame = 1; frame <= fps; frame++) {
        position = dampTo(position, 5, 6, frameSeconds((frame - 1) * 1000 / fps, frame * 1000 / fps))
      }
      assert.ok(Math.abs(position - 5 * (1 - Math.exp(-6))) < 1e-10, `${fps} fps changed the animation's duration`)
    }
  })

  it('settles exactly without overshooting or keeping idle shadow updates alive', () => {
    assert.equal(dampTo(0.9995, 1, 8, 1 / 60), 1)
    assert.equal(dampTo(1.0005, 1, 8, 1 / 60), 1)
    assert.equal(dampTo(0, 1, 8, 2), 1)
    assert.equal(dampTo(1, 0, 8, 2), 0)
    assert.equal(dampTo(0, 1, 8, 0), 0)
  })
})

describe('camera spring motion', () => {
  it('rejects non-finite targets and non-positive rates', () => {
    assert.throws(() => springTo({ value: 0, velocity: 0 }, NaN, 9, 1 / 60), /finite target/)
    assert.throws(() => springTo({ value: 0, velocity: 0 }, 1, 0, 1 / 60), /positive rate/)
    assert.throws(() => springTo({ value: 0, velocity: 0 }, 1, -9, 1 / 60), /positive rate/)
  })

  it('leaves the spring untouched on a zero-length frame', () => {
    const spring = { value: 0.2, velocity: 1.5 }
    assert.deepEqual(springTo(spring, 5, 9, 0), spring)
  })

  it('rejects invalid state and frame timing rather than producing NaN camera coordinates', () => {
    for (const delta of [NaN, Infinity, -1]) assert.throws(() => springTo({ value: 0, velocity: 0 }, 1, 16, delta), /time step/)
    assert.throws(() => springTo({ value: Infinity, velocity: 0 }, 1, 16, 0.1), /finite state/)
    assert.throws(() => springTo({ value: 0, velocity: NaN }, 1, 16, 0.1), /finite state/)
  })

  it('eases into a focus change without adding a long tail to direct camera motion', () => {
    const first = springTo({ value: 0, velocity: 0 }, 1, 24, 1 / 60)
    assert.ok(first.value > 0 && first.value < 0.1)
    let spring = { value: 0, velocity: 0 }
    for (let frame = 0; frame < 15; frame++) spring = springTo(spring, 1, 24, 1 / 60)
    assert.ok(spring.value > 0.98)
  })

  it('covers the same distance from rest at low, normal and high frame rates', () => {
    for (const fps of [2, 10, 30, 60, 120]) {
      let spring = { value: 0, velocity: 0 }
      for (let frame = 1; frame <= fps; frame++) {
        spring = springTo(spring, 5, 6, frameSeconds((frame - 1) * 1000 / fps, frame * 1000 / fps))
      }
      const expected = 5 * (1 - Math.exp(-6) * (1 + 6))
      assert.ok(Math.abs(spring.value - expected) < 1e-9, `${fps} fps changed the spring's duration`)
    }
  })

  describe('camera projection transitions', () => {
    const viewport = { width: 1440, height: 900 }
    const whole = { x: 0, y: 0, width: 1440, height: 900 }
    const besidePanel = { x: 600, y: 90, width: 800, height: 690 }

    it('eases a panel offset instead of jumping the projection on its first frame', () => {
      const motion = new CameraProjectionMotion()
      motion.update(whole, viewport, 0, true)
      const first = { ...motion.update(besidePanel, viewport, 1 / 60, false) }
      assert.ok(first.x > 0 && first.x < besidePanel.x * 0.1)
      assert.ok(first.width > besidePanel.width && first.width < whole.width)
      assert.equal(motion.moving, true)
      for (let frame = 0; frame < 180; frame++) motion.update(besidePanel, viewport, 1 / 60, false)
      assert.deepEqual(motion.area, besidePanel)
      assert.equal(motion.moving, false)
    })

    it('snaps exactly and clears momentum when reduced motion is enabled', () => {
      const motion = new CameraProjectionMotion()
      motion.update(whole, viewport, 0, true)
      motion.update(besidePanel, viewport, 0.1, false)
      assert.deepEqual(motion.update(besidePanel, viewport, 0, true), besidePanel)
      assert.equal(motion.moving, false)
      assert.deepEqual(motion.update(besidePanel, viewport, 1 / 60, false), besidePanel)
    })

    it('produces the same intermediate projection at different frame rates', () => {
      const results = [30, 60, 120].map((fps) => {
        const motion = new CameraProjectionMotion()
        motion.update(whole, viewport, 0, true)
        for (let frame = 0; frame < fps / 2; frame++) motion.update(besidePanel, viewport, 1 / fps, false)
        return { ...motion.area }
      })
      for (const area of results) for (const key of ['x', 'y', 'width', 'height'] as const) {
        assert.ok(Math.abs(area[key] - results[0][key]) < 1e-9)
      }
    })
  })

  it('settles exactly onto the target with zero velocity instead of drifting forever', () => {
    let spring = { value: 0, velocity: 0 }
    for (let frame = 0; frame < 600; frame++) spring = springTo(spring, 1, 9, 1 / 60)
    assert.deepEqual(spring, { value: 1, velocity: 0 })
  })

  it('carries velocity through a retarget instead of restarting from a standing stop', () => {
    // Run the spring toward an initial target long enough to build up real velocity.
    let spring = { value: 0, velocity: 0 }
    for (let frame = 0; frame < 6; frame++) spring = springTo(spring, 10, 9, 1 / 60)
    assert.ok(spring.velocity > 0, 'the spring should be moving before the retarget')
    const movingVelocity = spring.velocity
    // Retargeting on the very next, near-instant frame should not make the velocity jump: a fresh
    // exponential damp recomputes velocity from the new target and discontinuously changes direction,
    // but the spring's velocity is carried state and stays close to what it was a moment before.
    const retargeted = springTo(spring, -10, 9, 1e-9)
    assert.ok(Math.abs(retargeted.velocity - movingVelocity) < 1e-3, 'retargeting should not snap the velocity')
  })

  it('is unaffected by unrelated axes when springing a vector target', () => {
    const value = new Vector3(1, 2, 3)
    const velocity = new Vector3(0, 0, 0)
    springVector3To(value, velocity, new Vector3(1, 5, 3), 9, 1 / 60)
    assert.equal(value.x, 1)
    assert.equal(value.z, 3)
    assert.ok(value.y > 2 && value.y < 5)
    assert.ok(velocity.x === 0 && velocity.z === 0)
  })
})
