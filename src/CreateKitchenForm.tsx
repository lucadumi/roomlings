import { useState } from 'react'
import type { ReactNode } from 'react'
import { Home } from 'lucide-react'
import { currencies, parseMoney } from '../shared/domain.ts'
import { Form } from './components.tsx'
import { LoadingIcon } from './Branding.tsx'

export function CreateKitchenForm({ busy, error, onSubmit, initialMemberName = '' }: {
  busy: boolean; error: ReactNode; onSubmit: (body: Record<string, unknown>) => void; initialMemberName?: string
}) {
  const [name, setName] = useState('')
  const [memberName, setMemberName] = useState(initialMemberName)
  const [currency, setCurrency] = useState('EUR')
  const [budget, setBudget] = useState('450')
  const [localError, setLocalError] = useState('')
  return <Form onSubmit={() => { const amount = parseMoney(budget); if (!amount) { setLocalError('Enter a positive monthly budget.'); return }; setLocalError(''); onSubmit({ name, memberName, currency, budget: amount }) }}>
    <label className="field">What do you call home?<input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. The Sunday House" disabled={busy} /></label>
    <label className="field">Your name<input required maxLength={50} value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="What should your roommates call you?" disabled={busy} /></label>
    <div className="field-row"><label className="field">Monthly grocery budget<input required inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} disabled={busy} /></label><label className="field">Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy}>{currencies.map((value) => <option key={value}>{value}</option>)}</select></label></div>
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}
    <button className="button primary full" disabled={busy}>{busy ? <LoadingIcon size={17} tone="light" /> : <Home size={17} />}{busy ? 'Making room...' : 'Create our kitchen'}</button>
  </Form>
}
