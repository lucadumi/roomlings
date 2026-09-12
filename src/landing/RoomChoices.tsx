import { useId } from 'react'
import { roomCatalog, roomIds } from '../../shared/rooms.ts'
import type { RoomId } from '../../shared/rooms.ts'
import './roomPreview.css'

export function RoomChoices({ value, onChange }: {
  value: RoomId; onChange: (roomId: RoomId) => void
}) {
  const groupId = useId()
  return <fieldset className="welcome-preview-options">
    <legend className="sr-only">Preview a room</legend>
    {roomIds.map((id) => <label className="welcome-preview-choice" key={id}>
      <input type="radio" name={groupId} value={id} checked={value === id} onChange={() => onChange(id)} />
      <span>{roomCatalog[id].name}</span>
    </label>)}
  </fieldset>
}
