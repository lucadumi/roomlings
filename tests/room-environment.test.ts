import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Color, Group, Scene, Texture } from 'three'
import { applyRoomReflections, roomReflectionIntensity } from '../src/roomEnvironment.ts'

test('room reflections dim continuously for evening without changing geometry or the background', () => {
  const scene = new Scene()
  const room = new Group()
  const background = new Color('#ffffff')
  const texture = new Texture()
  scene.background = background
  scene.add(room)
  try {
    const reflections = { texture, dispose: () => texture.dispose() }
    applyRoomReflections(scene, reflections)
    assert.equal(scene.environment, texture)
    assert.equal(scene.environmentIntensity, 0.22)
    applyRoomReflections(scene, reflections, 0.5)
    assert.ok(Math.abs(scene.environmentIntensity - 0.135) < 0.000001)
    applyRoomReflections(scene, reflections, 1)
    assert.ok(Math.abs(scene.environmentIntensity - 0.05) < 0.000001)
    assert.equal(scene.background, background)
    assert.deepEqual(scene.children, [room])
    assert.deepEqual(room.position.toArray(), [0, 0, 0])
  } finally { texture.dispose() }
})

test('room reflection intensity rejects invalid lighting mixes', () => {
  for (const value of [-1, 1.01, NaN, Infinity]) assert.throws(() => roomReflectionIntensity(value), /mix between zero and one/)
})
