import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, KeyRound, LogOut, RefreshCw } from 'lucide-react'
import { accessStateSchema, deviceNameInputSchema, recoverInputSchema, recoveryRotationSchema } from '../shared/access.ts'
import type { AccessState, Device } from '../shared/access.ts'
import { errorMessage, request, RequestError } from './api.ts'
import { CopyField, Form, Modal } from './components.tsx'
import { LoadingIcon } from './Branding.tsx'
import { Feedback, FeedbackAction } from './Feedback.tsx'
import './access.css'

function currentDevice(access: AccessState): Device {
  const device = access.devices.find((device) => device.current)
  if (!device) throw new Error('Current browser missing. Refresh browser access.')
  return device
}

function activityTime(value: string | null): string {
  return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not recorded for this older session'
}

export function AccessDialog({ token, memberName, householdName, onClose, onRecover, onExpired }: {
  token: string; memberName: string; householdName: string; onClose: () => void
  onRecover: () => void; onExpired: (message: string) => void
}) {
  const [access, setAccess] = useState<AccessState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [mode, setMode] = useState<'main' | 'replace' | 'code' | 'revoke'>('main')
  const [target, setTarget] = useState<Device | null>(null)
  const [revokeOthers, setRevokeOthers] = useState(true)
  const [refreshId, setRefreshId] = useState(0)
  const content = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  const activeToken = useRef(token)
  const expired = useRef(onExpired)
  const savedLabel = useRef('')
  activeToken.current = token
  expired.current = onExpired

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let timedOut = false
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, 15_000)
    setLoading(true)
    request('/access', { token, signal: controller.signal }).then((result) => {
      if (!active) return
      const next = accessStateSchema.parse(result)
      const name = currentDevice(next).label
      const previousName = savedLabel.current
      setAccess(next)
      setLabel((previous) => previous === previousName ? name : previous)
      savedLabel.current = name
    }).catch((failure: unknown) => {
      if (!active) return
      if (timedOut) setError('Browser access timed out. Try again.')
      else if (failure instanceof RequestError && failure.status === 401) expired.current(failure.message)
      else setError(errorMessage(failure, 'Could not load browser access. Try again.'))
    }).finally(() => {
      clearTimeout(timeout)
      if (active) setLoading(false)
    })
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [token, refreshId])
  const ready = access !== null
  useEffect(() => {
    content.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus()
  }, [mode, ready])

  const mutate = async (operation: 'name' | 'code' | 'revoke') => {
    if (!access || busy || loading) return
    if (operation === 'name') {
      const input = deviceNameInputSchema.safeParse({ label })
      if (!input.success) { setError(input.error.issues[0].message); return }
    }
    if (operation === 'revoke' && !target) { setError('Choose the browser session to sign out.'); return }
    setBusy(true)
    setError('')
    setNotice('')
    if (operation === 'code') setSecret(null)
    try {
      if (operation === 'code') {
        const result = recoveryRotationSchema.parse(await request('/access/recovery', {
          token, body: { version: access.recovery.version, revokeOthers: access.recovery.enabled && revokeOthers },
        }))
        if (!mounted.current || activeToken.current !== token) return
        setAccess(result.access)
        setSecret(result.code)
        setMode('code')
      } else {
        const result = operation === 'name'
          ? await request('/access/device', { token, method: 'PATCH', body: { label } })
          : await request(`/access/devices/${target?.id}`, { token, method: 'DELETE' })
        if (!mounted.current || activeToken.current !== token) return
        const next = accessStateSchema.parse(result)
        setAccess(next)
        if (operation === 'name') {
          const name = currentDevice(next).label
          savedLabel.current = name
          setLabel(name)
        }
        setMode('main')
        setTarget(null)
        setNotice(operation === 'name' ? 'Browser name saved.' : 'Browser session signed out.')
      }
    } catch (failure) {
      if (!mounted.current || activeToken.current !== token) return
      if (failure instanceof RequestError && failure.status === 401) expired.current(failure.message)
      else {
        setError(errorMessage(failure, 'Access change not confirmed. Try again.'))
        if (failure instanceof RequestError && (failure.status === 409 || failure.status === 404)) {
          setMode('main')
          setRefreshId((value) => value + 1)
        }
      }
    } finally {
      if (mounted.current && activeToken.current === token) setBusy(false)
    }
  }

  const back = () => { setSecret(null); setTarget(null); setError(''); setMode('main') }
  return <Modal
    title={mode === 'code' ? 'Save your recovery code.' : mode === 'replace' ? 'Replace your recovery code?' : mode === 'revoke' ? 'Sign out this browser?' : 'Your browser access.'}
    subtitle={`${memberName} in ${householdName}. These controls only manage your own roommate identity.`}
    onClose={onClose} busy={busy}
  >
    <div className="access-content" ref={content}>
      {error && <Feedback actions={!loading && !access
        ? <FeedbackAction aria-label="Retry browser access" onClick={() => { setError(''); setRefreshId((value) => value + 1) }}>Retry</FeedbackAction> : undefined}>{error}</Feedback>}
      {notice && <Feedback tone="success" className="access-notice">{notice}</Feedback>}
      {loading && !access && <p className="inline loading-status" role="status"><LoadingIcon size={20} />Loading browser access...</p>}
      {mode === 'code' && secret && <>
        <p className="field-hint">Anyone with this code can return as you. Save it in a password manager. It stays valid until you replace it, but it is only displayed here now.</p>
        <CopyField label="Your private recovery code" value={secret} buttonLabel="Copy recovery code" copiedLabel="Recovery code copied" />
        <button className="button secondary full" onClick={back}>I saved the code</button>
      </>}
      {access && mode === 'replace' && <>
        <p className="field-hint">Your previous recovery code will stop working. Keep this browser open until you have saved the replacement.</p>
        <label className="access-checkbox"><input type="checkbox" checked={revokeOthers} disabled={busy} onChange={(event) => setRevokeOthers(event.target.checked)} /><span>Also sign out my other saved browser sessions. This session stays signed in.</span></label>
        <div className="button-row"><button className="button secondary" disabled={busy} onClick={back}>Cancel</button><button className="button primary" disabled={busy || loading} onClick={() => { void mutate('code') }}>{busy ? 'Replacing...' : 'Confirm replacement'}</button></div>
      </>}
      {access && mode === 'revoke' && target && <>
        <p className="field-hint">Sign out <strong>{target.label}</strong>? This does not remove your roommate identity or change expenses, bills or balances.</p>
        <p className="field-hint">If the recovery code was also exposed, replace it as well.</p>
        <div className="button-row"><button className="button secondary" disabled={busy} onClick={back}>Cancel</button><button className="button primary" disabled={busy || loading} onClick={() => { void mutate('revoke') }}>{busy ? 'Signing out...' : 'Sign out browser'}</button></div>
      </>}
      {access && mode === 'main' && <>
        <Form onSubmit={() => { void mutate('name') }}>
          <label className="field">Name this browser<input required maxLength={50} value={label} disabled={busy || loading} autoComplete="off" onChange={(event) => setLabel(event.target.value)} /></label>
          <button className="button secondary full" disabled={busy || loading || !label.trim() || label.trim() === currentDevice(access).label}><Check size={15} />Save browser name</button>
        </Form>
        <section className="access-section">
          <h3>Recovery code</h3>
          <p className="field-hint">{access.recovery.enabled ? 'Your recovery code is active. Use it on another browser to return as the same roommate, with the same ledger history.' : 'Create a private recovery code before you lose browser access. It restores this roommate identity, not a new member.'}</p>
          <button className="button primary full" disabled={busy || loading} onClick={() => {
            if (access.recovery.enabled) { setError(''); setRevokeOthers(true); setMode('replace') }
            else void mutate('code')
          }}><KeyRound size={16} />{access.recovery.enabled ? 'Replace recovery code' : 'Generate recovery code'}</button>
        </section>
        <section className="access-section">
          <div className="access-heading"><h3>Signed-in browsers</h3><button className="icon-button control-surface" aria-label="Refresh browser sessions" disabled={busy || loading} onClick={() => { setError(''); setNotice(''); setRefreshId((value) => value + 1) }}>{loading ? <LoadingIcon size={16} /> : <RefreshCw size={16} />}</button></div>
          <ul className="device-list">
            {access.devices.map((device) => <li key={device.id} className="device-row">
              <div><strong>{device.label}</strong>{device.current && <span className="device-current">This browser</span>}<small>Last active: {activityTime(device.lastUsedAt)}</small><small>Added: {activityTime(device.createdAt)}</small></div>
              {!device.current && <button className="button secondary small-button" disabled={busy || loading} aria-label={`Sign out ${device.label}`} onClick={() => { setError(''); setTarget(device); setMode('revoke') }}><LogOut size={14} />Sign out</button>}
            </li>)}
          </ul>
        </section>
      </>}
      {mode === 'main' && <button className="text-button" disabled={busy} onClick={onRecover}>Use a recovery code</button>}
    </div>
  </Modal>
}

export function RecoveryForm({ busy, error, onSubmit }: {
  busy: boolean; error: ReactNode; onSubmit: (body: Record<string, unknown>) => void
}) {
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('New browser')
  const [localError, setLocalError] = useState('')
  return <Form onSubmit={() => {
    const input = recoverInputSchema.safeParse({ code, label })
    if (!input.success) { setLocalError(input.error.issues[0].message); return }
    setLocalError('')
    onSubmit(input.data)
  }}>
    <label className="field">Recovery code<input type="password" required value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
    <label className="field">Name this browser<input required maxLength={50} value={label} onChange={(event) => setLabel(event.target.value)} disabled={busy} autoComplete="off" /></label>
    <p className="field-hint">Use the private code saved from your original roommate profile. It is not a kitchen invitation.</p>
    {localError && <Feedback>{localError}</Feedback>}{error}
    <button className="button primary full" disabled={busy}>{busy ? <LoadingIcon size={17} tone="light" /> : <KeyRound size={17} />}{busy ? 'Restoring access...' : 'Recover my access'}</button>
  </Form>
}
