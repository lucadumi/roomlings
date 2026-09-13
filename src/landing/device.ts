export type LandingDevice = 'desktop' | 'ios' | 'mobile'

type DeviceIdentity = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>

const appleHandheld = /\b(iPhone|iPad|iPod)\b/
const handheld = /\b(Android|Mobile|Tablet|Windows Phone|KaiOS)\b/

export function isIosDevice(device: DeviceIdentity): boolean {
  if (appleHandheld.test(device.userAgent) || appleHandheld.test(device.platform)) return true
  // iPadOS desktop mode reports a Mac identity while retaining multi-touch.
  return device.platform === 'MacIntel' && device.maxTouchPoints > 1
    && /\bMacintosh\b/.test(device.userAgent)
}

// Phones and tablets use the iOS app, never the browser household.
export function landingDevice(device: DeviceIdentity): LandingDevice {
  if (isIosDevice(device)) return 'ios'
  return handheld.test(device.userAgent) || handheld.test(device.platform) ? 'mobile' : 'desktop'
}
