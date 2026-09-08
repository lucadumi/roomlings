import { useId, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { roomCatalog, roomIds } from '../../shared/rooms.ts'
import type { RoomId } from '../../shared/rooms.ts'
import { roomPreviewImages } from '../roomPreviews.ts'
import './roomPreview.css'

export function RoomPreview({ roomId }: { roomId: RoomId }) {
  const [failed, setFailed] = useState(false)
  return <div className="welcome-stage welcome-room-scene" role={failed ? undefined : 'img'}
    aria-label={failed ? undefined : `${roomCatalog[roomId].name} preview`}>
    {failed
      ? <div className="welcome-preview-unavailable" role="status">
        <ImageOff size={26} aria-hidden="true" />
        <p>The {roomCatalog[roomId].name.toLowerCase()} preview could not load. You can still open your room.</p>
      </div>
      : <img src={roomPreviewImages[roomId]} alt="" width={560} height={384} draggable={false} onError={() => setFailed(true)} />}
  </div>
}

export function RoomChoices({ value, onChange }: {
  value: RoomId; onChange: (roomId: RoomId) => void
}) {
  const groupId = useId()
  return <fieldset className="welcome-preview-options">
    <legend className="sr-only">Preview a room</legend>
    {roomIds.map((id) => <label className="welcome-preview-choice" key={id}>
      <input type="radio" name={groupId} value={id} checked={value === id} onChange={() => onChange(id)} />
      <img src={roomPreviewImages[id]} alt="" width={84} height={58} loading="lazy" draggable={false} />
      <span>{roomCatalog[id].name}</span>
    </label>)}
  </fieldset>
}
