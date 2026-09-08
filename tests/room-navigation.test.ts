import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultRoom, resolveEntry, roomCatalog, roomPath } from '../src/roomNavigation.ts'
import { roomViews } from '../src/roomViews.ts'

test('the public home and personal rooms are distinct entries', () => {
  assert.deepEqual(resolveEntry('/'), { kind: 'home' })
  assert.deepEqual(resolveEntry('/welcome/'), { kind: 'home' })
  assert.deepEqual(resolveEntry('/', '#questions'), { kind: 'home' })
  assert.deepEqual(resolveEntry(roomPath()), { kind: 'room', roomId: defaultRoom })
  assert.deepEqual(resolveEntry('/rooms'), resolveEntry(roomPath()))
  assert.deepEqual(resolveEntry(roomPath('bathroom')), { kind: 'room', roomId: 'bathroom' })
  assert.deepEqual(resolveEntry('/', '#tour-bathroom'), { kind: 'home' })
})

test('registered rooms have implementations and unknown rooms never open a placeholder', () => {
  assert.deepEqual(Object.keys(roomViews), Object.keys(roomCatalog))
  for (const path of ['/rooms/bedroom', '/sample', '/sample/', '/sample/kitchen', '/sample/bathroom', '/sample/bedroom', '/rooms/toString', '/rooms/kitchen/unknown', '/unknown']) {
    assert.deepEqual(resolveEntry(path), { kind: 'unavailable' })
  }
})

test('old kitchen links and account/invitation/recovery fragments remain usable', () => {
  assert.deepEqual(resolveEntry('/kitchen'), { kind: 'legacy', roomId: defaultRoom })
  for (const hash of ['#account', '#account=create', '#account-invite=example', '#join=example', '#recover']) {
    assert.deepEqual(resolveEntry('/', hash), { kind: 'legacy', roomId: defaultRoom })
  }
})
