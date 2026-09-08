import { Bath, CheckCheck, Droplets, Home, Layers, ListChecks, PackagePlus, ReceiptText, ShoppingBasket, Square, Toilet, Wallet } from 'lucide-react'
import type { BathroomFocus } from '../bathroomModel.ts'
import type { RoomId } from '../../shared/rooms.ts'
import { tourChapters } from './tour.ts'

export type RoomTourChapter = {
  id: string; label: string; short: string; icon: typeof Home; title: string; copy: string
}

const kitchenCopy = [
  { icon: Home, title: 'Your shared kitchen.', copy: 'Explore the objects used for shopping, chores and shared costs. In your household, each one opens its related tool.' },
  { icon: ShoppingBasket, title: 'Shopping and groceries.', copy: 'Plan a shared list, claim items and record the paid receipt. The fridge shows those purchases, not how much food remains.' },
  { icon: ReceiptText, title: 'Bills and receipts.', copy: 'Keep paid groceries and recurring bills in one ledger. Record who paid and choose the roommates sharing each cost.' },
  { icon: Wallet, title: 'The grocery budget.', copy: 'Set a monthly grocery budget and see what remains. Bills and repayments stay separate from this pot.' },
  { icon: CheckCheck, title: 'Household repayments.', copy: 'See the same roommate balances across all rooms and months. Record repayments after paying; Roomlings never moves money.' },
]

export const bathroomChapters = [
  { id: 'bathroom-room', target: 'room', label: 'Whole bathroom', short: 'Room', icon: Home, title: 'Your shared bathroom.', copy: 'Explore the fixtures used for cleaning and restocking. In your household, each one opens its related tool.' },
  { id: 'bathroom-sink', target: 'sink', label: 'Sink', short: 'Sink', icon: Droplets, title: 'Sink chores.', copy: 'Assign sink-cleaning tasks with a due date and optional repeat schedule. Saved completions record who did the work and advance the next turn.' },
  { id: 'bathroom-mirror', target: 'mirror', label: 'Mirror', short: 'Mirror', icon: Square, title: 'Mirror chores.', copy: 'Assign mirror-cleaning tasks with a due date and optional rotation. Saved completions stay in the household history.' },
  { id: 'bathroom-toilet', target: 'toilet', label: 'Toilet', short: 'Toilet', icon: Toilet, title: 'Toilet chores.', copy: 'Assign toilet-cleaning tasks with a due date and optional repeat schedule. Saved completions record who did the work and advance the next turn.' },
  { id: 'bathroom-bath', target: 'bath', label: 'Bath', short: 'Bath', icon: Bath, title: 'Bath chores.', copy: 'Assign bath-cleaning tasks with a due date and optional rotation. This fixture keeps its tasks separate from other areas.' },
  { id: 'bathroom-floor', target: 'floor', label: 'Floor', short: 'Floor', icon: Layers, title: 'Floor chores.', copy: 'Schedule sweeping or mopping with an assigned roommate or rotation. Saved completions keep the next due date and turn current.' },
  { id: 'bathroom-chores', target: 'chores', label: 'Cleaning caddy', short: 'Chores', icon: ListChecks, title: 'Bathroom chores.', copy: 'Review all tasks for this room, including due dates and assignments. Completion history shows who did each turn.' },
  { id: 'bathroom-supplies', target: 'supplies', label: 'Supply shelf', short: 'Supplies', icon: PackagePlus, title: 'Bathroom supplies.', copy: 'Add needed toiletries and cleaning products to the shared shopping list. Restocking creates no expense until a paid receipt is recorded.' },
] satisfies (RoomTourChapter & { target: BathroomFocus })[]

export const roomTourChapters: Record<RoomId, readonly RoomTourChapter[]> = {
  kitchen: tourChapters.map((chapter, index) => ({ ...chapter, ...kitchenCopy[index] })),
  bathroom: bathroomChapters,
}
