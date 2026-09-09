import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Box3 } from 'three'
import { buildGardenModel } from '../src/landing/gardenModel.ts'
import { advanceGardenWind, gardenScrollGust, gardenSwayPadding, maximumGardenWind } from '../src/landing/gardenWind.ts'

test('scrolling produces bounded, direction-aware garden wind without a jump on page navigation', () => {
  assert.ok(gardenScrollGust(30, 16, 960) > 0)
  assert.ok(gardenScrollGust(-30, 16, 960) < 0)
  assert.equal(gardenScrollGust(0, 16, 960), 0)
  assert.equal(gardenScrollGust(10000, 0, 960), maximumGardenWind)
  assert.equal(gardenScrollGust(-10000, 0, 960), -maximumGardenWind)
  assert.ok(gardenScrollGust(30, 1000, 960) < gardenScrollGust(30, 16, 960))
})

test('wind eases into the leaves and returns to the ambient breeze after scrolling stops', () => {
  let wind = { gust: maximumGardenWind, lean: 0 }
  wind = advanceGardenWind(wind, 1 / 30)
  assert.ok(wind.lean > 0 && wind.lean < wind.gust)
  for (let frame = 0; frame < 120; frame++) wind = advanceGardenWind(wind, 1 / 30)
  assert.equal(wind.gust, 0)
  assert.equal(wind.lean, 0)
  assert.throws(() => gardenScrollGust(1, -1, 960))
  assert.throws(() => gardenScrollGust(1, 16, 0))
  assert.throws(() => advanceGardenWind({ gust: NaN, lean: 0 }, 1))
  assert.throws(() => advanceGardenWind({ gust: 0, lean: 0 }, -1))
})

test('both complete gardens remain inside their framing margin at maximum wind in either direction', () => {
  for (const side of ['left', 'right'] as const) {
    const model = buildGardenModel(side)
    try {
      const safe = model.bounds.clone().expandByScalar(gardenSwayPadding)
      for (const direction of [-1, 1]) {
        for (const leaf of model.foliage) leaf.object.rotation.z = leaf.restRotation + direction * (maximumGardenWind + leaf.amplitude)
        model.root.updateMatrixWorld(true)
        assert.ok(safe.containsBox(new Box3().setFromObject(model.root, true)), `${side} garden must not be cropped by wind`)
      }
    } finally { model.dispose() }
  }
})
