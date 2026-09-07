import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, History, Pencil, Plus, ReceiptText, ShoppingBasket, Trash2, UserCheck } from 'lucide-react'
import {
  localDate, money, shoppingCheckoutSchema, shoppingItemEditSchema, shoppingItemInputSchema, shoppingItemLimit,
} from '../shared/domain.ts'
import type { Household, ShoppingItem } from '../shared/domain.ts'
import { canEditShoppingItem, checkoutItems, inBasket } from '../shared/shopping.ts'
import { Form } from './components.tsx'
import { LoadingIcon } from './Branding.tsx'
import { ExpenseForm } from './ExpenseForm.tsx'
import { dateTitle } from './format.ts'
import './shopping.css'

export type ShoppingView = 'list' | 'basket' | 'history'

export function ShoppingPanel({ household, memberId, view, onView, busy, onAdd, onEdit, onRemove, onClaim, onRelease, onPick, onCheckout, onQuickRecord }: {
  household: Household; memberId: string; view: ShoppingView; onView: (view: ShoppingView) => void; busy: boolean
  onAdd: () => void; onEdit: (item: ShoppingItem) => void; onRemove: (item: ShoppingItem) => void
  onClaim: (item: ShoppingItem) => void; onRelease: (item: ShoppingItem) => void
  onPick: (item: ShoppingItem, pickedUp: boolean) => void
  onCheckout: () => void; onQuickRecord: () => void
}) {
  const [historyCount, setHistoryCount] = useState(20)
  const basket = household.shopping.items.filter((item) => inBasket(item, memberId))
  const items = view === 'basket' ? basket : household.shopping.items
  const receipts = new Map(household.expenses.map((expense) => [expense.id, expense]))
  const memberName = (id: string) => household.members.find((member) => member.id === id)?.name ?? 'Unknown roommate'
  return <section className="shopping-panel" aria-label="Shared shopping list" aria-busy={busy || undefined}>
    <nav className="receipt-tabs shopping-tabs" aria-label="Shopping bag sections">
      <button type="button" aria-pressed={view === 'list'} disabled={busy} onClick={() => onView('list')}>List <span>{household.shopping.items.length}</span></button>
      <button type="button" aria-pressed={view === 'basket'} disabled={busy} onClick={() => onView('basket')}>Basket <span>{basket.length}</span></button>
      <button type="button" aria-pressed={view === 'history'} disabled={busy} onClick={() => onView('history')}>Past runs</button>
    </nav>
    {busy && <p className="inline shopping-saving loading-status" role="status"><LoadingIcon size={20} />Saving the list...</p>}
    {view !== 'history' && <>
      <div className="shopping-toolbar">
        {view === 'list' ? <button className="button primary small-button" disabled={busy || household.shopping.items.length >= shoppingItemLimit} onClick={onAdd}><Plus size={15} />Add item</button>
          : <button className="button primary small-button" disabled={busy || !basket.length} onClick={onCheckout}><Check size={15} />Finish shopping</button>}
        <button className="text-button" disabled={busy} onClick={onQuickRecord}>Record without a list</button>
      </div>
      <p className="field-hint">{view === 'basket' ? 'Only your picked-up items are here. Confirm the actual receipt total to record an expense.' : 'Claim what you will buy, then tick it into your basket. Ticking items never creates a debt.'}</p>
      {!items.length && <div className="empty-state"><ShoppingBasket size={34} /><h3>{view === 'basket' ? 'Your basket is empty.' : 'What does home need?'}</h3><p>{view === 'basket' ? 'Pick up items from the shared list first.' : 'Add groceries, quantities and any useful notes.'}</p></div>}
      <div className="shopping-items">
        {items.map((item) => {
          const otherShopper = item.claimedBy !== null && item.claimedBy !== memberId
          const editable = canEditShoppingItem(item, memberId)
          return <article className={`shopping-item${item.pickedUp ? ' picked-up' : ''}`} key={item.id} aria-label={item.name}>
            <label className="shopping-pick">
              <input type="checkbox" checked={item.pickedUp} disabled={busy || otherShopper} aria-label={`Picked up ${item.name}`} onChange={(event) => onPick(item, event.target.checked)} />
              <span><strong>{item.name}</strong><small>{item.quantity}</small></span>
            </label>
            {item.notes && <p className="shopping-notes">{item.notes}</p>}
            <p className="shopping-owner">{item.claimedBy === null ? 'Available to claim'
              : item.pickedUp ? `In ${item.claimedBy === memberId ? 'your' : `${memberName(item.claimedBy)}'s`} basket`
                : `${item.claimedBy === memberId ? 'You are' : `${memberName(item.claimedBy)} is`} buying this`}</p>
            <div className="shopping-item-actions">
              {item.claimedBy === null ? <button className="button secondary small-button" disabled={busy} aria-label={`Claim ${item.name}`} onClick={() => onClaim(item)}><UserCheck size={14} />I will get it</button>
                : <button className="text-button" disabled={busy} aria-label={`Release claim on ${item.name}`} onClick={() => onRelease(item)}>Release claim</button>}
              <button className="icon-button" disabled={busy || !editable} aria-label={`Edit ${item.name}`} title={editable ? 'Edit item' : 'Return to the list and release other claims to edit'} onClick={() => onEdit(item)}><Pencil size={15} /></button>
              <button className="icon-button" disabled={busy || !editable} aria-label={`Remove ${item.name}`} title={editable ? 'Remove item' : 'Return to the list and release other claims to remove'} onClick={() => onRemove(item)}><Trash2 size={15} /></button>
            </div>
          </article>
        })}
      </div>
      {household.shopping.items.length >= shoppingItemLimit && <p className="field-hint">The list has reached {shoppingItemLimit} items. Finish a run or remove unused items before adding more.</p>}
      {view === 'list' && basket.length > 0 && <button className="button secondary full" disabled={busy} onClick={() => onView('basket')}><ShoppingBasket size={16} />Review my basket ({basket.length})</button>}
    </>}
    {view === 'history' && <>
      <p className="field-hint">Items are archived only after their grocery receipt is saved. Removing a receipt does not put bought items back on the list.</p>
      {!household.shopping.runs.length && <div className="empty-state"><History size={34} /><h3>No completed runs yet.</h3><p>Finish a basket to save its receipt and items here.</p></div>}
      {household.shopping.runs.slice(0, historyCount).map((run) => {
        const receipt = receipts.get(run.expenseId)
        return <article className="shopping-run" key={run.id} aria-label={run.name}>
          <h3>{run.name}</h3><p>Recorded by {memberName(run.completedBy)} on {dateTitle(localDate(new Date(run.completedAt)))}.</p>
          {receipt ? <p className="shopping-receipt"><ReceiptText size={15} /><strong>{money(receipt.amount, household.currency)}</strong> paid by {memberName(receipt.paidBy)}</p>
            : <p className="small-muted">Receipt removed. The purchased items remain archived.</p>}
          <details><summary>{run.items.length} {run.items.length === 1 ? 'item' : 'items'}</summary><ul>{run.items.map((item) => <li key={item.id}><strong>{item.quantity} {item.name}</strong>{item.notes && <span>{item.notes}</span>}</li>)}</ul></details>
        </article>
      })}
      {historyCount < household.shopping.runs.length && <button className="button secondary full" onClick={() => setHistoryCount((count) => count + 20)}>Show more runs</button>}
    </>}
  </section>
}

export function ShoppingItemForm({ household, memberId, item, busy, error, onSubmit }: {
  household: Household; memberId: string; item?: ShoppingItem; busy: boolean; error: ReactNode
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [quantity, setQuantity] = useState(item?.quantity ?? '1')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [baseVersion, setBaseVersion] = useState(item?.version ?? 0)
  const [localError, setLocalError] = useState('')
  const latest = item ? household.shopping.items.find((entry) => entry.id === item.id) : undefined
  const blocked = !!item && (!latest || !canEditShoppingItem(latest, memberId))
  const changed = !!item && !!latest && latest.version !== baseVersion
  return <Form onSubmit={() => {
    if (blocked || changed) { setLocalError('Review the latest shopping item before saving.'); return }
    const input = item ? shoppingItemEditSchema.safeParse({ name, quantity, notes, itemVersion: baseVersion })
      : shoppingItemInputSchema.safeParse({ name, quantity, notes })
    if (!input.success) { setLocalError(input.error.issues[0].message); return }
    setLocalError('')
    onSubmit(input.data)
  }}>
    <label className="field">Item name<input required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} placeholder="e.g. Oat milk" /></label>
    <label className="field">Quantity<input required maxLength={40} value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={busy} placeholder="e.g. 2 cartons or 500 g" /></label>
    <label className="field">Notes<textarea maxLength={240} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={busy} placeholder="Brand, preference or anything useful" /></label>
    {blocked && <p className="form-error" role="alert">This item left the list, is in a basket, or is being handled by another roommate. Close this form and review the list.</p>}
    {!blocked && changed && latest && <div className="shopping-conflict">
      <p role="alert">This item changed. Latest: {latest.quantity} {latest.name}{latest.notes ? `, ${latest.notes}` : ''}.</p>
      <div className="button-row">
        <button type="button" className="text-button" onClick={() => { setName(latest.name); setQuantity(latest.quantity); setNotes(latest.notes); setBaseVersion(latest.version); setLocalError('') }}>Use latest values</button>
        <button type="button" className="text-button" onClick={() => { setBaseVersion(latest.version); setLocalError('') }}>Keep my draft</button>
      </div>
    </div>}
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}
    <button className="button primary full" disabled={busy || blocked || changed}>{busy ? <LoadingIcon size={17} tone="light" /> : <Check size={17} />}{item ? 'Save item' : 'Add to shopping list'}</button>
  </Form>
}

export function ShoppingCheckoutForm({ household, memberId, checkoutId, initialItems, busy, error, onSubmit }: {
  household: Household; memberId: string; checkoutId: string; initialItems: ShoppingItem[]; busy: boolean
  error: ReactNode; onSubmit: (body: Record<string, unknown>) => void
}) {
  const [snapshot, setSnapshot] = useState(initialItems)
  const [selectedIds, setSelectedIds] = useState(initialItems.map((item) => item.id))
  const [selectionNotice, setSelectionNotice] = useState('')
  const [selectionError, setSelectionError] = useState('')
  const selected = snapshot.filter((item) => selectedIds.includes(item.id))
  const valid = checkoutItems(household, memberId, selected)
  const changed = selected.length > 0 && valid === null
  const recorded = household.shopping.runs.some((run) => run.id === checkoutId)
  const current = new Map(household.shopping.items.map((item) => [item.id, item]))
  return <ExpenseForm household={household} memberId={memberId} busy={busy} initialDescription="Shopping run" initialCategory="other"
    submitLabel="Record shopping run" submitDisabled={recorded || changed || !selected.length}
    error={recorded ? <p className="form-error" role="alert">This run has already been recorded. Close this form and open Past runs; no duplicate expense was added.</p> : error}
    onSubmit={(expense) => {
      const input = shoppingCheckoutSchema.safeParse({ ...expense, checkoutId, items: selected.map(({ id, version }) => ({ id, version })) })
      if (!input.success) { setSelectionError(input.error.issues[0].message); return }
      if (!valid || recorded) { setSelectionError('Review your basket before recording this run.'); return }
      onSubmit(input.data)
    }}
  >
    <fieldset className="checkout-items"><legend>Include in this run</legend>
      {snapshot.map((item) => {
        const active = current.get(item.id)
        const stale = !active || active.version !== item.version || !inBasket(active, memberId)
        const selected = selectedIds.includes(item.id)
        return <label className="checkout-item" key={item.id}>
          <input type="checkbox" checked={selected} disabled={busy || recorded || (!selected && stale)} onChange={(event) => setSelectedIds((previous) => event.target.checked ? [...previous, item.id] : previous.filter((id) => id !== item.id))} />
          <span><strong>{item.quantity} {item.name}</strong>{stale && <small>Changed or no longer in your basket</small>}</span>
        </label>
      })}
    </fieldset>
    {!recorded && <button type="button" className="text-button" disabled={busy} onClick={() => {
      const latest = household.shopping.items.filter((item) => inBasket(item, memberId))
      setSnapshot(latest)
      setSelectedIds(latest.map((item) => item.id))
      setSelectionError('')
      setSelectionNotice('Basket refreshed. Review the receipt total and split before saving.')
    }}>Reload my basket</button>}
    {!recorded && changed && <p className="form-error" role="alert">Your basket changed. Remove changed items from this selection or reload the basket, then review the total.</p>}
    {!recorded && !selected.length && <p className="field-hint">{snapshot.length ? 'Choose at least one item for this run.' : 'Your basket is empty. Close this form and pick up items from the shared list.'}</p>}
    {selectionNotice && <p className="field-hint" role="status">{selectionNotice}</p>}
    {selectionError && <p className="form-error" role="alert">{selectionError}</p>}
    <p className="field-hint">Record only money already paid. The selected items are archived only after the receipt is saved.</p>
  </ExpenseForm>
}
