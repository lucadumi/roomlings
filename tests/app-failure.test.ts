import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { appFailureKind, hasUnconfirmedWrites, reportAppFailure, trackWrite } from '../src/appFailure.ts'

describe('top-level app failures', () => {
  it('counts a save as unconfirmed only until it settles', async () => {
    let finish!: () => void
    const save = trackWrite(() => new Promise<void>((resolve) => { finish = resolve }))
    assert.equal(hasUnconfirmedWrites(), true)
    finish()
    await save
    assert.equal(hasUnconfirmedWrites(), false)
    await assert.rejects(trackWrite(() => Promise.reject(new Error('offline'))))
    assert.equal(hasUnconfirmedWrites(), false)
  })

  it('separates failed module loads from render failures', () => {
    assert.equal(appFailureKind(new TypeError('Failed to fetch dynamically imported module: /src/App.tsx')), 'load')
    assert.equal(appFailureKind(new TypeError('Importing a module script failed.')), 'load')
    assert.equal(appFailureKind(new Error('Cannot read properties of undefined')), 'render')
    assert.equal(appFailureKind('thrown text'), 'render')
  })

  it('reports only the failure kind and error class', (context) => {
    const logged = context.mock.method(console, 'error', () => {})
    reportAppFailure('render', new Error('Ada owes Ben 12.00 in The household with token abc'))
    const custom = new Error('secret')
    custom.name = 'Token abc123 for Ada'
    reportAppFailure('load', custom)
    assert.deepEqual(logged.mock.calls.map((call) => call.arguments), [
      ['Roomlings could not open (render: Error).'],
      ['Roomlings could not open (load: Error).'],
    ])
  })
})
