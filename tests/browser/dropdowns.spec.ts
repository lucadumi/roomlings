import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'
import { chooseOption, openGroceryForm, savedKitchen } from './fixtures.ts'
import { roomPath, samplePath } from '../../src/roomNavigation.ts'

test.use({ reducedMotion: 'reduce' })

async function seedHome(page: Page, accounts: AccountHarness, manyMembers = false) {
  const session = await accounts.store.create('The dropdown household', 'Ada', 'EUR', 45000)
  if (manyMembers) {
    for (let index = 1; index <= 11; index++) {
      session.household.members.push({ id: randomUUID(), name: `${'Taylor'.repeat(8)}${String(index).padStart(2, '0')}`, color: '#7d9070' })
    }
    await accounts.store.save(session.household)
  }
  await page.addInitScript((kitchen) => {
    localStorage.setItem('roomlings.session', kitchen.token)
    localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
    localStorage.setItem('roomlings.access-mode', 'browser')
  }, savedKitchen(session))
  return session
}

test('themed menus support keyboard navigation, typeahead and Escape without closing their form', async ({ page, accounts }) => {
  const session = await seedHome(page, accounts)
  await page.goto(roomPath())
  await page.getByRole('button', { name: 'House rules', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const currency = page.getByRole('combobox', { name: 'Currency', exact: true })
  expect(await currency.evaluate((element) => element.tagName)).toBe('BUTTON')
  await currency.focus()
  await page.keyboard.press('ArrowDown')
  const menu = page.getByRole('listbox', { name: 'Currency', exact: true })
  await expect(menu).toBeVisible()
  await page.keyboard.press('End')
  await expect(menu.getByRole('option').last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(menu.getByRole('option').first()).toBeFocused()
  await page.keyboard.type('usd')
  await expect(menu.getByRole('option', { name: 'USD', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(currency).toHaveAttribute('data-value', 'USD')
  await expect(currency).toBeFocused()
  await page.keyboard.press('Space')
  await expect(menu).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(currency).toHaveAttribute('data-value', 'USD')
  await expect(currency).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(currency).not.toBeFocused()
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.getByRole('button', { name: 'Save the house rules', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect((await accounts.store.get(session.household.id))?.currency).toBe('USD')
  await page.reload()
  await page.getByRole('button', { name: 'House rules', exact: true }).click()
  await expect(currency).toHaveText('USD')
  await currency.click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'House rules', exact: true })).toBeFocused()
})

test('a former roommate stays visible as a draft payer but cannot be selected again', async ({ page, accounts }) => {
  const session = await seedHome(page, accounts, true)
  await page.goto(roomPath())
  await openGroceryForm(page)
  const payer = page.getByRole('combobox', { name: 'Paid by', exact: true })
  const member = session.household.members[1]
  await chooseOption(payer, member.id)
  const latest = await accounts.store.get(session.household.id)
  if (!latest) throw new Error('The isolated household is missing.')
  latest.members.find((candidate) => candidate.id === member.id)!.inactive = true
  latest.version++
  await accounts.store.save(latest)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(payer).toContainText('former roommate')
  await payer.click()
  const former = page.getByRole('option', { name: `${member.name} (former roommate)`, exact: true })
  await expect(former).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Home')
  await expect(page.getByRole('option', { name: 'Ada', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(payer).toHaveAttribute('data-value', session.memberId)
  await payer.click()
  await expect(former).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('empty whole-home, area and recurrence choices preserve their actual saved values', async ({ page, accounts }) => {
  const session = await seedHome(page, accounts)
  await page.goto(roomPath('bathroom'))
  await page.getByRole('button', { name: 'Chores', exact: true }).click()
  await page.getByRole('button', { name: 'Add chore', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Chore name', { exact: true }).fill('Whole-home check')
  const area = dialog.getByRole('combobox', { name: 'Area', exact: true })
  await chooseOption(area, 'sink')
  await chooseOption(area, '')
  await expect(area).toContainText('Whole room')
  await chooseOption(dialog.getByRole('combobox', { name: 'Room', exact: true }), '')
  await expect(area).toHaveCount(0)
  const repeat = dialog.getByRole('combobox', { name: 'Repeat', exact: true })
  await chooseOption(repeat, '7')
  await chooseOption(repeat, '')
  await expect(repeat).toContainText('One-off')
  await dialog.getByRole('button', { name: 'Create chore', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const chore = (await accounts.store.get(session.household.id))?.chores.items[0]
  expect(chore).toMatchObject({ title: 'Whole-home check', roomId: null, area: null, repeatDays: null })
  await chooseOption(page.getByRole('combobox', { name: 'Chore room', exact: true }), 'home')
  await expect(page.getByRole('article', { name: 'Whole-home check', exact: true })).toBeVisible()
})

test('locked currencies cannot open a dropdown', async ({ page }) => {
  await page.goto(samplePath())
  await page.getByRole('button', { name: 'House rules', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Currency', exact: true })).toBeDisabled()
  await expect(page.getByRole('listbox')).toHaveCount(0)
})

test.describe('touch dropdowns', () => {
  test.use({ hasTouch: true })

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`long options scroll and remain reachable at ${viewport.width}x${viewport.height}`, async ({ page, accounts }) => {
      await page.setViewportSize(viewport)
      const session = await seedHome(page, accounts, true)
      await page.goto(roomPath())
      await openGroceryForm(page)
      const payer = page.getByRole('combobox', { name: 'Paid by', exact: true })
      await payer.scrollIntoViewIfNeeded()
      await payer.tap()
      const menu = page.getByRole('listbox', { name: 'Paid by', exact: true })
      await expect(menu).toBeInViewport({ ratio: 1 })
      expect(await menu.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await menu.locator('.dropdown-viewport').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
      const member = session.household.members.at(-1)!
      const option = menu.getByRole('option', { name: member.name, exact: true })
      await option.scrollIntoViewIfNeeded()
      await expect(option).toBeInViewport({ ratio: 1 })
      expect(await option.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
      await option.tap()
      await expect(menu).toHaveCount(0)
      await expect(payer).toHaveAttribute('data-value', member.id)
      await expect(payer).toHaveCSS('font-size', '16px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }
})
