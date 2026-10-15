import { expect, test } from './account-fixtures.ts'
import type { Page } from '@playwright/test'
import { openRoomEditor, selectRoom, waitForRoomReady } from './fixtures.ts'

test.use({ reducedMotion: 'reduce' })

async function openCompanion(page: Page) {
  const label = page.getByRole('button', { name: 'Ask the kettle a question', exact: true })
  await expect(label).toBeVisible()
  await label.click()
  const panel = page.getByRole('region', { name: 'Ask the kettle.', exact: true })
  await expect(panel).toBeVisible()
  return panel
}

test('the kitchen kettle answers typed questions and opens the matching tool', { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
  await page.goto('/kitchen')
  await waitForRoomReady(page)
  const panel = await openCompanion(page)
  const suggestions = panel.getByRole('region', { name: 'Popular in this room', exact: true })
  await expect(suggestions.getByRole('button')).toHaveText([
    'How do I record a grocery run?', 'Who owes whom?', 'How are costs split?', 'How do I invite a roommate?',
  ])

  const input = panel.getByRole('textbox', { name: 'Ask a question', exact: true })
  await input.fill('how much do i ow')
  const matches = panel.getByRole('region', { name: 'Did you mean', exact: true })
  await expect(matches.getByRole('button').first()).toHaveText('Who owes whom?')
  await expect(panel.getByRole('status')).toHaveText(/suggested question/)
  await input.press('Enter')
  const answer = panel.getByRole('article', { name: 'Who owes whom?', exact: true })
  await expect(answer).toContainText('Settle up suggests repayments')
  await expect(answer.getByRole('heading', { level: 3 })).toBeFocused()

  await answer.getByRole('button', { name: 'Open Settle up', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Keep it even.', exact: true })).toBeVisible()
})

test('the kettle tolerates typos and admits when it has no answer', { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
  await page.goto('/kitchen')
  await waitForRoomReady(page)
  const panel = await openCompanion(page)
  const input = panel.getByRole('textbox', { name: 'Ask a question', exact: true })
  await input.fill('we ran out of toilet paepr')
  await input.press('Enter')
  await expect(panel.getByRole('article', { name: 'How do I restock supplies?', exact: true })).toBeVisible()

  await input.fill('what is the meaning of life')
  await panel.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(panel.getByText('I do not know that one yet.')).toBeVisible()
  await expect(panel.getByRole('article')).toHaveCount(0)
  await panel.getByRole('button', { name: 'How do I record a grocery run?', exact: true }).click()
  await panel.getByRole('button', { name: 'Open the shopping bag', exact: true }).click()
  await expect(page.getByRole('region', { name: 'The shopping bag.', exact: true })).toBeVisible()
})

test('every room has the kettle with its own starter questions', { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
  await page.goto('/kitchen')
  await waitForRoomReady(page)
  await selectRoom(page, 'bathroom')
  await waitForRoomReady(page, page.locator('.bathroom-world'))
  let panel = await openCompanion(page)
  await expect(panel.getByRole('region', { name: 'Popular in this room', exact: true }).getByRole('button').first()).toHaveText('How do I add a chore?')
  await panel.getByRole('button', { name: 'How do I restock supplies?', exact: true }).click()
  await panel.getByRole('button', { name: 'Open room supplies', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Bathroom supplies.', exact: true })).toBeVisible()

  await selectRoom(page, 'living-room')
  await waitForRoomReady(page, page.locator('.living-room-world'))
  panel = await openCompanion(page)
  await panel.getByRole('button', { name: 'How do I change the room colors?', exact: true }).click()
  await panel.getByRole('button', { name: 'Choose room colors', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Make the room feel like home.', exact: true })).toBeVisible()
})

test('the corner kettle is a cartoon that draws no WebGL of its own', async ({ page, emptyHousehold: _household }) => {
  await page.goto('/kitchen')
  const kettle = page.getByRole('button', { name: 'Ask the kettle a question', exact: true })
  await expect(kettle.locator('svg.companion-kettle-art')).toBeVisible()
  await expect(kettle.locator('canvas')).toHaveCount(0)
  await expect(kettle).toHaveText('Ask me')
  await expect(kettle).toHaveAttribute('aria-pressed', 'false')
  const panel = await openCompanion(page)
  await expect(panel.getByRole('button', { name: 'How do I record a grocery run?', exact: true })).toBeVisible()
  await expect(kettle).toHaveAttribute('aria-pressed', 'true')
})

test('the kettle steps aside while the room is edited', { tag: '@room' }, async ({ page, emptyHousehold: _household }) => {
  await page.goto('/kitchen')
  await waitForRoomReady(page)
  await expect(page.getByRole('button', { name: 'Ask the kettle a question', exact: true })).toBeVisible()
  await openRoomEditor(page)
  await expect(page.getByRole('button', { name: 'Ask the kettle a question', exact: true })).toHaveCount(0)
})
