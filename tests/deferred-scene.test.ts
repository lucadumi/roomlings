import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deferredSceneSetup } from '../src/deferredScene.ts'

function clock() {
  let next = 0
  const pending = new Map<number, FrameRequestCallback>()
  return {
    frames: {
      request(callback: FrameRequestCallback) { pending.set(++next, callback); return next },
      cancel(frame: number) { pending.delete(frame) },
    },
    flush() {
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach((callback) => callback(16))
    },
    count: () => pending.size,
  }
}

test('StrictMode cleanup cancels cold setup before any scene resources are allocated', () => {
  const time = clock()
  let starts = 0
  let cleanups = 0
  const setup = () => { starts++; return () => { cleanups++ } }
  const fail = (cause: unknown) => { throw cause }
  const first = deferredSceneSetup(setup, fail, time.frames)
  first.setDeferred(false)
  first.dispose()
  assert.equal(time.count(), 0)
  const mounted = deferredSceneSetup(setup, fail, time.frames)
  mounted.setDeferred(false)
  assert.equal(starts, 0)
  time.flush()
  assert.equal(starts, 1)
  assert.equal(cleanups, 0)
  mounted.dispose()
  mounted.dispose()
  assert.equal(cleanups, 1)
})

test('opening an account dialog cancels pending setup and closing it resumes once', () => {
  const time = clock()
  let starts = 0
  const scene = deferredSceneSetup(() => { starts++ }, (cause) => { throw cause }, time.frames)
  scene.setDeferred(true)
  assert.equal(time.count(), 0)
  scene.setDeferred(false)
  scene.setDeferred(true)
  time.flush()
  assert.equal(starts, 0)
  scene.setDeferred(false)
  scene.setDeferred(false)
  assert.equal(time.count(), 1)
  time.flush()
  assert.equal(starts, 1)
  scene.dispose()
})

test('already initialized scenes survive account-dialog suspension without rebuilding', () => {
  const time = clock()
  let starts = 0
  let cleanups = 0
  const scene = deferredSceneSetup(() => {
    starts++
    return () => { cleanups++ }
  }, (cause) => { throw cause }, time.frames)
  scene.setDeferred(false)
  time.flush()
  scene.setDeferred(true)
  scene.setDeferred(false)
  time.flush()
  assert.equal(starts, 1)
  assert.equal(cleanups, 0)
  scene.dispose()
  assert.equal(cleanups, 1)
})

test('deferred initialization reports errors rather than leaving a success-shaped empty scene', () => {
  const time = clock()
  const error = new Error('Scene initialization failed')
  const errors: unknown[] = []
  const scene = deferredSceneSetup(() => { throw error }, (cause) => errors.push(cause), time.frames)
  scene.setDeferred(false)
  time.flush()
  assert.deepEqual(errors, [error])
  scene.dispose()
})
