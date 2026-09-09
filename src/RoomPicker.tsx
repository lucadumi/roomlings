import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import type { RoomStyle } from '../shared/domain.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import { roomCatalog, roomIds } from '../shared/rooms.ts'
import type { RoomId } from '../shared/rooms.ts'
import { Modal } from './components.tsx'
import { householdRoomPreviews } from './roomPreviews.ts'
import type { RoomPreviewLedger } from './householdRoomPreview.ts'
import './roomPicker.css'

export function RoomPicker({ currentRoom, onSelect, onClose, components, roomStyle = 'original', roomStyles, ledger }: {
  currentRoom: RoomId; onSelect: (roomId: RoomId) => void; onClose: () => void
  components?: readonly RoomComponent[]; roomStyle?: RoomStyle
  roomStyles?: Partial<Record<RoomId, RoomStyle>>; ledger?: RoomPreviewLedger
}) {
  const areas = useRef(new Map<RoomId, HTMLSpanElement>())
  const [images, setImages] = useState<Partial<Record<RoomId, string>>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const appearance = JSON.stringify([components, roomStyles, ledger])
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

  return <Modal title="Rooms" subtitle="Choose a room in this home." onClose={onClose}>
    <div className="room-preview-grid" role="group" aria-label="Choose a room" aria-busy={status === 'loading'} data-preview-source="saved">
      {roomIds.map((roomId) => <button type="button" key={roomId} className="room-preview-card"
        aria-label={`Open ${roomCatalog[roomId].name}`} aria-pressed={roomId === currentRoom} onClick={() => onSelect(roomId)}>
        <span ref={(area) => { if (area) areas.current.set(roomId, area); else areas.current.delete(roomId) }}
          style={{ display: 'block', position: 'relative', aspectRatio: '35 / 24' }} data-room-preview={roomId}>
          <img src={images[roomId]} alt="" width={560} height={384} draggable={false}
            hidden={!images[roomId]} style={{ visibility: images[roomId] ? 'visible' : 'hidden' }} />
          {!images[roomId] && <small style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            {status === 'unavailable' ? '3D preview unavailable' : 'Loading your room'}
          </small>}
        </span>
        <span className="room-preview-label"><strong>{roomCatalog[roomId].name}</strong>{roomId === currentRoom ? <Check size={16} /> : <ArrowRight size={16} />}</span>
        <small>{roomId === currentRoom ? 'Current room' : 'Open room'}</small>
      </button>)}
    </div>
  </Modal>
}
