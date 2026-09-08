import { Check, Plus, ShoppingBasket } from 'lucide-react'
import type { Household, ShoppingItemInput } from '../shared/domain.ts'
import { roomCatalog } from '../shared/rooms.ts'
import type { RoomId } from '../shared/rooms.ts'
import { normalizeShoppingName } from '../shared/shopping.ts'
import './chores.css'

export function RestockPanel({ household, roomId, busy, onAdd, onShopping }: {
  household: Household; roomId: RoomId; busy: boolean
  onAdd: (item: ShoppingItemInput) => void; onShopping: () => void
}) {
  const room = roomCatalog[roomId]
  return <section aria-label={`${room.name} supplies`}>
    <p className="field-hint">Add supplies when they are running low. This updates your shared shopping list, not an inventory or a debt.</p>
    <div className="restock-toolbar"><button className="button secondary small-button" disabled={busy} onClick={onShopping}><ShoppingBasket size={15} />Open shopping list</button>
      <button className="text-button" disabled={busy} onClick={() => onAdd({ name: '', quantity: '1', notes: `${room.name} supplies` })}><Plus size={14} />Other supplies</button>
    </div>
    {room.supplies.map((supply) => {
      const listed = household.shopping.items.find((item) => normalizeShoppingName(item.name) === normalizeShoppingName(supply.name))
      return <article className="restock-item" key={supply.id} aria-label={supply.name}>
        <div><h3>{supply.name}</h3><p>{listed ? `${listed.quantity} already on the shared list` : supply.quantity}</p></div>
        {listed ? <span className="chore-status completed"><Check size={13} />On the list</span>
          : <button className="button secondary small-button" disabled={busy} aria-label={`Restock ${supply.name}`} onClick={() => onAdd({ name: supply.name, quantity: supply.quantity, notes: `${room.name} supplies` })}><Plus size={14} />Add to list</button>}
      </article>
    })}
  </section>
}
