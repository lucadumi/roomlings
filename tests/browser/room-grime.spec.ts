import { randomUUID } from 'node:crypto'
import { billingDate, choreSchema } from '../../shared/domain.ts'
import { roomPath } from '../../src/roomNavigation.ts'
import { expect, test } from './account-fixtures.ts'
import { savedKitchen, waitForRoomReady } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

function daysBefore(today: string, days: number) {
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
}

test('overdue object chores dirty their objects and completing the chore cleans them', { tag: '@room' }, async ({ page, accounts }) => {
  const owner = await accounts.store.create('The grimy household', 'Ada', 'EUR', 45000)
  const household = owner.household
  const today = billingDate(household.billingTimeZone)
  const chore = (title: string, componentId: string, componentName: string, area: 'sink' | 'counters' | 'floor', overdue: number) => choreSchema.parse({
    id: randomUUID(), title, notes: '', roomId: 'kitchen', area, componentId, componentName,
    dueDate: daysBefore(today, overdue), repeatDays: 7, rotation: [owner.memberId], turn: 0,
    createdBy: owner.memberId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    version: 0, occurrence: 0, archived: false,
  })
  household.chores.items.push(
    chore('Scrub the sink', 'default-kitchen-sink', 'Sink', 'sink', 8),
    chore('Wipe the counters', 'default-kitchen-counters', 'Counters', 'counters', 1),
    chore('Clean the hob', 'default-kitchen-hob', 'Hob', 'counters', 0),
  )
  await accounts.store.save(household)
  await page.addInitScript((kitchen) => {
    if (!localStorage.getItem('roomlings.session')) {
      localStorage.setItem('roomlings.session', kitchen.token)
      localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
      localStorage.setItem('roomlings.access-mode', 'browser')
    }
  }, savedKitchen(owner))
  await page.goto(roomPath())
  await waitForRoomReady(page)

  const sink = page.locator('.hotspot-component[data-component-id="default-kitchen-sink"]')
  await expect(sink).toHaveAttribute('data-grime', '3')
  await expect(sink).toHaveAccessibleName('Chores for Sink, dirty: 8 days overdue')
  const counters = page.locator('.hotspot-component[data-component-id="default-kitchen-counters"]')
  await expect(counters).toHaveAttribute('data-grime', '1')
  await expect(counters).toHaveAccessibleName('Chores for Kitchen cabinets, dirty: 1 day overdue')
  // A chore due today is a reminder, not neglect.
  const hob = page.locator('.hotspot-component[data-component-id="default-kitchen-hob"]')
  await expect(hob).not.toHaveAttribute('data-grime', /./)
  await expect(hob).toHaveAccessibleName('Chores for Hob')

  await sink.click()
  const card = page.getByRole('article', { name: 'Scrub the sink', exact: true })
  await card.getByRole('button', { name: 'Mark done', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Record completion', exact: true }).click()
  await expect(sink).not.toHaveAttribute('data-grime', /./)
  await expect(sink).toHaveAccessibleName('Chores for Sink')
  await expect(counters).toHaveAttribute('data-grime', '1')
  const saved = await accounts.store.get(household.id)
  expect(saved?.chores.history).toHaveLength(1)
  expect(saved?.expenses).toEqual(household.expenses)
})
