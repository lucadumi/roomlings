import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRight, Check, CheckCheck,
  ChevronLeft, ChevronRight, CircleHelp, Download, Home, KeyRound, Leaf, Link,
  Plus, ReceiptText, RefreshCw, Search, Settings2, Snowflake, Trash2, Users, Wallet, X,
} from 'lucide-react'
import {
  balances, billingDate, categories, categoryLabels, currencies, escapeCsv, householdSchema, localDate,
  money, monthlyGroceries, parseMoney, splitAmount, suggestedTransfers,
} from '../shared/domain.ts'
import type {
  Bill, Category, Chore, ChoreCompletion, Expense, Household, Settlement, ShoppingItem, ShoppingItemInput, Transfer,
} from '../shared/domain.ts'
import type { AccountState, KitchenSession } from '../shared/accounts.ts'
import { billOccurrence, billPauseMonth, latestBillRevision } from '../shared/bills.ts'
import type { BillOccurrence } from '../shared/bills.ts'
import { canEditShoppingItem, inBasket } from '../shared/shopping.ts'
import { canUndoChore, choreAssignee, choreStatus } from '../shared/chores.ts'
import { choreLocationLabel, roomCatalog, roomIdSchema } from '../shared/rooms.ts'
import type { ChoreArea, RoomId } from '../shared/rooms.ts'
import {
  forgetAccountKitchens, getAccountState, getHousehold, preferAccountAccess, readAccessMode,
  readToken, rememberKitchen, request, RequestError, sameKitchenSession, savedKitchens, sessionSchema,
  updateSavedKitchen,
} from './api.ts'
import type { SavedKitchen, SavedKitchenChange } from './api.ts'
import { Avatar, CategoryIcon, CopyField, DraftConflict, Form, Modal, RoomPanel } from './components.tsx'
import { LoadingIcon, SceneLoading } from './Branding.tsx'
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
import { defaultRoom, resolveEntry, roomPath } from './roomNavigation.ts'
import { ChoreForm, ChoresPanel } from './Chores.tsx'
import type { ChoreFilter, ChoreView } from './Chores.tsx'
import { RestockPanel } from './Restock.tsx'
import { RoomPicker, RoomPreviewPreloader } from './RoomPicker.tsx'
import { Dropdown } from './Dropdown.tsx'
import { componentCatalog, componentChoreArea, getRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import type { ComponentChoreSuggestion, RoomComponent } from '../shared/roomComponents.ts'
import { roomAccessSchema } from '../shared/roomAccess.ts'
import type { RoomAccess } from '../shared/roomAccess.ts'
import { RoomEditor, RoomObjectsPanel } from './RoomComponents.tsx'
import { RoomAdminPanel } from './RoomAdminPanel.tsx'

const Welcome = lazy(() => import('./landing/Welcome.tsx'))
const isRoomEntry = () => resolveEntry(location.pathname, location.hash).kind === 'room'

type Page = 'overview' | 'shopping' | 'groceries' | 'bills' | 'settle' | 'kitchen' | 'budget' | 'chores' | 'supplies' | 'objects' | 'room-edit'
const pageFocus: Record<Page, FocusRequest['target']> = {
  overview: 'room', shopping: 'stock', groceries: 'ledger', bills: 'ledger', settle: 'settle',
  kitchen: 'roommates', budget: 'budget', chores: 'chores', supplies: 'supplies', objects: 'room', 'room-edit': 'room',
}
type Dialog = 'expense' | 'shopping-add' | 'bill-create' | 'create' | 'join' | 'recover' | 'access' | 'invite' | 'settings' | 'room-style' | 'rooms' | 'help' | 'room-admins'
  | { account: AccountIntent }
  | { transfer: Transfer } | { remove: Expense } | { undo: Settlement }
  | { editBill: Bill } | { payBill: BillOccurrence } | { pauseBill: { bill: Bill; paused: boolean } }
  | { editShopping: ShoppingItem } | { removeShopping: string } | { releaseShopping: string }
  | { createChore: { roomId: RoomId | null; area: ChoreArea | null; componentId?: string | null; title?: string; repeatDays?: number | null } } | { editChore: Chore }
  | { completeChore: Chore } | { archiveChore: Chore } | { undoChore: ChoreCompletion }
  | { restockItem: ShoppingItemInput }
  | { checkout: { id: string; items: ShoppingItem[] } } | null

const initialInvite = new URLSearchParams(location.hash.slice(1)).get('join') ?? ''
const initialRecovery = new URLSearchParams(location.hash.slice(1)).has('recover')
const initialAccountInvite = new URLSearchParams(location.hash.slice(1)).get('account-invite') ?? ''
const initialAccount = new URLSearchParams(location.hash.slice(1)).has('account')
const initialAccountIntent = new URLSearchParams(location.hash.slice(1)).get('account')
type InitialAccess = {
  session: KitchenSession | null; expiredBrowser?: string
}
let initialSession: Promise<InitialAccess> | undefined

function loadSession(account: AccountState): Promise<InitialAccess> {
  if (!initialSession) {
    const pending: Promise<InitialAccess> = (async (): Promise<InitialAccess> => {
      const mode = readAccessMode()
      if (mode === 'account' || (account.account && mode !== 'browser')) return { session: account.session }
      const token = readToken()
      if (token) {
        try {
          const saved = { token, ...await getHousehold(token) }
          return { session: saved }
        } catch (failure) {
          if (!(failure instanceof RequestError) || failure.status !== 401) throw failure
          return { session: account.session, expiredBrowser: token }
        }
      }
      return { session: account.session }
    })().catch((error: unknown) => {
      if (initialSession === pending) initialSession = undefined
      throw error
    })
    initialSession = pending
  }
  return initialSession
}

export function App({ roomId: currentRoom = defaultRoom }: { roomId?: RoomId }) {
  const enteringRoom = useRef(isRoomEntry())
  const [session, setSession] = useState<KitchenSession | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const sessionEpoch = useRef(0)
  const pendingMutation = useRef<{ key: string; id: string; version: number } | null>(null)
  const pendingRoomMutation = useRef<{ key: string; id: string; version: number } | null>(null)
  const [account, setAccount] = useState<AccountState | null>(null)
  const accountRef = useRef(account)
  accountRef.current = account
  const startupAttempt = useRef(0)
  const [page, setPage] = useState<Page>('overview')
  const [dialog, setDialog] = useState<Dialog>(initialAccountInvite ? { account: 'join' }
    : initialAccount ? { account: initialAccountIntent === 'create' || initialAccountIntent === 'join' ? initialAccountIntent : 'manage' }
      : initialInvite ? 'join' : initialRecovery ? 'recover' : null)
  const [roomMenuAnchor, setRoomMenuAnchor] = useState<HTMLButtonElement | null>(null)
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
  const [choreView, setChoreView] = useState<ChoreView>('active')
  const [choreMine, setChoreMine] = useState(false)
  const [choreFilter, setChoreFilter] = useState<ChoreFilter>({ room: currentRoom, area: null })
  const [supplyRoom, setSupplyRoom] = useState<RoomId>(currentRoom)
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [search, setSearch] = useState('')
  const [syncState, setSyncState] = useState<'saved' | 'offline'>('saved')
  const [saved, setSaved] = useState<SavedKitchen[]>([])
  const [stockEvent, setStockEvent] = useState<{ id: string; category: Category } | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ target: 'room', id: 0 })
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null)
  const [cancelPlacementRequest, setCancelPlacementRequest] = useState(0)
  const [initialObjectRemoval, setInitialObjectRemoval] = useState<string | null>(null)
  const [componentPreview, setComponentPreview] = useState<{
    householdId: string; roomId: RoomId; components: readonly RoomComponent[]; placement: RoomComponent | null
  } | null>(null)
  const [roomAccess, setRoomAccess] = useState<RoomAccess | null>(null)
  const [roomAccessError, setRoomAccessError] = useState('')
  const [roomAccessRetry, setRoomAccessRetry] = useState(0)
  const savedComponents = useMemo(() => session ? getRoomComponents(session.household) : [], [session?.household.id, session?.household.roomComponents])
  const canEditRooms = !!session && roomAccess?.householdId === session.household.id && roomAccess.memberId === session.memberId
    && roomAccess.role !== 'member' && !roomAccessError
  const previewComponents = useCallback((components: readonly RoomComponent[] | null, placement: RoomComponent | null = null) => {
    const householdId = session?.household.id
    setComponentPreview((previous) => components && householdId ? { householdId, roomId: currentRoom, components, placement }
      : previous && previous.householdId === householdId && previous.roomId === currentRoom ? null : previous)
  }, [session?.household.id, currentRoom])

  const changeSavedKitchen = useCallback((token: string, change: SavedKitchenChange) => {
    setSaved((previous) => previous.map((kitchen) => kitchen.token === token ? { ...kitchen, ...change } : kitchen))
    try { setSaved(updateSavedKitchen(token, change)) } catch {
      setError('Browser access changed, but this browser could not save the updated kitchen shortcut. Keep this tab open until browser storage is available.')
    }
  }, [])

  useEffect(() => {
    if (!session) return
    for (const kitchen of saved) {
      if (kitchen.householdId !== session.household.id) continue
      const member = session.household.members.find((member) => member.id === kitchen.memberId)
      if (kitchen.name !== session.household.name || (member && kitchen.memberName !== member.name)) {
        changeSavedKitchen(kitchen.token, { name: session.household.name, ...(member ? { memberName: member.name } : {}) })
      }
    }
  }, [session, saved, changeSavedKitchen])

  const initialize = useCallback(() => {
    const attempt = ++startupAttempt.current
    setLoading(true)
    setError('')
    void (async () => {
      const accountState = await getAccountState()
      if (startupAttempt.current !== attempt) return
      accountRef.current = accountState
      setAccount(accountState)
      try { setSaved(savedKitchens()) } catch {
        setError('This browser could not read its saved kitchen shortcuts. Account sign-in and recovery remain available.')
      }
      if (accountState?.deletionPending) {
        setError('Account deletion is pending. Account kitchen access is disabled.')
        setDialog({ account: 'manage' })
        return
      }
      const restored = await loadSession(accountState)
      if (startupAttempt.current !== attempt) return
      if (restored.expiredBrowser) initialSession = undefined
      const next = restored.session
      sessionEpoch.current++
      sessionRef.current = next
      setSession(next)
      if (restored.expiredBrowser) changeSavedKitchen(restored.expiredBrowser, { expired: true })
      if (!next) {
        if (accountState?.account) {
          if (restored.expiredBrowser) preferAccountAccess()
          setError((previous) => previous || (restored.expiredBrowser
            ? 'Your older browser-only access ended. Choose, create or link a kitchen from your signed-in account.'
            : 'Choose, create or link a kitchen from your account.'))
          setDialog((previous) => previous ?? { account: 'manage' })
        } else {
          if (restored.expiredBrowser) setError((previous) => previous || 'Your browser access is no longer active. Sign in or recover your existing identity to reopen the room.')
          if (isRoomEntry()) setDialog((previous) => previous ?? { account: 'manage' })
        }
        return
      }
      setBillMonth(billingDate(next.household.billingTimeZone).slice(0, 7))
      setShoppingView('list')
      if (restored.expiredBrowser) setNotice(`Your older browser-only access ended. Opened ${next.household.name} through your signed-in account.`)
      if (enteringRoom.current && !initialAccount && !initialAccountInvite && !initialInvite && !initialRecovery) {
        enteringRoom.current = false
        setDialog(null)
      }
      try { setSaved(rememberKitchen(next)) } catch {
        setError('Your browser could not save this kitchen session. Keep this tab open until browser storage is available.')
      }
    })().catch((failure: unknown) => {
      if (startupAttempt.current !== attempt) return
      setError(failure instanceof Error ? failure.message : 'Your kitchen could not be opened.')
      if (isRoomEntry() && failure instanceof RequestError && failure.status === 401) {
        enteringRoom.current = true
        setDialog({ account: 'manage' })
        setError('Your browser access is no longer active. Sign in or recover your existing identity to reopen the room.')
        try { setSaved(savedKitchens()) } catch {
          setError('Sign in to reopen your home. This browser also could not read its saved kitchen shortcuts.')
        }
      }
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
  }, [changeSavedKitchen])
  useEffect(initialize, [initialize])
  useEffect(() => {
    const navigateAccess = () => {
      const params = new URLSearchParams(location.hash.slice(1))
      const accountInvite = params.get('account-invite') ?? ''
      const invite = params.get('join') ?? ''
      if (accountInvite) setDialog({ account: 'join' })
      else if (params.has('account')) {
        const intent = params.get('account')
        setDialog({ account: intent === 'create' || intent === 'join' ? intent : 'manage' })
      }
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
    if (session?.household.id) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [session?.household.id])
  useEffect(() => {
    setPage('overview')
    setChoreFilter({ room: currentRoom, area: null })
    setChoreView('active')
    setChoreMine(false)
    setSupplyRoom(currentRoom)
    setSelectedComponentId(null)
    setComponentPreview(null)
    setFocusRequest((previous) => ({ target: 'room', id: previous.id + 1 }))
  }, [currentRoom])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 6500)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => { setFormError(''); pendingMutation.current = null }, [dialog])
  useEffect(() => { pendingRoomMutation.current = null }, [currentRoom, session?.household.id, session?.memberId])

  const expireSession = useCallback((expected: KitchenSession, message: string, accountExpired = false) => {
    if (!sameKitchenSession(sessionRef.current, expected)) return
    startupAttempt.current++
    sessionEpoch.current++
    initialSession = undefined
    sessionRef.current = null
    setSession(null)
    if (accountExpired && expected.token === null && accountRef.current) {
      const next: AccountState = {
        configured: accountRef.current.configured, account: null, memberships: [], devices: [], csrfToken: null, session: null,
      }
      accountRef.current = next
      setAccount(next)
    }
    setLoading(false)
    setBusy(false)
    enteringRoom.current = isRoomEntry()
    setDialog(expected.token === null || isRoomEntry() ? { account: 'manage' } : null)
    setPage('overview')
    setStockEvent(null)
    setFormError('')
    setError(message)
    setSyncState('offline')
    if (expected.token !== null) changeSavedKitchen(expected.token, { expired: true })
  }, [changeSavedKitchen])

  useEffect(() => {
    const current = sessionRef.current
    if (!current) { setRoomAccess(null); setRoomAccessError(''); return }
    const controller = new AbortController()
    setRoomAccess((previous) => previous?.householdId === current.household.id && previous.memberId === current.memberId ? previous : null)
    void request('/household/room-access', { token: current.token, householdId: current.household.id,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then((data) => {
        const next = roomAccessSchema.parse(data)
        if (controller.signal.aborted || !sameKitchenSession(sessionRef.current, current)) return
        if (next.householdId !== current.household.id || next.memberId !== current.memberId) throw new Error('The room permissions did not match this household. Refresh access before editing.')
        if (next.version < (sessionRef.current?.household.version ?? 0)) return
        setRoomAccess((previous) => previous?.householdId === next.householdId && previous.memberId === next.memberId && previous.version > next.version ? previous : next)
        setRoomAccessError('')
      }).catch((failure: unknown) => {
        if (controller.signal.aborted || !sameKitchenSession(sessionRef.current, current)) return
        if (failure instanceof RequestError && failure.status === 401) {
          expireSession(current, failure.message, true)
          return
        }
        setRoomAccessError(failure instanceof Error ? failure.message : 'Room editing permissions could not be loaded.')
      })
    return () => controller.abort()
  }, [session?.token, session?.memberId, session?.household.id, session?.household.version, roomAccessRetry, expireSession])

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
        expireSession(current, failure.message, failure.status === 401)
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
    initialSession = Promise.resolve({ session: next })
    setError('')
    try { setSaved(rememberKitchen(next)) } catch {
      setError('Your browser could not remember this kitchen. Keep this tab open until browser storage is available.')
    }
    if (!keepDialog) history.replaceState(null, '', `${location.pathname}${location.search}`)
    setMonth(localDate().slice(0, 7))
    setBillMonth(billingDate(next.household.billingTimeZone).slice(0, 7))
    setShoppingView('list')
    setChoreView('active')
    setChoreMine(false)
    setChoreFilter({ room: currentRoom, area: null })
    setFilter('all')
    setPage('overview')
    if (!keepDialog) setDialog(null)
    setSyncState('saved')
    setStockEvent(null)
    setSelectedComponentId(null)
    setComponentPreview(null)
    setFocusRequest((previous) => ({ target: 'room', id: previous.id + 1 }))
    if (location.pathname === '/' && !keepDialog) history.replaceState(history.state, '', roomPath(currentRoom))
  }

  const action = async (path: string, body: Record<string, unknown>, success: string, method?: string, inline = false): Promise<boolean> => {
    if (!session || busy) return false
    const epoch = sessionEpoch.current
    const pending = path === '/household/room-components' ? pendingRoomMutation : pendingMutation
    setBusy(true)
    setFormError('')
    if (inline) setError('')
    try {
      let mutation: { mutationId: string; mutationVersion: number } | undefined
      if (path !== '/shopping/checkout') {
        const key = JSON.stringify([epoch, session.household.id, session.memberId, path, method ?? 'POST', inline ? body : null])
        if (pending.current?.key !== key) {
          if (!globalThis.crypto?.randomUUID) throw new Error('Use HTTPS or localhost to safely save a kitchen change.')
          pending.current = { key, id: crypto.randomUUID(), version: session.household.version }
        }
        mutation = { mutationId: pending.current.id, mutationVersion: pending.current.version }
      }
      const result = await request<{ household: unknown; replayed?: boolean }>(path, {
        token: session.token, csrfToken: session.token === null ? accountRef.current?.csrfToken : undefined,
        householdId: session.household.id, body: { ...body, ...mutation, version: session.household.version }, method,
      })
      if (sessionEpoch.current !== epoch || !sameKitchenSession(sessionRef.current, session)) return false
      const household = householdSchema.parse(result.household)
      setSession((previous) => previous && sameKitchenSession(previous, session) && household.version >= previous.household.version ? { ...previous, household } : previous)
      pending.current = null
      setNotice(result.replayed ? 'Your earlier change was already saved. The latest kitchen is now shown.' : success)
      if (!inline) setDialog(null)
      setSyncState('saved')
      if (!result.replayed && path === '/bills') setBillMonth(household.bills[0].startMonth)
      if (!result.replayed && (path === '/expenses' || path === '/shopping/checkout') && method !== 'DELETE') {
        const added = household.expenses[0]
        setMonth(added.date.slice(0, 7))
        setStockEvent({ id: added.id, category: added.category })
        setFilter('all')
        setPage('overview')
      }
      return true
    } catch (failure) {
      if (sessionEpoch.current !== epoch || !sameKitchenSession(sessionRef.current, session)) return false
      if (failure instanceof RequestError && failure.status === 401) {
        expireSession(session, failure.message, true)
        return false
      }
      const message = failure instanceof Error ? failure.message : 'The change could not be saved.'
      if (path === '/household/room-components' && failure instanceof RequestError && failure.code === 'MUTATION_PAYLOAD_CHANGED') pending.current = null
      if (failure instanceof RequestError && (failure.status === 0 || failure.status >= 500)) setSyncState('offline')
      if (inline) setError(message)
      else setFormError(message)
      if (failure instanceof RequestError && (failure.status === 409 || failure.status === 403)) {
        await refresh(failure.status === 403 && session.token === null)
        if (failure.status === 403) setRoomAccessRetry((attempt) => attempt + 1)
      }
      return false
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
      initialSession = Promise.resolve({ session: current })
      setLoading(false)
      setBusy(false)
      setError('')
    } else if (kind === 'signed-out' || kind === 'deleting' || (current?.token === null && !next.account)) {
      startupAttempt.current++
      sessionEpoch.current++
      initialSession = Promise.resolve({ session: null })
      sessionRef.current = null
      enteringRoom.current = isRoomEntry()
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
        initialSession = Promise.resolve({ session: null })
        sessionRef.current = null
        setSession(null)
        setLoading(false)
        setBusy(false)
        setError('Choose, create or link a kitchen from your account.')
      }
    } else if (current?.token === null && !next.memberships.some((membership) =>
      membership.householdId === current.household.id && membership.memberId === current.memberId)) {
      expireSession(current, 'Your membership changed. Choose an available kitchen from your account.')
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
    if (busy && page === 'room-edit') { setError('Wait for the room change to finish before opening another tool.'); return }
    setFormError('')
    if ((account?.configured || account?.account) && (next === 'create' || next === 'join' || next === 'invite')) {
      setDialog({ account: next === 'create' ? 'create' : next === 'join' ? 'join' : 'manage' })
    } else if (next === 'access' && session?.token === null) setDialog({ account: 'manage' })
    else setDialog(next)
  }
  const household = session?.household
  const otherKitchens = saved.filter((kitchen) => kitchen.token !== session?.token)
  const memberName = (id: string) => household?.members.find((member) => member.id === id)?.name ?? 'Unknown roommate'
  const exportLedger = () => {
    if (!household) return
    const runs = new Map(household.shopping.runs.map((run) => [run.id, run]))
    const rows: (string | number)[][] = [['Type', 'Date', 'Description', 'Amount', 'Currency', 'Paid by / From', 'Split with / To', 'Category', 'Billing month', 'Shopping items']]
    for (const expense of household.expenses) rows.push([
      expense.bill ? 'Bill' : 'Expense', expense.date, expense.description, (expense.amount / 100).toFixed(2), household.currency,
      memberName(expense.paidBy), expense.participants.map(memberName).join('; '), expense.bill ? 'Monthly bill' : categoryLabels[expense.category],
      expense.bill?.month ?? '',
      expense.shoppingRunId ? runs.get(expense.shoppingRunId)?.items.map((item) =>
        `${item.quantity} ${item.name}${item.notes ? ` (${item.notes})` : ''}${item.componentSources?.length ? ` [${item.componentSources.map((source) => `${roomCatalog[source.roomId].name}: ${source.componentName}`).join(', ')}]` : ''}`).join('; ') ?? '' : '',
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
    if (busy) return
    // A newer access choice wins, but finishing startup must not cancel recovery.
    const attempt = startupAttempt.current
    setBusy(true)
    setFormError('')
    try {
      const next = sessionSchema.parse(await request(endpoint, { body }))
      if (startupAttempt.current !== attempt) return
      adoptSession(next)
      setNotice(endpoint === '/recover' ? 'Welcome back. Your original roommate identity has been restored.'
        : endpoint === '/join' ? 'You are in. Welcome to the kitchen!' : 'A fresh start for your shared kitchen.')
    } catch (failure) {
      if (startupAttempt.current !== attempt) return
      setFormError(failure instanceof Error ? failure.message : 'Your kitchen could not be opened.')
    } finally { if (startupAttempt.current === attempt) setBusy(false) }
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
      if (failure instanceof RequestError && failure.status === 401) changeSavedKitchen(kitchen.token, { expired: true })
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
  const visit = (next: Page, focus: FocusRequest['target'] | null = pageFocus[next]) => {
    if (page === 'room-edit' && busy) { setError('Wait for the room change to finish before leaving the editor.'); return }
    if (next !== 'room-edit') { setComponentPreview(null); pendingRoomMutation.current = null }
    if (next !== 'objects' && next !== 'room-edit') setSelectedComponentId(null)
    setPage(next)
    setFormError('')
    setSearch('')
    setFilter('all')
    if (focus !== null) setFocusRequest((previous) => ({ target: focus, id: previous.id + 1 }))
  }
  const interact = (action: KitchenAction) => {
    if (action === 'stock') setShoppingView('list')
    const pages: Record<KitchenAction, Page> = { stock: 'shopping', ledger: 'groceries', budget: 'budget', roommates: 'kitchen', settle: 'settle' }
    visit(pages[action])
  }
  const openChores = (area: ChoreArea | null = null) => {
    setChoreFilter({ room: currentRoom, area })
    setChoreView('active')
    setChoreMine(false)
    visit('chores', area ? null : 'chores')
  }
  const openSupplies = (roomId = currentRoom) => {
    setSupplyRoom(roomId)
    visit('supplies')
  }
  const openRoomObjects = (id: string | null = null) => {
    setSelectedComponentId(id)
    visit('objects')
  }
  const editRoom = (id: string | null = null, remove = false) => {
    if (!canEditRooms) { setError(roomAccessError || 'Ask a household admin for room editing access.'); return }
    if (remove) {
      const component = savedComponents.find((component) => component.id === id && component.roomId === currentRoom && component.installed)
      if (!component || !roomSlots.find((slot) => slot.id === component.slotId)?.removable) {
        setError('That object cannot be removed from this room.')
        return
      }
    }
    if (page !== 'room-edit') pendingRoomMutation.current = null
    setInitialObjectRemoval(remove ? id : null)
    setSelectedComponentId(id)
    setFormError('')
    setError('')
    visit('room-edit')
  }
  const selectRoomComponent = (id: string) => {
    if (busy) return
    if (page === 'room-edit') setSelectedComponentId(id)
    else openRoomObjects(id)
  }
  const openComponentChores = (component: RoomComponent) => {
    setChoreFilter({ room: component.roomId, area: null, componentId: component.id })
    setChoreView('active')
    setChoreMine(false)
    visit('chores', null)
    setSelectedComponentId(component.id)
  }
  const createComponentChore = (component: RoomComponent, suggestion?: ComponentChoreSuggestion) => {
    openDialog({ createChore: {
      roomId: component.roomId, area: componentChoreArea(component), componentId: component.id,
      title: suggestion?.title, repeatDays: suggestion?.repeatDays,
    } })
  }
  const useRoomComponent = (component: RoomComponent) => {
    switch (component.kind) {
      case 'shopping-bag': interact('stock'); break
      case 'receipt-book': interact('ledger'); break
      case 'house-pot': interact('budget'); break
      case 'noticeboard': interact('roommates'); break
      case 'settlement-envelope': interact('settle'); break
      case 'supply-shelf': openSupplies(component.roomId); break
      case 'cleaning-caddy':
        setChoreFilter({ room: component.roomId, area: null })
        setChoreView('active')
        setChoreMine(false)
        visit('chores')
        break
      default: setError('Use this object through its supplies, chores or state controls.')
    }
  }
  const switchRoom = (value: string) => {
    const parsed = roomIdSchema.safeParse(value)
    if (!parsed.success) { setError('That room is not available in this home.'); return }
    if (parsed.data === currentRoom) return
    history.pushState(null, '', roomPath(parsed.data))
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const renderDialog = () => {
    if (!dialog) return null
    const close = () => {
      if (enteringRoom.current && !sessionRef.current) {
        location.assign(`/#${typeof dialog === 'object' && 'account' in dialog && dialog.account === 'create' ? 'home-start' : 'home-sign-in'}`)
        return
      }
      enteringRoom.current = false
      if (location.pathname === '/') {
        const current = sessionRef.current
        if (current) history.replaceState(history.state, '', roomPath(currentRoom))
        else { location.replace('/'); return }
      }
      const params = new URLSearchParams(location.hash.slice(1))
      if (['account', 'account-invite', 'join', 'recover'].some((key) => params.has(key))) {
        history.replaceState(history.state, '', `${location.pathname}${location.search}`)
      }
      setDialog(null)
    }
    const footerError = formError && <p className="form-error" role="alert">{formError}</p>
    const accountIntent = typeof dialog === 'object' && 'account' in dialog ? dialog.account
      : (account?.configured || account?.account) && (dialog === 'create' || dialog === 'join' || dialog === 'invite')
        ? dialog === 'create' ? 'create' : dialog === 'join' ? 'join' : 'manage' : null
    if (accountIntent) return <AccountDialog key={`account:${accessRouteVersion}`} autoEnter={enteringRoom.current}
      intent={accountIntent} initialState={account} initialInvite={accountInvitation || invitation} legacySession={session && session.token !== null ? session : null}
      savedLegacy={saved} onChange={handleAccountChange} onClose={close} onRecover={() => openDialog('recover')}
      onLegacyChange={changeSavedKitchen}
      onOpenLegacy={(kitchen) => switchKitchen(kitchen, true)} />
    if (dialog === 'help' && currentRoom !== 'kitchen') return <Modal title={`Your shared ${roomCatalog[currentRoom].name.toLowerCase()}.`} subtitle="Chores and supplies use the same household as your kitchen." onClose={close}>
      <div className="game-guide">
        <p><Check size={19} /><span><strong>Choose an object.</strong> {currentRoom === 'bathroom'
          ? 'The sink, mirror, bath, toilet and floor open chores for that area.'
          : 'The sofa, coffee table, plant, bin and floor open their care routines. Other objects open their supplies and suggested chores.'}</span></p>
        <p><Users size={19} /><span><strong>Share the work.</strong> Assign a person or rotation. Completing a chore records who did it and advances the next turn.</span></p>
        <p><Plus size={19} /><span><strong>Restock supplies.</strong> The supply shelf adds items to the existing shopping list. It does not record a purchase.</span></p>
        <p><Settings2 size={19} /><span><strong>Make the room yours.</strong> Room objects holds supplies, care and manual states. Admins use Edit room to preview appliances, fixtures and decorations before applying a shared change.</span></p>
      </div><p className="field-hint">Open Rooms to choose a room preview. Drag to turn the view, scroll or pinch to zoom, or use the camera controls. Chores and supplies also work without 3D.</p>
    </Modal>
    if (dialog === 'help') return <Modal title="A kitchen you can play with." subtitle="Real groceries, real shares. Just a much nicer place to keep track." onClose={close}>
      <div className="game-guide">
        <p><Snowflake size={19} /><span><strong>Peek in the fridge.</strong> Click a door to open it. Click a grocery to find the expenses on that shelf.</span></p>
        <p><Plus size={19} /><span><strong>Plan a grocery run.</strong> The shopping bag holds the shared list and your basket. Record the paid receipt to archive its items and stock the fridge.</span></p>
        <p><ReceiptText size={19} /><span><strong>Keep the receipts.</strong> The book holds groceries and monthly bills. Record a bill only after someone has paid it.</span></p>
        <p><Wallet size={19} /><span><strong>Watch the house pot.</strong> The coins represent the monthly budget you have left, not points or rewards.</span></p>
        <p><Users size={19} /><span><strong>Make room for your people.</strong> The noticeboard opens your household. The envelope sorts out repayments.</span></p>
        <p><Check size={19} /><span><strong>Keep up with chores.</strong> The cleaning caddy opens this room's tasks. Room supplies go onto the existing shopping list.</span></p>
        <p><Settings2 size={19} /><span><strong>Make the room yours.</strong> Room objects holds supplies, care and manual states. Admins use Edit room to preview appliances, furniture and decorations before applying a shared change.</span></p>
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
    if (dialog === 'rooms' && roomMenuAnchor) return <RoomPicker currentRoom={currentRoom} householdId={household.id} anchor={roomMenuAnchor} onClose={close} components={savedComponents} roomStyle={household.roomStyle}
      ledger={{ counts, memberCount: household.members.filter((member) => !member.inactive).length, expenseCount: household.expenses.length, fundFraction: remaining / household.budget }}
      onSelect={(roomId) => { switchRoom(roomId); setDialog(null) }} />
    if (dialog === 'room-admins') return <Modal title="Household admins." subtitle="Admins customize the rooms and can give another roommate admin access. Ownership and the shared ledger stay unchanged." onClose={close} busy={busy}>
      {roomAccess?.householdId === household.id && roomAccess.memberId === session.memberId
        ? <RoomAdminPanel access={roomAccess} busy={busy || !!roomAccessError}
          onChange={(memberId, role) => { void action(`/household/room-access/${memberId}`, { role }, role === 'admin' ? 'Room admin access granted.' : 'Room admin access removed.', 'PATCH') }} />
        : <p className="field-hint" role="status">Loading household permissions...</p>}
      {roomAccessError && <p className="form-error" role="alert">{roomAccessError}<button type="button" className="text-button" onClick={() => setRoomAccessRetry((attempt) => attempt + 1)}>Retry room access</button></p>}
      {footerError}
    </Modal>
    if (typeof dialog === 'object' && 'createChore' in dialog) return <Modal title="Add a household chore." subtitle="Choose a room, schedule and who takes turns." onClose={close} busy={busy}>
      <ChoreForm household={household} memberId={session.memberId} initialRoom={dialog.createChore.roomId} initialArea={dialog.createChore.area} busy={busy} error={footerError}
        initialComponentId={dialog.createChore.componentId} initialTitle={dialog.createChore.title} initialRepeatDays={dialog.createChore.repeatDays}
        onSubmit={(body) => { void action('/chores', body, 'Chore added to your household.') }} />
    </Modal>
    if (typeof dialog === 'object' && 'editChore' in dialog) return <Modal title="Edit a household chore." subtitle="Completed turns stay in history. Changes apply to the scheduled task." onClose={close} busy={busy}>
      <ChoreForm household={household} memberId={session.memberId} chore={dialog.editChore} initialRoom={dialog.editChore.roomId} busy={busy} error={footerError}
        onSubmit={(body) => { void action(`/chores/${dialog.editChore.id}`, body, 'Chore updated.', 'PATCH') }} />
    </Modal>
    if (typeof dialog === 'object' && ('completeChore' in dialog || 'archiveChore' in dialog)) {
      const completing = 'completeChore' in dialog
      const snapshot = completing ? dialog.completeChore : dialog.archiveChore
      const chore = household.chores.items.find((item) => item.id === snapshot.id)
      const allowed = !!chore && chore.version === snapshot.version && (!completing || (!chore.archived && chore.dueDate !== null))
      const assignee = chore ? choreAssignee(chore, household.members) : null
      const label = completing ? 'Record completion' : snapshot.archived ? 'Restore chore' : 'Archive chore'
      return <Modal title={completing ? 'Mark this chore done?' : snapshot.archived ? 'Restore this chore?' : 'Archive this chore?'}
        subtitle={completing ? 'This records a completed turn, not a payment.' : snapshot.archived ? 'The chore returns with its saved schedule. Previous history stays.' : 'The chore leaves the active list. Its history stays, and it can be restored later.'}
        onClose={close} busy={busy}>
        <div className="chore-confirmation"><h3>{snapshot.title}</h3><p>{choreLocationLabel(snapshot.roomId, snapshot.area,
          snapshot.componentId ? savedComponents.find((component) => component.id === snapshot.componentId)?.name ?? snapshot.componentName : undefined)}</p>
          {snapshot.dueDate && <p>Scheduled for {dateTitle(snapshot.dueDate, billingDate(household.billingTimeZone))}.</p>}
          {completing && <p>{assignee ? `Assigned to ${assignee.name}. ` : 'Unassigned. '}Completion will be recorded by {memberName(session.memberId)}.</p>}
        </div>
        {!allowed ? <p className="form-error" role="alert">This chore changed. Close the dialog and review its latest state before continuing.</p> : footerError}
        <div className="button-row"><button className="button secondary" disabled={busy} onClick={close}>Cancel</button>
          <button className="button primary" disabled={busy || !allowed} onClick={() => {
            if (completing) void action(`/chores/${snapshot.id}/complete`, { choreVersion: snapshot.version }, 'Chore completed. The next turn is up to date.')
            else void action(`/chores/${snapshot.id}/archive`, { choreVersion: snapshot.version, archived: !snapshot.archived }, snapshot.archived ? 'Chore restored.' : 'Chore archived. Its history is retained.', 'PATCH')
          }}>{label}</button>
        </div>
      </Modal>
    }
    if (typeof dialog === 'object' && 'undoChore' in dialog) {
      const completion = household.chores.history.find((item) => item.id === dialog.undoChore.id)
      const chore = household.chores.items.find((item) => item.id === dialog.undoChore.choreId)
      const allowed = !!completion && canUndoChore(chore, completion)
      return <Modal title="Undo this chore completion?" subtitle="Restore the previous due date and turn. A later edit or completion cannot be overwritten." onClose={close} busy={busy}>
        <div className="chore-confirmation"><h3>{dialog.undoChore.title}</h3><p>{choreLocationLabel(dialog.undoChore.roomId, dialog.undoChore.area, dialog.undoChore.componentName)}</p><p>Scheduled for {dateTitle(dialog.undoChore.dueDate, billingDate(household.billingTimeZone))}.</p></div>
        {!allowed ? <p className="form-error" role="alert">This completion can no longer be undone because the chore changed.</p> : footerError}
        <div className="button-row"><button className="button secondary" disabled={busy} onClick={close}>Keep completion</button>
          <button className="button primary" disabled={busy || !allowed} onClick={() => {
            if (chore) void action(`/chores/completions/${dialog.undoChore.id}/undo`, { choreVersion: chore.version }, 'Completion undone. The previous turn is restored.')
          }}>Undo completion</button>
        </div>
      </Modal>
    }
    if (typeof dialog === 'object' && 'restockItem' in dialog) return <Modal title="Restock a household supply." subtitle="Review the quantity before adding it to the shared shopping list." onClose={close} busy={busy}>
      <ShoppingItemForm household={household} memberId={session.memberId} initialItem={dialog.restockItem} preventDuplicate busy={busy} error={footerError}
        onSubmit={(body) => { void action('/shopping/items', body, 'Supply saved on the shared shopping list.') }} />
    </Modal>
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
      <RoomStyleForm current={household.roomStyle} busy={busy} canEdit={canEditRooms} error={footerError} onClose={close}
        onSubmit={(roomStyle) => { void action('/household/room-style', { roomStyle }, 'Room style saved for everyone.', 'PATCH') }} />
    </Modal>
    if (dialog === 'invite') return <Modal title="Better with roommates." subtitle="This private invitation lets a roommate join and edit your kitchen. Only share it with people you trust." onClose={close} busy={busy}>
      <Invite household={household} busy={busy} error={footerError} onRotate={() => { void action('/invite/rotate', {}, 'A fresh invitation is ready. The previous link no longer works.') }} />
    </Modal>
    if (typeof dialog === 'object' && 'transfer' in dialog) {
      const { transfer } = dialog
      return <Modal title="Call it even." subtitle="Only record this after the money has actually been paid. Roomlings calculates repayments; it does not move money." onClose={close} busy={busy}>
        <div className="payment-summary"><span>{memberName(transfer.from)} <ArrowRight size={16} /> {memberName(transfer.to)}</span><strong>{money(transfer.amount, household.currency)}</strong></div>
        {footerError}<button className="button primary full" disabled={busy} onClick={() => { void action('/settlements', { ...transfer }, 'Payment recorded. A little less owing, a little more sharing.') }}>{busy ? <LoadingIcon size={17} tone="light" /> : <Check size={17} />}Yes, record payment</button>
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

  if (!household || !session) return <div className="entry-shell">
    <div inert={!!dialog}>
      <Suspense fallback={<SceneLoading label="Opening your home..." />}>
        <Welcome paused={!!dialog} accessNotice={loading
          ? <p className="inline loading-status" role="status"><LoadingIcon size={20} />Checking saved access...</p>
          : error ? <><p className="form-error" role="alert">{error}</p><div className="button-row"><button className="button secondary" onClick={initialize}>Try again</button><button className="text-button" onClick={() => openDialog('recover')}>Recover access</button></div></> : null} />
      </Suspense>
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
  const today = billingDate(household.billingTimeZone)
  const roomDue = household.chores.items.filter((chore) => chore.roomId === currentRoom
    && ['due', 'overdue'].includes(choreStatus(chore, today)))
  const dueChores: Partial<Record<ChoreArea, number>> = {}
  for (const chore of roomDue) if (chore.area) dueChores[chore.area] = (dueChores[chore.area] ?? 0) + 1
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

  const activeComponentPreview = page === 'room-edit' && componentPreview?.householdId === household.id
    && componentPreview.roomId === currentRoom ? componentPreview : null
  const activePlacement = activeComponentPreview?.placement
  return <div className="game-app" data-page={page} data-component-panel={page === 'objects' || page === 'room-edit'} data-placement-preview={!!activePlacement}>
    <RoomPreviewPreloader householdId={household.id} components={savedComponents} roomStyle={household.roomStyle}
      ledger={{ counts, memberCount: household.members.filter((member) => !member.inactive).length, expenseCount: household.expenses.length, fundFraction: remaining / household.budget }} />
    <GameHome roomId={currentRoom}
      household={household} memberId={session.memberId} counts={counts} selected={filter}
      remaining={remaining} yourBalance={yourBalance} transferCount={transfers.length}
      receiptCount={household.expenses.length} monthControls={monthControls} monthLabel={monthTitle(month)}
      stockEvent={stockEvent} focusRequest={focusRequest} syncState={syncState} inert={dialog !== null && dialog !== 'rooms'}
      overviewFocus={page !== 'overview' && (dialog === 'room-style' || dialog === 'help' || dialog === 'settings' || dialog === 'room-admins')}
      busy={busy} roomsOpen={dialog === 'rooms'} onRooms={(anchor) => {
        setRoomMenuAnchor(anchor)
        if (dialog === 'rooms') setDialog(null)
        else openDialog('rooms')
      }} dueChores={dueChores} dueChoreCount={roomDue.length} onOpenChores={openChores} onRestock={() => openSupplies()}
      panelOpen={page !== 'overview'} activeTool={page === 'chores' || page === 'supplies' ? 'chores' : page === 'shopping' ? 'stock' : page === 'groceries' || page === 'bills' ? 'ledger' : page === 'budget' ? 'budget' : page === 'settle' ? 'settle' : page === 'kitchen' ? 'roommates' : page === 'objects' || page === 'room-edit' ? page : null}
      panelSide={page === 'objects' || page === 'room-edit' ? 'left' : 'right'}
      components={activeComponentPreview?.components ?? savedComponents}
      placementPreviewId={activePlacement?.id ?? null}
      editMode={page === 'room-edit'} selectedComponentId={selectedComponentId} onComponentSelect={selectRoomComponent}
      onObjects={() => { if (page === 'room-edit') setSelectedComponentId(null); else openRoomObjects() }}
      canEditRooms={canEditRooms} onRoomStyle={() => openDialog('room-style')} onHelp={() => openDialog('help')} onSettings={() => openDialog('settings')}
      onAction={interact} onInvite={() => openDialog('invite')}
      onSelect={(category) => { visit('groceries'); setFilter(category); setFocusRequest((previous) => ({ target: 'fridge', id: previous.id + 1 })) }}
    />
    {(error || (roomAccessError && !dialog)) && <div className="error-banner" role="alert">
      <span>{error || roomAccessError}{error && roomAccessError && error !== roomAccessError ? ` ${roomAccessError}` : ''}</span>
      {roomAccessError && <button className="text-button" onClick={() => setRoomAccessRetry((attempt) => attempt + 1)}>Retry room access</button>}
      {error && <button className="icon-button" onClick={() => setError('')} aria-label="Dismiss message"><X size={16} /></button>}
    </div>}
    {page !== 'overview' && (!dialog || dialog === 'rooms' || page === 'room-edit') && <RoomPanel
      title={activePlacement ? `Try ${activePlacement.name.trim() || componentCatalog[activePlacement.kind].name}`
        : { shopping: 'The shopping bag.', groceries: 'The receipt book.', bills: 'The receipt book.', settle: 'Keep it even.', kitchen: 'Your kind of people.', budget: 'The little house pot.', chores: 'Household chores.', supplies: `${roomCatalog[supplyRoom].name} supplies.`, objects: 'Components.', 'room-edit': 'Edit room.' }[page]}
      subtitle={{ shopping: 'Plan together. Record the receipt after someone has paid.', groceries: 'Paid grocery runs and shared costs for the selected month.', bills: 'The regular costs of home, in the same shared ledger.', settle: 'Repayments across groceries and bills, over all months.', kitchen: 'Your roommates and shared household settings.', budget: 'Your remaining grocery budget for the selected month.', chores: 'One schedule for your home, with room-by-room assignments and completed turns.', supplies: 'Use the same shopping list for supplies across your home.', objects: '', 'room-edit': '' }[page]}
      view={page === 'bills' ? `bills:${billMonth}` : page === 'shopping' ? `shopping:${shoppingView}` : page === 'chores' ? `chores:${choreView}:${choreFilter.room}:${choreFilter.area}:${choreFilter.componentId ?? ''}` : page === 'objects' ? `objects:${selectedComponentId ?? ''}` : page}
      suspended={dialog !== null && dialog !== 'rooms'} busy={page === 'room-edit' && busy}
      side={page === 'objects' || page === 'room-edit' ? 'left' : 'right'}
      compact={!!activePlacement}
      badge={page === 'objects' || page === 'room-edit' ? <span className={`room-panel-mode ${page === 'room-edit' ? 'editing' : 'live'}`}>{page === 'room-edit' ? 'Private preview' : 'Live room'}</span> : undefined}
      onClose={() => activePlacement ? setCancelPlacementRequest((request) => request + 1) : visit('overview')}
    ><div className="game-panel-content">
        {page === 'room-edit' && <RoomEditor key={`${household.id}:${currentRoom}`} household={household} roomId={currentRoom} busy={busy} canEdit={canEditRooms}
          error={formError ? <p className="form-error" role="alert">{formError}</p> : !canEditRooms ? <p className="form-error" role="alert">Room editing access is unavailable. Your draft is still here; an admin must restore your access before you can apply it.</p> : null}
          selectedComponentId={selectedComponentId} cancelPlacementRequest={cancelPlacementRequest} initialRemovalId={initialObjectRemoval}
          onSelect={setSelectedComponentId} onPreview={previewComponents}
          onSubmit={(patch) => action('/household/room-components', patch, 'Room updated for everyone.', 'PATCH')}
          onClose={() => visit('overview')} onManageAdmins={() => openDialog('room-admins')} onRoomColors={() => openDialog('room-style')} />}
        {page === 'objects' && <RoomObjectsPanel household={household} roomId={currentRoom} selectedComponentId={selectedComponentId} busy={busy} canEdit={canEditRooms}
          onSelect={setSelectedComponentId} onEdit={editRoom} onRemove={(id) => editRoom(id, true)} onRestock={(item) => openDialog({ restockItem: item })}
          onShopping={() => { setShoppingView('list'); visit('shopping') }} onCreateChore={createComponentChore} onOpenChores={openComponentChores}
          onState={(component, state) => { void action(`/room-components/${component.id}/state`, { componentVersion: component.version, state }, 'Object state saved for everyone.', 'PATCH', true) }}
          onUse={useRoomComponent} onHelp={() => openDialog('help')} />}
        {page === 'chores' && <ChoresPanel household={household} memberId={session.memberId} filter={choreFilter} onFilter={setChoreFilter} view={choreView} onView={setChoreView} mine={choreMine} onMine={setChoreMine} busy={busy}
          onAdd={() => {
            const component = savedComponents.find((component) => component.id === choreFilter.componentId && component.installed)
            if (component) createComponentChore(component)
            else openDialog({ createChore: { roomId: choreFilter.room === 'home' ? null : choreFilter.room === 'all' ? currentRoom : choreFilter.room, area: choreFilter.area } })
          }}
          onEdit={(chore) => openDialog({ editChore: chore })} onComplete={(chore) => openDialog({ completeChore: chore })}
          onArchive={(chore) => openDialog({ archiveChore: chore })} onUndo={(completion) => openDialog({ undoChore: completion })}
          onRestock={() => openSupplies(choreFilter.room === 'all' || choreFilter.room === 'home' ? currentRoom : choreFilter.room)} />}
        {page === 'supplies' && <RestockPanel household={household} roomId={supplyRoom} busy={busy}
          onAdd={(item) => openDialog({ restockItem: item })} onShopping={() => { setShoppingView('list'); visit('shopping') }} />}
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
          <button className="button secondary full" disabled={busy} onClick={() => openDialog('room-admins')}><Users size={16} />Household admins</button>
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
        {page === 'kitchen' && <div className="kitchen-layout"><section><div className="section-heading"><div><span className="eyebrow">WELCOME TO {household.name.toUpperCase()}</span><h2>A seat at the table.</h2></div><span className="count-pill">{household.members.filter((member) => !member.inactive).length} / 12</span></div><div className="roommate-grid">{household.members.map((member) => <div className="roommate-card" key={member.id}><Avatar member={member} /><h3>{member.name}</h3><span>{member.inactive ? 'Former roommate' : member.id === session.memberId ? 'That is you' : 'Fellow fridge explorer'}</span><div><ReceiptText size={15} />{household.expenses.filter((expense) => !expense.bill && expense.paidBy === member.id).length} grocery runs</div></div>)}<button className="roommate-card add-roommate" onClick={() => openDialog('invite')}><span className="add-circle"><Plus size={24} /></span><h3>One more?</h3><span>Invite a roommate</span></button></div></section><section className="kitchen-settings"><span className="eyebrow">THE HOUSE RULES</span><h2>Simple is good.</h2><div className="setting-row"><span>Monthly grocery pot</span><strong>{money(household.budget, household.currency)}</strong></div><div className="setting-row"><span>Currency</span><strong>{household.currency}</strong></div><div className="setting-row"><span>Split style</span><strong>Equally, with your people</strong></div><p className="muted-paragraph">Choose who shares each grocery run. Expenses are saved to this kitchen's server and synced with your roommates.</p><button className="button secondary full" onClick={() => openDialog('settings')}><Settings2 size={16} />Edit house rules</button><button className="text-button" onClick={exportLedger}><Download size={16} />Export the complete ledger</button><hr /><button className="text-button" onClick={() => openDialog('create')}><Plus size={16} />Create another kitchen</button><button className="text-button" onClick={() => openDialog('join')}><Link size={16} />Join a different kitchen</button>
          {otherKitchens.length > 0 && <div className="saved-kitchens"><span className="eyebrow">ALSO SAVED IN THIS BROWSER</span>{otherKitchens.map((kitchen) => <button key={kitchen.token} disabled={busy}
            aria-label={kitchen.expired ? `Recover access to ${kitchen.name}` : undefined}
            onClick={() => { if (kitchen.expired) openDialog('recover'); else void switchKitchen(kitchen) }}>
            <Home size={15} /><span><strong>{kitchen.name}</strong><small>Return as {kitchen.memberName}</small>{kitchen.expired && <small>Access expired. Recover access</small>}</span>
            {kitchen.expired ? <KeyRound size={14} /> : <ArrowRight size={14} />}
          </button>)}</div>}
          <p className="small-muted">{session.token === null ? 'Sign in with your account on any device. Account and membership manages your kitchens and sessions.' : 'Kitchen sessions are saved in this browser. Use the same browser to return as your existing roommate identity.'}</p></section></div>}
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
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}<button className="button primary full" disabled={busy}>{busy ? <LoadingIcon size={17} tone="light" /> : <ArrowRight size={17} />}Join the kitchen</button>
  </Form>
}

function SettingsForm({ household, busy, error, onSubmit }: { household: Household; busy: boolean; error: ReactNode; onSubmit: (body: Record<string, unknown>) => void }) {
  const [name, setName] = useState(household.name)
  const [budget, setBudget] = useState((household.budget / 100).toFixed(2))
  const [currency, setCurrency] = useState<string>(household.currency)
  const [reviewed, setReviewed] = useState({ name: household.name, budget: household.budget, currency: household.currency })
  const [localError, setLocalError] = useState('')
  const currencyLocked = household.expenses.length > 0 || household.settlements.length > 0 || household.bills.length > 0
  const changed = reviewed.name !== household.name || reviewed.budget !== household.budget || reviewed.currency !== household.currency
  const currentCurrency = currencyLocked ? household.currency : currency
  return <Form onSubmit={() => {
    if (changed) { setLocalError('Review the latest house rules before saving.'); return }
    const amount = parseMoney(budget)
    if (!amount) { setLocalError('Enter a positive budget with up to two decimal places.'); return }
    setLocalError('')
    onSubmit({ name, budget: amount, currency: currentCurrency })
  }}>
    <label className="field">Kitchen name<input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
    <div className="field-row"><label className="field">Monthly budget<input required inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} disabled={busy} /></label><label className="field">Currency<Dropdown label="Currency" value={currentCurrency} onValueChange={setCurrency} disabled={busy || currencyLocked}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</Dropdown></label></div>
    <p className="field-hint">The monthly grocery target applies to every month. {currencyLocked && 'Currency stays fixed after adding expenses or monthly bills.'}</p>
    {changed && <DraftConflict
      onLatest={() => {
        setName(household.name); setBudget((household.budget / 100).toFixed(2)); setCurrency(household.currency)
        setReviewed({ name: household.name, budget: household.budget, currency: household.currency }); setLocalError('')
      }}
      onKeep={() => { setReviewed({ name: household.name, budget: household.budget, currency: household.currency }); setLocalError('') }}
    >The house rules changed. Review the latest values before saving your draft.</DraftConflict>}
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}<button className="button primary full" disabled={busy || changed}>{busy ? 'Saving...' : 'Save the house rules'}<Check size={17} /></button>
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
