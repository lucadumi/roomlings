import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRight, Check, CheckCheck,
  ChevronLeft, ChevronRight, CircleHelp, Copy, Download, Home, Leaf, Link, LoaderCircle,
  Plus, ReceiptText, RefreshCw, Search, Settings2, Snowflake, Trash2, Users, Wallet, X,
} from 'lucide-react'
import {
  balances, categories, categoryLabels, currencies, escapeCsv, householdSchema, localDate,
  money, monthlyExpenses, parseMoney, splitAmount, suggestedTransfers,
} from '../shared/domain.ts'
import type { Category, Expense, Household, Session, Settlement, Transfer } from '../shared/domain.ts'
import { createDemo, getHousehold, readToken, rememberKitchen, request, RequestError, saveToken, sessionSchema } from './api.ts'
import type { SavedKitchen } from './api.ts'
import { Avatar, CategoryIcon, Form, Modal, RoomPanel } from './components.tsx'
import { GameHome } from './GameHome.tsx'
import type { KitchenAction } from './room.ts'
import type { FocusRequest } from './camera.ts'

type Page = 'overview' | 'groceries' | 'settle' | 'kitchen' | 'budget'
type Dialog = 'expense' | 'create' | 'join' | 'invite' | 'settings' | 'help' | { transfer: Transfer } | { remove: Expense } | { undo: Settlement } | null
const initialInvite = new URLSearchParams(location.hash.slice(1)).get('join') ?? ''
let initialSession: Promise<Session> | undefined

function loadSession(): Promise<Session> {
  if (!initialSession) {
    initialSession = (async () => {
      const token = readToken()
      if (token) return { token, ...await getHousehold(token) }
      const demo = await createDemo()
      saveToken(demo.token)
      return demo
    })().catch((error: unknown) => { initialSession = undefined; throw error })
  }
  return initialSession
}

function monthTitle(month: string, short = false): string {
  return new Intl.DateTimeFormat('en-GB', { month: short ? 'short' : 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00`))
}

function dateTitle(date: string): string {
  if (date === localDate()) return 'Today'
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (date === localDate(yesterday)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [page, setPage] = useState<Page>('overview')
  const [dialog, setDialog] = useState<Dialog>(initialInvite ? 'join' : null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [month, setMonth] = useState(localDate().slice(0, 7))
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [search, setSearch] = useState('')
  const [syncState, setSyncState] = useState<'saved' | 'offline'>('saved')
  const [saved, setSaved] = useState<SavedKitchen[]>([])
  const [stockEvent, setStockEvent] = useState<{ id: string; category: Category } | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ target: 'room', id: 0 })

  const initialize = useCallback(() => {
    setLoading(true)
    setError('')
    loadSession().then((next) => {
      setSession(next)
      try { setSaved(rememberKitchen(next)) } catch {
        setError('Your browser could not save this kitchen session. Keep this tab open until browser storage is available.')
      }
    }).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : 'Your kitchen could not be opened.')
    }).finally(() => setLoading(false))
  }, [])
  useEffect(initialize, [initialize])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 6500)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => { setFormError('') }, [dialog])

  const refresh = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    try {
      const fresh = await getHousehold(current.token)
      setSession((previous) => previous?.token === current.token && fresh.household.version >= previous.household.version ? { ...previous, ...fresh } : previous)
      setSyncState('saved')
    } catch (failure) {
      setSyncState('offline')
      if (failure instanceof RequestError && failure.status === 401) setError(failure.message)
    }
  }, [])
  useEffect(() => {
    if (!session?.token) return
    const interval = window.setInterval(() => { if (!document.hidden) void refresh() }, 12_000)
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { clearInterval(interval); window.removeEventListener('focus', focus) }
  }, [session?.token, refresh])

  const adoptSession = (next: Session) => {
    setSession(next)
    initialSession = Promise.resolve(next)
    setError('')
    try { setSaved(rememberKitchen(next)) } catch {
      setError('Your browser could not remember this kitchen. Keep this tab open until browser storage is available.')
    }
    history.replaceState(null, '', `${location.pathname}${location.search}`)
    setMonth(localDate().slice(0, 7))
    setFilter('all')
    setPage('overview')
    setDialog(null)
    setSyncState('saved')
    setStockEvent(null)
    setFocusRequest((previous) => ({ target: 'room', id: previous.id + 1 }))
  }

  const action = async (path: string, body: Record<string, unknown>, success: string, method?: string) => {
    if (!session || busy) return
    setBusy(true)
    setFormError('')
    try {
      const result = await request<{ household: unknown }>(path, { token: session.token, body: { ...body, version: session.household.version }, method })
      const household = householdSchema.parse(result.household)
      setSession((previous) => previous?.token === session.token && household.version >= previous.household.version ? { ...previous, household } : previous)
      setNotice(success)
      setDialog(null)
      setSyncState('saved')
      if (path === '/expenses' && method !== 'DELETE') {
        const added = household.expenses[0]
        setMonth(added.date.slice(0, 7))
        setStockEvent({ id: added.id, category: added.category })
        setFilter('all')
        setPage('overview')
      }
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'The change could not be saved.')
      if (failure instanceof RequestError && failure.status === 409) await refresh()
    } finally { setBusy(false) }
  }

  const openDialog = (next: Dialog) => { setFormError(''); setDialog(next) }
  const household = session?.household
  const memberName = (id: string) => household?.members.find((member) => member.id === id)?.name ?? 'Unknown roommate'
  const exportLedger = () => {
    if (!household) return
    const rows: (string | number)[][] = [['Type', 'Date', 'Description', 'Amount', 'Currency', 'Paid by / From', 'Split with / To', 'Category']]
    for (const expense of household.expenses) rows.push([
      'Expense', expense.date, expense.description, (expense.amount / 100).toFixed(2), household.currency,
      memberName(expense.paidBy), expense.participants.map(memberName).join('; '), categoryLabels[expense.category],
    ])
    for (const settlement of household.settlements) rows.push([
      'Repayment', settlement.createdAt.slice(0, 10), 'Recorded repayment', (settlement.amount / 100).toFixed(2),
      household.currency, memberName(settlement.from), memberName(settlement.to), '',
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
      setNotice(endpoint === '/join' ? 'You are in. Welcome to the kitchen!' : 'A fresh start for your shared kitchen.')
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : 'Your kitchen could not be opened.')
    } finally { setBusy(false) }
  }

  const switchKitchen = async (kitchen: SavedKitchen) => {
    setBusy(true)
    try {
      const next = await getHousehold(kitchen.token)
      adoptSession({ token: kitchen.token, ...next })
      setNotice(`Welcome back to ${next.household.name}.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That kitchen could not be opened.')
    } finally { setBusy(false) }
  }

  const changeMonth = (direction: number) => {
    const date = new Date(`${month}-15T12:00:00`)
    date.setMonth(date.getMonth() + direction)
    setMonth(localDate(date).slice(0, 7))
  }
  const visit = (next: Page) => {
    setPage(next)
    setSearch('')
    setFilter('all')
    if (next === 'overview') setFocusRequest((previous) => ({ target: 'room', id: previous.id + 1 }))
  }
  const interact = (action: KitchenAction) => {
    setFocusRequest((previous) => ({ target: action, id: previous.id + 1 }))
    if (action === 'stock') openDialog('expense')
    else {
      const pages: Record<Exclude<KitchenAction, 'stock'>, Page> = { ledger: 'groceries', budget: 'budget', roommates: 'kitchen', settle: 'settle' }
      visit(pages[action])
    }
  }

  const renderDialog = () => {
    if (!dialog) return null
    const close = () => setDialog(null)
    const footerError = formError && <p className="form-error" role="alert">{formError}</p>
    if (dialog === 'help') return <Modal title="A kitchen you can play with." subtitle="Real groceries, real shares. Just a much nicer place to keep track." onClose={close}>
      <div className="game-guide">
        <p><Snowflake size={19} /><span><strong>Peek in the fridge.</strong> Click a door to open it. Click a grocery to find the expenses on that shelf.</span></p>
        <p><Plus size={19} /><span><strong>Unpack a grocery run.</strong> Click the shopping bag. Save an expense and watch the groceries fly into the fridge.</span></p>
        <p><ReceiptText size={19} /><span><strong>Keep the receipts.</strong> The little book holds your shared shopping history.</span></p>
        <p><Wallet size={19} /><span><strong>Watch the house pot.</strong> The coins represent the monthly budget you have left, not points or rewards.</span></p>
        <p><Users size={19} /><span><strong>Make room for your people.</strong> The noticeboard opens your household. The envelope sorts out repayments.</span></p>
      </div><p className="field-hint">Drag to turn the room. Scroll or pinch to zoom. Selecting an object brings it closer while its details stay beside the room. Use Whole room to pull back, or tap the kettle for a little tea break. Everything is also available from the toolbar. The fridge visualizes purchases, not what is left to eat.</p>
    </Modal>
    if (dialog === 'create') return <Modal title="Make room for your people." subtitle="Start a fresh kitchen, then invite your roommates. You can switch back to saved kitchens from The roommates." onClose={close} busy={busy}>
      <CreateForm busy={busy} error={footerError} onSubmit={(body) => { void newSession('/households', body) }} />
      <button className="text-button centered" disabled={busy} onClick={() => openDialog('join')}>Already have an invitation? Join a kitchen <ArrowRight size={14} /></button>
    </Modal>
    if (dialog === 'join') return <Modal title="There is a place for you." subtitle="Use the invitation your roommate shared. Everyone with the link can join and edit the shared ledger." onClose={close} busy={busy}>
      <JoinForm initialInvite={initialInvite} busy={busy} error={footerError} onSubmit={(body) => { void newSession('/join', body) }} />
    </Modal>
    if (!household || !session) return null
    if (dialog === 'expense') return <Modal title="What is in the bag?" subtitle="Unpack a grocery run. We will take care of the splitting." onClose={close} busy={busy}>
      <ExpenseForm household={household} memberId={session.memberId} busy={busy} error={footerError} onSubmit={(body) => { void action('/expenses', body, 'Fridge stocked. Groceries shared. All saved.') }} />
    </Modal>
    if (dialog === 'settings') return <Modal title="A few house rules." subtitle="A shared budget keeps everyone on the same page." onClose={close} busy={busy}>
      <SettingsForm household={household} busy={busy} error={footerError} onSubmit={(body) => { void action('/household', body, 'Your house rules have been updated.', 'PATCH') }} />
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
    if (typeof dialog === 'object' && 'remove' in dialog) return <Modal title="Remove this grocery run?" subtitle={`"${dialog.remove.description}" will be removed from everyone's ledger. Existing payments will stay and balances will be recalculated.`} onClose={close} busy={busy}>
      {footerError}<div className="button-row"><button className="button secondary" disabled={busy} onClick={close}>Keep it</button><button className="button primary" disabled={busy} onClick={() => { void action(`/expenses/${dialog.remove.id}`, {}, 'Grocery run removed. Balances have been recalculated.', 'DELETE') }}>{busy ? 'Removing...' : 'Remove grocery run'}</button></div>
    </Modal>
    if (typeof dialog === 'object' && 'undo' in dialog) return <Modal title="Undo this recorded payment?" subtitle="This only changes the shared ledger. It will not return money that has already been transferred." onClose={close} busy={busy}>
      {footerError}<div className="button-row"><button className="button secondary" disabled={busy} onClick={close}>Keep it</button><button className="button primary" disabled={busy} onClick={() => { void action(`/settlements/${dialog.undo.id}`, {}, 'Recorded payment undone.', 'DELETE') }}>{busy ? 'Saving...' : 'Undo payment record'}</button></div>
    </Modal>
    return null
  }

  if (!household || !session) return <div className="welcome-screen">
    <div className="brand"><span className="brand-mark"><Snowflake size={23} /></span>roomlings<span className="brand-period">.</span></div>
    <div className="welcome-content"><span className="eyebrow">A HAPPIER SHARED KITCHEN</span><h1>A full fridge.<br /><em>A fair share.</em></h1>
      {loading ? <p className="inline"><LoaderCircle className="spin" size={19} /> Opening the kitchen...</p> : <><p className="form-error" role="alert">{error}</p><div className="button-row"><button className="button primary" onClick={initialize}>Try again</button><button className="button secondary" onClick={() => openDialog('join')}>Join a kitchen</button><button className="text-button" onClick={() => openDialog('create')}>Create a kitchen</button></div></>}
    </div>{renderDialog()}
  </div>

  const expenses = monthlyExpenses(household, month)
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
    <div className="section-heading"><div><span className="eyebrow">LITTLE RUNS, SHARED GOODNESS</span><h2>The grocery ledger<span className="count-pill">{expenses.length}</span></h2></div>
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
      expenseCount={expenses.length} monthControls={monthControls} monthLabel={monthTitle(month)}
      stockEvent={stockEvent} focusRequest={focusRequest} syncState={syncState} inert={dialog !== null}
      panelOpen={page !== 'overview'} activeTool={page === 'groceries' ? 'ledger' : page === 'budget' ? 'budget' : page === 'settle' ? 'settle' : page === 'kitchen' ? 'roommates' : null}
      onAction={interact} onCreate={() => openDialog('create')} onInvite={() => openDialog('invite')}
      onSettings={() => openDialog('settings')} onHelp={() => openDialog('help')}
      onSelect={(category) => { visit('groceries'); setFilter(category); setFocusRequest((previous) => ({ target: 'fridge', id: previous.id + 1 })) }}
    />
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss message"><X size={16} /></button></div>}
    {page !== 'overview' && !dialog && <RoomPanel
      title={{ groceries: 'The receipt book.', settle: 'Keep it even.', kitchen: 'Your kind of people.', budget: 'The little house pot.' }[page]}
      subtitle={{ groceries: 'Every little thing you brought home, all in one place.', settle: 'Real repayments, without the awkward conversations.', kitchen: 'One kitchen. Different tastes. Always a fair share.', budget: 'The coins in your jar show how much of this month is left to enjoy.' }[page]}
      onClose={() => visit('overview')}
    ><div className="game-panel-content">
        {page === 'groceries' && <><div className="panel-period">{monthControls}<button className="button primary small-button" onClick={() => openDialog('expense')}><Plus size={15} />Add grocery run</button></div><div className="grocery-summary"><div><span className="eyebrow">SPENT TOGETHER</span><strong>{money(total, household.currency)}</strong></div><div><span className="eyebrow">GROCERY RUNS</span><strong>{expenses.length.toString().padStart(2, '0')}</strong></div><div className="category-breakdown">{categories.filter((category) => totals[category] > 0).map((category) => <button key={category} onClick={() => setFilter(category)} className={`breakdown-item ${category}`}><CategoryIcon category={category} size={16} /><span>{categoryLabels[category]}</span><strong>{money(totals[category], household.currency)}</strong></button>)}</div></div>{ledger}</>}
        {page === 'budget' && <><div className="panel-period">{monthControls}<button className="button secondary small-button" onClick={() => openDialog('settings')}><Settings2 size={15} />Edit monthly budget</button></div><section className="budget-panel"><div className="card-topline"><span className="eyebrow">SPENT TOGETHER</span><Leaf size={19} /></div><div className="spend-amount">{money(total, household.currency)}<span>of {money(household.budget, household.currency)}</span></div><div className="budget-track" role="meter" aria-label="Monthly grocery spending" aria-valuemin={0} aria-valuemax={household.budget} aria-valuenow={Math.min(total, household.budget)} aria-valuetext={`${money(total, household.currency)} spent out of ${money(household.budget, household.currency)}`}><div style={{ width: `${progress * 100}%` }} className={remaining < 0 ? 'over-budget' : ''} /></div><div className="budget-labels"><strong className={remaining < 0 ? 'negative' : ''}>{money(Math.abs(remaining), household.currency)} {remaining < 0 ? 'over budget' : 'left to enjoy'}</strong><span>{expenses.length} grocery runs</span></div><p className="budget-note">{remaining < 0 ? 'The pot is empty for this month. Maybe a pantry dinner tonight?' : 'A little room for the essentials. And a little treat.'}</p></section><div className="budget-categories">{categories.map((category) => <button key={category} onClick={() => { visit('groceries'); setFilter(category) }}><span className={`category-icon ${category}`}><CategoryIcon category={category} /></span><span>{categoryLabels[category]}</span><strong>{money(totals[category], household.currency)}</strong><ArrowRight size={15} /></button>)}</div><p className="field-hint">The jar represents your remaining monthly budget, not a bank account. The app never moves money.</p></>}
        {page === 'settle' && <div className="settle-layout"><div><section className="repayments-panel"><div className="section-heading"><div><span className="eyebrow">ALL-TIME BALANCES, SIMPLIFIED</span><h2>A shorter way to square.</h2></div><span className="round-stamp"><CheckCheck size={24} /></span></div><p className="section-description">Instead of paying back every grocery run, make these {transfers.length || 'zero'} {transfers.length === 1 ? 'payment' : 'payments'}. Calculated automatically, down to the last cent.</p>
          {transfers.map((transfer) => <div className="transfer-row" key={`${transfer.from}-${transfer.to}`}><div className="transfer-people"><Avatar member={household.members.find((member) => member.id === transfer.from)!} small /><strong>{memberName(transfer.from)}</strong><ArrowRight size={17} /><Avatar member={household.members.find((member) => member.id === transfer.to)!} small /><strong>{memberName(transfer.to)}</strong></div><div className="transfer-action"><strong>{money(transfer.amount, household.currency)}</strong><button className="button secondary small-button" onClick={() => openDialog({ transfer })}><Check size={14} />Record paid</button></div></div>)}
          {!transfers.length && <div className="empty-state"><CheckCheck size={42} className="sage-text" /><h3>All square. How lovely.</h3><p>No one owes a thing. There is probably a dinner to celebrate.</p></div>}
          <div className="info-note"><CircleHelp size={17} /><p>Roomlings does not send money. Pay your roommate however you like, then record it here. Cent remainders are shared deterministically, so the ledger always adds up.</p></div></section>
          <section className="payment-history"><div className="section-heading"><h2>All paid, all good.</h2><span className="small-muted">Payment history</span></div>{household.settlements.length ? household.settlements.map((settlement) => <div className="history-row" key={settlement.id}><span className="history-check"><Check size={17} /></span><div><strong>{memberName(settlement.from)} paid {memberName(settlement.to)}</strong><span>{dateTitle(settlement.createdAt.slice(0, 10))}</span></div><strong>{money(settlement.amount, household.currency)}</strong><button className="text-button" onClick={() => openDialog({ undo: settlement })}>Undo</button></div>) : <p className="muted-paragraph">Recorded payments will find a home here.</p>}</section></div><section className="household-panel settle-balances"><div className="card-topline"><span className="eyebrow">WHERE EVERYONE STANDS</span></div>{balanceList}<div className="handwritten-note">Fair shares.<br />Full plates.</div></section></div>}
        {page === 'kitchen' && <div className="kitchen-layout"><section><div className="section-heading"><div><span className="eyebrow">WELCOME TO {household.name.toUpperCase()}</span><h2>A seat at the table.</h2></div><span className="count-pill">{household.members.length} / 12</span></div><div className="roommate-grid">{household.members.map((member) => <div className="roommate-card" key={member.id}><Avatar member={member} /><h3>{member.name}</h3><span>{member.id === session.memberId ? 'That is you' : 'Fellow fridge explorer'}</span><div><ReceiptText size={15} />{household.expenses.filter((expense) => expense.paidBy === member.id).length} grocery runs</div></div>)}<button className="roommate-card add-roommate" onClick={() => openDialog('invite')}><span className="add-circle"><Plus size={24} /></span><h3>One more?</h3><span>Invite a roommate</span></button></div></section><section className="kitchen-settings"><span className="eyebrow">THE HOUSE RULES</span><h2>Simple is good.</h2><div className="setting-row"><span>Monthly grocery pot</span><strong>{money(household.budget, household.currency)}</strong></div><div className="setting-row"><span>Currency</span><strong>{household.currency}</strong></div><div className="setting-row"><span>Split style</span><strong>Equally, with your people</strong></div><p className="muted-paragraph">Choose who shares each grocery run. Expenses are saved to this kitchen's server and synced with your roommates.</p><button className="button secondary full" onClick={() => openDialog('settings')}><Settings2 size={16} />Edit house rules</button><button className="text-button" onClick={exportLedger}><Download size={16} />Export the complete ledger</button><hr /><button className="text-button" onClick={() => openDialog('create')}><Plus size={16} />Create another kitchen</button><button className="text-button" onClick={() => openDialog('join')}><Link size={16} />Join a different kitchen</button>{saved.filter((kitchen) => kitchen.token !== session.token).length > 0 && <div className="saved-kitchens"><span className="eyebrow">ALSO SAVED IN THIS BROWSER</span>{saved.filter((kitchen) => kitchen.token !== session.token).map((kitchen) => <button key={kitchen.token} disabled={busy} onClick={() => { void switchKitchen(kitchen) }}><Home size={15} /><span><strong>{kitchen.name}</strong><small>Return as {kitchen.memberName}</small></span><ArrowRight size={14} /></button>)}</div>}<p className="small-muted">Kitchen sessions are saved in this browser. Use the same browser to return as your existing roommate identity.</p></section></div>}
    </div></RoomPanel>}
    {notice && <div className="toast" role="status"><Check size={17} /><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={14} /></button></div>}
    {renderDialog()}
  </div>
}

function ExpenseForm({ household, memberId, busy, error, onSubmit }: { household: Household; memberId: string; busy: boolean; error: ReactNode; onSubmit: (body: Record<string, unknown>) => void }) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(memberId)
  const [participants, setParticipants] = useState(household.members.map((member) => member.id))
  const [category, setCategory] = useState<Category>('produce')
  const [date, setDate] = useState(localDate())
  const [localError, setLocalError] = useState('')
  const cents = parseMoney(amount)
  const shares = cents && participants.length ? splitAmount(cents, participants) : null
  return <Form onSubmit={() => {
    if (!cents) { setLocalError('Enter a positive amount with no more than two decimal places.'); return }
    if (!participants.length) { setLocalError('Choose at least one roommate to split with.'); return }
    setLocalError('')
    onSubmit({ description, amount: cents, paidBy, participants, category, date })
  }}>
    <label className="field">What did you pick up?<input required maxLength={100} placeholder="e.g. The big weekly shop" value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} /></label>
    <div className="field-row"><label className="field">Total ({household.currency})<input required inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} /></label><label className="field">Date<input type="date" required value={date} max={localDate()} onChange={(event) => setDate(event.target.value)} disabled={busy} /></label></div>
    <div className="field-row"><label className="field">Paid by<select value={paidBy} onChange={(event) => setPaidBy(event.target.value)} disabled={busy}>{household.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label className="field">On which shelf?<select value={category} onChange={(event) => setCategory(event.target.value as Category)} disabled={busy}>{categories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></label></div>
    <fieldset className="split-fieldset"><legend>Share it with</legend><div className="participant-options">{household.members.map((member) => <label className={`participant-option${participants.includes(member.id) ? ' chosen' : ''}`} key={member.id}><input type="checkbox" checked={participants.includes(member.id)} disabled={busy} onChange={(event) => setParticipants((previous) => event.target.checked ? [...previous, member.id] : previous.filter((id) => id !== member.id))} /><Avatar member={member} small /><span>{member.name}</span>{participants.includes(member.id) && <Check size={13} />}</label>)}</div></fieldset>
    {shares && <div className="split-preview">{household.members.filter((member) => participants.includes(member.id)).map((member) => <span key={member.id}>{member.name} <strong>{money(shares.get(member.id) ?? 0, household.currency)}</strong></span>)}</div>}
    {(localError || error) && <div>{localError && <p className="form-error" role="alert">{localError}</p>}{error}</div>}
    <button className="button primary full" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <Plus size={17} />} {busy ? 'Adding to the kitchen...' : 'Add & split the groceries'}</button>
    <p className="form-footnote">Shared equally, with any spare cents split fairly.</p>
  </Form>
}

function CreateForm({ busy, error, onSubmit }: { busy: boolean; error: ReactNode; onSubmit: (body: Record<string, unknown>) => void }) {
  const [name, setName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [budget, setBudget] = useState('450')
  const [localError, setLocalError] = useState('')
  return <Form onSubmit={() => { const amount = parseMoney(budget); if (!amount) { setLocalError('Enter a positive monthly budget.'); return }; setLocalError(''); onSubmit({ name, memberName, currency, budget: amount }) }}>
    <label className="field">What do you call home?<input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. The Sunday House" disabled={busy} /></label>
    <label className="field">Your name<input required maxLength={50} value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="What should your roommates call you?" disabled={busy} /></label>
    <div className="field-row"><label className="field">Monthly grocery budget<input required inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} disabled={busy} /></label><label className="field">Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy}>{currencies.map((value) => <option key={value}>{value}</option>)}</select></label></div>
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}
    <button className="button primary full" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <Home size={17} />}{busy ? 'Making room...' : 'Create our kitchen'}</button>
  </Form>
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
  const currencyLocked = household.expenses.length > 0 || household.settlements.length > 0
  return <Form onSubmit={() => { const amount = parseMoney(budget); if (!amount) { setLocalError('Enter a positive budget with up to two decimal places.'); return }; setLocalError(''); onSubmit({ name, budget: amount, currency }) }}>
    <label className="field">Kitchen name<input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
    <div className="field-row"><label className="field">Monthly budget<input required inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} disabled={busy} /></label><label className="field">Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy || currencyLocked}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label></div>
    <p className="field-hint">The monthly target applies to every month. {currencyLocked && 'Currency stays fixed after the first expense to keep your ledger accurate.'}</p>
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}<button className="button primary full" disabled={busy}>{busy ? 'Saving...' : 'Save the house rules'}<Check size={17} /></button>
  </Form>
}

function Invite({ household, busy, error, onRotate }: { household: Household; busy: boolean; error: ReactNode; onRotate: () => void }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const link = `${location.origin}${location.pathname}#join=${encodeURIComponent(household.inviteCode)}`
  return <div className="invite-content"><label className="field">Your private kitchen invitation<input readOnly value={link} onFocus={(event) => event.target.select()} /></label><button className="button primary full" onClick={() => {
    if (!navigator.clipboard) { setCopyError('Clipboard access needs HTTPS or localhost. Select the invitation above and copy it manually.'); return }
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setCopyError('') }).catch(() => setCopyError('Your browser could not copy the link. Select the field above and copy it manually.'))
  }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Invitation copied' : 'Copy invitation'}</button>
    {location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? <p className="field-hint">This is a local development link. To invite other devices, run the production build on a shared HTTPS host and copy its invitation instead.</p> : null}
    {copyError && <p className="form-error" role="alert">{copyError}</p>}{error}<div className="invite-rotate"><p>Need to retire an old invitation? A new one stops future joins through the old link. Existing roommates keep access.</p><button className="text-button" disabled={busy} onClick={onRotate}><RefreshCw size={14} />Make a fresh invitation</button></div></div>
}

function ShoppingBagIllustration() {
  return <div className="empty-bag"><ReceiptText size={37} strokeWidth={1.2} /><Leaf size={17} /></div>
}
