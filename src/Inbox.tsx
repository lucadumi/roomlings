import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CheckCheck, ChevronRight, ListChecks, ReceiptText, Wallet } from 'lucide-react'
import { billingDate, money } from '../shared/domain.ts'
import type { Household } from '../shared/domain.ts'
import { inboxItems, inboxStateSchema, inboxUnread, mergeInboxRead, readAll } from '../shared/inbox.ts'
import type { InboxItem, InboxRead, InboxState } from '../shared/inbox.ts'
import { errorMessage, request } from './api.ts'
import { Feedback, FeedbackAction } from './Feedback.tsx'
import './inbox.css'

type Access = { token: string | null; householdId: string; memberId: string; csrfToken?: string | null }

export function useInbox(household: Household | null, access: Access | null, onError: (message: string) => void) {
  const [state, setState] = useState<InboxState | null>(null)
  const [loadError, setLoadError] = useState('')
  const latest = useRef(access)
  latest.current = access
  const key = access ? `${access.householdId}:${access.memberId}:${access.token ?? ''}` : ''
  const keyRef = useRef(key)
  keyRef.current = key
  const load = useCallback(async () => {
    const current = latest.current
    const requested = keyRef.current
    if (!current) return
    try {
      const next = inboxStateSchema.parse(await request('/inbox', { token: current.token, householdId: current.householdId }))
      if (keyRef.current !== requested) return
      setState(next)
      setLoadError('')
    } catch (failure) {
      if (keyRef.current === requested) setLoadError(errorMessage(failure, 'Could not load notifications. Try again.'))
    }
  }, [])
  useEffect(() => {
    setState(null)
    setLoadError('')
    if (!key) return
    void load()
    const focus = () => { void load() }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [key, load])
  const today = household ? billingDate(household.billingTimeZone) : ''
  const items = useMemo(() => household && access ? inboxItems(household, access.memberId, today) : [],
    [household, access?.memberId, today])
  const unread = state ? items.filter((item) => inboxUnread(item, state)) : []
  const markRead = async (input: InboxRead) => {
    const current = latest.current
    const requested = keyRef.current
    if (!current || !state) return
    const previous = state
    setState(mergeInboxRead(state, input))
    try {
      const saved = inboxStateSchema.parse(await request('/inbox', {
        token: current.token, csrfToken: current.token === null ? current.csrfToken : undefined,
        householdId: current.householdId, body: input, method: 'PUT',
      }))
      if (keyRef.current === requested) setState(saved)
    } catch (failure) {
      if (keyRef.current !== requested) return
      setState(previous)
      onError(errorMessage(failure, 'Could not mark notifications as read. Try again.'))
    }
  }
  return {
    items, state, loadError, retry: () => { void load() }, unreadCount: unread.length,
    open: (item: InboxItem) => { if (state && inboxUnread(item, state)) void markRead({ ids: [item.id] }) },
    readAll: () => {
      if (!state) return
      const next = readAll(items, state)
      if (next.readThrough !== state.readThrough && next.readThrough) void markRead({ through: next.readThrough })
    },
  }
}

const icons = { chore: ListChecks, expense: ReceiptText, bill: ReceiptText, settlement: Wallet }

export function InboxButton({ unread, active, disabled, onClick }: { unread: number; active: boolean; disabled: boolean; onClick: () => void }) {
  return <button className="icon-button control-surface inbox-trigger" disabled={disabled} onClick={onClick} title="Notifications"
    aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-pressed={active}>
    <Bell size="1.1875rem" />{unread > 0 && <i className="inbox-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</i>}
  </button>
}

export function InboxPanel({ household, items, state, loadError, onRetry, onOpen, onReadAll }: {
  household: Household; items: readonly InboxItem[]; state: InboxState | null; loadError: string
  onRetry: () => void; onOpen: (item: InboxItem) => void; onReadAll: () => void
}) {
  if (!state && loadError) return <Feedback actions={<FeedbackAction onClick={onRetry}>Retry</FeedbackAction>}>{loadError}</Feedback>
  if (!state) return <p className="section-description" role="status">Loading notifications...</p>
  if (!items.length) return <div className="empty-state inbox-empty"><Bell size="2rem" /><h3>All caught up.</h3>
    <p>Your chore turns and the money that involves you will show up here.</p></div>
  const today = billingDate(household.billingTimeZone)
  // Chores you still owe stay at the top until they are done.
  const current = items.filter((item) => item.kind === 'chore' || billingDate(household.billingTimeZone, new Date(item.at)) === today)
  const earlier = items.filter((item) => !current.includes(item))
  const unread = items.some((item) => inboxUnread(item, state))
  const row = (item: InboxItem) => {
    const Icon = icons[item.kind]
    const isUnread = inboxUnread(item, state)
    return <li key={item.id}><button type="button" className="inbox-item" data-kind={item.kind} data-unread={isUnread} onClick={() => onOpen(item)}>
      <span className={`inbox-icon ${item.kind}`}><Icon size="1rem" /></span>
      <span className="inbox-text"><strong>{item.title}</strong>
        <small>{item.detail}{item.amount !== undefined ? `; ${money(item.amount, household.currency)}` : ''}</small></span>
      {isUnread && <span className="inbox-dot"><span className="sr-only">Unread</span></span>}
      <ChevronRight size="1rem" className="inbox-chevron" />
    </button></li>
  }
  return <section className="inbox" aria-label="Notifications">
    {current.length > 0 && <><h3 className="inbox-group">Today</h3><ul>{current.map(row)}</ul></>}
    {earlier.length > 0 && <><h3 className="inbox-group">Earlier</h3><ul>{earlier.map(row)}</ul></>}
    <div className="inbox-actions"><button type="button" className="text-button" disabled={!unread} onClick={onReadAll}><CheckCheck size="1rem" />Mark all read</button></div>
  </section>
}
