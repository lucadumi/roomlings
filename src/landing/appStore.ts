// The App Store listing is configured at build time with VITE_APP_STORE_URL.
// Until it is set, the landing shows the app as coming soon instead of a dead link.
export function appStoreUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && url.hostname === 'apps.apple.com' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
