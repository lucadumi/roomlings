import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Download, Pause, Pencil, Play, Plus, ReceiptText, Undo2 } from 'lucide-react'
import { billCreateInputSchema, billEditInputSchema, billPaymentInputSchema, billingDate, money, parseMoney } from '../shared/domain.ts'
import type { Bill, Expense, Household } from '../shared/domain.ts'
import { addMonths, earlierOverdueBills, latestBillRevision, monthlyBills } from '../shared/bills.ts'
import type { BillOccurrence } from '../shared/bills.ts'
import { Form, SplitParticipants } from './components.tsx'
import { LoadingIcon } from './Branding.tsx'
import { dateTitle, monthTitle } from './format.ts'
import './bills.css'

const statusLabels = { paid: 'Paid', overdue: 'Overdue', due: 'Due today', upcoming: 'Upcoming' }

export function BillsPanel({ household, month, onMonth, onCreate, onEdit, onPay, onPause, onRemove, onExport, busy }: {
  household: Household
  month: string
  onMonth: (month: string) => void
  onCreate: () => void
  onEdit: (bill: Bill) => void
  onPay: (item: BillOccurrence) => void
  onPause: (bill: Bill, paused: boolean) => void
  onRemove: (expense: Expense) => void
  onExport: () => void
  busy: boolean
}) {
  const today = billingDate(household.billingTimeZone)
  const currentMonth = today.slice(0, 7)
  const items = useMemo(() => monthlyBills(household, month, today), [household, month, today])
  const earlier = useMemo(() => earlierOverdueBills(household, month, today), [household, month, today])
  const firstMonth = household.bills.reduce((first, bill) => bill.startMonth < first ? bill.startMonth : first, currentMonth)
  const unpaid = items.filter((item) => !item.payment)
  const paidTotal = items.reduce((sum, item) => sum + (item.payment?.amount ?? 0), 0)
  return <section className="bills-panel" aria-label="Monthly household bills">
    <div className="panel-period">
      <div className="month-control">
        <button className="icon-button" aria-label="Previous bill month" disabled={busy || month <= firstMonth} onClick={() => onMonth(addMonths(month, -1))}><ChevronLeft size={16} /></button>
        <span>{monthTitle(month, true)}</span>
        <button className="icon-button" aria-label="Next bill month" disabled={busy || month === '9999-12'} onClick={() => onMonth(addMonths(month, 1))}><ChevronRight size={16} /></button>
      </div>
      <button className="button primary small-button new-monthly-bill" aria-label="New monthly bill" title="New monthly bill" disabled={busy || household.bills.length >= 100} onClick={onCreate}><Plus size={15} /><span>New monthly bill</span></button>
    </div>
    {month !== currentMonth && <button className="text-button" onClick={() => onMonth(currentMonth)}>Back to this month</button>}
    <p className="field-hint">Bills stay outside the grocery pot and fridge. Only recorded payments enter your shared balances. Dates follow {household.billingTimeZone}.</p>
    {earlier.firstMonth && <div className="bill-overdue-note">
      <p>{earlier.count} earlier {earlier.count === 1 ? 'bill is' : 'bills are'} still overdue.</p>
      <button className="text-button" onClick={() => { if (earlier.firstMonth) onMonth(earlier.firstMonth) }}>View {monthTitle(earlier.firstMonth)}</button>
    </div>}
    {items.length > 0 && <div className="bill-totals" aria-label="Monthly bill totals">
      <span><small>PLANNED, NOT YET RECORDED</small><strong>{money(unpaid.reduce((sum, item) => sum + item.amount, 0), household.currency)}</strong></span>
      <span><small>RECORDED THIS BILLING MONTH</small><strong>{money(paidTotal, household.currency)}</strong></span>
    </div>}
    <div className="bill-occurrences">
      {items.map((item) => <article className="bill-card bill-occurrence" key={item.billId} aria-label={`${item.name}, ${monthTitle(month)}`}>
        <header><div><h3>{item.name}</h3><p>Due {dateTitle(item.dueDate, today)}</p></div><span className={`bill-status ${item.status}`}>{statusLabels[item.status]}</span></header>
        <div className="bill-amount"><strong>{money(item.amount, household.currency)}</strong><span>{item.participants.length} {item.participants.length === 1 ? 'share' : 'shares'}</span></div>
        {item.payment ? <>
          <p>Paid by {household.members.find((member) => member.id === item.payment?.paidBy)?.name} on {dateTitle(item.payment.date, today)}.</p>
          <button className="text-button" disabled={busy} onClick={() => { if (item.payment) onRemove(item.payment) }} aria-label={`Undo payment for ${item.name}`}><Undo2 size={14} />Undo payment record</button>
        </> : <>
          <p className="small-muted">Confirm the actual amount and who paid before recording.</p>
          <button className="button secondary small-button" disabled={busy} onClick={() => onPay(item)} aria-label={`Record payment for ${item.name}`}><Check size={15} />Record paid</button>
        </>}
      </article>)}
    </div>
    {!items.length && <div className="empty-state"><CalendarDays size={34} /><h3>{household.bills.length ? 'No bills scheduled here.' : 'Make room for the regulars.'}</h3><p>{household.bills.length ? 'Choose another month or add a monthly bill.' : 'Keep rent, utilities and subscriptions in the same shared ledger.'}</p></div>}
    {household.bills.length > 0 && <section className="bill-schedules" aria-label="Monthly bill schedules">
      <div className="section-heading"><h2>Your monthly bills</h2><span className="count-pill">{household.bills.length}</span></div>
      <p className="field-hint">Edits apply to unpaid bills from this month onward. Pausing stops future months, not existing dues.</p>
      {household.bills.map((bill) => {
        const revision = latestBillRevision(bill)
        const pause = bill.pauses.find((pause) => pause.untilMonth === null)
        return <article className="bill-card bill-schedule" key={bill.id} aria-label={`${revision.name} schedule`}>
          <header><div><h3>{revision.name}</h3><p>{money(revision.amount, household.currency)} by default, due on day {revision.dueDay}.</p></div><ReceiptText size={20} /></header>
          <p className="small-muted">{pause ? (pause.fromMonth > currentMonth ? `Pauses from ${monthTitle(pause.fromMonth)}.` : 'Paused.') : (bill.startMonth > currentMonth ? `Starts ${monthTitle(bill.startMonth)}.` : 'Active every month.')}</p>
          <div className="bill-actions">
            <button className="button secondary small-button" disabled={busy} onClick={() => onEdit(bill)} aria-label={`Edit ${revision.name}`}><Pencil size={14} />Edit</button>
            <button className="button secondary small-button" disabled={busy} onClick={() => onPause(bill, !pause)} aria-label={`${pause ? 'Resume' : 'Pause'} ${revision.name}`}>{pause ? <Play size={14} /> : <Pause size={14} />}{pause ? 'Resume' : 'Pause'}</button>
            {bill.startMonth > month && <button className="text-button" onClick={() => onMonth(bill.startMonth)}>View first month</button>}
          </div>
        </article>
      })}
    </section>}
    {household.bills.length >= 100 && <p className="field-hint">This kitchen has reached its limit of 100 monthly bills.</p>}
    <button className="button secondary small-button" onClick={onExport}><Download size={15} />Export ledger</button>
  </section>
}

export function BillForm({ household, bill, busy, error, onSubmit }: {
  household: Household; bill?: Bill; busy: boolean; error: ReactNode; onSubmit: (body: Record<string, unknown>) => void
}) {
  const revision = bill ? latestBillRevision(bill) : undefined
  const timeZone = household.bills.length ? household.billingTimeZone : Intl.DateTimeFormat().resolvedOptions().timeZone
  const [name, setName] = useState(revision?.name ?? '')
  const [amount, setAmount] = useState(revision ? (revision.amount / 100).toFixed(2) : '')
  const [firstDueDate, setFirstDueDate] = useState(billingDate(timeZone))
  const [dueDay, setDueDay] = useState(String(revision?.dueDay ?? 1))
  const [participants, setParticipants] = useState(revision?.participants ?? household.members.filter((member) => !member.inactive).map((member) => member.id))
  const [localError, setLocalError] = useState('')
  const cents = parseMoney(amount)
  const currentMonth = billingDate(timeZone).slice(0, 7)
  const appliesFrom = bill && bill.startMonth > currentMonth ? bill.startMonth : currentMonth
  return <Form onSubmit={() => {
    if (!cents) { setLocalError('Enter a positive amount with no more than two decimal places.'); return }
    if (household.members.some((member) => member.inactive && participants.includes(member.id))) {
      setLocalError('Remove former roommates from the participants before saving this new bill schedule.')
      return
    }
    const input = bill
      ? billEditInputSchema.safeParse({ name, amount: cents, dueDay: Number(dueDay), participants })
      : billCreateInputSchema.safeParse({ name, amount: cents, firstDueDate, participants, timeZone })
    if (!input.success) { setLocalError(input.error.issues[0].message); return }
    setLocalError('')
    onSubmit(input.data)
  }}>
    <label className="field">Bill name<input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} placeholder="e.g. Rent or internet" /></label>
    <div className="field-row">
      <label className="field">Default amount ({household.currency})<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} placeholder="0.00" /></label>
      {bill ? <label className="field">Day of month<input type="number" inputMode="numeric" min={1} max={31} required value={dueDay} onChange={(event) => setDueDay(event.target.value)} disabled={busy} /></label>
        : <label className="field">First due date<input type="date" min="1900-01-01" required value={firstDueDate} onChange={(event) => setFirstDueDate(event.target.value)} disabled={busy} /></label>}
    </div>
    <p className="field-hint">Repeats monthly in {timeZone}. Short months use their last day. You can change the actual amount when recording a payment.</p>
    <SplitParticipants members={household.members} selected={participants} onChange={setParticipants} amount={cents} currency={household.currency} disabled={busy} />
    {bill && <p className="field-hint">Changes apply from {monthTitle(appliesFrom)}. Earlier months and recorded payments keep their original details.</p>}
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}
    <button className="button primary full" disabled={busy}>{busy ? <LoadingIcon size={17} tone="light" /> : <Check size={17} />}{bill ? 'Save monthly bill' : 'Create monthly bill'}</button>
  </Form>
}

export function BillPaymentForm({ household, memberId, item, busy, blocked, error, onSubmit }: {
  household: Household; memberId: string; item: BillOccurrence; busy: boolean; blocked: boolean
  error: ReactNode; onSubmit: (body: Record<string, unknown>) => void
}) {
  const [amount, setAmount] = useState((item.amount / 100).toFixed(2))
  const [paidBy, setPaidBy] = useState(memberId)
  const today = billingDate(household.billingTimeZone)
  const [date, setDate] = useState(today)
  const [participants, setParticipants] = useState(item.participants)
  const [localError, setLocalError] = useState('')
  const cents = parseMoney(amount)
  const disabled = busy || blocked
  return <Form onSubmit={() => {
    if (!cents) { setLocalError('Enter a positive amount with no more than two decimal places.'); return }
    if (household.members.some((member) => member.inactive && (member.id === paidBy || participants.includes(member.id)))) {
      setLocalError('Choose an active payer and remove former roommates from this new payment record. Existing ledger entries remain unchanged.')
      return
    }
    const input = billPaymentInputSchema.safeParse({ month: item.month, amount: cents, paidBy, participants, date })
    if (!input.success) { setLocalError(input.error.issues[0].message); return }
    setLocalError('')
    onSubmit(input.data)
  }}>
    <div className="bill-payment-summary"><strong>{item.name}</strong><span>{monthTitle(item.month)}, due {dateTitle(item.dueDate, today)}</span></div>
    <div className="field-row">
      <label className="field">Amount paid ({household.currency})<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={disabled} /></label>
      <label className="field">Payment date<input type="date" required value={date} max={today} onChange={(event) => setDate(event.target.value)} disabled={disabled} /></label>
    </div>
    <label className="field">Paid by<select value={paidBy} onChange={(event) => setPaidBy(event.target.value)} disabled={disabled}>{household.members.filter((member) => !member.inactive || member.id === paidBy).map((member) => <option key={member.id} value={member.id} disabled={member.inactive}>{member.name}{member.inactive ? ' (former roommate)' : ''}</option>)}</select></label>
    <SplitParticipants members={household.members} selected={participants} onChange={setParticipants} amount={cents} currency={household.currency} disabled={disabled} />
    {participants.some((id) => household.members.some((member) => member.id === id && member.inactive)) && <p className="field-hint">This schedule includes a former roommate. New payment records require active participants; review the split before recording a payment. Existing ledger entries are unchanged.</p>}
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}
    <button className="button primary full" disabled={disabled}>{busy ? <LoadingIcon size={17} tone="light" /> : <Check size={17} />}Record bill payment</button>
    <p className="form-footnote">One expense for this bill and month. No money is transferred.</p>
  </Form>
}
