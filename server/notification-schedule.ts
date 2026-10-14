import { billingDate } from '../shared/domain.ts'
import type { Household } from '../shared/domain.ts'
import { choreAssignee, choreGrime, choreStatus } from '../shared/chores.ts'
import { componentChoreIsPaused, getRoomComponents } from '../shared/roomComponents.ts'

export function dailyChoreWindow(timeZone: string, now: Date): { date: string; expiresAt: string } | null {
  const parts = new Map(new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', numberingSystem: 'latn', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]))
  if (parts.get('hour') !== '09') return null
  const remaining = 3600 - Number(parts.get('minute')) * 60 - Number(parts.get('second'))
  return {
    date: billingDate(timeZone, now),
    expiresAt: new Date(now.getTime() - now.getMilliseconds() + remaining * 1000).toISOString(),
  }
}

export function assignedDueChores(household: Household, memberId: string, date: string) {
  const components = getRoomComponents(household)
  return household.chores.items.filter((chore) => {
    const status = choreStatus(chore, date)
    return (status === 'due' || status === 'overdue') && !componentChoreIsPaused(chore, components)
      && choreAssignee(chore, household.members)?.id === memberId
  })
}

// An overdue turn is dirtying its object, so the summary opens the most overdue installed object first.
export function overdueChores(household: Household, memberId: string, date: string) {
  return assignedDueChores(household, memberId, date)
    .map((chore) => ({ chore, grime: choreGrime(chore, date) }))
    .filter((entry) => entry.grime !== null)
    .sort((a, b) => b.grime!.overdueDays - a.grime!.overdueDays || a.chore.id.localeCompare(b.chore.id))
    .map((entry) => entry.chore)
}

export function summaryComponent(household: Household, memberId: string, date: string): string | undefined {
  const installed = (id: string | null | undefined) => !!id && getRoomComponents(household).some((component) => component.id === id && component.installed)
  const dirtiest = overdueChores(household, memberId, date).find((chore) => installed(chore.componentId))
  if (dirtiest) return dirtiest.componentId!
  const due = assignedDueChores(household, memberId, date)
  const ids = new Set(due.map((chore) => chore.componentId))
  const id = ids.size === 1 ? due[0]?.componentId : undefined
  return id && getRoomComponents(household).some((component) => component.id === id && component.installed) ? id : undefined
}
