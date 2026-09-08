import { ArrowRight, Check } from 'lucide-react'
import { roomCatalog, roomIds } from '../shared/rooms.ts'
import type { RoomId } from '../shared/rooms.ts'
import { Modal } from './components.tsx'
import kitchenPreview from './assets/rooms/kitchen.png'
import bathroomPreview from './assets/rooms/bathroom.png'
import './roomPicker.css'

const previews: Record<RoomId, string> = {
  kitchen: kitchenPreview,
  bathroom: bathroomPreview,
}

export function RoomPicker({ currentRoom, onSelect, onClose }: {
  currentRoom: RoomId; onSelect: (roomId: RoomId) => void; onClose: () => void
}) {
  return <Modal title="Rooms" subtitle="Choose a room in this home." onClose={onClose}>
    <div className="room-preview-grid" role="group" aria-label="Choose a room">
      {roomIds.map((roomId) => <button type="button" key={roomId} className="room-preview-card"
        aria-label={`Open ${roomCatalog[roomId].name}`} aria-pressed={roomId === currentRoom} onClick={() => onSelect(roomId)}>
        <img src={previews[roomId]} alt="" width={560} height={384} draggable={false} />
        <span className="room-preview-label"><strong>{roomCatalog[roomId].name}</strong>{roomId === currentRoom ? <Check size={16} /> : <ArrowRight size={16} />}</span>
        <small>{roomId === currentRoom ? 'Current room' : 'Open room'}</small>
      </button>)}
    </div>
  </Modal>
}
