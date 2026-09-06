import { localDate } from '../shared/domain.ts'

export function monthTitle(month: string, short = false): string {
  return new Intl.DateTimeFormat('en-GB', { month: short ? 'short' : 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00`))
}

export function dateTitle(date: string, today = localDate()): string {
  if (date === today) return 'Today'
  const yesterday = new Date(`${today}T12:00:00`)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date === localDate(yesterday)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
}
