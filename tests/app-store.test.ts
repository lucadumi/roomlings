import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { appStoreUrl } from '../src/landing/appStore.ts'

describe('App Store listing link', () => {
  it('accepts only secure App Store listing URLs', () => {
    assert.equal(appStoreUrl('https://apps.apple.com/app/roomlings/id1234567890'), 'https://apps.apple.com/app/roomlings/id1234567890')
    assert.equal(appStoreUrl('  https://apps.apple.com/us/app/id1  '), 'https://apps.apple.com/us/app/id1')
  })

  it('treats a missing or unexpected value as not yet available', () => {
    for (const value of [undefined, null, '', '   ', 42, 'not a url', 'http://apps.apple.com/app/id1',
      'https://apps.apple.com.example.test/app/id1', 'https://example.test/app', 'https://user:pass@apps.apple.com/app/id1',
      'javascript:alert(1)']) {
      assert.equal(appStoreUrl(value), null, String(value))
    }
  })
})
