import { z } from 'zod'
import { choreAssignee, choreStatus } from './chores.ts'
import { roomCatalog } from './rooms.ts'
import { getRoomComponents, componentChoreIsPaused } from './roomComponents.ts'
import type { Household } from './domain.ts'
import { latestBillRevision } from './bills.ts'

export const inboxReadLimit = 200
export const inboxItemLimit = 50
export const inboxWindowDays = 30
const itemId = z.string().min(1).max(120).regex(/^(chore|expense|settlement):[0-9a-f-]+(:\d{4}-\d{2}-\d{2})?$/)
export const inboxStateSchema = z.object({
  readThrough: z.string().datetime().nullable(),
  readIds: z.array(itemId).max(inboxReadLimit),
}).strict()
export const inboxReadSchema = z.object({
  through: z.string().datetime().optional(),
  ids: z.array(itemId).min(1).max(inboxReadLimit).optional(),
}).strict().refine((input) => input.through !== undefined || input.ids !== undefined, 'Choose notifications to mark as read.')

export type InboxState = z.infer<typeof inboxStateSchema>
export type InboxRead = z.infer<typeof inboxReadSchema>
export type InboxItem = {
  id: string
  kind: 'chore' | 'expense' | 'bill' | 'settlement'
  at: string
  title: string
  detail: string
  amount?: number
  target: { page: 'chores'; choreId: string } | { page: 'groceries' | 'bills'; month: string } | { page: 'settle' }
}

const day = 86_400_000

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / day)
}

// Every item is derived from the saved household, so the inbox never disagrees with the ledger or chores.
export function inboxItems(household: Household, memberId: string, today: string, now = Date.now()): InboxItem[] {
  const name = (id: string) => household.members.find((member) => member.id === id)?.name ?? 'A former roommate'
  const since = now - inboxWindowDays * day
  const items: InboxItem[] = []
  const components = getRoomComponents(household)
  for (const chore of household.chores.items) {
    const status = choreStatus(chore, today)
    if ((status !== 'due' && status !== 'overdue') || componentChoreIsPaused(chore, components)
      || choreAssignee(chore, household.members)?.id !== memberId) continue
    const late = daysBetween(chore.dueDate!, today)
    const place = [chore.roomId ? roomCatalog[chore.roomId].name : 'Whole home', chore.componentName].filter(Boolean).join(', ')
    items.push({
      id: `chore:${chore.id}:${chore.dueDate}`, kind: 'chore', at: `${chore.dueDate}T00:00:00.000Z`,
      title: late > 0 ? `${chore.title} is ${late} ${late === 1 ? 'day' : 'days'} overdue` : `${chore.title} is due today`,
      detail: `${place}; your turn`, target: { page: 'chores', choreId: chore.id },
    })
  }
  for (const expense of household.expenses) {
    if (expense.paidBy === memberId || !expense.participants.includes(memberId) || Date.parse(expense.createdAt) < since) continue
    const bill = expense.bill ? household.bills?.find((entry) => entry.id === expense.bill!.billId) : undefined
    items.push({
      id: `expense:${expense.id}`, kind: expense.bill ? 'bill' : 'expense', at: expense.createdAt, amount: expense.amount,
      title: `${name(expense.paidBy)} paid ${bill ? latestBillRevision(bill).name : expense.description}`,
      detail: `Split ${expense.participants.length} ${expense.participants.length === 1 ? 'way' : 'ways'}`,
      target: { page: expense.bill ? 'bills' : 'groceries', month: expense.bill?.month ?? expense.date.slice(0, 7) },
    })
  }
  for (const settlement of household.settlements) {
    if (settlement.to !== memberId || Date.parse(settlement.createdAt) < since) continue
    items.push({
      id: `settlement:${settlement.id}`, kind: 'settlement', at: settlement.createdAt, amount: settlement.amount,
      title: `${name(settlement.from)} paid you back`, detail: 'Repayment', target: { page: 'settle' },
    })
  }
  // Turns you owe come first, most overdue at the top; money follows, newest first.
  const rank = (item: InboxItem) => item.kind === 'chore' ? 0 : 1
  return items.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at))
    || a.id.localeCompare(b.id)).slice(0, inboxItemLimit)
}

export function inboxUnread(item: InboxItem, state: InboxState): boolean {
  return !(state.readThrough !== null && item.at <= state.readThrough) && !state.readIds.includes(item.id)
}

// Marking everything read moves the cursor to the newest item, so later entries stay unread.
export function readAll(items: readonly InboxItem[], state: InboxState): InboxState {
  const newest = items.reduce<string | null>((latest, item) => latest === null || item.at > latest ? item.at : latest, null)
  if (newest === null || (state.readThrough !== null && state.readThrough >= newest)) return state
  return { readThrough: newest, readIds: state.readIds.filter((id) => !items.some((item) => item.id === id && item.at <= newest)) }
}

export function mergeInboxRead(state: InboxState, input: InboxRead): InboxState {
  const readThrough = input.through && (state.readThrough === null || input.through > state.readThrough) ? input.through : state.readThrough
  const ids = [...new Set([...state.readIds, ...(input.ids ?? [])])]
  return inboxStateSchema.parse({ readThrough, readIds: ids.slice(-inboxReadLimit) })
}
