import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dampTo, frameSeconds } from '../src/motion.ts'

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
