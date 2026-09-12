import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isIosDevice } from '../src/landing/device.ts'

const mac = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 0,
}

describe('iOS landing device detection', () => {
  it('recognizes iPhone and iPad user agents independently of touch and viewport emulation', () => {
    for (const device of ['iPhone', 'iPad']) {
      assert.equal(isIosDevice({
        userAgent: `Mozilla/5.0 (${device}; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15`,
        platform: 'MacIntel',
        maxTouchPoints: 1,
      }), true)
    }
  })

  it('recognizes an iOS platform when the user agent uses a desktop identity', () => {
    for (const platform of ['iPhone', 'iPad']) {
      assert.equal(isIosDevice({ ...mac, platform, maxTouchPoints: 5 }), true)
    }
  })

  it('recognizes desktop-mode iPads without relying on a coarse primary pointer', () => {
    for (const maxTouchPoints of [2, 5, 10]) {
      assert.equal(isIosDevice({ ...mac, maxTouchPoints }), true)
    }
  })

  it('keeps desktop Macs and single-touch emulation on the web landing', () => {
    for (const maxTouchPoints of [0, 1]) {
      assert.equal(isIosDevice({ ...mac, maxTouchPoints }), false)
    }
  })

  it('does not mistake Android, touch laptops or narrow desktop windows for iOS', () => {
    for (const device of [
      { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)', platform: 'Linux armv8l', maxTouchPoints: 5 },
      { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet)', platform: 'Linux armv8l', maxTouchPoints: 10 },
      { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 10 },
      { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64', maxTouchPoints: 0 },
      { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)', platform: 'MacIntel', maxTouchPoints: 5 },
    ]) {
      assert.equal(isIosDevice(device), false)
    }
  })
})
