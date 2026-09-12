export function isIosDevice(device: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  const mobileIdentity = /\b(iPhone|iPad)\b/
  if (mobileIdentity.test(device.userAgent) || mobileIdentity.test(device.platform)) return true
  // iPadOS desktop mode reports a Mac identity while retaining multi-touch.
  return device.platform === 'MacIntel' && device.maxTouchPoints > 1
    && /\bMacintosh\b/.test(device.userAgent)
}
