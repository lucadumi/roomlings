import { useEffect, useId, useRef, useState } from 'react'
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react'
import { Apple, Check, Coffee, Cookie, Copy, Egg, ShoppingBasket, X } from 'lucide-react'
import { money, splitAmount } from '../shared/domain.ts'
import type { Category, Member } from '../shared/domain.ts'

export function CategoryIcon({ category, size = 20 }: { category: Category; size?: number }) {
  const Icon = { produce: Apple, dairy: Egg, pantry: Cookie, drinks: Coffee, other: ShoppingBasket }[category]
  return <Icon size={size} strokeWidth={1.7} />
}

export function Avatar({ member, small = false }: { member: Member; small?: boolean }) {
  return <span className={`avatar${small ? ' small' : ''}`} style={{ backgroundColor: member.color }} title={member.name}>{member.name.slice(0, 1).toUpperCase()}</span>
}

export function Modal({ title, subtitle, children, onClose, busy = false, wide = false }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy
  useEffect(() => {
    const previous = document.activeElement
    if (previous instanceof HTMLElement && previous !== document.body && !dialog.current?.contains(previous)) returnFocus.current = previous
    const priorOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') ?? [])]
      .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'))
    const firstInput = focusable().find((element) => element.matches('input, textarea'))
    ;(firstInput ?? focusable()[0] ?? dialog.current)?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busyRef.current) closeRef.current()
      }
      if (event.key === 'Tab') {
        const elements = focusable()
        const first = elements[0]
        const last = elements.at(-1)
        if (!first) { event.preventDefault(); dialog.current?.focus({ preventScroll: true }); return }
        const active = document.activeElement
        if (!(active instanceof HTMLElement) || !elements.includes(active)
          || (event.shiftKey && document.activeElement === first)
          || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first)?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = priorOverflow
      document.removeEventListener('keydown', onKey)
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
    }
  }, [])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className={`modal${wide ? ' wide' : ''}`} ref={dialog} role="dialog" aria-modal="true" aria-busy={busy || undefined} aria-labelledby={titleId} aria-describedby={subtitle ? descriptionId : undefined} tabIndex={-1}>
      <button type="button" className="icon-button control-surface modal-close" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={20} /></button>
      <div className="eyebrow">A LITTLE HOUSEKEEPING</div>
      <h2 id={titleId}>{title}</h2>
      {subtitle && <p className="modal-subtitle" id={descriptionId}>{subtitle}</p>}
      {children}
    </div>
  </div>
}

export function RoomPanel({ title, subtitle, children, onClose, view }: {
  title: string; subtitle: string; children: ReactNode; onClose: () => void; view?: string
}) {
  const panel = useRef<HTMLElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && !panel.current?.contains(active)) returnFocus.current = active
    // A dialog temporarily unmounts the panel and its focused controls.
    if (!returnFocus.current) returnFocus.current = document.querySelector<HTMLButtonElement>('.game-dock button[aria-pressed="true"]')
    if (scroll.current) scroll.current.scrollTop = 0
    panel.current?.focus({ preventScroll: true })
  }, [title, view])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        closeRef.current()
      }
    }
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('keydown', escape)
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
    }
  }, [])
  return <aside className="room-panel" role="region" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
    <header className="room-panel-header"><div><span className="eyebrow">A LITTLE HOUSEKEEPING</span><h2 id={titleId}>{title}</h2></div><button type="button" className="icon-button control-surface" aria-label="Close panel" onClick={onClose}><X size={20} /></button></header>
    <div className="room-panel-scroll" ref={scroll}><p className="room-panel-subtitle">{subtitle}</p>{children}</div>
  </aside>
}

export function Form({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) {
  return <form onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit() }}>{children}</form>
}

export function CopyField({ label, value, buttonLabel, copiedLabel }: {
  label: string; value: string; buttonLabel: string; copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const currentValue = useRef(value)
  const copyAttempt = useRef(0)
  currentValue.current = value
  useEffect(() => {
    copyAttempt.current++
    setCopied(false)
    setError('')
    return () => { copyAttempt.current++ }
  }, [value])
  return <>
    <label className="field">{label}<input readOnly value={value} autoComplete="off" spellCheck={false} onFocus={(event) => event.target.select()} /></label>
    <button type="button" className="button primary full" onClick={() => {
      const attempt = ++copyAttempt.current
      setCopied(false)
      setError('')
      if (!navigator.clipboard) { setError('Clipboard access needs HTTPS or localhost. Select the field above and copy it manually.'); return }
      navigator.clipboard.writeText(value).then(() => {
        if (currentValue.current !== value || copyAttempt.current !== attempt) return
        setCopied(true)
        setError('')
      }).catch(() => {
        if (currentValue.current === value && copyAttempt.current === attempt) setError('Your browser could not copy this value. Select the field above and copy it manually.')
      })
    }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? copiedLabel : buttonLabel}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>
}

export function SplitParticipants({ members, selected, onChange, amount, currency, disabled }: {
  members: Member[]
  selected: string[]
  onChange: Dispatch<SetStateAction<string[]>>
  amount: number | null
  currency: string
  disabled: boolean
}) {
  const shares = amount && selected.length ? splitAmount(amount, selected) : null
  return <>
    <fieldset className="split-fieldset"><legend>Share it with</legend><div className="participant-options">
      {members.filter((member) => !member.inactive || selected.includes(member.id)).map((member) => <label className={`participant-option${selected.includes(member.id) ? ' chosen' : ''}`} key={member.id}>
        <input type="checkbox" checked={selected.includes(member.id)} disabled={disabled} onChange={(event) => onChange((previous) =>
          event.target.checked ? [...previous, member.id] : previous.filter((id) => id !== member.id),
        )} />
        <Avatar member={member} small /><span>{member.name}{member.inactive ? ' (former roommate)' : ''}</span>{selected.includes(member.id) && <Check size={13} />}
      </label>)}
    </div></fieldset>
    {shares && <div className="split-preview">{members.filter((member) => selected.includes(member.id)).map((member) =>
      <span key={member.id}>{member.name}<strong>{money(shares.get(member.id) ?? 0, currency)}</strong></span>,
    )}</div>}
  </>
}
