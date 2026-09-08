import type { Category, RoomStyle } from '../shared/domain.ts'
import type { ChoreArea } from '../shared/rooms.ts'
import type { FocusRequest } from './camera.ts'
import type { KitchenAction } from './room.ts'

export type RoomWorldProps = {
  roomStyle: RoomStyle
  paused: boolean
  panelOpen: boolean
  focusRequest: FocusRequest
  counts: Record<Category, number>
  selected: Category | 'all'
  fundFraction: number
  memberCount: number
  expenseCount: number
  stockEvent: { id: string; category: Category } | null
  onSelect: (category: Category) => void
  onAction: (action: KitchenAction) => void
  onOpenChores: (area: ChoreArea | null) => void
  onRestock: () => void
  dueChores: Partial<Record<ChoreArea, number>>
}
