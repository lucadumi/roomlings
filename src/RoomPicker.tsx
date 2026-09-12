import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, LoaderCircle } from 'lucide-react'
import type { RoomStyle } from '../shared/domain.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import { roomCatalog, roomIds } from '../shared/rooms.ts'
import type { RoomId } from '../shared/rooms.ts'
import { cachedHouseholdRoomPreviews, householdRoomPreviews, roomSelectorPreviewSizes } from './roomPreviews.ts'
import type { RoomPreviewLedger } from './householdRoomPreview.ts'
import './roomPicker.css'

function menuPosition(bounds: DOMRect) {
  const width = Math.min(320, window.innerWidth - 24)
  const top = bounds.bottom + 8
  return {
    left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
    top, width, maxHeight: Math.max(48, window.innerHeight - top - 12),
  }
}

type SavedPreviewProps = {
  householdId: string
  components?: readonly RoomComponent[]
  roomStyle?: RoomStyle
  roomStyles?: Partial<Record<RoomId, RoomStyle>>
  ledger?: RoomPreviewLedger
}

export function RoomPreviewPreloader({ householdId, components, roomStyle = 'original', roomStyles, ledger }: SavedPreviewProps) {
  const appearance = JSON.stringify([components, roomStyles, ledger])
  useEffect(() => {
    let cancelled = false
    let scheduled = false
    let idle: number | undefined
    let frame = 0
    const warm = () => {
      if (cancelled) return
      void householdRoomPreviews({ components, roomStyle, roomStyles, ledger, sizes: roomSelectorPreviewSizes(window.devicePixelRatio) }, householdId)
        .catch((error: unknown) => console.warn('Saved room previews could not be prepared:', error instanceof Error ? error.message : error))
    }
    const schedule = () => {
      if (scheduled || !document.querySelector('.world-canvas:not([hidden]) canvas')) return
      scheduled = true
      observer.disconnect()
      if (window.requestIdleCallback) idle = window.requestIdleCallback(warm, { timeout: 1500 })
      else frame = requestAnimationFrame(() => { frame = requestAnimationFrame(warm) })
    }
    const observer = new MutationObserver(schedule)
    const home = document.querySelector('.game-home')
    if (home) observer.observe(home, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
    schedule()
    return () => {
      cancelled = true
      observer.disconnect()
      if (idle !== undefined) window.cancelIdleCallback(idle)
      cancelAnimationFrame(frame)
    }
  }, [householdId, roomStyle, appearance])
  return null
}

export function RoomPicker({ currentRoom, onSelect, onClose, anchor, householdId, components, roomStyle = 'original', roomStyles, ledger }: SavedPreviewProps & {
  currentRoom: RoomId; onSelect: (roomId: RoomId) => void; onClose: () => void
  anchor: HTMLButtonElement
}) {
  const areas = useRef(new Map<RoomId, HTMLSpanElement>())
  const menu = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<RoomId, HTMLButtonElement>())
  const close = useRef(onClose)
  const restoreFocus = useRef(true)
  const [focusedRoom, setFocusedRoom] = useState(currentRoom)
  const [position, setPosition] = useState(() => menuPosition(anchor.getBoundingClientRect()))
  const lastPosition = useRef(position)
  const initialImages = cachedHouseholdRoomPreviews({
    components, roomStyle, roomStyles, ledger, sizes: roomSelectorPreviewSizes(window.devicePixelRatio),
  }, householdId)
  const [images, setImages] = useState<Partial<Record<RoomId, string>>>(initialImages ?? {})
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>(initialImages ? 'ready' : 'loading')
  const appearance = JSON.stringify([components, roomStyles, ledger])
  close.current = onClose

  useLayoutEffect(() => {
    let frame = 0
    let disposed = false
    const measure = () => {
      if (disposed) return false
      const bounds = anchor.getBoundingClientRect()
      if (!anchor.isConnected || !bounds.width || !bounds.height) { restoreFocus.current = false; close.current(); return false }
      const next = menuPosition(bounds)
      if (!Object.keys(next).every((key) => Reflect.get(lastPosition.current, key) === Reflect.get(next, key))) {
        lastPosition.current = next
        setPosition(next)
      }
      return true
    }
    const followAnchor = () => {
      // Grid reflow can move the trigger without changing its observed size.
      if (measure()) frame = requestAnimationFrame(followAnchor)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(anchor)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    window.visualViewport?.addEventListener('resize', measure)
    followAnchor()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [anchor])

  useLayoutEffect(() => {
    buttons.current.get(currentRoom)?.focus({ preventScroll: true })
    setFocusedRoom(currentRoom)
  }, [currentRoom])

  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target
      if (menu.current?.isConnected && target instanceof Node && !menu.current.contains(target) && !anchor.contains(target)) {
        restoreFocus.current = false
        close.current()
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.isConnected && !event.defaultPrevented) {
        event.preventDefault()
        event.stopPropagation()
        close.current()
      }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside, true)
      document.removeEventListener('keydown', escape, true)
      if (restoreFocus.current && anchor.isConnected) anchor.focus({ preventScroll: true })
    }
  }, [anchor])
  useEffect(() => {
    let cancelled = false
    let version = 0
    let previousSize = ''
    const render = () => {
      const ratio = Math.min(window.devicePixelRatio, 2)
      const sizes = Object.fromEntries(roomIds.map((roomId) => {
        const area = areas.current.get(roomId)?.getBoundingClientRect()
        return [roomId, { width: Math.max(1, Math.round((area?.width || 280) * ratio)), height: Math.max(1, Math.round((area?.height || 192) * ratio)) }]
      })) as Record<RoomId, { width: number; height: number }>
      const size = JSON.stringify(sizes)
      if (size === previousSize) return
      previousSize = size
      const request = ++version
      const options = { components, roomStyle, roomStyles, ledger, sizes }
      const cached = cachedHouseholdRoomPreviews(options, householdId)
      if (cached) { setImages(cached); setStatus('ready'); return }
      setStatus('loading')
      householdRoomPreviews(options, householdId).then((previews) => {
        if (cancelled || request !== version) return
        setImages(previews)
        setStatus('ready')
      }).catch((error: unknown) => {
        if (cancelled || request !== version) return
        console.warn('Saved room previews could not render:', error instanceof Error ? error.message : error)
        setImages({})
        setStatus('unavailable')
      })
    }
    setImages({})
    const observer = new ResizeObserver(render)
    areas.current.forEach((area) => observer.observe(area))
    render()
    return () => { cancelled = true; observer.disconnect() }
  }, [appearance, roomStyle, householdId])

  return createPortal(<div className="room-picker-menu" ref={menu} id="room-selection-menu" role="menu" aria-label="Rooms"
    style={position}
    onKeyDown={(event) => {
      if (event.key === 'Tab') {
        event.preventDefault()
        restoreFocus.current = false
        const focusable = [...document.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
          .filter((element) => !menu.current?.contains(element) && element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'))
        const index = focusable.indexOf(anchor)
        const next = focusable[index + (event.shiftKey ? -1 : 1)]
        onClose()
        ;(next ?? anchor).focus({ preventScroll: true })
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? roomIds.length - 1
          : (roomIds.indexOf(focusedRoom) + (event.key === 'ArrowDown' ? 1 : -1) + roomIds.length) % roomIds.length
        const next = roomIds[index]
        setFocusedRoom(next)
        buttons.current.get(next)?.focus({ preventScroll: true })
      }
    }}>
    <div className="room-preview-grid" role="group" aria-label="Choose a room" aria-busy={status === 'loading'} data-preview-source="saved">
      {roomIds.map((roomId) => <button type="button" key={roomId} className="room-preview-card"
        ref={(button) => { if (button) buttons.current.set(roomId, button); else buttons.current.delete(roomId) }}
        role="menuitemradio" aria-label={`Open ${roomCatalog[roomId].name}`} aria-checked={roomId === currentRoom}
        tabIndex={focusedRoom === roomId ? 0 : -1} onFocus={() => setFocusedRoom(roomId)} onClick={() => onSelect(roomId)}>
        <span ref={(area) => { if (area) areas.current.set(roomId, area); else areas.current.delete(roomId) }}
          className="room-menu-preview" data-room-preview={roomId}>
          <img src={images[roomId]} alt="" width={560} height={384} draggable={false}
            hidden={!images[roomId] || status === 'loading'} style={{ visibility: images[roomId] && status !== 'loading' ? 'visible' : 'hidden' }} />
          {status === 'loading' ? <span className="room-menu-preview-status" role="status" aria-label={`Loading ${roomCatalog[roomId].name} preview`}>
            <LoaderCircle size={23} className="spin" aria-hidden="true" />
          </span> : status === 'unavailable' && <small className="room-menu-preview-status">3D is unavailable.</small>}
        </span>
        <span className="room-preview-label"><strong>{roomCatalog[roomId].name}</strong><small>{roomId === currentRoom ? 'Current room' : 'Open room'}</small></span>
        {roomId === currentRoom ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
      </button>)}
    </div>
  </div>, document.body)
}
