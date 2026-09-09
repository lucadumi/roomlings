import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check } from 'lucide-react'
import type { RoomStyle } from '../shared/domain.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import { roomCatalog, roomIds } from '../shared/rooms.ts'
import type { RoomId } from '../shared/rooms.ts'
import { householdRoomPreviews } from './roomPreviews.ts'
import type { RoomPreviewLedger } from './householdRoomPreview.ts'
import './roomPicker.css'

function menuPosition(anchor: HTMLButtonElement) {
  const bounds = anchor.getBoundingClientRect()
  const width = Math.min(320, window.innerWidth - 24)
  const top = bounds.bottom + 8
  return {
    left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
    top, width, maxHeight: Math.max(48, window.innerHeight - top - 12),
  }
}

export function RoomPicker({ currentRoom, onSelect, onClose, anchor, components, roomStyle = 'original', roomStyles, ledger }: {
  currentRoom: RoomId; onSelect: (roomId: RoomId) => void; onClose: () => void
  anchor: HTMLButtonElement
  components?: readonly RoomComponent[]; roomStyle?: RoomStyle
  roomStyles?: Partial<Record<RoomId, RoomStyle>>; ledger?: RoomPreviewLedger
}) {
  const areas = useRef(new Map<RoomId, HTMLSpanElement>())
  const menu = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<RoomId, HTMLButtonElement>())
  const close = useRef(onClose)
  const restoreFocus = useRef(true)
  const [focusedRoom, setFocusedRoom] = useState(currentRoom)
  const [position, setPosition] = useState(() => menuPosition(anchor))
  const [images, setImages] = useState<Partial<Record<RoomId, string>>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const appearance = JSON.stringify([components, roomStyles, ledger])
  close.current = onClose

  useLayoutEffect(() => {
    const measure = () => {
      const bounds = anchor.getBoundingClientRect()
      if (!anchor.isConnected || !bounds.width || !bounds.height) { restoreFocus.current = false; close.current(); return }
      const next = menuPosition(anchor)
      setPosition((previous) => Object.keys(next).every((key) =>
        Reflect.get(previous, key) === Reflect.get(next, key)) ? previous : next)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(anchor)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    window.visualViewport?.addEventListener('resize', measure)
    measure()
    return () => {
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
      setStatus('loading')
      householdRoomPreviews({ components, roomStyle, roomStyles, ledger, sizes }).then((previews) => {
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
  }, [appearance, roomStyle])

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
            hidden={!images[roomId]} style={{ visibility: images[roomId] ? 'visible' : 'hidden' }} />
          {!images[roomId] && <small className="room-menu-preview-status">
            {status === 'unavailable' ? '3D preview unavailable' : 'Loading preview'}
          </small>}
        </span>
        <span className="room-preview-label"><strong>{roomCatalog[roomId].name}</strong><small>{roomId === currentRoom ? 'Current room' : 'Open room'}</small></span>
        {roomId === currentRoom ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
      </button>)}
    </div>
  </div>, document.body)
}
