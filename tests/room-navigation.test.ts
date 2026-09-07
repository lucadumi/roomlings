import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultRoom, resolveEntry, roomCatalog, roomPath, samplePath } from '../src/roomNavigation.ts'
import { roomViews } from '../src/roomViews.ts'

test('the public home, personal room and anonymous sample are distinct entries', () => {
  assert.deepEqual(resolveEntry('/'), { kind: 'home' })
  assert.deepEqual(resolveEntry('/welcome/'), { kind: 'home' })
  assert.deepEqual(resolveEntry('/', '#questions'), { kind: 'home' })
  assert.deepEqual(resolveEntry(roomPath()), { kind: 'room', roomId: defaultRoom })
  assert.deepEqual(resolveEntry(samplePath()), { kind: 'sample', roomId: defaultRoom })
  assert.deepEqual(resolveEntry('/rooms'), resolveEntry(roomPath()))
  assert.deepEqual(resolveEntry('/sample/'), resolveEntry(samplePath()))
})

test('registered rooms have implementations and unknown rooms never open a placeholder', () => {
  assert.deepEqual(Object.keys(roomViews), Object.keys(roomCatalog))
  for (const path of ['/rooms/bathroom', '/sample/bathroom', '/rooms/toString', '/rooms/kitchen/unknown', '/unknown']) {
    assert.deepEqual(resolveEntry(path), { kind: 'unavailable' })
  }
})

test('old kitchen links and account/invitation/recovery fragments remain usable', () => {
  assert.deepEqual(resolveEntry('/kitchen'), { kind: 'legacy', roomId: defaultRoom })
  for (const hash of ['#account', '#account=create', '#account-invite=example', '#join=example', '#recover']) {
    assert.deepEqual(resolveEntry('/', hash), { kind: 'legacy', roomId: defaultRoom })
  }
})
