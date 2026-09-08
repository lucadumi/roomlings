import { z } from 'zod'
import { choreAreaSchema, roomCatalog, roomIdSchema } from './rooms.ts'
import type { ChoreArea, RoomId } from './rooms.ts'

export const categories = ['produce', 'dairy', 'pantry', 'drinks', 'other'] as const
export type Category = (typeof categories)[number]
export const currencies = ['EUR', 'USD', 'GBP', 'RON'] as const
export const memberColors = ['#c9533a', '#7d9070', '#c2a34e', '#7c89a1', '#aa7893', '#738f91']
export const activeMemberLimit = 12
export const retainedMemberLimit = 200
export const mutationReceiptLimit = 1000
export const roomStyleSchema = z.enum(['original', 'sage', 'clay', 'linen'])

const id = z.string().uuid()
export const mutationInputSchema = z.object({ mutationId: id, mutationVersion: z.number().int().nonnegative() })
const mutationReceiptSchema = z.object({
  id, memberId: id, version: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export const nameSchema = z.string().trim().min(1, 'Please enter a name.').max(50)
export const centsSchema = z.number().int().positive().max(100_000_000)
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}, 'Please choose a valid date.')
export const monthSchema = z.string().regex(/^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/, 'Choose a valid billing month.')
export const timeZoneSchema = z.string().min(1).max(100).refine((timeZone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone })
    return true
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}, 'Choose a valid billing time zone.')
export const participantsSchema = z.array(id).min(1, 'Choose someone to split with.').max(activeMemberLimit)
  .refine((ids) => new Set(ids).size === ids.length, 'Choose each roommate only once.')

export const memberSchema = z.object({ id, name: nameSchema, color: z.string(), inactive: z.boolean().optional() })
export const expenseInputSchema = z.object({
  description: z.string().trim().min(1, 'Give this grocery run a name.').max(100),
  amount: centsSchema,
  paidBy: id,
  participants: participantsSchema,
  category: z.enum(categories),
  date: dateSchema,
})
const billPaymentReferenceSchema = z.object({ billId: id, month: monthSchema, dueDate: dateSchema })
  .refine((reference) => reference.dueDate.startsWith(`${reference.month}-`), 'The due date must belong to the billing month.')
export const expenseSchema = expenseInputSchema.extend({
  id, createdAt: z.string().datetime(), bill: billPaymentReferenceSchema.optional(), shoppingRunId: id.optional(),
})
export const shoppingItemLimit = 200
export const shoppingRunLimit = 20_000
export const shoppingItemInputSchema = z.object({
  name: nameSchema,
  quantity: z.string().trim().min(1, 'Enter a quantity.').max(40).default('1'),
  notes: z.string().trim().max(240).default(''),
})
export const shoppingItemVersionSchema = z.object({ itemVersion: z.number().int().nonnegative() })
export const shoppingItemEditSchema = shoppingItemInputSchema.extend(shoppingItemVersionSchema.shape)
export const shoppingClaimSchema = shoppingItemVersionSchema.extend({ claimed: z.boolean() })
export const shoppingPickSchema = shoppingItemVersionSchema.extend({ pickedUp: z.boolean() })
export const shoppingItemSnapshotSchema = shoppingItemInputSchema.extend({
  id, createdBy: id, createdAt: z.string().datetime(),
})
export const shoppingItemSchema = shoppingItemSnapshotSchema.extend({
  version: z.number().int().nonnegative(),
  claimedBy: id.nullable(),
  pickedUp: z.boolean(),
  updatedAt: z.string().datetime(),
}).refine((item) => !item.pickedUp || item.claimedBy !== null, 'An item in a basket must have a shopper.')
export const shoppingRunSchema = z.object({
  id, expenseId: id, name: expenseInputSchema.shape.description,
  completedBy: id, completedAt: z.string().datetime(),
  items: z.array(shoppingItemSnapshotSchema).min(1).max(shoppingItemLimit),
})
export const shoppingCheckoutSchema = expenseInputSchema.extend({
  checkoutId: id,
  items: z.array(z.object({ id, version: z.number().int().nonnegative() })).min(1, 'Choose at least one item.').max(shoppingItemLimit)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Choose each item only once.'),
})
export const choreLimit = 200
export const choreCompletionLimit = 20_000
const choreTitleSchema = z.string().trim().min(1, 'Give this chore a name.').max(80)
const choreDateSchema = dateSchema.refine((date) => date >= '1900-01-01', 'Choose a chore date from 1900 onward.')
const choreFieldsSchema = z.object({
  title: choreTitleSchema,
  notes: z.string().trim().max(240).default(''),
  roomId: roomIdSchema.nullable(),
  area: choreAreaSchema.nullable(),
  dueDate: choreDateSchema,
  repeatDays: z.number().int().min(1).max(365).nullable(),
  rotation: z.array(id).min(1, 'Choose at least one roommate for this chore.').max(activeMemberLimit)
    .refine((ids) => new Set(ids).size === ids.length, 'Choose each roommate only once in the rotation.'),
  turn: z.number().int().nonnegative().default(0),
})
type ChoreLocation = { roomId: RoomId | null; area: ChoreArea | null }
function validateChoreLocation(chore: ChoreLocation, context: z.RefinementCtx) {
  if (chore.roomId === null ? chore.area !== null
    : chore.area !== null && !roomCatalog[chore.roomId].areas.some((area) => area.id === chore.area)) {
    context.addIssue({ code: 'custom', message: 'Choose an area in this room, or no area for a whole-home chore.', path: ['area'] })
  }
}
function validateChoreFields(chore: ChoreLocation & { rotation: string[]; turn: number }, context: z.RefinementCtx) {
  validateChoreLocation(chore, context)
  if (chore.turn >= chore.rotation.length) {
    context.addIssue({ code: 'custom', message: 'Choose the next roommate from this chore rotation.', path: ['turn'] })
  }
}
export const choreInputSchema = choreFieldsSchema.superRefine(validateChoreFields)
export const choreVersionSchema = z.object({ choreVersion: z.number().int().nonnegative() })
export const choreEditInputSchema = choreFieldsSchema.extend(choreVersionSchema.shape).superRefine(validateChoreFields)
export const choreArchiveSchema = choreVersionSchema.extend({ archived: z.boolean() })
export const choreSchema = choreFieldsSchema.extend({
  id, createdBy: id, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  dueDate: choreDateSchema.nullable(),
  version: z.number().int().nonnegative(),
  occurrence: z.number().int().nonnegative(),
  archived: z.boolean(),
}).superRefine((chore, context) => {
  validateChoreFields(chore, context)
  if (chore.dueDate === null && chore.repeatDays !== null) {
    context.addIssue({ code: 'custom', message: 'A repeating chore must keep its next due date.', path: ['dueDate'] })
  }
  if (chore.occurrence > chore.version) {
    context.addIssue({ code: 'custom', message: 'A chore occurrence cannot be ahead of its version.', path: ['occurrence'] })
  }
})
export const choreCompletionSchema = z.object({
  id, choreId: id,
  occurrence: z.number().int().nonnegative(),
  title: choreTitleSchema,
  roomId: roomIdSchema.nullable(),
  area: choreAreaSchema.nullable(),
  dueDate: choreDateSchema,
  turn: z.number().int().nonnegative().max(activeMemberLimit - 1),
  assignedTo: id.nullable(),
  completedBy: id,
  completedAt: z.string().datetime(),
  resultVersion: z.number().int().positive(),
  undoneAt: z.string().datetime().nullable(),
  undoneBy: id.nullable(),
}).superRefine((completion, context) => {
  validateChoreLocation(completion, context)
  if ((completion.undoneAt === null) !== (completion.undoneBy === null)) {
    context.addIssue({ code: 'custom', message: 'An undone chore completion needs both its time and roommate.', path: ['undoneAt'] })
  }
  if (completion.resultVersion <= completion.occurrence) {
    context.addIssue({ code: 'custom', message: 'A completion must record the resulting chore version.', path: ['resultVersion'] })
  }
})
export const billEditInputSchema = z.object({
  name: nameSchema, amount: centsSchema, dueDay: z.number().int().min(1).max(31), participants: participantsSchema,
})
export const billCreateInputSchema = billEditInputSchema.omit({ dueDay: true }).extend({
  firstDueDate: dateSchema.refine((date) => date >= '1900-01-01', 'Choose a first due date from 1900 onward.'),
  timeZone: timeZoneSchema.default('UTC'),
})
export const billPaymentInputSchema = z.object({
  month: monthSchema, amount: centsSchema, paidBy: id, participants: participantsSchema, date: dateSchema,
})
export const billRevisionSchema = billEditInputSchema.extend({ fromMonth: monthSchema })
export const billPauseSchema = z.object({ fromMonth: monthSchema, untilMonth: monthSchema.nullable() })
  .refine((pause) => pause.untilMonth === null || pause.untilMonth > pause.fromMonth, 'A pause must end after it starts.')
export const billSchema = z.object({
  id, createdAt: z.string().datetime(), startMonth: monthSchema,
  revisions: z.array(billRevisionSchema).min(1), pauses: z.array(billPauseSchema),
}).superRefine((bill, context) => {
  if (bill.revisions[0]?.fromMonth !== bill.startMonth) {
    context.addIssue({ code: 'custom', message: 'A bill needs its original monthly schedule.', path: ['revisions'] })
  }
  for (let index = 1; index < bill.revisions.length; index++) {
    if (bill.revisions[index].fromMonth <= bill.revisions[index - 1].fromMonth) {
      context.addIssue({ code: 'custom', message: 'Bill revisions must have distinct, ordered months.', path: ['revisions', index] })
    }
  }
  for (let index = 0; index < bill.pauses.length; index++) {
    const pause = bill.pauses[index]
    const previous = bill.pauses[index - 1]
    if (pause.fromMonth < bill.startMonth || (previous && (previous.untilMonth === null || pause.fromMonth < previous.untilMonth))) {
      context.addIssue({ code: 'custom', message: 'Bill pauses must not overlap or precede the bill.', path: ['pauses', index] })
    }
  }
})
export const settlementSchema = z.object({
  id,
  from: id,
  to: id,
  amount: z.number().int().positive(),
  createdAt: z.string().datetime(),
})
export const householdSchema = z.object({
  id,
  name: nameSchema,
  currency: z.enum(currencies),
  budget: centsSchema,
  roomStyle: roomStyleSchema.default('original'),
  inviteCode: z.string(),
  version: z.number().int().nonnegative(),
  mutationReceipts: z.array(mutationReceiptSchema).max(mutationReceiptLimit).optional(),
  members: z.array(memberSchema).min(1).max(retainedMemberLimit),
  expenses: z.array(expenseSchema),
  settlements: z.array(settlementSchema),
  bills: z.array(billSchema).max(100).default(() => []),
  billingTimeZone: timeZoneSchema.default('UTC'),
  shopping: z.object({
    items: z.array(shoppingItemSchema).max(shoppingItemLimit),
    runs: z.array(shoppingRunSchema).max(shoppingRunLimit),
  }).default(() => ({ items: [], runs: [] })),
  chores: z.object({
    items: z.array(choreSchema).max(choreLimit),
    history: z.array(choreCompletionSchema).max(choreCompletionLimit),
  }).default(() => ({ items: [], history: [] })),
}).superRefine((household, context) => {
  if (household.members.filter((member) => !member.inactive).length > activeMemberLimit) {
    context.addIssue({ code: 'custom', message: 'A kitchen can have at most 12 active roommates.', path: ['members'] })
  }
  const bills = new Map(household.bills.map((bill) => [bill.id, bill]))
  const members = new Set(household.members.map((member) => member.id))
  const receiptIds = new Set<string>()
  household.mutationReceipts?.forEach((receipt, index, receipts) => {
    if (receiptIds.has(receipt.id) || !members.has(receipt.memberId) || receipt.version > household.version
      || (index > 0 && receipt.version <= receipts[index - 1].version)) {
      context.addIssue({ code: 'custom', message: 'Saved changes need unique identifiers, valid roommates and ordered versions.', path: ['mutationReceipts', index] })
    }
    receiptIds.add(receipt.id)
  })
  if (bills.size !== household.bills.length) {
    context.addIssue({ code: 'custom', message: 'Monthly bills need unique identifiers.', path: ['bills'] })
  }
  household.bills.forEach((bill, index) => {
    if (bill.revisions.some((revision) => revision.participants.some((participant) => !members.has(participant)))) {
      context.addIssue({ code: 'custom', message: 'A bill references an unknown roommate.', path: ['bills', index] })
    }
  })
  const payments = new Set<string>()
  household.expenses.forEach((expense, index) => {
    if (!expense.bill) return
    const key = `${expense.bill.billId}:${expense.bill.month}`
    const bill = bills.get(expense.bill.billId)
    if (!bill || expense.bill.month < bill.startMonth || payments.has(key)) {
      context.addIssue({ code: 'custom', message: 'A bill payment must reference one unique scheduled month.', path: ['expenses', index] })
    }
    if (!members.has(expense.paidBy) || expense.participants.some((participant) => !members.has(participant))) {
      context.addIssue({ code: 'custom', message: 'A bill payment references an unknown roommate.', path: ['expenses', index] })
    }
    payments.add(key)
  })
  const items = new Set<string>()
  household.shopping.items.forEach((item, index) => {
    if (items.has(item.id) || !members.has(item.createdBy) || (item.claimedBy !== null && !members.has(item.claimedBy))) {
      context.addIssue({ code: 'custom', message: 'Shopping items need unique identifiers and valid roommates.', path: ['shopping', 'items', index] })
    }
    items.add(item.id)
  })
  const runs = new Map(household.shopping.runs.map((run) => [run.id, run]))
  const receipts = new Set<string>()
  const expenses = new Map(household.expenses.map((expense) => [expense.id, expense]))
  if (runs.size !== household.shopping.runs.length) {
    context.addIssue({ code: 'custom', message: 'Shopping runs need unique identifiers.', path: ['shopping', 'runs'] })
  }
  household.shopping.runs.forEach((run, index) => {
    const expense = expenses.get(run.expenseId)
    if (!members.has(run.completedBy) || receipts.has(run.expenseId) || (expense && (expense.shoppingRunId !== run.id || expense.bill))) {
      context.addIssue({ code: 'custom', message: 'A shopping run must have its own grocery receipt and a valid shopper.', path: ['shopping', 'runs', index] })
    }
    receipts.add(run.expenseId)
    for (const item of run.items) {
      if (items.has(item.id) || !members.has(item.createdBy)) {
        context.addIssue({ code: 'custom', message: 'A shopping item can only be archived once.', path: ['shopping', 'runs', index, 'items'] })
      }
      items.add(item.id)
    }
  })
  household.expenses.forEach((expense, index) => {
    if (expense.shoppingRunId && (expense.bill || runs.get(expense.shoppingRunId)?.expenseId !== expense.id)) {
      context.addIssue({ code: 'custom', message: 'A shopping receipt must reference its matching run.', path: ['expenses', index] })
    }
    if (expense.shoppingRunId && (!members.has(expense.paidBy) || expense.participants.some((participant) => !members.has(participant)))) {
      context.addIssue({ code: 'custom', message: 'A shopping receipt references an unknown roommate.', path: ['expenses', index] })
    }
  })
  const chores = new Map(household.chores.items.map((chore) => [chore.id, chore]))
  if (chores.size !== household.chores.items.length) {
    context.addIssue({ code: 'custom', message: 'Chores need unique identifiers.', path: ['chores', 'items'] })
  }
  household.chores.items.forEach((chore, index) => {
    if (!members.has(chore.createdBy) || chore.rotation.some((member) => !members.has(member))) {
      context.addIssue({ code: 'custom', message: 'A chore references an unknown roommate.', path: ['chores', 'items', index] })
    }
  })
  const completions = new Set<string>()
  const completedOccurrences = new Set<string>()
  household.chores.history.forEach((completion, index) => {
    const chore = chores.get(completion.choreId)
    const key = `${completion.choreId}:${completion.occurrence}`
    const active = completion.undoneAt === null
    if (completions.has(completion.id) || !chore || completion.resultVersion > chore.version
      || (active && (completedOccurrences.has(key) || completion.occurrence >= chore.occurrence))) {
      context.addIssue({ code: 'custom', message: 'A chore occurrence can have only one active completion with a valid chore version.', path: ['chores', 'history', index] })
    }
    if (!members.has(completion.completedBy) || (completion.assignedTo !== null && !members.has(completion.assignedTo))
      || (completion.undoneBy !== null && !members.has(completion.undoneBy))) {
      context.addIssue({ code: 'custom', message: 'A chore completion references an unknown roommate.', path: ['chores', 'history', index] })
    }
    completions.add(completion.id)
    if (active) completedOccurrences.add(key)
  })
})

export type Member = z.infer<typeof memberSchema>
export type RoomStyle = z.infer<typeof roomStyleSchema>
export type ExpenseInput = z.infer<typeof expenseInputSchema>
export type Expense = z.infer<typeof expenseSchema>
export type Settlement = z.infer<typeof settlementSchema>
export type Household = z.infer<typeof householdSchema>
export type Bill = z.infer<typeof billSchema>
export type BillRevision = z.infer<typeof billRevisionSchema>
export type BillEditInput = z.infer<typeof billEditInputSchema>
export type BillCreateInput = z.infer<typeof billCreateInputSchema>
export type BillPaymentInput = z.infer<typeof billPaymentInputSchema>
export type ShoppingItem = z.infer<typeof shoppingItemSchema>
export type ShoppingItemInput = z.infer<typeof shoppingItemInputSchema>
export type ShoppingRun = z.infer<typeof shoppingRunSchema>
export type ShoppingCheckoutInput = z.infer<typeof shoppingCheckoutSchema>
export type ChoreInput = z.infer<typeof choreInputSchema>
export type Chore = z.infer<typeof choreSchema>
export type ChoreCompletion = z.infer<typeof choreCompletionSchema>
export type Transfer = Pick<Settlement, 'from' | 'to' | 'amount'>
export type Session = { token: string; memberId: string; household: Household }

export const categoryLabels: Record<Category, string> = {
  produce: 'Fruit & veg',
  dairy: 'Dairy & eggs',
  pantry: 'Pantry',
  drinks: 'Drinks',
  other: 'Other groceries',
}

export function splitAmount(amount: number, participants: string[]): Map<string, number> {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !participants.length
    || new Set(participants).size !== participants.length) {
    throw new Error('A split needs a positive whole-cent amount and unique participants.')
  }
  const ordered = [...participants].sort()
  const base = Math.floor(amount / ordered.length)
  const remainder = amount % ordered.length
  return new Map(ordered.map((member, index) => [member, base + (index < remainder ? 1 : 0)]))
}

export function balances(household: Pick<Household, 'members' | 'expenses' | 'settlements'>): Map<string, number> {
  const result = new Map(household.members.map((member) => [member.id, 0]))
  const add = (member: string, amount: number) => {
    const previous = result.get(member)
    if (previous === undefined) throw new Error('The ledger references an unknown roommate.')
    result.set(member, previous + amount)
  }
  for (const expense of household.expenses) {
    add(expense.paidBy, expense.amount)
    for (const [participant, amount] of splitAmount(expense.amount, expense.participants)) add(participant, -amount)
  }
  for (const settlement of household.settlements) {
    add(settlement.from, settlement.amount)
    add(settlement.to, -settlement.amount)
  }
  return result
}

export function suggestedTransfers(household: Pick<Household, 'members' | 'expenses' | 'settlements'>): Transfer[] {
  const current = [...balances(household)]
  const creditors = current.filter(([, balance]) => balance > 0).map(([id, amount]) => ({ id, amount }))
  const debtors = current.filter(([, balance]) => balance < 0).map(([id, amount]) => ({ id, amount: -amount }))
  const order = (a: { id: string; amount: number }, b: { id: string; amount: number }) => b.amount - a.amount || a.id.localeCompare(b.id)
  creditors.sort(order)
  debtors.sort(order)
  const transfers: Transfer[] = []
  let creditor = 0
  let debtor = 0
  while (creditor < creditors.length && debtor < debtors.length) {
    const to = creditors[creditor]
    const from = debtors[debtor]
    const amount = Math.min(to.amount, from.amount)
    transfers.push({ from: from.id, to: to.id, amount })
    to.amount -= amount
    from.amount -= amount
    if (to.amount === 0) creditor++
    if (from.amount === 0) debtor++
  }
  return transfers
}

export function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return amount > 0 && amount <= 100_000_000 ? amount : null
}

export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount / 100)
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function billingDate(timeZone: string, date = new Date()): string {
  const parts = new Map(new Intl.DateTimeFormat('en-CA', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return dateSchema.parse(`${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`)
}

export function monthlyExpenses(household: Household, month: string): Expense[] {
  return household.expenses.filter((expense) => expense.date.startsWith(`${month}-`))
}

export function monthlyGroceries(household: Household, month: string): Expense[] {
  return monthlyExpenses(household, month).filter((expense) => !expense.bill)
}

export function escapeCsv(value: string | number): string {
  const text = String(value)
  const safe = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
