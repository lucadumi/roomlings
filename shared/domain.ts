import { z } from 'zod'

export const categories = ['produce', 'dairy', 'pantry', 'drinks', 'other'] as const
export type Category = (typeof categories)[number]
export const currencies = ['EUR', 'USD', 'GBP', 'RON'] as const
export const memberColors = ['#c9533a', '#7d9070', '#c2a34e', '#7c89a1', '#aa7893', '#738f91']

const id = z.string().uuid()
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
export const participantsSchema = z.array(id).min(1, 'Choose someone to split with.').max(12)
  .refine((ids) => new Set(ids).size === ids.length, 'Choose each roommate only once.')

export const memberSchema = z.object({ id, name: nameSchema, color: z.string() })
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
  id, createdAt: z.string().datetime(), bill: billPaymentReferenceSchema.optional(),
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
  amount: centsSchema,
  createdAt: z.string().datetime(),
})
export const householdSchema = z.object({
  id,
  name: nameSchema,
  currency: z.enum(currencies),
  budget: centsSchema,
  inviteCode: z.string(),
  demo: z.boolean(),
  version: z.number().int().nonnegative(),
  members: z.array(memberSchema).min(1).max(12),
  expenses: z.array(expenseSchema),
  settlements: z.array(settlementSchema),
  bills: z.array(billSchema).max(100).default(() => []),
  billingTimeZone: timeZoneSchema.default('UTC'),
}).superRefine((household, context) => {
  const bills = new Map(household.bills.map((bill) => [bill.id, bill]))
  const members = new Set(household.members.map((member) => member.id))
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
})

export type Member = z.infer<typeof memberSchema>
export type ExpenseInput = z.infer<typeof expenseInputSchema>
export type Expense = z.infer<typeof expenseSchema>
export type Settlement = z.infer<typeof settlementSchema>
export type Household = z.infer<typeof householdSchema>
export type Bill = z.infer<typeof billSchema>
export type BillRevision = z.infer<typeof billRevisionSchema>
export type BillEditInput = z.infer<typeof billEditInputSchema>
export type BillCreateInput = z.infer<typeof billCreateInputSchema>
export type BillPaymentInput = z.infer<typeof billPaymentInputSchema>
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
