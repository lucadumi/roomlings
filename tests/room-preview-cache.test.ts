import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRoomPreviewCache } from '../src/roomPreviewCache.ts'
import type { RoomPreviewOptions } from '../src/roomPreviewCache.ts'

const options = (): RoomPreviewOptions => ({
  roomStyle: 'original',
  sizes: { kitchen: { width: 86, height: 59 }, bathroom: { width: 86, height: 59 }, 'living-room': { width: 86, height: 59 } },
})
const images = (value: string) => ({ kitchen: value, bathroom: value, 'living-room': value })

test('room previews coalesce in-flight requests and are synchronously available after warming', async () => {
  let renders = 0
  let finish!: (value: ReturnType<typeof images>) => void
  const cache = createRoomPreviewCache(async () => {
    renders++
    return new Promise((resolve) => { finish = resolve })
  })
  const first = cache.render(options(), 'home-a')
  const second = cache.render(options(), 'home-a')
  assert.equal(first, second)
  assert.equal(renders, 1)
  assert.equal(cache.read(options(), 'home-a'), undefined)
  const result = images('current')
  finish(result)
  assert.equal(await first, result)
  assert.equal(cache.read(options(), 'home-a'), result)
  assert.equal(await cache.render(options(), 'home-a'), result)
  assert.equal(renders, 1)
})

test('preview caches isolate households, styles, geometry, ledger visuals and measured sizes', async () => {
  let renders = 0
  const cache = createRoomPreviewCache(async () => images(String(++renders)), 10)
  const original = await cache.render(options(), 'home-a')
  assert.equal(cache.read(options(), 'home-b'), undefined)
  assert.notDeepEqual(await cache.render(options(), 'home-b'), original)
  for (const changed of [
    { ...options(), roomStyle: 'coastal' as const },
    { ...options(), components: [] },
    { ...options(), ledger: { memberCount: 2 } },
    { ...options(), sizes: { ...options().sizes, kitchen: { width: 172, height: 118 } } },
  ]) {
    assert.equal(cache.read(changed, 'home-a'), undefined)
    assert.notDeepEqual(await cache.render(changed, 'home-a'), original)
  }
  assert.equal(cache.read(options(), 'home-a'), original)
})

test('failed renders remain errors and can be retried without poisoning successful entries', async () => {
  let failing = true
  const cache = createRoomPreviewCache(async () => {
    if (failing) throw new Error('WebGL unavailable')
    return images('recovered')
  })
  await assert.rejects(cache.render(options(), 'home-a'), /WebGL unavailable/)
  assert.equal(cache.read(options(), 'home-a'), undefined)
  failing = false
  assert.deepEqual(await cache.render(options(), 'home-a'), images('recovered'))
})

test('the preview cache evicts least-recently-used snapshots instead of growing without bound', async () => {
  const cache = createRoomPreviewCache(async () => images('ready'), 2)
  await cache.render(options(), 'a')
  await cache.render(options(), 'b')
  cache.read(options(), 'a')
  await cache.render(options(), 'c')
  assert.ok(cache.read(options(), 'a'))
  assert.equal(cache.read(options(), 'b'), undefined)
  assert.ok(cache.read(options(), 'c'))
  assert.throws(() => createRoomPreviewCache(async () => images('ready'), 0), /positive integer/)
})

test('completed background preloads populate the shared cache', async () => {
  let renders = 0
  const cache = createRoomPreviewCache(async () => { renders++; return images('warmed') })
  await cache.preload(options(), 'home-a', new AbortController().signal)
  assert.deepEqual(cache.read(options(), 'home-a'), images('warmed'))
  assert.deepEqual(await cache.render(options(), 'home-a'), images('warmed'))
  assert.equal(renders, 1)
})

test('cancelled background work cannot cache results or invalidate a foreground request', async () => {
  let finishBackground!: (result: ReturnType<typeof images>) => void
  let renders = 0
  const cache = createRoomPreviewCache(async (_options, signal) => {
    renders++
    return signal ? new Promise((resolve) => { finishBackground = resolve }) : images('foreground')
  })
  const controller = new AbortController()
  const background = cache.preload(options(), 'home-a', controller.signal)
  const foreground = await cache.render(options(), 'home-a')
  controller.abort()
  finishBackground(images('cancelled'))
  await assert.rejects(background, (cause) => cause === controller.signal.reason)
  assert.equal(cache.read(options(), 'home-a'), foreground)
  assert.equal(renders, 2)
})

test('aborted preloads never start rendering and foreground work is not duplicated by warming', async () => {
  let renders = 0
  let finish!: (result: ReturnType<typeof images>) => void
  const cache = createRoomPreviewCache(async () => {
    renders++
    return new Promise((resolve) => { finish = resolve })
  })
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(cache.preload(options(), 'home-a', aborted.signal), (cause) => cause === aborted.signal.reason)
  assert.equal(renders, 0)
  const foreground = cache.render(options(), 'home-a')
  const background = new AbortController()
  await cache.preload(options(), 'home-a', background.signal)
  background.abort()
  assert.equal(renders, 1)
  finish(images('ready'))
  assert.deepEqual(await foreground, images('ready'))
})
