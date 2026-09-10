import { useState } from 'react'
import { KeyRound, RefreshCw } from 'lucide-react'
import { accountRecoveryCodeCount, accountRecoverySignInSchema } from '../shared/accounts.ts'
import type { AccountRecoverySignIn as AccountRecoveryInput, AccountRecoveryState } from '../shared/accounts.ts'
import { CopyField, Form } from './components.tsx'
import { LoadingIcon } from './Branding.tsx'
import { Feedback } from './Feedback.tsx'

export function AccountRecoveryPanel({ recovery, codes, busy, onGenerate, onRevoke, onRefresh, onSaved }: {
  recovery: AccountRecoveryState; codes: string[]; busy: boolean
  onGenerate: () => void; onRevoke: () => void; onRefresh: () => void; onSaved: () => void
}) {
  if (codes.length) return <>
    <p className="field-hint">Save these codes in your password manager or another private place. Each code signs in to your account once, without an email code. Anyone with a code and your email can access your account.</p>
    <p className="field-hint"><strong>This is the only time these codes are shown.</strong> They are not saved in browser storage and cannot be displayed again after you leave this screen.</p>
    <CopyField multiline label="Your account recovery codes" value={codes.join('\n')}
      buttonLabel="Copy all recovery codes" copiedLabel="Recovery codes copied" />
    <button className="button secondary full" disabled={busy} onClick={onSaved}>I saved these codes</button>
  </>
  return <>
    <div className="access-heading">
      <h3>{recovery.remaining} unused recovery {recovery.remaining === 1 ? 'code' : 'codes'}</h3>
      <button className="icon-button control-surface" disabled={busy} aria-label="Refresh recovery code status" onClick={onRefresh}><RefreshCw size={16} /></button>
    </div>
    <p className="field-hint">Account recovery codes are a backup when email sign-in is unavailable. They restore your existing account and memberships, without creating another roommate or signing out your other devices.</p>
    <p className="field-hint">Generate {accountRecoveryCodeCount} single-use codes and keep them somewhere private. You may need to sign in again before changing them.</p>
    {recovery.updatedAt && <p className="field-hint">Last changed: {new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(recovery.updatedAt))}</p>}
    <button className="button primary full" disabled={busy} onClick={onGenerate}>
      {busy ? <LoadingIcon size={17} tone="light" /> : <KeyRound size={17} />}
      {recovery.remaining ? 'Replace recovery codes' : 'Generate recovery codes'}
    </button>
    {recovery.remaining > 0 && <button className="text-button" disabled={busy} onClick={onRevoke}>Revoke recovery codes</button>}
  </>
}

export function AccountRecoverySignIn({ busy, initialEmail, fixedEmail = false, onSubmit, onEmail }: {
  busy: boolean; initialEmail: string; fixedEmail?: boolean
  onSubmit: (body: AccountRecoveryInput) => Promise<boolean>; onEmail: (email: string) => void
}) {
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('Saved browser')
  const [error, setError] = useState('')
  return <Form onSubmit={() => {
    const input = accountRecoverySignInSchema.safeParse({ email, code, label })
    if (!input.success) { setError(input.error.issues[0].message); return }
    setError('')
    void onSubmit(input.data).then((success) => { if (success) setCode('') })
  }}>
    <p className="field-hint">Use one unused code saved from your account recovery-code list. This is not an email code or a browser-only kitchen recovery code. A successful sign-in uses the code once and keeps your existing account and kitchens.</p>
    <label className="field">Email address<input type="email" required autoComplete="email" maxLength={254}
      value={email} disabled={busy || fixedEmail} onChange={(event) => setEmail(event.target.value)} /></label>
    <label className="field">Account recovery code<input type="password" required autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={80}
      value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /></label>
    <label className="field">Name this browser<input required autoComplete="off" maxLength={50}
      value={label} disabled={busy} onChange={(event) => setLabel(event.target.value)} /></label>
    {error && <Feedback>{error}</Feedback>}
    <button className="button primary full" disabled={busy}>{busy ? <LoadingIcon size={17} tone="light" /> : <KeyRound size={17} />}Recover my account</button>
    <button type="button" className="text-button" disabled={busy} onClick={() => onEmail(email)}>Use email sign-in</button>
  </Form>
}
