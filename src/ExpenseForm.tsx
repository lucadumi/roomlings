import { useState } from 'react'
import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { categories, categoryLabels, localDate, parseMoney } from '../shared/domain.ts'
import type { Category, Household } from '../shared/domain.ts'
import { Form, SplitParticipants } from './components.tsx'
import { LoadingIcon } from './Branding.tsx'

export function ExpenseForm({
  household, memberId, busy, error, onSubmit, children, initialDescription = '', initialCategory = 'produce',
  submitLabel = 'Add & split the groceries', submitDisabled = false,
}: {
  household: Household; memberId: string; busy: boolean; error: ReactNode
  onSubmit: (body: Record<string, unknown>) => void; children?: ReactNode
  initialDescription?: string; initialCategory?: Category; submitLabel?: string; submitDisabled?: boolean
}) {
  const [description, setDescription] = useState(initialDescription)
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(memberId)
  const [participants, setParticipants] = useState(household.members.filter((member) => !member.inactive).map((member) => member.id))
  const [category, setCategory] = useState<Category>(initialCategory)
  const [date, setDate] = useState(localDate())
  const [localError, setLocalError] = useState('')
  const cents = parseMoney(amount)
  return <Form onSubmit={() => {
    if (!cents) { setLocalError('Enter a positive amount with no more than two decimal places.'); return }
    if (!participants.length) { setLocalError('Choose at least one roommate to split with.'); return }
    if (household.members.some((member) => member.inactive && (member.id === paidBy || participants.includes(member.id)))) {
      setLocalError('A selected roommate has left this kitchen. Choose an active payer and remove former roommates from this new grocery split.')
      return
    }
    if (submitDisabled) { setLocalError('Review the selected items before recording this run.'); return }
    setLocalError('')
    onSubmit({ description, amount: cents, paidBy, participants, category, date })
  }}>
    {children}
    <label className="field">What did you pick up?<input required maxLength={100} placeholder="e.g. The big weekly shop" value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} /></label>
    <div className="field-row"><label className="field">Total ({household.currency})<input required inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} /></label><label className="field">Date<input type="date" required value={date} max={localDate()} onChange={(event) => setDate(event.target.value)} disabled={busy} /></label></div>
    <div className="field-row"><label className="field">Paid by<select value={paidBy} onChange={(event) => setPaidBy(event.target.value)} disabled={busy}>{household.members.filter((member) => !member.inactive || member.id === paidBy).map((member) => <option key={member.id} value={member.id} disabled={member.inactive}>{member.name}{member.inactive ? ' (former roommate)' : ''}</option>)}</select></label><label className="field">On which shelf?<select value={category} onChange={(event) => setCategory(event.target.value as Category)} disabled={busy}>{categories.map((category) => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></label></div>
    <SplitParticipants members={household.members} selected={participants} onChange={setParticipants} amount={cents} currency={household.currency} disabled={busy} />
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}
    <button className="button primary full" disabled={busy || submitDisabled}>{busy ? <LoadingIcon size={17} tone="light" /> : <Plus size={17} />}{busy ? 'Adding to the kitchen...' : submitLabel}</button>
    <p className="form-footnote">Shared equally, with any spare cents split fairly.</p>
  </Form>
}
