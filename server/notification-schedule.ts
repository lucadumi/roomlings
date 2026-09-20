import { billingDate } from '../shared/domain.ts'
import type { Household } from '../shared/domain.ts'
import { choreAssignee, choreStatus } from '../shared/chores.ts'
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

export function summaryComponent(household: Household, memberId: string, date: string): string | undefined {
  const due = assignedDueChores(household, memberId, date)
  const ids = new Set(due.map((chore) => chore.componentId))
  const id = ids.size === 1 ? due[0]?.componentId : undefined
  return id && getRoomComponents(household).some((component) => component.id === id && component.installed) ? id : undefined
}
