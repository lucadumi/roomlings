import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRoomComponent } from '../shared/roomComponents.ts'
import { cachedComponentThumbnail, clearComponentThumbnails, renderComponentThumbnail } from '../src/componentThumbnail.ts'

test('clearing thumbnails cancels queued work before it can create a renderer or repopulate the cache', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  const frames: FrameRequestCallback[] = []
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length },
  })

  const component = createRoomComponent('plant', 'kitchen-plant-counter', 'queued-thumbnail')
  try {
    clearComponentThumbnails()
    const first = assert.rejects(renderComponentThumbnail(component, 'original'), /interrupted/)
    await Promise.resolve()
    assert.equal(frames.length, 1)
    clearComponentThumbnails()
    const second = assert.rejects(renderComponentThumbnail(component, 'sage'), /interrupted/)
    await Promise.resolve()
    assert.equal(frames.length, 2, 'A new generation must not wait behind a cleared queue')
    clearComponentThumbnails()
    frames.forEach((callback) => callback(0))
    await Promise.all([first, second])
  } finally {
    clearComponentThumbnails()
    if (original) Object.defineProperty(globalThis, 'requestAnimationFrame', original)
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  }
})

test('unavailable WebGL rejects object previews instead of generating SVG substitutes', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  const created: string[] = []
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag: string) {
        created.push(tag)
        assert.equal(tag, 'canvas')
        return { getContext: () => null }
      },
      createElementNS() { throw new Error('A 2D renderer must not be created.') },
    },
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true, value: (callback: FrameRequestCallback) => { callback(0); return 1 },
  })
  const component = createRoomComponent('plant', 'kitchen-plant-counter', 'unavailable-thumbnail')
  try {
    clearComponentThumbnails()
    await assert.rejects(renderComponentThumbnail(component, 'original'), /3D is unavailable/)
    await assert.rejects(renderComponentThumbnail(component, 'original'), /3D is unavailable/)
    assert.equal(cachedComponentThumbnail(component, 'original'), undefined)
    assert.deepEqual(created, ['canvas'])
  } finally {
    clearComponentThumbnails()
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (originalFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', originalFrame)
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  }
})
