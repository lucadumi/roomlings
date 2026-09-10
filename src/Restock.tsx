import { useState } from 'react'
import { Check, Plus, ShoppingBasket } from 'lucide-react'
import { shoppingItemLimit } from '../shared/domain.ts'
import type { Household, ShoppingItemInput } from '../shared/domain.ts'
import { getRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import type { ComponentSupply, RoomComponent } from '../shared/roomComponents.ts'
import { roomCatalog } from '../shared/rooms.ts'
import type { RoomId } from '../shared/rooms.ts'
import { normalizeShoppingName } from '../shared/shopping.ts'
import { Dropdown } from './Dropdown.tsx'
import './chores.css'

export function SupplyShortcuts({ household, components, busy, onAdd }: {
  household: Household; components: readonly RoomComponent[]; busy: boolean
  onAdd: (item: ShoppingItemInput) => void
}) {
  const [selectedSources, setSelectedSources] = useState<Record<string, string>>({})
  const groups = new Map<string, { component: RoomComponent; supply: ComponentSupply }[]>()
  for (const component of components) {
    if (!component.installed) continue
    for (const supply of component.supplies) {
      const key = normalizeShoppingName(supply.name)
      const sources = groups.get(key) ?? []
      sources.push({ component, supply })
      groups.set(key, sources)
    }
  }
  return <>
    <div className="restock-grid">{[...groups].map(([key, sources]) => {
      const { component, supply } = sources.find(({ component, supply }) => `${component.id}:${supply.id}` === selectedSources[key]) ?? sources[0]
      const listed = household.shopping.items.find((item) => normalizeShoppingName(item.name) === key)
      return <article className="restock-item" key={key} aria-label={supply.name}>
        <div>
          <h3>{supply.name}</h3>
          <p>{listed ? `${listed.quantity} already on the shared list` : supply.quantity}</p>
          {sources.length > 1 ? <label className="field">Supply shortcut for {supply.name}
            <Dropdown label={`Supply shortcut for ${supply.name}`} value={`${component.id}:${supply.id}`} disabled={busy}
              onValueChange={(value) => setSelectedSources((current) => ({ ...current, [key]: value }))}>
              {sources.map(({ component, supply }) => <option key={`${component.id}:${supply.id}`} value={`${component.id}:${supply.id}`}>{`${component.name}${sources.filter((source) => source.component.name === component.name).length > 1 ? ` at ${roomSlots.find((slot) => slot.id === component.slotId)?.name}` : ''} (${supply.quantity})`}</option>)}
            </Dropdown>
          </label> : <p>{roomCatalog[component.roomId].name}: {component.name}</p>}
        </div>
        {listed ? <span className="chore-status completed"><Check size={13} />On the list</span>
          : <button type="button" className="button secondary small-button" disabled={busy || household.shopping.items.length >= shoppingItemLimit}
            aria-label={`Restock ${supply.name}`} onClick={() => onAdd({
              name: supply.name, quantity: supply.quantity, notes: `${roomCatalog[component.roomId].name}: ${component.name}`,
              componentSource: { componentId: component.id, supplyId: supply.id },
            })}><Plus size={14} />Add to list</button>}
      </article>
    })}</div>
    {household.shopping.items.length >= shoppingItemLimit && <p className="field-hint">The shared list has reached {shoppingItemLimit} items. Finish a run or remove an unused item before adding more.</p>}
  </>
}

export function RestockPanel({ household, roomId, busy, onAdd, onShopping }: {
  household: Household; roomId: RoomId; busy: boolean
  onAdd: (item: ShoppingItemInput) => void; onShopping: () => void
}) {
  const room = roomCatalog[roomId]
  const components = getRoomComponents(household).filter((component) => component.roomId === roomId && component.installed)
  return <section aria-label={`${room.name} supplies`}>
    <p className="field-hint">These are shopping shortcuts for the objects in this room. Add supplies when they are running low. Nothing tracks stock or adds a debt.</p>
    <div className="restock-toolbar"><button className="button secondary small-button" disabled={busy} onClick={onShopping}><ShoppingBasket size={15} />Open shopping list</button>
      <button className="text-button" disabled={busy || household.shopping.items.length >= shoppingItemLimit} onClick={() => onAdd({ name: '', quantity: '1', notes: `${room.name} supplies` })}><Plus size={14} />Other supplies</button>
    </div>
    {!components.some((component) => component.supplies.length) && <p className="field-hint">No supply shortcuts are configured in this room. An admin can add them in Edit room, or you can add other supplies above.</p>}
    <SupplyShortcuts household={household} components={components} busy={busy} onAdd={onAdd} />
  </section>
}
