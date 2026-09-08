import { randomUUID } from 'node:crypto'
import { billingDate, localDate, memberColors } from '../shared/domain.ts'
import type { Session } from '../shared/domain.ts'
import type { Store } from '../server/store.ts'

export async function createPopulatedHousehold(store: Store): Promise<Session> {
  const session = await store.create('The Sunday House', 'You', 'EUR', 45000)
  const { household, memberId } = session
  household.members.push(...['Jules', 'Sam', 'Alex'].map((name, index) => ({
    id: randomUUID(), name, color: memberColors[index + 1],
  })))
  const entries = [
    { description: 'The big weekly shop', amount: 8632, paidBy: 0, category: 'pantry', days: 0 },
    { description: 'Farmers market finds', amount: 2840, paidBy: 1, category: 'produce', days: 1 },
    { description: 'Milk, eggs & a little cheese', amount: 1875, paidBy: 2, category: 'dairy', days: 2 },
    { description: 'Coffee for the whole house', amount: 2490, paidBy: 0, category: 'drinks', days: 3 },
    { description: 'Pasta night essentials', amount: 3620, paidBy: 3, category: 'pantry', days: 4 },
    { description: 'Something green', amount: 1260, paidBy: 1, category: 'produce', days: 5 },
  ] as const
  household.expenses = entries.map((entry) => {
    const date = new Date()
    // Keep fixture receipts in the current month so browser totals stay deterministic.
    date.setDate(Math.max(1, date.getDate() - entry.days))
    return {
      id: randomUUID(), description: entry.description, amount: entry.amount,
      paidBy: household.members[entry.paidBy].id, participants: household.members.map((member) => member.id),
      category: entry.category, date: localDate(date), createdAt: new Date().toISOString(),
    }
  })
  const now = new Date()
  const dueDate = billingDate(household.billingTimeZone, now)
  household.chores.items = ([
    { title: 'Clear the sink', roomId: 'kitchen', area: 'sink', repeatDays: 1 },
    { title: 'Take out the rubbish', roomId: 'kitchen', area: 'bins', repeatDays: 3 },
    { title: 'Wipe the mirror', roomId: 'bathroom', area: 'mirror', repeatDays: 7 },
    { title: 'Clean the toilet', roomId: 'bathroom', area: 'toilet', repeatDays: 7 },
  ] as const).map((entry, turn) => ({
    ...entry, id: randomUUID(), notes: '', dueDate, rotation: household.members.map((member) => member.id), turn,
    createdBy: memberId, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    version: 0, occurrence: 0, archived: false,
  }))
  await store.save(household)
  return session
}
