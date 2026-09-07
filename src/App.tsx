import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRight, Check, CheckCheck,
  ChevronLeft, ChevronRight, CircleHelp, Download, Home, KeyRound, Leaf, Link, LoaderCircle,
  Plus, ReceiptText, RefreshCw, Search, Settings2, Snowflake, Trash2, Users, Wallet, X,
} from 'lucide-react'
import {
  balances, billingDate, categories, categoryLabels, currencies, escapeCsv, householdSchema, localDate,
  money, monthlyGroceries, parseMoney, splitAmount, suggestedTransfers,
} from '../shared/domain.ts'
import type { Bill, Category, Expense, Household, Settlement, ShoppingItem, Transfer } from '../shared/domain.ts'
import type { AccountState, KitchenSession } from '../shared/accounts.ts'
import { billOccurrence, billPauseMonth, latestBillRevision } from '../shared/bills.ts'
import type { BillOccurrence } from '../shared/bills.ts'
import { canEditShoppingItem, inBasket } from '../shared/shopping.ts'
import {
  createDemo, forgetAccountKitchens, getAccountState, getHousehold, preferAccountAccess, readAccessMode,
  readToken, rememberKitchen, request, RequestError, sameKitchenSession, savedKitchens, sessionSchema,
} from './api.ts'
import type { SavedKitchen } from './api.ts'
import { Avatar, CategoryIcon, CopyField, Form, Modal, RoomPanel } from './components.tsx'
import { AccessDialog, RecoveryForm } from './Access.tsx'
import { AccountDialog } from './Accounts.tsx'
import type { AccountChange, AccountIntent } from './Accounts.tsx'
import { CreateKitchenForm } from './CreateKitchenForm.tsx'
import { BillForm, BillPaymentForm, BillsPanel } from './Bills.tsx'
import { ExpenseForm } from './ExpenseForm.tsx'
import { ShoppingCheckoutForm, ShoppingItemForm, ShoppingPanel } from './Shopping.tsx'
import type { ShoppingView } from './Shopping.tsx'
import { dateTitle, monthTitle } from './format.ts'
import { GameHome } from './GameHome.tsx'
import { RoomStyleForm } from './RoomStyle.tsx'
import type { KitchenAction } from './room.ts'
import type { FocusRequest } from './camera.ts'

type Page = 'overview' | 'shopping' | 'groceries' | 'bills' | 'settle' | 'kitchen' | 'budget'
type Dialog = 'expense' | 'shopping-add' | 'bill-create' | 'create' | 'join' | 'recover' | 'access' | 'invite' | 'settings' | 'room-style' | 'help'
  | { account: AccountIntent }
  | { transfer: Transfer } | { remove: Expense } | { undo: Settlement }
  | { editBill: Bill } | { payBill: BillOccurrence } | { pauseBill: { bill: Bill; paused: boolean } }
  | { editShopping: ShoppingItem } | { removeShopping: string } | { releaseShopping: string }
  | { checkout: { id: string; items: ShoppingItem[] } } | null
const initialInvite = new URLSearchParams(location.hash.slice(1)).get('join') ?? ''
const initialRecovery = new URLSearchParams(location.hash.slice(1)).has('recover')
const initialAccountInvite = new URLSearchParams(location.hash.slice(1)).get('account-invite') ?? ''
const initialAccount = new URLSearchParams(location.hash.slice(1)).has('account')
let initialSession: Promise<KitchenSession | null> | undefined

function loadSession(account: AccountState): Promise<KitchenSession | null> {
  if (!initialSession) {
    const pending: Promise<KitchenSession | null> = (async () => {
      const mode = readAccessMode()
      if (mode === 'account' || (account.account && mode !== 'browser')) return account.session
      const token = readToken()
      if (token) return { token, ...await getHousehold(token) }
      return createDemo()
    })().catch((error: unknown) => {
      if (initialSession === pending) initialSession = undefined
      throw error
    })
    initialSession = pending
  }
  return initialSession
}

export function App() {
  const [session, setSession] = useState<KitchenSession | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const sessionEpoch = useRef(0)
  const [account, setAccount] = useState<AccountState | null>(null)
  const accountRef = useRef(account)
  accountRef.current = account
  const startupAttempt = useRef(0)
  const [page, setPage] = useState<Page>('overview')
  const [dialog, setDialog] = useState<Dialog>(initialAccountInvite ? { account: 'join' }
    : initialAccount ? { account: 'manage' } : initialInvite ? 'join' : initialRecovery ? 'recover' : null)
  const [invitation, setInvitation] = useState(initialInvite)
  const [accountInvitation, setAccountInvitation] = useState(initialAccountInvite)
  const [accessRouteVersion, setAccessRouteVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [month, setMonth] = useState(localDate().slice(0, 7))
  const [billMonth, setBillMonth] = useState(localDate().slice(0, 7))
  const [shoppingView, setShoppingView] = useState<ShoppingView>('list')
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [search, setSearch] = useState('')
  const [syncState, setSyncState] = useState<'saved' | 'offline'>('saved')
  const [saved, setSaved] = useState<SavedKitchen[]>([])
  const [stockEvent, setStockEvent] = useState<{ id: string; category: Category } | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ target: 'room', id: 0 })

  const initialize = useCallback(() => {
    const attempt = ++startupAttempt.current
    setLoading(true)
    setError('')
    void (async () => {
      const accountState = await getAccountState()
      if (startupAttempt.current !== attempt) return
      accountRef.current = accountState
      setAccount(accountState)
      const next = await loadSession(accountState)
      if (startupAttempt.current !== attempt) return
      sessionEpoch.current++
      sessionRef.current = next
      setSession(next)
      if (!next) {
        setSaved(savedKitchens())
        setError(accountState.account ? 'Choose, create or link a kitchen from your account.' : 'Sign in to return to your account.')
        setDialog((previous) => previous ?? { account: 'manage' })
        return
      }
      setBillMonth(billingDate(next.household.billingTimeZone).slice(0, 7))
      setShoppingView('list')
      try { setSaved(rememberKitchen(next)) } catch {
        setError('Your browser could not save this kitchen session. Keep this tab open until browser storage is available.')
      }
    })().catch((failure: unknown) => {
      if (startupAttempt.current !== attempt) return
      setError(failure instanceof Error ? failure.message : 'Your kitchen could not be opened.')
      if (failure instanceof RequestError && failure.code === 'ACCOUNT_DELETION_PENDING') {
        setDialog({ account: 'manage' })
        try { setSaved(savedKitchens()) } catch {
          setError('Account deletion is pending. This browser also could not load its saved kitchen shortcuts.')
        }
      }
    }).finally(() => {
      if (startupAttempt.current === attempt) setLoading(false)
    })
    return () => { startupAttempt.current++ }
  }, [])
  useEffect(initialize, [initialize])
  useEffect(() => {
    const navigateAccess = () => {
      const params = new URLSearchParams(location.hash.slice(1))
      const accountInvite = params.get('account-invite') ?? ''
      const invite = params.get('join') ?? ''
      if (accountInvite) setDialog({ account: 'join' })
      else if (params.has('account')) setDialog({ account: 'manage' })
      else if (invite) setDialog('join')
      else if (params.has('recover')) setDialog('recover')
      else return
      setInvitation(invite)
      setAccountInvitation(accountInvite)
      setAccessRouteVersion((version) => version + 1)
      setFormError('')
    }
    window.addEventListener('hashchange', navigateAccess)
    return () => window.removeEventListener('hashchange', navigateAccess)
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 6500)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => { setFormError('') }, [dialog])

  const expireSession = useCallback((expected: KitchenSession, message: string) => {
    if (!sameKitchenSession(sessionRef.current, expected)) return
    startupAttempt.current++
    sessionEpoch.current++
    initialSession = undefined
    sessionRef.current = null
    setSession(null)
    setLoading(false)
    setBusy(false)
    setDialog(expected.token === null ? { account: 'manage' } : null)
    setPage('overview')
    setStockEvent(null)
    setFormError('')
    setError(message)
    setSyncState('offline')
  }, [])

  const refresh = useCallback(async (refreshAccess = false) => {
    const current = sessionRef.current
    if (!current) return
    let epoch = sessionEpoch.current
    try {
      if (refreshAccess && current.token === null) {
        const next = await getAccountState()
        if (sessionEpoch.current !== epoch || !sameKitchenSession(sessionRef.current, current)) return
        const previousDevice = accountRef.current?.devices.find((device) => device.current)?.id
        const allowed = next.account?.id === accountRef.current?.account?.id && next.memberships.some((membership) =>
          membership.householdId === current.household.id && membership.memberId === current.memberId)
        accountRef.current = next
        setAccount(next)
        if (!allowed) {
          expireSession(current, 'Your account access changed. Sign in or choose an available kitchen.')
          return
        }
        if (previousDevice !== next.devices.find((device) => device.current)?.id) {
          epoch = ++sessionEpoch.current
          setBusy(false)
        }
      }
      const fresh = await getHousehold(current.token, current.household.id)
      if (sessionEpoch.current !== epoch || !sameKitchenSession(sessionRef.current, current)) return
      if (fresh.memberId !== current.memberId) {
        expireSession(current, 'This browser is now using a different account identity. Choose your kitchen again.')
        return
      }
      setSession((previous) => previous && sameKitchenSession(previous, current) && fresh.household.version >= previous.household.version ? { ...previous, ...fresh } : previous)
      setSyncState('saved')
    } catch (failure) {
      if (sessionEpoch.current !== epoch || !sameKitchenSession(sessionRef.current, current)) return
      setSyncState('offline')
      if (failure instanceof RequestError && (failure.status === 401 || (failure.status === 403 && current.token === null))) {
        expireSession(current, failure.message)
      }
    }
  }, [expireSession])
  useEffect(() => {
    if (!session?.memberId) return
    const interval = window.setInterval(() => { if (!document.hidden) void refresh() }, 12_000)
    const focus = () => { void refresh(true) }
    window.addEventListener('focus', focus)
    return () => { clearInterval(interval); window.removeEventListener('focus', focus) }
  }, [session?.token, session?.memberId, session?.household.id, refresh])

  const adoptSession = (next: KitchenSession, keepDialog = false) => {
    startupAttempt.current++
    sessionEpoch.current++
    setLoading(false)
    setBusy(false)
    sessionRef.current = next
    setSession(next)
    initialSession = Promise.resolve(next)
    setError('')
    try { setSaved(rememberKitchen(next)) } catch {
      setError('Your browser could not remember this kitchen. Keep this tab open until browser storage is available.')
    }
    if (!keepDialog) history.replaceState(null, '', `${location.pathname}${location.search}`)
    setMonth(localDate().slice(0, 7))
    setBillMonth(billingDate(next.household.billingTimeZone).slice(0, 7))
    setShoppingView('list')
    setFilter('all')
    setPage('overview')
    if (!keepDialog) setDialog(null)
    setSyncState('saved')
    setStockEvent(null)
    setFocusRequest((previous) => ({ target: 'room', id: previous.id + 1 }))
  }

  const action = async (path: string, body: Record<string, unknown>, success: string, method?: string, inline = false) => {
    if (!session || busy) return
    const epoch = sessionEpoch.current
    setBusy(true)
    setFormError('')
    if (inline) setError('')
    try {
      const result = await request<{ household: unknown }>(path, {
        token: session.token, csrfToken: session.token === null ? accountRef.current?.csrfToken : undefined,
        householdId: session.household.id, body: { ...body, version: session.household.version }, method,
      })
      if (sessionEpoch.current !== epoch || !sameKitchenSession(sessionRef.current, session)) return
      const household = householdSchema.parse(result.household)
      setSession((previous) => previous && sameKitchenSession(previous, session) && household.version >= previous.household.version ? { ...previous, household } : previous)
      setNotice(success)
      if (!inline) setDialog(null)
      setSyncState('saved')
      if (path === '/bills') setBillMonth(household.bills[0].startMonth)
      if ((path === '/expenses' || path === '/shopping/checkout') && method !== 'DELETE') {
        const added = household.expenses[0]
        setMonth(added.date.slice(0, 7))
        setStockEvent({ id: added.id, category: added.category })
        setFilter('all')
        setPage('overview')
      }
    } catch (failure) {
      if (sessionEpoch.current !== epoch || !sameKitchenSession(sessionRef.current, session)) return
      if (failure instanceof RequestError && failure.status === 401) {
        expireSession(session, failure.message)
        return
      }
      const message = failure instanceof Error ? failure.message : 'The change could not be saved.'
      if (inline) setError(message)
      else setFormError(message)
      if (failure instanceof RequestError && (failure.status === 409 || (failure.status === 403 && session.token === null))) {
        await refresh(failure.status === 403)
      }
    } finally {
      if (sessionEpoch.current === epoch && sameKitchenSession(sessionRef.current, session)) setBusy(false)
    }
  }

  const handleAccountChange = (next: AccountState, kind: AccountChange) => {
    const previous = accountRef.current
    const current = sessionRef.current
    accountRef.current = next
    setAccount(next)
    const identityChanged = previous?.account?.id !== next.account?.id
      || previous?.devices.find((device) => device.current)?.id !== next.devices.find((device) => device.current)?.id
    const preserveLegacy = (kind === 'signed-out' || kind === 'deleting') && current !== null && current.token !== null
      && !previous?.memberships.some((membership) => membership.householdId === current.household.id && membership.memberId === current.memberId)
    if (preserveLegacy) {
      startupAttempt.current++
      sessionEpoch.current++
      initialSession = Promise.resolve(current)
      setLoading(false)
      setBusy(false)
      setError('')
    } else if (kind === 'signed-out' || kind === 'deleting' || (current?.token === null && !next.account)) {
      startupAttempt.current++
      sessionEpoch.current++
      initialSession = Promise.resolve(null)
      sessionRef.current = null
      setSession(null)
      setLoading(false)
      setBusy(false)
      setPage('overview')
      setStockEvent(null)
      setError(kind === 'deleting' ? 'Account deletion is pending. Account kitchen access is disabled.' : 'Sign in to return to your account.')
    } else if (kind === 'select' || (next.account && identityChanged) || (!current && next.session)) {
      if (next.session) adoptSession(next.session, true)
      else {
        startupAttempt.current++
        sessionEpoch.current++
        initialSession = Promise.resolve(null)
        sessionRef.current = null
        setSession(null)
        setLoading(false)
        setBusy(false)
        setError('Choose, create or link a kitchen from your account.')
      }
    } else if (current?.token === null && next.session && sameKitchenSession(current, next.session)
      && next.session.household.version >= current.household.version) {
      sessionRef.current = next.session
      setSession(next.session)
    }
    try {
      const removed = previous?.memberships.filter((membership) => kind === 'signed-out'
        || (next.account !== null && previous.account?.id === next.account.id
          && !next.memberships.some((saved) => saved.householdId === membership.householdId && saved.memberId === membership.memberId))) ?? []
      if (removed.length) setSaved(forgetAccountKitchens(removed))
      if (preserveLegacy && current) setSaved(rememberKitchen(current))
      else if (kind === 'signed-out' || kind === 'deleting' || kind === 'select' || (next.account && identityChanged)) preferAccountAccess()
    } catch {
      setError('Account access changed, but this browser could not update its saved kitchen shortcuts. Check browser storage before closing the tab.')
    }
  }
  const openDialog = (next: Dialog) => {
    setFormError('')
    if ((account?.configured || account?.account) && (next === 'create' || next === 'join' || next === 'invite')) {
      setDialog({ account: next === 'create' ? 'create' : next === 'join' ? 'join' : 'manage' })
    } else if (next === 'access' && session?.token === null) setDialog({ account: 'manage' })
    else setDialog(next)
  }
  const household = session?.household
  const memberName = (id: string) => household?.members.find((member) => member.id === id)?.name ?? 'Unknown roommate'
  const exportLedger = () => {
    if (!household) return
    const runs = new Map(household.shopping.runs.map((run) => [run.id, run]))
    const rows: (string | number)[][] = [['Type', 'Date', 'Description', 'Amount', 'Currency', 'Paid by / From', 'Split with / To', 'Category', 'Billing month', 'Shopping items']]
    for (const expense of household.expenses) rows.push([
      expense.bill ? 'Bill' : 'Expense', expense.date, expense.description, (expense.amount / 100).toFixed(2), household.currency,
      memberName(expense.paidBy), expense.participants.map(memberName).join('; '), expense.bill ? 'Monthly bill' : categoryLabels[expense.category],
      expense.bill?.month ?? '',
      expense.shoppingRunId ? runs.get(expense.shoppingRunId)?.items.map((item) => `${item.quantity} ${item.name}${item.notes ? ` (${item.notes})` : ''}`).join('; ') ?? '' : '',
    ])
    for (const settlement of household.settlements) rows.push([
      'Repayment', settlement.createdAt.slice(0, 10), 'Recorded repayment', (settlement.amount / 100).toFixed(2),
      household.currency, memberName(settlement.from), memberName(settlement.to), '', '', '',
    ])
    const url = URL.createObjectURL(new Blob(['\uFEFF', rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'roomlings-ledger.csv'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('Your whole ledger has been exported.')
  }

  const newSession = async (endpoint: string, body: Record<string, unknown>) => {
    setBusy(true)
    setFormError('')
    try {
      const next = sessionSchema.parse(await request(endpoint, { body }))
      adoptSession(next)
      setNotice(endpoint === '/recover' ? 'Welcome back. Your original roommate identity has been restored.'
        : endpoint === '/join' ? 'You are in. Welcome to the kitchen!' : 'A fresh start for your shared kitchen.')
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Your kitchen could not be opened.')
    } finally { setBusy(false) }
  }

  const switchKitchen = async (kitchen: SavedKitchen, surfaceInDialog = false): Promise<boolean> => {
    const epoch = sessionEpoch.current
    setBusy(true)
    try {
      const next = await getHousehold(kitchen.token)
      if (sessionEpoch.current !== epoch) return false
      adoptSession({ token: kitchen.token, ...next })
      setNotice(`Welcome back to ${next.household.name}.`)
      return true
    } catch (failure) {
      if (sessionEpoch.current !== epoch) return false
      if (surfaceInDialog) throw failure
      setError(failure instanceof Error ? failure.message : 'That kitchen could not be opened.')
      return false
    } finally { if (sessionEpoch.current === epoch) setBusy(false) }
  }

  const changeMonth = (direction: number) => {
    const date = new Date(`${month}-15T12:00:00`)
    date.setMonth(date.getMonth() + direction)
    setMonth(localDate(date).slice(0, 7))
  }
  const visit = (next: Page) => {
    setPage(next)
    setFormError('')
    setSearch('')
    setFilter('all')
    if (next === 'overview') setFocusRequest((previous) => ({ target: 'room', id: previous.id + 1 }))
  }
  const interact = (action: KitchenAction) => {
    setFocusRequest((previous) => ({ target: action, id: previous.id + 1 }))
    if (action === 'stock') setShoppingView('list')
    const pages: Record<KitchenAction, Page> = { stock: 'shopping', ledger: 'groceries', budget: 'budget', roommates: 'kitchen', settle: 'settle' }
    visit(pages[action])
  }

  const renderDialog = () => {
    if (!dialog) return null
    const close = () => setDialog(null)
    const footerError = formError && <p className="form-error" role="alert">{formError}</p>
    const accountIntent = typeof dialog === 'object' && 'account' in dialog ? dialog.account
      : (account?.configured || account?.account) && (dialog === 'create' || dialog === 'join' || dialog === 'invite')
        ? dialog === 'create' ? 'create' : dialog === 'join' ? 'join' : 'manage' : null
    if (accountIntent) return <AccountDialog key={`account:${accessRouteVersion}`}
      intent={accountIntent} initialState={account} initialInvite={accountInvitation || invitation} legacySession={session && session.token !== null ? session : null}
      savedLegacy={saved} onChange={handleAccountChange} onClose={close} onRecover={() => openDialog('recover')}
      onOpenLegacy={(kitchen) => switchKitchen(kitchen, true)} />
    if (dialog === 'help') return <Modal title="A kitchen you can play with." subtitle="Real groceries, real shares. Just a much nicer place to keep track." onClose={close}>
      <div className="game-guide">
        <p><Snowflake size={19} /><span><strong>Peek in the fridge.</strong> Click a door to open it. Click a grocery to find the expenses on that shelf.</span></p>
        <p><Plus size={19} /><span><strong>Plan a grocery run.</strong> The shopping bag holds the shared list and your basket. Record the paid receipt to archive its items and stock the fridge.</span></p>
        <p><ReceiptText size={19} /><span><strong>Keep the receipts.</strong> The book holds groceries and monthly bills. Record a bill only after someone has paid it.</span></p>
        <p><Wallet size={19} /><span><strong>Watch the house pot.</strong> The coins represent the monthly budget you have left, not points or rewards.</span></p>
        <p><Users size={19} /><span><strong>Make room for your people.</strong> The noticeboard opens your household. The envelope sorts out repayments.</span></p>
      </div><p className="field-hint">Drag to turn the room. Scroll or pinch to zoom. Selecting an object brings it closer while its details stay beside the room. Use Whole room to pull back, or tap the kettle for a little tea break. Everything is also available from the toolbar. The fridge visualizes purchases, not what is left to eat.</p>
    </Modal>
    // Keep welcome-screen forms mounted when the loaded kitchen replaces the welcome content.
    if (dialog === 'create') return <Modal key="create" title="Make room for your people." subtitle="Start a fresh kitchen, then invite your roommates. You can switch back to saved kitchens from The roommates." onClose={close} busy={busy}>
      <CreateKitchenForm busy={busy} error={footerError} onSubmit={(body) => { void newSession('/households', body) }} />
      <button className="text-button centered" disabled={busy} onClick={() => openDialog('join')}>Already have an invitation? Join a kitchen <ArrowRight size={14} /></button>
      <button className="text-button centered" disabled={busy} onClick={() => openDialog('recover')}>Recover existing access <KeyRound size={14} /></button>
    </Modal>
    if (dialog === 'join') return <Modal key={`join:${accessRouteVersion}`} title="There is a place for you." subtitle="Use the invitation your roommate shared. Everyone with the link can join and edit the shared ledger." onClose={close} busy={busy}>
      <JoinForm initialInvite={invitation} busy={busy} error={footerError} onSubmit={(body) => { void newSession('/join', body) }} />
      <button className="text-button centered" disabled={busy} onClick={() => openDialog('recover')}>Recover existing access <KeyRound size={14} /></button>
    </Modal>
    if (dialog === 'recover') return <Modal key="recover" title="Come back as yourself." subtitle="Restore your existing roommate identity without creating another member." onClose={close} busy={busy}>
      <RecoveryForm busy={busy} error={footerError} onSubmit={(body) => { void newSession('/recover', body) }} />
    </Modal>
    if (!household || !session) return null
    if (dialog === 'access' && session.token !== null) return <AccessDialog key={session.token} token={session.token} memberName={memberName(session.memberId)} householdName={household.name}
      onClose={close} onRecover={() => openDialog('recover')} onExpired={(message) => expireSession(session, message)} />
    if (dialog === 'expense') return <Modal title="What is in the bag?" subtitle="Unpack a grocery run. We will take care of the splitting." onClose={close} busy={busy}>
      <ExpenseForm household={household} memberId={session.memberId} busy={busy} error={footerError} onSubmit={(body) => { void action('/expenses', body, 'Fridge stocked. Groceries shared. All saved.') }} />
    </Modal>
    if (dialog === 'shopping-add') return <Modal title="Add to the shared list." subtitle="Tell your roommates what home needs. No expense is created yet." onClose={close} busy={busy}>
      <ShoppingItemForm household={household} memberId={session.memberId} busy={busy} error={footerError} onSubmit={(body) => { void action('/shopping/items', body, 'Item added to the shared shopping list.') }} />
    </Modal>
    if (typeof dialog === 'object' && 'editShopping' in dialog) return <Modal title="Edit a shopping item." subtitle="Keep quantities and notes clear for whoever is buying it." onClose={close} busy={busy}>
      <ShoppingItemForm household={household} memberId={session.memberId} item={dialog.editShopping} busy={busy} error={footerError} onSubmit={(body) => { void action(`/shopping/items/${dialog.editShopping.id}`, body, 'Shopping item updated.', 'PATCH') }} />
    </Modal>
    if (typeof dialog === 'object' && ('removeShopping' in dialog || 'releaseShopping' in dialog)) {
      const release = 'releaseShopping' in dialog
      const id = release ? dialog.releaseShopping : dialog.removeShopping
      const item = household.shopping.items.find((item) => item.id === id)
      const allowed = !!item && (release ? item.claimedBy !== null : canEditShoppingItem(item, session.memberId))
      return <Modal title={release ? 'Release this shopping claim?' : 'Remove this shopping item?'}
        subtitle={item ? `${item.quantity} ${item.name}. ${release ? 'This returns it to the shared list and clears its basket status. Coordinate with the shopper before buying it again.' : 'This only changes the list, not your ledger.'}` : 'This item is no longer on the list.'}
        onClose={close} busy={busy}>
        {!allowed ? <p className="form-error" role="alert">The item changed. Close this dialog and review its current status.</p> : footerError}
        <div className="button-row"><button className="button secondary" disabled={busy} onClick={close}>Cancel</button>
          {item && <button className="button primary" disabled={busy || !allowed} onClick={() => {
            if (release) void action(`/shopping/items/${id}/claim`, { itemVersion: item.version, claimed: false }, 'Shopping claim released.')
            else void action(`/shopping/items/${id}`, { itemVersion: item.version }, 'Item removed from the shopping list.', 'DELETE')
          }}>{release ? 'Release claim' : 'Remove item'}</button>}
        </div>
      </Modal>
    }
    if (typeof dialog === 'object' && 'checkout' in dialog) return <Modal title="Finish this shopping run." subtitle="Confirm the actual total, payer and split. Nothing is archived until the receipt is saved." onClose={close} busy={busy}>
      <ShoppingCheckoutForm household={household} memberId={session.memberId} checkoutId={dialog.checkout.id} initialItems={dialog.checkout.items} busy={busy} error={footerError}
        onSubmit={(body) => { void action('/shopping/checkout', body, 'Shopping run saved. Items archived and the fridge stocked.') }} />
    </Modal>
    if (dialog === 'bill-create') return <Modal title="A regular part of home." subtitle="Add a monthly bill. Creating a schedule does not create a debt or move money." onClose={close} busy={busy}>
      <BillForm household={household} busy={busy} error={footerError} onSubmit={(body) => { void action('/bills', body, 'Monthly bill created. Record a payment when someone has paid it.') }} />
    </Modal>
    if (typeof dialog === 'object' && 'editBill' in dialog) return <Modal title="Edit a monthly bill." subtitle="Update the default amount, due day and people sharing it." onClose={close} busy={busy}>
      <BillForm household={household} bill={dialog.editBill} busy={busy} error={footerError} onSubmit={(body) => { void action(`/bills/${dialog.editBill.id}`, body, 'Monthly bill updated. Recorded payments are unchanged.', 'PATCH') }} />
    </Modal>
    if (typeof dialog === 'object' && 'payBill' in dialog) {
      const bill = household.bills.find((bill) => bill.id === dialog.payBill.billId)
      const current = bill ? billOccurrence(household, bill, dialog.payBill.month) : null
      const blocked = !current ? 'This bill is no longer scheduled for that month. Close this form and choose an active month.'
        : current.payment ? 'A payment is already recorded for this bill and month. Close this form to see the recorded expense.' : ''
      return <Modal title="Record a bill payment." subtitle="Only record money that has actually been paid. Roomlings does not move money." onClose={close} busy={busy}>
        <BillPaymentForm household={household} memberId={session.memberId} item={current ?? dialog.payBill} busy={busy} blocked={!!blocked}
          error={blocked ? <p className="form-error" role="alert">{blocked}</p> : footerError}
          onSubmit={(body) => { void action(`/bills/${dialog.payBill.billId}/payments`, body, 'Bill payment recorded once in the shared ledger.') }} />
      </Modal>
    }
    if (typeof dialog === 'object' && 'pauseBill' in dialog) {
      const { bill, paused } = dialog.pauseBill
      return <Modal title={paused ? 'Pause this monthly bill?' : 'Resume this monthly bill?'}
        subtitle={paused ? `${latestBillRevision(bill).name} will stop recurring from ${monthTitle(billPauseMonth(bill, billingDate(household.billingTimeZone).slice(0, 7)))}. Existing dues and recorded payments stay.`
          : 'Resume from this month, or the first scheduled month if later. Skipped months will not be added back.'}
        onClose={close} busy={busy}>
        {footerError}<div className="button-row"><button className="button secondary" disabled={busy} onClick={close}>Cancel</button>
          <button className="button primary" disabled={busy} onClick={() => { void action(`/bills/${bill.id}/pause`, { paused }, paused ? 'Monthly bill paused for future months.' : 'Monthly bill resumed. Skipped months stay skipped.') }}>{paused ? 'Pause monthly bill' : 'Resume monthly bill'}</button>
        </div>
      </Modal>
    }
    if (dialog === 'settings') return <Modal title="A few house rules." subtitle="A shared budget keeps everyone on the same page." onClose={close} busy={busy}>
      <SettingsForm household={household} busy={busy} error={footerError} onSubmit={(body) => { void action('/household', body, 'Your house rules have been updated.', 'PATCH') }} />
    </Modal>
    if (dialog === 'room-style') return <Modal title="Make the room feel like home." subtitle="One shared look for your household. Your groceries, bills and balances stay the same." onClose={close} busy={busy}>
      <RoomStyleForm current={household.roomStyle} busy={busy} error={footerError} onClose={close}
        onSubmit={(roomStyle) => { void action('/household/room-style', { roomStyle }, 'Room style saved for everyone.', 'PATCH') }} />
    </Modal>
    if (dialog === 'invite') return <Modal title="Better with roommates." subtitle={household.demo ? 'This is a sample kitchen. Create your real one before inviting your people.' : 'This private invitation lets a roommate join and edit your kitchen. Only share it with people you trust.'} onClose={close} busy={busy}>
      {household.demo ? <button className="button primary full" onClick={() => openDialog('create')}>Create your kitchen <ArrowRight size={16} /></button>
        : <Invite household={household} busy={busy} error={footerError} onRotate={() => { void action('/invite/rotate', {}, 'A fresh invitation is ready. The previous link no longer works.') }} />}
    </Modal>
    if (typeof dialog === 'object' && 'transfer' in dialog) {
      const { transfer } = dialog
      return <Modal title="Call it even." subtitle="Only record this after the money has actually been paid. Roomlings calculates repayments; it does not move money." onClose={close} busy={busy}>
        <div className="payment-summary"><span>{memberName(transfer.from)} <ArrowRight size={16} /> {memberName(transfer.to)}</span><strong>{money(transfer.amount, household.currency)}</strong></div>
        {footerError}<button className="button primary full" disabled={busy} onClick={() => { void action('/settlements', { ...transfer }, 'Payment recorded. A little less owing, a little more sharing.') }}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Yes, record payment</button>
      </Modal>
    }
    if (typeof dialog === 'object' && 'remove' in dialog) return <Modal title={dialog.remove.bill ? 'Undo this bill payment record?' : 'Remove this grocery run?'}
      subtitle={dialog.remove.bill ? 'This removes the expense record and recalculates balances. It does not return money or undo roommate repayments.'
        : `"${dialog.remove.description}" will be removed from everyone's ledger. Existing payments will stay and balances will be recalculated.${dialog.remove.shoppingRunId ? ' Its purchased items stay archived.' : ''}`} onClose={close} busy={busy}>
      {footerError}<div className="button-row"><button className="button secondary" disabled={busy} onClick={close}>Keep it</button><button className="button primary" disabled={busy} onClick={() => { void action(`/expenses/${dialog.remove.id}`, {}, dialog.remove.bill ? 'Bill payment record removed. Balances have been recalculated.' : 'Grocery run removed. Balances have been recalculated.', 'DELETE') }}>{busy ? 'Removing...' : dialog.remove.bill ? 'Undo bill payment record' : 'Remove grocery run'}</button></div>
    </Modal>
    if (typeof dialog === 'object' && 'undo' in dialog) return <Modal title="Undo this recorded payment?" subtitle="This only changes the shared ledger. It will not return money that has already been transferred." onClose={close} busy={busy}>
      {footerError}<div className="button-row"><button className="button secondary" disabled={busy} onClick={close}>Keep it</button><button className="button primary" disabled={busy} onClick={() => { void action(`/settlements/${dialog.undo.id}`, {}, 'Recorded payment undone.', 'DELETE') }}>{busy ? 'Saving...' : 'Undo payment record'}</button></div>
    </Modal>
    return null
  }

  if (!household || !session) return <div className="welcome-screen">
    <div className="brand"><span className="brand-mark"><Snowflake size={23} /></span>roomlings<span className="brand-period">.</span></div>
    <div className="welcome-content"><span className="eyebrow">A HAPPIER SHARED KITCHEN</span><h1>A full fridge.<br /><em>A fair share.</em></h1>
      {loading ? <p className="inline"><LoaderCircle className="spin" size={19} /> Opening the kitchen...</p> : <><p className="form-error" role="alert">{error}</p><div className="button-row"><button className="button primary" onClick={initialize}>Try again</button><button className="button secondary" onClick={() => openDialog('recover')}>Recover access</button><button className="button secondary" onClick={() => openDialog('join')}>Join a kitchen</button><button className="text-button" onClick={() => openDialog('create')}>Create a kitchen</button></div></>}
    </div>{renderDialog()}
  </div>

  const expenses = monthlyGroceries(household, month)
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const remaining = household.budget - total
  const progress = Math.min(total / household.budget, 1)
  const counts = Object.fromEntries(categories.map((category) => [category, expenses.filter((expense) => expense.category === category).length])) as Record<Category, number>
  const totals = Object.fromEntries(categories.map((category) => [category, expenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + expense.amount, 0)])) as Record<Category, number>
  const currentBalances = balances(household)
  const yourBalance = currentBalances.get(session.memberId) ?? 0
  const transfers = suggestedTransfers(household)
  const filtered = expenses.filter((expense) => (filter === 'all' || expense.category === filter)
    && `${expense.description} ${memberName(expense.paidBy)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const monthControls = <div className="month-control">
    <button className="icon-button" onClick={() => changeMonth(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
    <span>{monthTitle(month, true)}</span>
    <button className="icon-button" onClick={() => changeMonth(1)} aria-label="Next month" disabled={month >= localDate().slice(0, 7)}><ChevronRight size={16} /></button>
  </div>
  const balanceList = <div className="balance-list">{household.members.map((member) => {
    const balance = currentBalances.get(member.id) ?? 0
    return <div className="balance-row" key={member.id}><Avatar member={member} /><div className="member-label"><strong>{member.name}{member.id === session.memberId && member.name !== 'You' ? ' (you)' : ''}</strong><span>{balance > 0 ? 'gets back' : balance < 0 ? 'owes the house' : 'all settled up'}</span></div><span className={`balance-amount ${balance > 0 ? 'positive' : balance < 0 ? 'negative' : ''}`}>{balance > 0 ? '+' : balance < 0 ? '-' : ''}{money(Math.abs(balance), household.currency)}</span></div>
  })}</div>

  const ledger = <section className="ledger-section">
    <div className="section-heading"><div><h2>Grocery runs <span className="count-pill">{filtered.length}</span></h2></div>
      <button className="button secondary small-button" onClick={exportLedger}><Download size={15} /> Export ledger</button>
    </div>
    <div className="ledger-toolbar"><div className="category-tabs" aria-label="Filter grocery runs">
      <button className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Everything</button>
      {categories.map((category) => <button className={filter === category ? 'active' : ''} aria-label={categoryLabels[category]} aria-pressed={filter === category} key={category} onClick={() => setFilter(category)}><CategoryIcon category={category} size={15} /><span>{categoryLabels[category]}</span></button>)}
    </div>{page === 'groceries' && <label className="search-input"><Search size={16} /><input aria-label="Search grocery runs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a grocery run" /></label>}</div>
    <div className="ledger-table" role="table" aria-label="Grocery expenses">
      <div className="ledger-table-head" role="row"><span role="columnheader">THE GROCERY RUN</span><span role="columnheader">PAID BY</span><span role="columnheader">SPLIT WITH</span><span role="columnheader">TOTAL</span><span /></div>
      {filtered.map((expense) => {
        const payer = household.members.find((member) => member.id === expense.paidBy)!
        const shares = splitAmount(expense.amount, expense.participants)
        return <div className="expense-row" role="row" key={expense.id}><div className="expense-description" role="cell"><span className={`category-icon ${expense.category}`}><CategoryIcon category={expense.category} /></span><div><strong>{expense.description}</strong><span>{dateTitle(expense.date)}<i />Paid by {payer.name}</span><details className="expense-shares"><summary>{expense.participants.length} {expense.participants.length === 1 ? 'share' : 'shares'}</summary>{expense.participants.map((id) => <span className="expense-share" key={id}>{memberName(id)} <strong>{money(shares.get(id) ?? 0, household.currency)}</strong></span>)}</details></div></div><div className="paid-by" role="cell"><Avatar member={payer} small /><span>{payer.name}</span></div><div className="split-avatars" role="cell" aria-label={expense.participants.map(memberName).join(', ')}>{expense.participants.slice(0, 4).map((id) => <Avatar key={id} member={household.members.find((member) => member.id === id)!} small />)}{expense.participants.length > 4 && <span className="extra-members">+{expense.participants.length - 4}</span>}</div><strong className="expense-total" role="cell">{money(expense.amount, household.currency)}</strong><button className="icon-button delete-expense" title={`Remove ${expense.description}`} aria-label={`Remove ${expense.description}`} onClick={() => openDialog({ remove: expense })}><Trash2 size={15} /></button></div>
      })}
      {!filtered.length && <div className="empty-state"><ShoppingBagIllustration /><h3>{search || filter !== 'all' ? 'Nothing in this little corner.' : 'A fresh shelf, a fresh start.'}</h3><p>{search || filter !== 'all' ? 'Try another category or search term.' : 'Add your first grocery run and we will sort out the shares.'}</p>{!search && filter === 'all' && <button className="text-button" onClick={() => openDialog('expense')}>Add a grocery run <Plus size={16} /></button>}</div>}
    </div>
  </section>

  return <div className="game-app">
    <GameHome
      household={household} memberId={session.memberId} counts={counts} selected={filter}
      remaining={remaining} yourBalance={yourBalance} transferCount={transfers.length}
      expenseCount={expenses.length} receiptCount={household.expenses.length} monthControls={monthControls} monthLabel={monthTitle(month)}
      stockEvent={stockEvent} focusRequest={focusRequest} syncState={syncState} inert={dialog !== null}
      panelOpen={page !== 'overview'} activeTool={page === 'shopping' ? 'stock' : page === 'groceries' || page === 'bills' ? 'ledger' : page === 'budget' ? 'budget' : page === 'settle' ? 'settle' : page === 'kitchen' ? 'roommates' : null}
      onAction={interact} onCreate={() => openDialog('create')} onInvite={() => openDialog('invite')}
      onSettings={() => openDialog('settings')} onRoomStyle={() => openDialog('room-style')} onHelp={() => openDialog('help')}
      onSelect={(category) => { visit('groceries'); setFilter(category); setFocusRequest((previous) => ({ target: 'fridge', id: previous.id + 1 })) }}
    />
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss message"><X size={16} /></button></div>}
    {page !== 'overview' && !dialog && <RoomPanel
      title={{ shopping: 'The shopping bag.', groceries: 'The receipt book.', bills: 'The receipt book.', settle: 'Keep it even.', kitchen: 'Your kind of people.', budget: 'The little house pot.' }[page]}
      subtitle={{ shopping: 'Plan together. Record the receipt after someone has paid.', groceries: 'Paid grocery runs and shared costs for the selected month.', bills: 'The regular costs of home, in the same shared ledger.', settle: 'Repayments across groceries and bills, over all months.', kitchen: 'One kitchen. Different tastes. Always a fair share.', budget: 'Your remaining grocery budget for the selected month.' }[page]}
      view={page === 'bills' ? `bills:${billMonth}` : page === 'shopping' ? `shopping:${shoppingView}` : page}
      onClose={() => visit('overview')}
    ><div className="game-panel-content">
        {page === 'shopping' && <ShoppingPanel household={household} memberId={session.memberId} view={shoppingView} onView={setShoppingView} busy={busy}
          onAdd={() => openDialog('shopping-add')} onEdit={(item) => openDialog({ editShopping: item })} onRemove={(item) => openDialog({ removeShopping: item.id })}
          onClaim={(item) => { void action(`/shopping/items/${item.id}/claim`, { itemVersion: item.version, claimed: true }, '', undefined, true) }}
          onRelease={(item) => openDialog({ releaseShopping: item.id })}
          onPick={(item, pickedUp) => { void action(`/shopping/items/${item.id}/pick`, { itemVersion: item.version, pickedUp }, '', undefined, true) }}
          onQuickRecord={() => openDialog('expense')}
          onCheckout={() => {
            const items = household.shopping.items.filter((item) => inBasket(item, session.memberId))
            if (!items.length) { setError('Pick up items before finishing a shopping run.'); return }
            if (!globalThis.crypto?.randomUUID) { setError('Use HTTPS or localhost to safely record a shopping run.'); return }
            openDialog({ checkout: { id: crypto.randomUUID(), items } })
          }} />}
        {(page === 'groceries' || page === 'bills') && <nav className="receipt-tabs" aria-label="Receipt book sections">
          <button type="button" disabled={busy} aria-pressed={page === 'groceries'} onClick={() => visit('groceries')}>Groceries</button>
          <button type="button" disabled={busy} aria-pressed={page === 'bills'} onClick={() => visit('bills')}>Bills</button>
        </nav>}
        {page === 'bills' && <BillsPanel household={household} month={billMonth} onMonth={setBillMonth} busy={busy}
          onCreate={() => openDialog('bill-create')} onEdit={(bill) => openDialog({ editBill: bill })} onPay={(item) => openDialog({ payBill: item })}
          onPause={(bill, paused) => openDialog({ pauseBill: { bill, paused } })} onRemove={(expense) => openDialog({ remove: expense })} onExport={exportLedger} />}
        {page === 'kitchen' && <div className="access-entry">
          <button className="button secondary full" disabled={busy} onClick={() => openDialog({ account: 'manage' })}><Users size={16} />Account and membership</button>
          {session.token !== null && <><button className="button secondary full" disabled={busy} onClick={() => openDialog('access')}><KeyRound size={16} />Recovery and devices</button>
            <button className="text-button" disabled={busy} onClick={() => openDialog('recover')}>Use a recovery code</button></>}
        </div>}
        {page === 'groceries' && <><div className="panel-period">{monthControls}<button className="button primary small-button" onClick={() => openDialog('expense')}><Plus size={15} />Add grocery run</button></div><div className="grocery-summary"><div><span className="eyebrow">SPENT TOGETHER</span><strong>{money(total, household.currency)}</strong></div><div><span className="eyebrow">GROCERY RUNS</span><strong>{expenses.length}</strong></div><div className="category-breakdown">{categories.filter((category) => totals[category] > 0).map((category) => <button key={category} onClick={() => setFilter(category)} aria-pressed={filter === category} className={`breakdown-item ${category}`}><CategoryIcon category={category} size={16} /><span>{categoryLabels[category]}</span><strong>{money(totals[category], household.currency)}</strong></button>)}</div></div>{ledger}</>}
        {page === 'budget' && <><div className="panel-period">{monthControls}<button className="button secondary small-button" onClick={() => openDialog('settings')}><Settings2 size={15} />Edit monthly budget</button></div><section className="budget-panel"><div className="card-topline"><span className="eyebrow">SPENT TOGETHER</span><Leaf size={19} /></div><div className="spend-amount">{money(total, household.currency)}<span>of {money(household.budget, household.currency)}</span></div><div className="budget-track" role="meter" aria-label="Monthly grocery spending" aria-valuemin={0} aria-valuemax={household.budget} aria-valuenow={Math.min(total, household.budget)} aria-valuetext={`${money(total, household.currency)} spent out of ${money(household.budget, household.currency)}`}><div style={{ width: `${progress * 100}%` }} className={remaining < 0 ? 'over-budget' : ''} /></div><div className="budget-labels"><strong className={remaining < 0 ? 'negative' : ''}>{money(Math.abs(remaining), household.currency)} {remaining < 0 ? 'over budget' : 'left to enjoy'}</strong><span>{expenses.length} grocery {expenses.length === 1 ? 'run' : 'runs'}</span></div><p className="budget-note">{remaining < 0 ? 'The pot is empty for this month. Maybe a pantry dinner tonight?' : 'A little room for the essentials. And a little treat.'}</p></section><div className="budget-categories">{categories.map((category) => <button key={category} onClick={() => { visit('groceries'); setFilter(category) }}><span className={`category-icon ${category}`}><CategoryIcon category={category} /></span><span>{categoryLabels[category]}</span><strong>{money(totals[category], household.currency)}</strong><ArrowRight size={15} /></button>)}</div><p className="field-hint">The jar represents your remaining monthly budget, not a bank account. The app never moves money.</p></>}
        {page === 'settle' && <div className="settle-layout"><div><section className="repayments-panel"><div className="section-heading"><div><h2>Suggested repayments</h2></div><span className="round-stamp"><CheckCheck size={24} /></span></div>{transfers.length > 0 && <p className="section-description">Settle the current household balance with {transfers.length} {transfers.length === 1 ? 'payment' : 'payments'}.</p>}
          {transfers.map((transfer) => <div className="transfer-row" key={`${transfer.from}-${transfer.to}`}><div className="transfer-people"><Avatar member={household.members.find((member) => member.id === transfer.from)!} small /><strong>{memberName(transfer.from)}</strong><ArrowRight size={17} /><Avatar member={household.members.find((member) => member.id === transfer.to)!} small /><strong>{memberName(transfer.to)}</strong></div><div className="transfer-action"><strong>{money(transfer.amount, household.currency)}</strong><button className="button secondary small-button" onClick={() => openDialog({ transfer })}><Check size={14} />Record paid</button></div></div>)}
          {!transfers.length && <div className="empty-state"><CheckCheck size={42} className="sage-text" /><h3>All settled up.</h3><p>No repayments are needed.</p></div>}
          <div className="info-note"><CircleHelp size={17} /><p>Roomlings does not send money. Pay your roommate first, then record the payment here.</p></div></section>
          <section className="payment-history"><div className="section-heading"><h2>Payment history</h2></div>{household.settlements.length ? household.settlements.map((settlement) => <div className="history-row" key={settlement.id}><span className="history-check"><Check size={17} /></span><div><strong>{memberName(settlement.from)} paid {memberName(settlement.to)}</strong><span>{dateTitle(settlement.createdAt.slice(0, 10))}</span></div><strong>{money(settlement.amount, household.currency)}</strong><button className="text-button" onClick={() => openDialog({ undo: settlement })}>Undo</button></div>) : <p className="muted-paragraph">No repayments recorded yet.</p>}</section></div><section className="household-panel settle-balances"><div className="card-topline"><span className="eyebrow">WHERE EVERYONE STANDS</span></div>{balanceList}<div className="handwritten-note">Fair shares.<br />Full plates.</div></section></div>}
        {page === 'kitchen' && <div className="kitchen-layout"><section><div className="section-heading"><div><span className="eyebrow">WELCOME TO {household.name.toUpperCase()}</span><h2>A seat at the table.</h2></div><span className="count-pill">{household.members.filter((member) => !member.inactive).length} / 12</span></div><div className="roommate-grid">{household.members.map((member) => <div className="roommate-card" key={member.id}><Avatar member={member} /><h3>{member.name}</h3><span>{member.inactive ? 'Former roommate' : member.id === session.memberId ? 'That is you' : 'Fellow fridge explorer'}</span><div><ReceiptText size={15} />{household.expenses.filter((expense) => !expense.bill && expense.paidBy === member.id).length} grocery runs</div></div>)}<button className="roommate-card add-roommate" onClick={() => openDialog('invite')}><span className="add-circle"><Plus size={24} /></span><h3>One more?</h3><span>Invite a roommate</span></button></div></section><section className="kitchen-settings"><span className="eyebrow">THE HOUSE RULES</span><h2>Simple is good.</h2><div className="setting-row"><span>Monthly grocery pot</span><strong>{money(household.budget, household.currency)}</strong></div><div className="setting-row"><span>Currency</span><strong>{household.currency}</strong></div><div className="setting-row"><span>Split style</span><strong>Equally, with your people</strong></div><p className="muted-paragraph">Choose who shares each grocery run. Expenses are saved to this kitchen's server and synced with your roommates.</p><button className="button secondary full" onClick={() => openDialog('settings')}><Settings2 size={16} />Edit house rules</button><button className="text-button" onClick={exportLedger}><Download size={16} />Export the complete ledger</button><hr /><button className="text-button" onClick={() => openDialog('create')}><Plus size={16} />Create another kitchen</button><button className="text-button" onClick={() => openDialog('join')}><Link size={16} />Join a different kitchen</button>{saved.filter((kitchen) => kitchen.token !== session.token).length > 0 && <div className="saved-kitchens"><span className="eyebrow">ALSO SAVED IN THIS BROWSER</span>{saved.filter((kitchen) => kitchen.token !== session.token).map((kitchen) => <button key={kitchen.token} disabled={busy} onClick={() => { void switchKitchen(kitchen) }}><Home size={15} /><span><strong>{kitchen.name}</strong><small>Return as {kitchen.memberName}</small></span><ArrowRight size={14} /></button>)}</div>}<p className="small-muted">{session.token === null ? 'Sign in with your account on any device. Account and membership manages your kitchens and sessions.' : 'Kitchen sessions are saved in this browser. Use the same browser to return as your existing roommate identity.'}</p></section></div>}
    </div></RoomPanel>}
    {notice && <div className="toast" role="status"><Check size={17} /><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={14} /></button></div>}
    {renderDialog()}
  </div>
}

function JoinForm({ initialInvite, busy, error, onSubmit }: { initialInvite: string; busy: boolean; error: ReactNode; onSubmit: (body: Record<string, unknown>) => void }) {
  const [invite, setInvite] = useState(initialInvite)
  const [name, setName] = useState('')
  const [localError, setLocalError] = useState('')
  return <Form onSubmit={() => {
    const value = invite.trim()
    let inviteCode = value
    if (value.includes('://')) {
      try { inviteCode = new URLSearchParams(new URL(value).hash.slice(1)).get('join') ?? '' } catch { setLocalError('Paste a valid invitation link or code.'); return }
    }
    if (!inviteCode) { setLocalError('That link does not contain a kitchen invitation.'); return }
    setLocalError('')
    onSubmit({ inviteCode, name })
  }}>
    <label className="field">Invitation link or code<input required value={invite} onChange={(event) => setInvite(event.target.value)} placeholder="Paste your invitation" disabled={busy} /></label>
    <label className="field">Your name<input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} placeholder="A name your roommates know" disabled={busy} /></label>
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}<button className="button primary full" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}Join the kitchen</button>
  </Form>
}

function SettingsForm({ household, busy, error, onSubmit }: { household: Household; busy: boolean; error: ReactNode; onSubmit: (body: Record<string, unknown>) => void }) {
  const [name, setName] = useState(household.name)
  const [budget, setBudget] = useState((household.budget / 100).toFixed(2))
  const [currency, setCurrency] = useState<string>(household.currency)
  const [localError, setLocalError] = useState('')
  const currencyLocked = household.expenses.length > 0 || household.settlements.length > 0 || household.bills.length > 0
  return <Form onSubmit={() => { const amount = parseMoney(budget); if (!amount) { setLocalError('Enter a positive budget with up to two decimal places.'); return }; setLocalError(''); onSubmit({ name, budget: amount, currency }) }}>
    <label className="field">Kitchen name<input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
    <div className="field-row"><label className="field">Monthly budget<input required inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} disabled={busy} /></label><label className="field">Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy || currencyLocked}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label></div>
    <p className="field-hint">The monthly grocery target applies to every month. {currencyLocked && 'Currency stays fixed after adding expenses or monthly bills.'}</p>
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}<button className="button primary full" disabled={busy}>{busy ? 'Saving...' : 'Save the house rules'}<Check size={17} /></button>
  </Form>
}

function Invite({ household, busy, error, onRotate }: { household: Household; busy: boolean; error: ReactNode; onRotate: () => void }) {
  const link = `${location.origin}${location.pathname}#join=${encodeURIComponent(household.inviteCode)}`
  return <div className="invite-content"><CopyField label="Your private kitchen invitation" value={link} buttonLabel="Copy invitation" copiedLabel="Invitation copied" />
    {location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? <p className="field-hint">This is a local development link. To invite other devices, run the production build on a shared HTTPS host and copy its invitation instead.</p> : null}
    {error}<div className="invite-rotate"><p>Need to retire an old invitation? A new one stops future joins through the old link. Existing roommates keep access.</p><button className="text-button" disabled={busy} onClick={onRotate}><RefreshCw size={14} />Make a fresh invitation</button></div></div>
}

function ShoppingBagIllustration() {
  return <div className="empty-bag"><ReceiptText size={37} strokeWidth={1.2} /><Leaf size={17} /></div>
}
