import { Bath, CheckCheck, Droplets, Home, Layers, Leaf, ListChecks, PackagePlus, ReceiptText, ShoppingBasket, Sofa, Square, Toilet, Trash2, Wallet } from 'lucide-react'
import type { BathroomFocus } from '../bathroomModel.ts'
import type { LivingRoomFocus } from '../livingRoomModel.ts'
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

export const livingRoomChapters = [
  { id: 'living-room-room', target: 'room', label: 'Whole living room', short: 'Room', icon: Home, title: 'Your shared living room.', copy: 'A place for quiet evenings and time together. The sofa, tables and shared objects connect to the same household chores and shopping list.' },
  { id: 'living-room-sofa', target: 'sofa', label: 'Sofa', short: 'Sofa', icon: Sofa, title: 'A sofa for everyone.', copy: 'Schedule vacuuming and washing cushion covers with a due date and a roommate rotation. A tidy state is a manual update, not a completed chore.' },
  { id: 'living-room-surfaces', target: 'surfaces', label: 'Tables and shelves', short: 'Surfaces', icon: Square, title: 'Clear the shared surfaces.', copy: 'Keep the coffee table, TV and shelves ready for the next person. Each object can have its own cleaning routine and supply shortcuts.' },
  { id: 'living-room-plants', target: 'plants', label: 'Plants', short: 'Plants', icon: Leaf, title: 'Share the plant care.', copy: 'Give watering and tending a regular turn. Plant food and potting soil join the shared shopping list only when you ask to restock them.' },
  { id: 'living-room-floor', target: 'floor', label: 'Floor and rug', short: 'Floor', icon: Layers, title: 'Keep the lounge underfoot tidy.', copy: 'Assign vacuuming or mopping to a roommate or rotation. Saved completions record who did the work and advance the next turn.' },
  { id: 'living-room-bins', target: 'bins', label: 'Bin', short: 'Bin', icon: Trash2, title: 'Take a turn with the bin.', copy: 'Set a reminder to empty the bin and add bags to the shared list when needed. Removing an object keeps its completed chore history.' },
  { id: 'living-room-chores', target: 'chores', label: 'Cleaning caddy', short: 'Chores', icon: ListChecks, title: 'The living room routine.', copy: 'Review tasks for the whole room, their due dates and assignments. These chores stay separate from the kitchen and bathroom, in the same home.' },
  { id: 'living-room-supplies', target: 'supplies', label: 'Supply shelf', short: 'Supplies', icon: PackagePlus, title: 'Living room supplies.', copy: 'Add floor cleaner, dusting cloths and bin bags to the household shopping list. No cost is recorded until someone records a paid receipt.' },
] satisfies (RoomTourChapter & { target: LivingRoomFocus })[]

export const roomTourChapters: Record<RoomId, readonly RoomTourChapter[]> = {
  kitchen: tourChapters.map((chapter, index) => ({ ...chapter, ...kitchenCopy[index] })),
  bathroom: bathroomChapters,
  'living-room': livingRoomChapters,
}
