import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import type { BrowserNotificationSettings, NotificationPreferences } from '../shared/notifications.ts'
import { errorMessage } from './api.ts'
import { browserPushSupport, browserSettings, currentSubscription, disableBrowserPush, enableBrowserPush, saveBrowserPreferences } from './browserPush.ts'
import { Feedback } from './Feedback.tsx'

export function BrowserAlerts({ householdId, csrfToken }: { householdId: string; csrfToken: string | null | undefined }) {
  const support = browserPushSupport()
  const [settings, setSettings] = useState<BrowserNotificationSettings | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const [next, subscription] = await Promise.all([browserSettings(householdId, controller.signal), currentSubscription()])
        if (controller.signal.aborted) return
        setSettings(next)
        setEnabled(!!subscription && Notification.permission === 'granted')
      } catch (failure) {
        if (!controller.signal.aborted) setError(errorMessage(failure, 'Could not check browser alerts. Reopen notifications to try again.'))
      }
    })()
    return () => controller.abort()
  }, [householdId])
  if (!settings && !error) return null
  if (settings && !settings.available) return null
  const run = async (change: () => Promise<void>, fallback: string) => {
    setBusy(true)
    setError('')
    try { await change() } catch (failure) { setError(errorMessage(failure, fallback)) } finally { setBusy(false) }
  }
  const toggle = (key: keyof NotificationPreferences) => {
    if (!settings) return
    const previous = settings
    const preferences = { ...settings.preferences, [key]: !settings.preferences[key] }
    setSettings({ ...settings, preferences })
    void run(async () => {
      try { setSettings(await saveBrowserPreferences(householdId, csrfToken, preferences)) } catch (failure) {
        setSettings(previous)
        throw failure
      }
    }, 'Could not save alert settings. Try again.')
  }
  const blocked = support === 'supported' && Notification.permission === 'denied'
  return <section className="browser-alerts" aria-label="Alerts in this browser">
    <div className="browser-alerts-row">
      <span className="inbox-icon"><BellRing size="1rem" /></span>
      <span className="inbox-text"><strong>Alerts in this browser</strong>
        <small>{support === 'insecure' ? 'Open Roomlings over HTTPS or localhost to allow alerts.'
          : support === 'unsupported' ? 'This browser cannot show Roomlings alerts.'
            : blocked ? 'Blocked in your browser settings for this site.'
              : enabled ? 'On. Chore turns and shared money reach this browser.' : 'Get your chore turns and shared money as alerts.'}</small></span>
      {settings && support === 'supported' && !blocked && (enabled
        ? <button type="button" className="button secondary small-button" disabled={busy}
          onClick={() => void run(async () => { await disableBrowserPush(csrfToken); setEnabled(false) }, 'Could not turn off alerts. Try again.')}>Turn off</button>
        : <button type="button" className="button small-button" disabled={busy || !settings.publicKey}
          onClick={() => void run(async () => { await enableBrowserPush(settings.publicKey!, csrfToken); setEnabled(true) }, 'Could not turn on alerts. Try again.')}>Turn on</button>)}
    </div>
    {settings && enabled && <div className="browser-alerts-options" role="group" aria-label="Alert types">
      <label><input type="checkbox" checked={settings.preferences.chores} disabled={busy} onChange={() => toggle('chores')} />Chores</label>
      <label><input type="checkbox" checked={settings.preferences.money} disabled={busy} onChange={() => toggle('money')} />Money</label>
    </div>}
    {error && <Feedback inline onDismiss={() => setError('')}>{error}</Feedback>}
  </section>
}
