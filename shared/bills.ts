import { billSchema, billingDate, monthSchema } from './domain.ts'
import type { Bill, BillEditInput, BillRevision, Expense, Household } from './domain.ts'

export function addMonths(month: string, offset: number): string {
  monthSchema.parse(month)
  if (!Number.isInteger(offset)) throw new Error('A month offset must be a whole number.')
  const [year, number] = month.split('-').map(Number)
  const index = year * 12 + number - 1 + offset
  return monthSchema.parse(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`)
}

export function billDueDate(month: string, day: number): string {
  monthSchema.parse(month)
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('A monthly bill needs a due day between 1 and 31.')
  const [year, number] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate()
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

export function latestBillRevision(bill: Bill): BillRevision {
  const revision = bill.revisions.at(-1)
  if (!revision) throw new Error('The monthly bill has no schedule.')
  return revision
}

export function billRevisionForMonth(bill: Bill, month: string): BillRevision | undefined {
  return bill.revisions.findLast((revision) => revision.fromMonth <= month)
}

export function billIsScheduled(bill: Bill, month: string): boolean {
  return month >= bill.startMonth && !bill.pauses.some((pause) =>
    month >= pause.fromMonth && (pause.untilMonth === null || month < pause.untilMonth),
  )
}

export function reviseBill(bill: Bill, input: BillEditInput, month: string): Bill {
  monthSchema.parse(month)
  const fromMonth = monthSchema.parse(month > bill.startMonth ? month : bill.startMonth)
  // Earlier periods retain their terms. Paid periods retain the expense snapshot as well.
  return billSchema.parse({
    ...bill,
    revisions: [...bill.revisions.filter((revision) => revision.fromMonth < fromMonth), { ...input, fromMonth }],
  })
}

export function billPauseMonth(bill: Bill, month: string): string {
  const next = addMonths(month, 1)
  return bill.startMonth > next ? bill.startMonth : next
}

export function setBillPaused(bill: Bill, paused: boolean, month: string): Bill {
  monthSchema.parse(month)
  const open = bill.pauses.find((pause) => pause.untilMonth === null)
  if (paused) {
    if (open) throw new Error('This monthly bill is already paused.')
    return billSchema.parse({ ...bill, pauses: [...bill.pauses, { fromMonth: billPauseMonth(bill, month), untilMonth: null }] })
  }
  if (!open) throw new Error('This monthly bill is already active.')
  return billSchema.parse({
    ...bill,
    pauses: bill.pauses.flatMap((pause) => {
      if (pause !== open) return [pause]
      return month <= pause.fromMonth ? [] : [{ ...pause, untilMonth: month }]
    }),
  })
}

export type BillOccurrence = {
  billId: string
  month: string
  name: string
  dueDate: string
  amount: number
  participants: string[]
  payment: Expense | null
  status: 'paid' | 'overdue' | 'due' | 'upcoming'
}

function occurrence(bill: Bill, month: string, today: string, payment?: Expense): BillOccurrence | null {
  if (payment?.bill) {
    return {
      billId: bill.id, month, name: payment.description, dueDate: payment.bill.dueDate,
      amount: payment.amount, participants: payment.participants, payment, status: 'paid',
    }
  }
  const revision = billRevisionForMonth(bill, month)
  if (!revision || !billIsScheduled(bill, month)) return null
  const dueDate = billDueDate(month, revision.dueDay)
  return {
    billId: bill.id, month, name: revision.name, dueDate, amount: revision.amount,
    participants: revision.participants, payment: null,
    status: dueDate < today ? 'overdue' : dueDate === today ? 'due' : 'upcoming',
  }
}

export function billOccurrence(household: Household, bill: Bill, month: string, today = billingDate(household.billingTimeZone)): BillOccurrence | null {
  monthSchema.parse(month)
  const payment = household.expenses.find((expense) => expense.bill?.billId === bill.id && expense.bill.month === month)
  return occurrence(bill, month, today, payment)
}

function recordedBillPayments(household: Household): Map<string, Expense> {
  const payments = new Map<string, Expense>()
  for (const expense of household.expenses) {
    if (expense.bill) payments.set(`${expense.bill.billId}:${expense.bill.month}`, expense)
  }
  return payments
}

export function monthlyBills(household: Household, month: string, today = billingDate(household.billingTimeZone)): BillOccurrence[] {
  monthSchema.parse(month)
  const payments = recordedBillPayments(household)
  return household.bills.flatMap((bill) => {
    const item = occurrence(bill, month, today, payments.get(`${bill.id}:${month}`))
    return item ? [item] : []
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name) || a.billId.localeCompare(b.billId))
}

export function earlierOverdueBills(household: Household, beforeMonth: string, today = billingDate(household.billingTimeZone)): { count: number; firstMonth: string | null } {
  monthSchema.parse(beforeMonth)
  const payments = recordedBillPayments(household)
  const currentMonth = today.slice(0, 7)
  let count = 0
  let firstMonth: string | null = null
  for (const bill of household.bills) {
    for (let month = bill.startMonth; month < beforeMonth && month <= currentMonth; month = addMonths(month, 1)) {
      if (!payments.has(`${bill.id}:${month}`) && billIsScheduled(bill, month)) {
        const revision = billRevisionForMonth(bill, month)
        if (revision && billDueDate(month, revision.dueDay) < today) {
          count++
          if (firstMonth === null || month < firstMonth) firstMonth = month
        }
      }
      if (month === currentMonth) break
    }
  }
  return { count, firstMonth }
}
