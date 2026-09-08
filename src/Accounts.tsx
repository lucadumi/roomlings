import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Check, Home, KeyRound, LogOut, Mail, Plus, RefreshCw, Users } from 'lucide-react'
import { z } from 'zod'
import {
  acceptAccountInvitationSchema, accountInvitationResultSchema, accountRecoveryResultSchema, accountRecoveryStateSchema, accountStateSchema,
  createAccountHouseholdSchema, deleteAccountSchema, householdAccessSchema, linkAccountSchema,
  sendAccountCodeSchema, verifyAccountCodeSchema,
} from '../shared/accounts.ts'
import type { AccountRecoveryState, AccountState, CreateAccountHousehold, HouseholdAccess } from '../shared/accounts.ts'
import type { Session } from '../shared/domain.ts'
import { nameSchema } from '../shared/domain.ts'
import { getAccountState, request, RequestError } from './api.ts'
import type { SavedKitchen, SavedKitchenChange } from './api.ts'
import { CopyField, Form, Modal } from './components.tsx'
import { LoadingIcon } from './Branding.tsx'
import { CreateKitchenForm } from './CreateKitchenForm.tsx'
import { AccountRecoveryPanel, AccountRecoverySignIn } from './AccountRecovery.tsx'
import './access.css'

export type AccountIntent = 'manage' | 'create' | 'join'
export type AccountChange = 'refresh' | 'select' | 'signed-out' | 'deleting'
type AccountView = AccountIntent | 'link' | 'household' | 'recovery'
const accessIntent = (view: AccountView): AccountView => view === 'create' || view === 'join' ? view : 'manage'
type Confirmation = {
  title: string; description: string; button: string; email?: boolean
  action: (confirmation: string) => Promise<void>
}

const dateTime = (value: string) => new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value))

function browserKitchens(session: Session | null, saved: SavedKitchen[]): SavedKitchen[] {
  const current = session ? [{
    token: session.token, householdId: session.household.id, memberId: session.memberId,
    name: session.household.name,
    memberName: session.household.members.find((member) => member.id === session.memberId)?.name ?? 'Saved roommate',
  }] : []
  return [...current, ...saved.filter((kitchen) => kitchen.token !== session?.token
    && (kitchen.householdId !== session?.household.id || kitchen.memberId !== session?.memberId))]
}

export function AccountDialog({
  intent = 'manage', initialInvite = '', initialState, legacySession, savedLegacy, onChange, onClose, onRecover, onOpenLegacy, onLegacyChange, autoEnter = false,
}: {
  intent?: AccountIntent; initialInvite?: string; legacySession: Session | null; savedLegacy: SavedKitchen[]
  autoEnter?: boolean
  initialState: AccountState | null
  onChange: (state: AccountState, change: AccountChange) => void; onClose: () => void; onRecover: () => void
  onOpenLegacy: (kitchen: SavedKitchen) => Promise<boolean>
  onLegacyChange: (token: string, change: SavedKitchenChange) => void
}) {
  const [state, setState] = useState<AccountState | null>(initialState)
  const [view, setView] = useState<AccountView>(intent)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshId, setRefreshId] = useState(0)
  const [access, setAccess] = useState<HouseholdAccess | null>(null)
  const [inviteSecret, setInviteSecret] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [confirmationEmail, setConfirmationEmail] = useState('')
  const [reauthenticate, setReauthenticate] = useState(false)
  const [recoverySignIn, setRecoverySignIn] = useState(false)
  const [signInEmail, setSignInEmail] = useState('')
  const [recovery, setRecovery] = useState<AccountRecoveryState | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [pendingDeletion, setPendingDeletion] = useState(initialState?.deletionPending ?? false)
  const pending = useRef(pendingDeletion)
  const [legacy, setLegacy] = useState(() => browserKitchens(legacySession, savedLegacy))
  const retired = useRef(new Set<string>())
  const mounted = useRef(false)
  const working = useRef(false)
  const creation = useRef<{ accountId: string; input: CreateAccountHousehold } | null>(null)
  const contextEpoch = useRef(0)
  const latest = useRef(state)
  const change = useRef(onChange)
  const content = useRef<HTMLDivElement>(null)
  const recoveryInput = useRef<HTMLInputElement>(null)
  latest.current = state
  pending.current = pendingDeletion
  change.current = onChange

  const acceptState = (next: AccountState, kind: AccountChange) => {
    if (!mounted.current) return
    setPendingDeletion(next.deletionPending ?? false)
    if (next.deletionPending) {
      kind = 'deleting'
      setConfirmation(null)
      setReauthenticate(false)
      setRecoverySignIn(false)
      setRecoveryCodes([])
      setRecovery(null)
    }
    const previous = latest.current
    const accountChanged = previous?.account?.id !== next.account?.id
    if (kind === 'signed-out' || kind === 'deleting' || (next.account && creation.current?.accountId !== next.account.id)) creation.current = null
    const deviceChanged = previous?.devices.find((device) => device.current)?.id !== next.devices.find((device) => device.current)?.id
    if (accountChanged || !next.account || (access && !next.memberships.some((membership) => membership.householdId === access.household.id))) {
      setAccess(null)
      setConfirmation(null)
      setInviteSecret('')
      setView(accessIntent)
    }
    if (!next.account || accountChanged || deviceChanged) setRecoveryCodes([])
    if (!next.account || accountChanged || (kind === 'refresh' && deviceChanged)) setRecovery(null)
    if (previous?.account && (accountChanged || (kind === 'refresh' && deviceChanged))) setView(accessIntent)
    const removed = previous?.memberships.filter((membership) => kind === 'signed-out'
      || (previous.account?.id === next.account?.id && next.account !== null
        && !next.memberships.some((current) => current.householdId === membership.householdId && current.memberId === membership.memberId))) ?? []
    for (const membership of removed) retired.current.add(`${membership.householdId}:${membership.memberId}`)
    if (removed.length) setLegacy((kitchens) => kitchens.filter((kitchen) => !retired.current.has(`${kitchen.householdId}:${kitchen.memberId}`)))
    latest.current = next
    setState(next)
    change.current(next, kind)
  }
  useEffect(() => {
    const previous = latest.current
    if (!initialState || initialState === previous) return
    setPendingDeletion(initialState.deletionPending ?? false)
    if (initialState.deletionPending) {
      setConfirmation(null)
      setRecoveryCodes([])
      setRecovery(null)
    }
    if (initialState.account?.id === previous?.account?.id
      && initialState.devices.find((device) => device.current)?.id === previous?.devices.find((device) => device.current)?.id) {
      latest.current = initialState
      setState(initialState)
      if (access && !initialState.memberships.some((membership) => membership.householdId === access.household.id)) {
        setAccess(null)
        setConfirmation(null)
        setInviteSecret('')
        setView(accessIntent)
      }
      return
    }
    contextEpoch.current++
    working.current = false
    latest.current = initialState
    setState(initialState)
    setBusy(false)
    setLoading(false)
    setConfirmation(null)
    setAccess(null)
    setReauthenticate(false)
    setRecoverySignIn(false)
    setSignInEmail('')
    setRecovery(null)
    setRecoveryCodes([])
    setView(accessIntent)
    setInviteSecret('')
    setError('')
    if (!initialState.account) {
      setNotice(pending.current
        ? 'Account access has ended. Any queued deletion continues on the server until it succeeds.'
        : 'Your account session has ended. Sign in again to continue.')
    }
  }, [initialState])
  useEffect(() => {
    setLegacy((previous) => {
      const seen = new Set<string>()
      return [...browserKitchens(legacySession, savedLegacy), ...previous].filter((kitchen) => {
        if (retired.current.has(`${kitchen.householdId}:${kitchen.memberId}`) || seen.has(kitchen.token)) return false
        seen.add(kitchen.token)
        return true
      })
    })
  }, [legacySession, savedLegacy])
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    const epoch = contextEpoch.current
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
    setLoading(true)
    getAccountState(signal).then(async (next) => {
      if (controller.signal.aborted || contextEpoch.current !== epoch) return
      const sameAccount = next.account?.id === latest.current?.account?.id
      const ended = pending.current && next.account === null
      acceptState(next, ended ? 'signed-out' : 'refresh')
      if (next.deletionPending) return
      if (ended) { setView('manage'); setError(''); setNotice('Account access has ended. Any queued deletion continues on the server until it succeeds.') }
      if (sameAccount && next.account && view === 'household' && access
        && next.memberships.some((membership) => membership.householdId === access.household.id)) {
        const fresh = householdAccessSchema.parse(await request(`/account/households/${access.household.id}`, { signal }))
        if (!controller.signal.aborted && contextEpoch.current === epoch) acceptAccess(fresh)
      } else if (sameAccount && next.account && view === 'recovery') {
        const fresh = accountRecoveryStateSchema.parse(await request('/account/recovery', { signal }))
        if (!controller.signal.aborted && contextEpoch.current === epoch) {
          setRecovery(fresh)
          setRecoveryCodes([])
        }
      }
    }).catch((failure: unknown) => {
      if (controller.signal.aborted || contextEpoch.current !== epoch) return
      setError(failure instanceof Error ? failure.message : 'Account access could not be loaded.')
      if (failure instanceof RequestError && failure.code === 'ACCOUNT_DELETION_PENDING') {
        setPendingDeletion(true)
        setRecoveryCodes([])
        setRecovery(null)
        if (latest.current) change.current(latest.current, 'deleting')
      } else if (failure instanceof RequestError && failure.status === 401 && latest.current) {
        acceptState({
          configured: latest.current.configured, account: null, memberships: [], devices: [], csrfToken: null, session: null,
        }, 'refresh')
      }
    }).finally(() => { if (!controller.signal.aborted && contextEpoch.current === epoch) setLoading(false) })
    return () => { mounted.current = false; controller.abort() }
  }, [refreshId])
  useEffect(() => {
    if (!loading) content.current?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), button:not([disabled])')?.focus()
  }, [view, loading, confirmation, reauthenticate, recoverySignIn, recoveryCodes.length, state?.account?.id])

  const run = async (operation: () => Promise<void>): Promise<boolean> => {
    if (working.current || loading) return false
    const epoch = contextEpoch.current
    working.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
      return contextEpoch.current === epoch
    } catch (failure) {
      if (mounted.current && contextEpoch.current === epoch) {
        setError(failure instanceof Error ? failure.message : 'Your account change could not be saved.')
        if (failure instanceof RequestError && failure.code === 'ACCOUNT_DELETION_PENDING') {
          setPendingDeletion(true)
          setConfirmation(null)
          setReauthenticate(false)
          setRecoverySignIn(false)
          setRecoveryCodes([])
          setRecovery(null)
          if (latest.current) change.current(latest.current, 'deleting')
        } else if (failure instanceof RequestError && failure.status === 401
          && (failure.code === 'ACCOUNT_SESSION_REQUIRED' || failure.code === 'REAUTHENTICATION_REQUIRED')) {
          setConfirmation(null)
          setReauthenticate(true)
          setRecoveryCodes([])
        } else if (failure instanceof RequestError && (failure.status === 409 || failure.status === 404)) {
          setConfirmation(null)
          setInviteSecret('')
          setRecoveryCodes([])
          setLoading(true)
          setRefreshId((value) => value + 1)
        }
      }
      return false
    } finally {
      if (contextEpoch.current === epoch) {
        working.current = false
        if (mounted.current) setBusy(false)
      }
    }
  }
  const accountRequest = async (path: string, options: Parameters<typeof request>[1] = {}): Promise<unknown> => {
    const epoch = contextEpoch.current
    const result = await request(path, options)
    if (!mounted.current || contextEpoch.current !== epoch) throw new DOMException('Account access changed during the request.', 'AbortError')
    return result
  }
  const accountAction = async (path: string, body: unknown, method = 'POST', kind: AccountChange = 'refresh') => {
    const next = accountStateSchema.parse(await accountRequest(path, { body, method, csrfToken: latest.current?.csrfToken }))
    acceptState(next, kind)
    return next
  }
  const acceptAccess = (next: HouseholdAccess) => {
    if (!mounted.current) return
    setAccess(next)
    const current = latest.current
    if (!current?.account) return
    acceptState({
      ...current,
      memberships: current.memberships.map((membership) => membership.householdId === next.household.id
        ? { ...membership, householdName: next.household.name, role: next.role } : membership),
      session: current.session?.household.id === next.household.id
        ? { ...current.session, household: next.household } : current.session,
    }, 'refresh')
  }
  const accessAction = async (path: string, body: unknown, method = 'POST') => {
    acceptAccess(householdAccessSchema.parse(await accountRequest(path, { body, method, csrfToken: latest.current?.csrfToken })))
  }
  const openHousehold = (id: string) => run(async () => {
    const next = householdAccessSchema.parse(await accountRequest(`/account/households/${id}`))
    if (!mounted.current) return
    acceptAccess(next)
    setInviteSecret('')
    setView('household')
  })
  const openRecovery = () => run(async () => {
    const next = accountRecoveryStateSchema.parse(await accountRequest('/account/recovery'))
    setRecovery(next)
    setRecoveryCodes([])
    setView('recovery')
  })
  const generateCodes = async (version: number) => {
    const result = accountRecoveryResultSchema.parse(await accountRequest('/account/recovery', {
      body: { version }, csrfToken: latest.current?.csrfToken,
    }))
    setRecovery(result.recovery)
    setRecoveryCodes(result.codes)
  }
  const revokeCodes = async (version: number) => {
    const next = accountRecoveryStateSchema.parse(await accountRequest('/account/recovery', {
      body: { version }, method: 'DELETE', csrfToken: latest.current?.csrfToken,
    }))
    setRecovery(next)
    setRecoveryCodes([])
    setNotice('Your unused account recovery codes have been revoked. Existing sessions are unchanged.')
  }
  const chooseSignIn = (useRecovery: boolean, email: string) => {
    setRecoverySignIn(useRecovery)
    setSignInEmail(email)
    setError('')
    setNotice('')
  }
  const finishSignIn = async (next: AccountState, message: string) => {
    setReauthenticate(false)
    setRecoverySignIn(false)
    setNotice(message)
    if (autoEnter && next.session && intent === 'manage' && view === 'manage' && !reauthenticate) {
      onClose()
      return
    }
    if (view === 'recovery') {
      setRecovery(accountRecoveryStateSchema.parse(await accountRequest('/account/recovery')))
    }
  }
  const navigate = (next: AccountView) => {
    creation.current = null
    setError('')
    setNotice('')
    setConfirmation(null)
    setConfirmationEmail('')
    setInviteSecret('')
    setRecoveryCodes([])
    setView(next)
  }
  const confirm = (next: Confirmation) => {
    setError('')
    setNotice('')
    setConfirmationEmail('')
    setConfirmation(next)
  }
  const signedOut = async (all: boolean) => {
    await accountAction('/account/logout', { all }, 'POST', 'signed-out')
    if (mounted.current) {
      setReauthenticate(false)
      setRecoverySignIn(false)
      setRecoveryCodes([])
      setRecovery(null)
      navigate('manage')
      setNotice(all ? 'Your account and linked browser sessions have been signed out.' : 'Your account is signed out on this browser.')
    }
  }
  const linkBrowserKitchen = async (kitchen: SavedKitchen) => {
    const epoch = contextEpoch.current
    try {
      await accountAction('/account/link', { token: kitchen.token }, 'POST', 'select')
      if (mounted.current) { navigate('manage'); setNotice('Your existing roommate identity is linked. Its history is unchanged.') }
    } catch (failure) {
      if (mounted.current && contextEpoch.current === epoch && failure instanceof RequestError
        && failure.code === 'BROWSER_ACCESS_EXPIRED') {
        const change: SavedKitchenChange = { expired: true }
        setLegacy((previous) => previous.map((saved) => saved.token === kitchen.token ? { ...saved, ...change } : saved))
        onLegacyChange(kitchen.token, change)
        setConfirmation(null)
      }
      throw failure
    }
  }

  const account = state?.account
  const browserLegacy = legacy
  const disabled = loading || busy
  const title = pendingDeletion ? 'Account deletion is pending.' : confirmation?.title ?? (recoverySignIn && (reauthenticate || !account) ? 'Recover your account.'
    : reauthenticate || !account ? 'Your place, on every device.' : view === 'recovery' ? 'Your account recovery codes.'
    : view === 'household' ? 'Who shares this kitchen?' : view === 'create' ? 'Make room for your people.'
      : view === 'join' ? 'There is a place for you.' : view === 'link' ? 'Keep your existing place.' : 'Your Roomlings account.')
  return <Modal title={title} subtitle="Account access and household membership. Your shared ledger stays the source of truth." onClose={onClose} busy={busy}>
    <div className="access-content" ref={content}>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="access-notice" role="status">{notice}</p>}
      {loading && <p className="inline loading-status" role="status"><LoadingIcon size={20} />Loading account access...</p>}
      {!loading && !state && !pendingDeletion && <button className="button secondary full" onClick={() => { setError(''); setRefreshId((value) => value + 1) }}>Try again</button>}
      {pendingDeletion && <>
        <p className="field-hint">Account access is disabled while deletion finishes. The server retries automatically at startup and every minute. This is not a completed deletion yet.</p>
        <button className="button secondary full" disabled={disabled} onClick={() => { setRefreshId((value) => value + 1) }}>Check deletion status</button>
        {state?.account && state.csrfToken && <button className="text-button" disabled={disabled} onClick={() => { void run(async () => {
          await accountAction('/account', { confirmation: state.account?.email }, 'DELETE', 'signed-out')
          if (mounted.current) { setPendingDeletion(false); navigate('manage'); setNotice('Your account deletion has completed.') }
        }) }}>Retry account deletion</button>}
      </>}
      {!loading && state && !state.configured && !account && <p className="field-hint">
        Email sign-in is not configured on this server yet. The server owner needs to complete the Supabase setup in the README.
        Your existing browser access and recovery codes still work.
      </p>}
      {!pendingDeletion && state?.configured && (!account || reauthenticate) && !confirmation && (recoverySignIn ? <AccountRecoverySignIn
        busy={disabled} initialEmail={account?.email ?? signInEmail} fixedEmail={!!account && reauthenticate}
        onEmail={(email) => chooseSignIn(false, email)}
        onSubmit={(body) => run(async () => {
          const next = await accountAction('/account/recover', body, 'POST', 'select')
          if (mounted.current) await finishSignIn(next, 'Your account is signed in. The recovery code has been used and cannot be reused.')
        })}
      /> : <EmailSignIn
        busy={disabled} initialEmail={account?.email ?? signInEmail} initialName={account?.name ?? browserLegacy[0]?.memberName ?? ''}
        fixedEmail={!!account && reauthenticate}
        onRecovery={(email) => chooseSignIn(true, email)}
        onSend={(email) => run(async () => {
          z.object({ sent: z.literal(true) }).parse(await accountRequest('/account/code', { body: { email } }))
          if (mounted.current) setNotice('Check your email for a one-time sign-in code.')
        })}
        onVerify={(body) => run(async () => {
          const next = await accountAction('/account/verify', body, 'POST', 'select')
          if (mounted.current) await finishSignIn(next, 'Your verified account is signed in.')
        })}
      />)}
      {confirmation && <Form onSubmit={() => {
        void run(async () => {
          await confirmation.action(confirmationEmail)
          if (mounted.current) setConfirmation(null)
        })
      }}>
        <p className="field-hint">{confirmation.description}</p>
        {confirmation.email && <label className="field">Confirm your email<input type="email" required autoComplete="off" value={confirmationEmail} disabled={disabled} onChange={(event) => setConfirmationEmail(event.target.value)} /></label>}
        <div className="button-row">
          <button type="button" className="button secondary" disabled={disabled} onClick={() => { setConfirmation(null); setError('') }}>Cancel</button>
          <button className="button primary" disabled={disabled}>{busy ? 'Saving...' : confirmation.button}</button>
        </div>
      </Form>}
      {!pendingDeletion && state && account && !reauthenticate && !confirmation && <>
        <p className="field-hint"><strong>{account.name}</strong><br />{account.email} (verified)</p>
        {view === 'manage' && <>
          <AccountProfile key={account.id} name={account.name} label={state.devices.find((device) => device.current)?.label ?? ''}
            busy={disabled}
            onName={(name) => { void run(async () => { await accountAction('/account', { name }, 'PATCH'); setNotice('Account name saved. Existing ledger names are unchanged.') }) }}
            onLabel={(label) => { void run(async () => { await accountAction('/account/device', { label }, 'PATCH'); setNotice('Browser name saved.') }) }} />
          <section className="access-section">
            <h3>Your kitchens</h3>
            {!state.memberships.length && <p className="field-hint">Create a kitchen, accept an invitation, or link your existing roommate identity. Linking keeps its original history.</p>}
            <ul className="device-list">{state.memberships.map((membership) => <li className="device-row" key={membership.householdId}>
              <div><strong>{membership.householdName}</strong><small>{membership.role === 'owner' ? 'Owner' : 'Member'}</small></div>
              <button className="button secondary small-button" disabled={disabled} aria-label={`Open ${membership.householdName}`} onClick={() => { void run(async () => {
                await accountAction(`/account/households/${membership.householdId}/select`, {}, 'POST', 'select')
                if (mounted.current) {
                  history.replaceState(null, '', `${location.pathname}${location.search}`)
                  onClose()
                }
              }) }}><Home size={14} />Open</button>
              <button className="text-button" disabled={disabled} aria-label={`Manage ${membership.householdName}`} onClick={() => { void openHousehold(membership.householdId) }}>Membership</button>
            </li>)}</ul>
            <button className="button secondary full" disabled={disabled} onClick={() => navigate('create')}><Plus size={16} />Create a kitchen</button>
            <button className="button secondary full" disabled={disabled} onClick={() => navigate('join')}><Users size={16} />Accept an invitation</button>
            <button className="text-button" disabled={disabled} onClick={() => navigate('link')}><KeyRound size={16} />Link existing kitchen access</button>
          </section>
          <section className="access-section">
            <div className="access-heading"><h3>Account sessions</h3><button className="icon-button control-surface" aria-label="Refresh account sessions" disabled={disabled} onClick={() => { setError(''); setRefreshId((value) => value + 1) }}><RefreshCw size={16} /></button></div>
            <ul className="device-list">{state.devices.map((device) => <li className="device-row" key={device.id}>
              <div><strong>{device.label}</strong>{device.current && <span className="device-current">This browser</span>}<small>Last active: {dateTime(device.lastUsedAt)}</small><small>Expires: {dateTime(device.expiresAt)}</small></div>
              {!device.current && <button className="button secondary small-button" disabled={disabled} aria-label={`Revoke ${device.label}`} onClick={() => confirm({
                title: 'Sign out that account session?', description: `This signs out ${device.label}. It does not remove household membership or change the ledger.`,
                button: 'Revoke session', action: async () => { await accountAction(`/account/devices/${device.id}`, {}, 'DELETE'); setNotice('Account session revoked.') },
              })}><LogOut size={14} />Sign out</button>}
            </li>)}</ul>
            <button className="button secondary full" disabled={disabled} onClick={() => confirm({
              title: 'Sign out this account?', description: 'This browser will need an email sign-in code or an unused account recovery code to return. Other devices remain signed in.',
              button: 'Sign out this device', action: () => signedOut(false),
            })}>Sign out this device</button>
            <button className="text-button" disabled={disabled} onClick={() => confirm({
              title: 'Sign out every device?', description: 'This revokes all account sessions and browser sessions for linked identities. Unused account recovery codes and browser recovery codes remain valid until replaced or revoked. Your ledger and memberships stay.',
              button: 'Sign out all devices', action: () => signedOut(true),
            })}>Sign out all devices</button>
          </section>
          <section className="access-section">
            <h3>Recovery codes</h3>
            <p className="field-hint">Keep a way back into your account when email sign-in is unavailable. Save ten single-use codes in a private place.</p>
            <button className="button secondary full" disabled={disabled} onClick={() => { void openRecovery() }}><KeyRound size={16} />Manage recovery codes</button>
          </section>
          <section className="access-section">
            <h3>Account lifecycle</h3>
            <p className="field-hint">Before leaving or deleting an account, transfer ownership of any kitchen that still has other active roommates. Shared financial history is retained; leaving does not cancel debts.</p>
            <button className="text-button" disabled={disabled} onClick={() => { setError(''); setReauthenticate(true) }}>Verify email again</button>
            <button className="text-button" disabled={disabled} onClick={() => confirm({
              title: 'Delete your Roomlings account?', email: true, button: 'Delete my account',
              description: 'This deletes your account and sign-in identity and revokes linked access. Shared ledger records retain former-roommate references so balances remain correct. Names written inside expense descriptions are not automatically removed. Export any ledgers you need first. This cannot be undone.',
              action: async (confirmation) => {
                const input = deleteAccountSchema.parse({ confirmation })
                if (input.confirmation !== account.email) throw new Error('Enter the email address of this account to confirm deletion.')
                await accountAction('/account', input, 'DELETE', 'signed-out')
                if (mounted.current) {
                  navigate('manage')
                  setNotice('Your account has been deleted. Shared ledger history has been retained.')
                }
              },
            })}>Delete my account</button>
          </section>
        </>}
        {view === 'recovery' && recovery && <AccountRecoveryPanel recovery={recovery} codes={recoveryCodes} busy={disabled}
          onRefresh={() => { void openRecovery() }}
          onSaved={() => { setRecoveryCodes([]); setNotice('Your recovery codes are ready. Keep your saved copy private.') }}
          onGenerate={() => {
            if (recovery.remaining) confirm({
              title: 'Replace your account recovery codes?',
              description: 'All older unused codes will stop working. Save the new set when it appears. Existing sessions and household memberships stay unchanged.',
              button: 'Replace recovery codes', action: () => generateCodes(recovery.version),
            })
            else void run(() => generateCodes(recovery.version))
          }}
          onRevoke={() => confirm({
            title: 'Revoke your unused recovery codes?',
            description: 'These codes will no longer sign in to your account. Email sign-in and existing sessions stay available. Your kitchens and memberships are unchanged.',
            button: 'Revoke recovery codes', action: () => revokeCodes(recovery.version),
          })}
        />}
        {view === 'create' && <CreateKitchenForm key={account.id} initialMemberName={account.name}
          initialValues={creation.current?.accountId === account.id ? creation.current.input : undefined}
          busy={disabled} error={null} onSubmit={(body) => {
          void run(async () => {
            const input = createAccountHouseholdSchema.parse(body)
            const requestId = creation.current?.accountId === account.id ? creation.current.input.requestId : undefined
            if (!requestId && !globalThis.crypto?.randomUUID) throw new Error('Use HTTPS or localhost to safely create a kitchen.')
            creation.current = { accountId: account.id, input: { ...input, requestId: requestId ?? crypto.randomUUID() } }
            await accountAction('/account/households', creation.current.input, 'POST', 'select')
            if (mounted.current) {
              if (autoEnter) onClose()
              else { navigate('manage'); setNotice('Your account now owns the new kitchen.') }
            }
          })
        }} />}
        {view === 'join' && <AccountJoinForm initialInvite={initialInvite} name={account.name} busy={disabled} onSubmit={(body) => {
          void run(async () => {
            await accountAction('/account/invitations/accept', body, 'POST', 'select')
            if (mounted.current) {
              history.replaceState(null, '', `${location.pathname}${location.search}`)
              if (autoEnter) onClose()
              else {
                navigate('manage')
                setNotice('The kitchen is linked to your account. Reopening the invitation will not add another roommate.')
              }
            }
          })
        }} />}
        {view === 'link' && <>
          <p className="field-hint">Link only your own roommate identity. Your existing member ID, expenses and balances stay unchanged. Other saved browser sessions continue to work.</p>
          <ul className="device-list">{browserLegacy.filter((kitchen) => !state.memberships.some((membership) =>
            membership.householdId === kitchen.householdId)).map((kitchen) => <li className="device-row" key={kitchen.token}>
              <div><strong>{kitchen.name}</strong><small>Return as {kitchen.memberName}</small>{kitchen.expired && <small>Access expired</small>}</div>
              {kitchen.expired ? <button className="button secondary small-button" disabled={disabled} aria-label={`Recover access to ${kitchen.name}`}
                onClick={() => recoveryInput.current?.focus()}>Recover access</button>
                : <button className="button secondary small-button" disabled={disabled} aria-label={`Link ${kitchen.memberName} in ${kitchen.name}`} onClick={() => confirm({
                title: 'Link this roommate to your account?',
                description: `Link ${kitchen.memberName} in ${kitchen.name} to ${account.email}? This does not create a new roommate or merge different identities.`,
                button: 'Link this identity', action: () => linkBrowserKitchen(kitchen),
              })}>Link identity</button>}
            </li>)}</ul>
          <LinkRecoveryForm inputRef={recoveryInput} busy={disabled} onSubmit={(body) => run(async () => {
            await accountAction('/account/link', body, 'POST', 'select')
            if (mounted.current) { navigate('manage'); setNotice('Your recovery identity is linked to this account.') }
          })} />
        </>}
        {view === 'household' && access && <>
          <div className="access-heading"><h3>{access.household.name}</h3><button className="icon-button control-surface" aria-label="Refresh membership settings" disabled={disabled} onClick={() => { void openHousehold(access.household.id) }}><RefreshCw size={16} /></button></div>
          <p className="field-hint">You are {access.role === 'owner' ? 'the owner' : 'a member'}. All active roommates can edit the shared ledger. Former roommates remain in financial history.</p>
          <ul className="device-list">{access.members.map((member) => <li className="device-row" key={member.memberId}>
            <div><strong>{member.name}</strong><small>{member.active ? `${member.role === 'owner' ? 'Owner' : 'Member'}; ${member.linked ? 'account linked' : 'browser access only'}` : 'Former roommate'}</small></div>
            {access.role === 'owner' && member.active && member.memberId !== access.memberId && <>
              {member.linked && <button className="text-button" disabled={disabled} aria-label={`Make ${member.name} owner`} onClick={() => confirm({
                title: 'Transfer kitchen ownership?', description: `${member.name} will manage membership and invitations. You will remain a member and can still edit the ledger.`,
                button: 'Transfer ownership', action: () => accessAction(`/account/households/${access.household.id}/owner`, { version: access.household.version, memberId: member.memberId }),
              })}>Make owner</button>}
              <button className="text-button" disabled={disabled} aria-label={`Remove ${member.name}`} onClick={() => confirm({
                title: 'Remove this roommate access?', description: `${member.name} will lose account, browser and recovery access to this kitchen. Their shopping claims will be released. Existing debts and financial records stay unchanged.`,
                button: 'Remove access', action: () => accessAction(`/account/households/${access.household.id}/members/${member.memberId}`, { version: access.household.version }, 'DELETE'),
              })}>Remove access</button>
            </>}
          </li>)}</ul>
          {access.role === 'owner' && <section className="access-section">
            <h3>Account invitations</h3>
            <p className="field-hint">New links expire after seven days and require verified account sign-in. Share them only with people you want in this household.</p>
            <button className="button secondary full" disabled={disabled} onClick={() => { void run(async () => {
              const result = accountInvitationResultSchema.parse(await accountRequest(`/account/households/${access.household.id}/invitations`, {
                body: { version: access.household.version, expiresInDays: 7 }, csrfToken: state.csrfToken,
              }))
              if (mounted.current) { acceptAccess(result.access); setInviteSecret(result.code); setNotice('Invitation created. Copy it now; its secret is not stored in the invitation list.') }
            }) }}>Create seven-day invitation</button>
            {inviteSecret && <CopyField label="Account invitation link" value={`${location.origin}${location.pathname}#account-invite=${encodeURIComponent(inviteSecret)}`} buttonLabel="Copy account invitation" copiedLabel="Account invitation copied" />}
            {(location.hostname === 'localhost' || location.hostname === '127.0.0.1') && <p className="field-hint">This is a local preview link. Use your shared HTTPS deployment when inviting other devices.</p>}
            <ul className="device-list">{access.invitations.map((invitation) => <li className="device-row" key={invitation.id}>
              <div><strong>Created {dateTime(invitation.createdAt)}</strong><small>{invitation.revokedAt ? 'Revoked' : `Expires ${dateTime(invitation.expiresAt)}`}; {invitation.uses} accepted</small></div>
              {!invitation.revokedAt && Date.parse(invitation.expiresAt) > Date.now() && <button className="text-button" disabled={disabled} aria-label={`Revoke invitation ${invitation.id}`} onClick={() => confirm({
                title: 'Revoke this invitation?', description: 'This link will stop accepting new roommates. People who already joined keep their membership.',
                button: 'Revoke invitation', action: async () => {
                  await accessAction(`/account/households/${access.household.id}/invitations/${invitation.id}`, { version: access.household.version }, 'DELETE')
                  if (mounted.current) setInviteSecret('')
                },
              })}>Revoke</button>}
            </li>)}</ul>
          </section>}
          <section className="access-section">
            <h3>Leave this kitchen</h3>
            <p className="field-hint">Leaving removes access, not debts. Existing expenses, monthly bill schedules and repayments stay in the shared ledger. Review future bill participants with your roommates before leaving.</p>
            <button className="text-button" disabled={disabled} onClick={() => confirm({
              title: 'Leave this kitchen?', description: `You will lose access to ${access.household.name}, including through old browser sessions and recovery codes. Your historical ledger entries and balances remain. If you are the only active roommate, the kitchen will be closed to new access.`,
              button: 'Leave kitchen', action: async () => {
                await accountAction(`/account/households/${access.household.id}/membership`, { version: access.household.version }, 'DELETE', 'select')
                if (mounted.current) { navigate('manage'); setNotice('You have left the kitchen. Its financial history is unchanged.') }
              },
            })}>Leave kitchen</button>
          </section>
        </>}
        {view !== 'manage' && <button className="text-button" disabled={disabled} onClick={() => navigate('manage')}>Back to account</button>}
      </>}
      {reauthenticate && account && !confirmation && <button className="text-button" disabled={disabled} onClick={() => { setReauthenticate(false); setError('') }}>Back to account</button>}
      {(!account || pendingDeletion) && !loading && !confirmation && browserLegacy.length > 0 && <section className="access-section">
        <h3>Saved browser kitchens</h3>
        <p className="field-hint">These browser-only identities are separate from an account. Opening one does not sign you into an account or merge memberships.</p>
        <ul className="device-list">{browserLegacy.map((kitchen) => <li className="device-row" key={kitchen.token}>
          <div><strong>{kitchen.name}</strong><small>Return as {kitchen.memberName}</small>{kitchen.expired && <small>Access expired</small>}</div>
          {kitchen.expired ? <button className="button secondary small-button" disabled={disabled} aria-label={`Recover access to ${kitchen.name}`}
            onClick={onRecover}>Recover access</button>
            : <button className="button secondary small-button" disabled={disabled} aria-label={`Open saved ${kitchen.name}`} onClick={() => { void run(async () => {
            const opened = await onOpenLegacy(kitchen)
            if (opened && mounted.current) onClose()
          }) }}>Open saved kitchen</button>}
        </li>)}</ul>
      </section>}
      {!account && !confirmation && <button className="text-button" disabled={disabled} onClick={onRecover}>Use existing browser recovery</button>}
    </div>
  </Modal>
}

function EmailSignIn({ busy, initialEmail, initialName, fixedEmail = false, onSend, onVerify, onRecovery }: {
  busy: boolean; initialEmail: string; initialName: string; fixedEmail?: boolean
  onSend: (email: string) => Promise<boolean>; onVerify: (body: z.infer<typeof verifyAccountCodeSchema>) => Promise<boolean>
  onRecovery: (email: string) => void
}) {
  const [email, setEmail] = useState(initialEmail)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState(initialName)
  const [label, setLabel] = useState('Saved browser')
  const [error, setError] = useState('')
  const codeInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (sent) codeInput.current?.focus() }, [sent])
  return <Form onSubmit={() => {
    setError('')
    if (!sent) {
      const input = sendAccountCodeSchema.safeParse({ email })
      if (!input.success) { setError(input.error.issues[0].message); return }
      void onSend(input.data.email).then((success) => { if (success) { setEmail(input.data.email); setSent(true) } })
    } else {
      const input = verifyAccountCodeSchema.safeParse({ email, code, name, label })
      if (!input.success) { setError(input.error.issues[0].message); return }
      void onVerify(input.data).then((success) => { if (success) setCode('') })
    }
  }}>
    <p className="field-hint">Sign in or create an account with a one-time email code. No password to remember. Your email is used by Supabase to authenticate you.</p>
    <label className="field">Email address<input type="email" required autoComplete="email" maxLength={254} value={email} disabled={busy || sent || fixedEmail} onChange={(event) => setEmail(event.target.value)} /></label>
    {sent && <>
      <label className="field">Email sign-in code<input ref={codeInput} type="text" required inputMode="numeric" pattern="[0-9]{6,10}" autoComplete="one-time-code" maxLength={10} value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /></label>
      <label className="field">Account display name<input required autoComplete="nickname" maxLength={50} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field">Name this browser<input required maxLength={50} autoComplete="off" value={label} disabled={busy} onChange={(event) => setLabel(event.target.value)} /></label>
      <p className="field-hint">The display name is used when creating a new account. Signing into an existing account keeps its saved name.</p>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy}>{busy ? <LoadingIcon size={17} tone="light" /> : <Mail size={17} />}{sent ? 'Verify and sign in' : 'Send sign-in code'}</button>
    {sent && <div className="button-row">
      {!fixedEmail && <button type="button" className="text-button" disabled={busy} onClick={() => { setSent(false); setCode(''); setError('') }}>Use another email</button>}
      <button type="button" className="text-button" disabled={busy} onClick={() => { void onSend(email) }}>Send another code</button>
    </div>}
    <button type="button" className="text-button" disabled={busy} onClick={() => onRecovery(email)}>Use an account recovery code</button>
  </Form>
}

function AccountProfile({ name, label, busy, onName, onLabel }: {
  name: string; label: string; busy: boolean; onName: (name: string) => void; onLabel: (label: string) => void
}) {
  const [draftName, setDraftName] = useState(name)
  const [draftLabel, setDraftLabel] = useState(label)
  const [error, setError] = useState('')
  const saved = useRef({ name, label })
  useEffect(() => {
    const previous = saved.current
    setDraftName((draft) => draft.trim() === previous.name || draft.trim() === name ? name : draft)
    setDraftLabel((draft) => draft.trim() === previous.label || draft.trim() === label ? label : draft)
    saved.current = { name, label }
  }, [name, label])
  const submit = (value: string, save: (value: string) => void) => {
    const input = nameSchema.safeParse(value)
    if (!input.success) { setError(input.error.issues[0].message); return }
    setError('')
    save(input.data)
  }
  return <>
    <Form onSubmit={() => submit(draftName, onName)}>
      <label className="field">Account display name<input required maxLength={50} value={draftName} disabled={busy} onChange={(event) => setDraftName(event.target.value)} /></label>
      <button className="button secondary full" disabled={busy || draftName.trim() === name}><Check size={15} />Save account name</button>
    </Form>
    <Form onSubmit={() => submit(draftLabel, onLabel)}>
      <label className="field">Name this account browser<input required maxLength={50} value={draftLabel} disabled={busy} onChange={(event) => setDraftLabel(event.target.value)} /></label>
      <button className="button secondary full" disabled={busy || draftLabel.trim() === label}><Check size={15} />Save account browser name</button>
    </Form>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>
}

function AccountJoinForm({ initialInvite, name, busy, onSubmit }: {
  initialInvite: string; name: string; busy: boolean; onSubmit: (body: z.infer<typeof acceptAccountInvitationSchema>) => void
}) {
  const [invite, setInvite] = useState(initialInvite)
  const [memberName, setMemberName] = useState(name)
  const [error, setError] = useState('')
  return <Form onSubmit={() => {
    let code = invite.trim()
    if (code.includes('://')) {
      try { code = new URLSearchParams(new URL(code).hash.slice(1)).get('account-invite') ?? '' }
      catch (failure) { if (!(failure instanceof TypeError)) throw failure; setError('Paste a valid account invitation link.'); return }
    }
    const input = acceptAccountInvitationSchema.safeParse({ code, memberName })
    if (!input.success) { setError(input.error.issues[0].message); return }
    setError('')
    onSubmit(input.data)
  }}>
    <label className="field">Account invitation link or code<input required autoComplete="off" value={invite} disabled={busy} onChange={(event) => setInvite(event.target.value)} /></label>
    <label className="field">Your name in this kitchen<input required maxLength={50} value={memberName} disabled={busy} onChange={(event) => setMemberName(event.target.value)} /></label>
    <p className="field-hint">This creates a membership for your signed-in account. To keep an existing roommate identity, link its browser access or recovery code instead.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy}>Accept kitchen invitation</button>
  </Form>
}

function LinkRecoveryForm({ busy, onSubmit, inputRef }: {
  busy: boolean; onSubmit: (body: z.infer<typeof linkAccountSchema>) => Promise<boolean>
  inputRef: RefObject<HTMLInputElement | null>
}) {
  const [recoveryCode, setRecoveryCode] = useState('')
  const [error, setError] = useState('')
  return <Form onSubmit={() => {
    const input = linkAccountSchema.safeParse({ recoveryCode })
    if (!input.success) { setError(input.error.issues[0].message); return }
    setError('')
    void onSubmit(input.data).then((success) => { if (success) setRecoveryCode('') })
  }}>
    <label className="field">Existing roommate recovery code<input ref={inputRef} type="password" required autoComplete="off" autoCapitalize="none" spellCheck={false} value={recoveryCode} disabled={busy} onChange={(event) => setRecoveryCode(event.target.value)} /></label>
    <p className="field-hint">This proves access to an existing roommate. It is not an invitation and will not create another person.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy}>Link recovery identity to my account</button>
  </Form>
}
