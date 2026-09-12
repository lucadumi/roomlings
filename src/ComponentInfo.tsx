import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Image, Info } from 'lucide-react'

export function ComponentInfo({ label, description, supplies }: {
  label: string
  description: string
  supplies: string
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    panel.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const card = trigger.current?.closest('.room-object-card, .room-catalog-card')
    const escape = (event: Event) => {
      if (!(event instanceof window.KeyboardEvent) || event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus({ preventScroll: true })
    }
    card?.addEventListener('keydown', escape)
    return () => card?.removeEventListener('keydown', escape)
  }, [open])
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (!open || event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }

  return <>
    <button ref={trigger} type="button" className="component-info-trigger"
      aria-label={open ? `Show rendering of ${label}` : `Info about ${label}`} aria-expanded={open}
      aria-controls={open ? id : undefined} onKeyDown={closeOnEscape}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}>
      {open ? <Image size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
    </button>
    {open && <div id={id} ref={panel} className="component-info-panel" role="region" tabIndex={0}
      aria-label={`${label} information`} onKeyDown={closeOnEscape}>
      <strong>{label}</strong>
      <p>{description}</p>
      <dl><div><dt>Supplies</dt><dd>{supplies}</dd></div></dl>
    </div>}
  </>
}
