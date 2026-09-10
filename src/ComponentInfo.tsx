import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info, X } from 'lucide-react'

type Position = { left: number; top: number; width: number; maxHeight: number }

export function ComponentInfo({ label, description, details }: {
  label: string
  description: string
  details: readonly { label: string; value: string }[]
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    const measure = () => {
      const button = trigger.current
      const popup = panel.current
      if (!button || !popup) return
      const bounds = button.getBoundingClientRect()
      if (!button.isConnected || bounds.bottom <= 0 || bounds.top >= window.innerHeight) {
        setOpen(false)
        return
      }
      const width = Math.min(280, window.innerWidth - 24)
      const below = Math.max(0, window.innerHeight - bounds.bottom - 20)
      const above = Math.max(0, bounds.top - 20)
      const placeBelow = popup.scrollHeight <= below || below >= above
      const maxHeight = Math.max(1, Math.min(window.innerHeight - 24, placeBelow ? below : above))
      const height = Math.min(popup.scrollHeight, maxHeight)
      const next = {
        left: Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12)),
        top: Math.max(12, placeBelow ? bounds.bottom + 8 : bounds.top - height - 8),
        width, maxHeight,
      }
      setPosition((previous) => previous && previous.left === next.left && previous.top === next.top
        && previous.width === next.width && previous.maxHeight === next.maxHeight ? previous : next)
      frame = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      const target = event.target
      if (target instanceof Node && !trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  return <>
    <button ref={trigger} type="button" className="component-info-trigger"
      aria-label={`${open ? 'Close info' : 'Info'} about ${label}`} aria-expanded={open}
      aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}>
      {open ? <X size={16} /> : <Info size={16} />}
    </button>
    {open && createPortal(<div ref={panel} id={id} className="component-info-panel" role="tooltip"
      aria-label={`${label} information`} style={{ ...position, visibility: position ? 'visible' : 'hidden' }}>
      <strong>{label}</strong>
      <p>{description}</p>
      <dl>{details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>
    </div>, document.body)}
  </>
}
