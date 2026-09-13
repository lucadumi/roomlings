import { randomUUID } from 'node:crypto'
import type { Locator, Page } from '@playwright/test'
import { billingDate, householdSchema, localDate, money } from '../../shared/domain.ts'
import type { Session } from '../../shared/domain.ts'
import {
  accountState, expect, test,
} from './account-fixtures.ts'
import type { AccountHarness } from './account-fixtures.ts'
import { chooseOption, minimumControlSize, openGroceryForm, openRoomEditor, openRoomObjects, openShoppingBag, savedKitchen, waitForRoomReady } from './fixtures.ts'
import { roomPath } from '../../src/roomNavigation.ts'

const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 844, height: 390 },
]
const desktopViewports = [
  { width: 1025, height: 620 },
  { width: 1251, height: 700 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3440, height: 1440 },
  { width: 3840, height: 2160 },
]
const resizeViewports = [
  ...viewports,
  { width: 320, height: 480 },
  { width: 560, height: 620 },
  { width: 561, height: 620 },
  { width: 600, height: 800 },
  { width: 667, height: 375 },
  { width: 800, height: 621 },
  { width: 801, height: 621 },
  { width: 1000, height: 620 },
  { width: 1001, height: 620 },
  ...desktopViewports,
]
const longName = 'Alexandria'.repeat(5)
const otherName = 'Christopher'.repeat(5).slice(0, 50)
const kitchenName = 'Oursharedhousehold'.repeat(3).slice(0, 50)
const description = 'Groceries'.repeat(12).slice(0, 100)
const itemName = 'UnsweetenedMilk'.repeat(4).slice(0, 50)
const billName = 'HouseholdInternet'.repeat(3).slice(0, 50)

async function settledLayout(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Responsive scenarios need an explicit viewport.')
  const home = page.locator('.game-home')
  await expect(home).toHaveCSS('width', `${viewport.width}px`)
  await expect(home).toHaveCSS('height', `${viewport.height}px`)
  await expect.poll(() => home.evaluate((element) => {
    const app = element.closest('.game-app')
    const dock = element.querySelector('.game-bottom')
    const toolbar = element.querySelector('.game-dock')
    const header = element.querySelector('.game-hud')
    if (!app || !dock || !toolbar || !header) throw new Error('The room layout is missing.')
    const style = getComputedStyle(app)
    const top = Math.min(dock.getBoundingClientRect().top, toolbar.getBoundingClientRect().top)
    const space = element.getBoundingClientRect().bottom - top + parseFloat(getComputedStyle(dock).marginTop)
    return Math.abs(parseFloat(style.getPropertyValue('--game-dock-space')) - space) < 1
      && Math.abs(parseFloat(style.getPropertyValue('--game-header-space')) - header.getBoundingClientRect().height) < 1
  })).toBe(true)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

async function contentProblems(container: Locator) {
  return container.evaluate((root) => {
    const boundary = root.getBoundingClientRect()
    return [root, ...root.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
      if (!(element instanceof HTMLElement) || !element.clientWidth || !element.getClientRects().length
        || element.closest('.sr-only, [hidden]') || getComputedStyle(element).visibility === 'hidden') return []
      const bounds = element.getBoundingClientRect()
      const outside = bounds.left < boundary.left - 1 || bounds.right > boundary.right + 1
      const overflow = !element.matches('input, select, textarea, .game-house > span, .dropdown-value')
        && element.scrollWidth > element.clientWidth + 1
      return outside || overflow ? [{
        element: element.className || element.tagName,
        text: element.textContent?.slice(0, 55),
        outside,
        overflow: element.scrollWidth - element.clientWidth,
      }] : []
    })
  })
}

async function expectContentFits(container: Locator) {
  expect(await contentProblems(container)).toEqual([])
}

async function expectReachable(control: Locator, minimum?: number) {
  const targetSize = minimum ?? await minimumControlSize(control)
  await control.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
  await expect(control).toBeInViewport({ ratio: 1 })
  const dimensions = await control.evaluate((element) => {
    const { width, height } = element.getBoundingClientRect()
    return { width, height }
  })
  expect(dimensions.width).toBeGreaterThanOrEqual(targetSize)
  expect(dimensions.height).toBeGreaterThanOrEqual(targetSize)
}

async function expectVerticalCameraRail(page: Page) {
  const rail = page.locator('.world-camera-controls')
  await expect(rail).toHaveCSS('flex-direction', 'column')
  const geometry = await rail.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const room = element.closest('.kitchen-world')!.getBoundingClientRect()
    const unit = parseFloat(getComputedStyle(document.documentElement).fontSize)
    const buttons = [...element.querySelectorAll('button')].filter((button) => button.getClientRects().length)
      .map((button) => button.getBoundingClientRect())
    return {
      onRight: room.right - bounds.right >= 0 && room.right - bounds.right <= 2 * unit,
      singleColumn: buttons.every((button) => Math.abs(button.left - buttons[0].left) < 1),
    }
  })
  expect(geometry).toEqual({ onRight: true, singleColumn: true })
  await expectContentFits(rail)
}

async function restore(page: Page, session: Session) {
  await page.addInitScript((kitchen) => {
    if (!localStorage.getItem('roomlings.session')) {
      localStorage.setItem('roomlings.session', kitchen.token)
      localStorage.setItem('roomlings.kitchens', JSON.stringify([kitchen]))
    }
  }, savedKitchen(session))
}

async function seedContent(page: Page, accounts: AccountHarness) {
  const session = await accounts.store.create(kitchenName, longName, 'RON', 45000)
  const household = session.household
  const guest = { id: randomUUID(), name: otherName, color: '#7d9070' }
  household.members.push(guest)
  const participants = household.members.map((member) => member.id)
  const now = new Date().toISOString()
  const today = localDate()
  const billMonth = billingDate(household.billingTimeZone).slice(0, 7)
  for (const name of [description, 'The weekly pantry run']) {
    household.expenses.push({
      id: randomUUID(), description: name, amount: 99_999_999, paidBy: session.memberId,
      participants, category: 'produce', date: today, createdAt: now,
    })
  }
  household.settlements.push({
    id: randomUUID(), from: guest.id, to: session.memberId, amount: 1009, createdAt: now,
  })
  household.bills.push({
    id: randomUUID(), createdAt: now, startMonth: billMonth, pauses: [],
    revisions: [{ fromMonth: billMonth, name: billName, amount: 99_999_999, dueDay: 1, participants }],
  })
  const snapshot = {
    id: randomUUID(), name: itemName, quantity: 'Cartons'.repeat(5), notes: 'Unsweetened'.repeat(20),
    createdBy: guest.id, createdAt: now,
  }
  household.shopping.items.push({
    ...snapshot, version: 0, claimedBy: guest.id, pickedUp: false, updatedAt: now,
  })
  const runId = randomUUID()
  const expenseId = randomUUID()
  household.expenses.push({
    id: expenseId, description: 'The completed shopping run', amount: 901, paidBy: guest.id,
    participants, category: 'other', date: today, createdAt: now, shoppingRunId: runId,
  })
  household.shopping.runs.push({
    id: runId, expenseId, name: description, completedBy: guest.id, completedAt: now,
    items: [{ ...snapshot, id: randomUUID() }],
  })
  await accounts.store.save(householdSchema.parse(household))
  await restore(page, session)
  return { session, guest }
}

async function openAccount(page: Page) {
  await page.getByRole('button', { name: 'The roommates', exact: true }).click()
  await page.getByRole('button', { name: 'Account and membership', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test.describe('responsive current app', () => {
  // Rendering fidelity is covered separately; these cases exercise CSS layout and working controls.
  test.use({ reducedMotion: 'reduce', deviceScaleFactor: process.env.CI ? 0.5 : 1 })

  for (const roomId of ['kitchen', 'bathroom', 'living-room'] as const) {
    test(`${roomId} controls reflow through resizing and landscape orientation`, { tag: '@room' }, async ({ page, accounts }, testInfo) => {
      test.setTimeout(process.env.CI ? 180_000 : 90_000)
      await seedContent(page, accounts)
      await page.goto(roomPath(roomId))
      await waitForRoomReady(page)
      await page.evaluate(() => document.fonts.ready)
      for (const viewport of resizeViewports) {
        await page.setViewportSize(viewport)
        await settledLayout(page)
        const issues = await page.locator('.game-home').evaluate((home) => {
          const selectors = ['.game-hud', '.room-caption', '.game-identity', '.game-month', '.game-resources', '.house-tools', '.world-camera-controls', '.world-quick-actions', '.game-dock', '.game-balance', '.room-sync']
          const boxes = selectors.flatMap((selector) => {
            const element = home.querySelector(selector)
            return element?.getClientRects().length ? [{ selector, element, box: element.getBoundingClientRect() }] : []
          })
          return boxes.flatMap(({ selector, element, box }, index) => [
            ...(box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1 ? [`${selector} is outside the viewport`] : []),
            ...boxes.slice(index + 1).filter(({ element: otherElement, box: other }) =>
              !element.contains(otherElement) && !otherElement.contains(element)
              && Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1
              && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1,
            ).map((other) => `${selector} overlaps ${other.selector}`),
          ])
        })
        const header = await contentProblems(page.locator('.game-hud'))
        const dock = await contentProblems(page.locator('.game-dock'))
        if (issues.length || header.length || dock.length) {
          await page.screenshot({ path: testInfo.outputPath(`${viewport.width}x${viewport.height}.png`) })
        }
        expect.soft(issues, `${viewport.width}x${viewport.height}`).toEqual([])
        expect.soft(header, `${viewport.width}x${viewport.height} header`).toEqual([])
        expect.soft(dock, `${viewport.width}x${viewport.height} dock`).toEqual([])
        await expectVerticalCameraRail(page)
        expect.soft(await page.locator('.game-home').evaluate((home) => ({
          horizontal: home.scrollWidth - home.clientWidth,
          vertical: home.scrollHeight - home.clientHeight,
        })), `${viewport.width}x${viewport.height} room`).toEqual({ horizontal: 0, vertical: 0 })
      }
    })

    test(`${roomId} vertical camera rail keeps every control usable in a short window`, { tag: '@room' }, async ({ page, populatedHousehold: _household }, testInfo) => {
      await page.setViewportSize({ width: 320, height: 400 })
      await page.goto(roomPath(roomId))
      await waitForRoomReady(page)
      await settledLayout(page)
      await expectVerticalCameraRail(page)
      await page.screenshot({ path: testInfo.outputPath('vertical-camera-rail.png') })
      const world = page.locator('.kitchen-world')
      const rail = page.locator('.world-camera-controls')
      for (const button of await rail.getByRole('button').all()) await expectReachable(button)
      await rail.evaluate((element) => { element.scrollTop = 0 })
      await rail.hover()
      await page.mouse.wheel(0, 240)
      if (await rail.evaluate((element) => element.scrollHeight > element.clientHeight + 1)) {
        await expect.poll(() => rail.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      }
      await expect(rail).toContainText('100%')
      await rail.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await expect(rail).toContainText('110%')
      await rail.getByRole('button', { name: 'Zoom out', exact: true }).click()
      await expect(rail).toContainText('100%')
      await rail.getByRole('button', { name: 'Reset room view', exact: true }).click()
      await expect(rail.getByRole('button', { name: 'Reset room view', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await rail.getByRole('button', { name: 'Hide object labels', exact: true }).click()
      await rail.getByRole('button', { name: 'Show object labels', exact: true }).click()
      await rail.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
      await expect(world).toHaveAttribute('data-evening', 'true')
      await rail.getByRole('button', { name: 'Switch to daylight', exact: true }).click()
      await page.getByRole('navigation', { name: 'Household tools', exact: true }).getByRole('button', { name: 'Chores', exact: true }).click()
      await settledLayout(page)
      await expectVerticalCameraRail(page)
      await expect(rail.getByRole('button', { name: 'Zoom in', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(rail.getByRole('button', { name: 'Zoom out', exact: true })).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: testInfo.outputPath('vertical-camera-rail-with-panel.png') })
      for (const button of await rail.getByRole('button').all()) await expectReachable(button)
      await rail.getByRole('button', { name: 'Zoom in', exact: true }).click()
      await rail.getByRole('button', { name: 'Reset room view', exact: true }).click()
      await expect(rail.getByRole('button', { name: 'Reset room view', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expectReachable(page.getByRole('button', { name: 'Close panel', exact: true }))
    })
  }

  for (const mode of ['receipts', 'objects', 'editor']) {
    test(`${mode} panels reflow through narrow and desktop windows`, { tag: '@room' }, async ({ page, accounts }, testInfo) => {
      await seedContent(page, accounts)
      await page.goto('/kitchen')
      await waitForRoomReady(page)
      if (mode === 'receipts') await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
      else if (mode === 'objects') await openRoomObjects(page)
      else await openRoomEditor(page)
      const panel = page.locator('.room-panel')
      for (const viewport of [
        { width: 320, height: 480 }, { width: 390, height: 844 },
        { width: 561, height: 620 }, { width: 600, height: 800 },
        { width: 800, height: 621 }, { width: 801, height: 621 },
        { width: 844, height: 390 }, desktopViewports[0], desktopViewports[4], desktopViewports[8],
      ]) {
        await page.setViewportSize(viewport)
        await settledLayout(page)
        const geometry = await panel.evaluate((element) => {
          const panel = element.getBoundingClientRect()
          const scroll = element.querySelector('.room-panel-scroll')!.getBoundingClientRect()
          const overlaps = (other: DOMRect) =>
            Math.min(panel.right, other.right) - Math.max(panel.left, other.left) > 1
            && Math.min(panel.bottom, other.bottom) - Math.max(panel.top, other.top) > 1
          return {
            outside: panel.left < 0 || panel.right > innerWidth || panel.top < 0 || panel.bottom > innerHeight,
            scrollHeight: scroll.height,
            overlaps: ['.game-dock', '.game-hud', '.world-camera-controls', '.kitchen-world']
              .filter((selector) => {
                const other = document.querySelector(selector)
                return other?.getClientRects().length && overlaps(other.getBoundingClientRect())
              }),
          }
        })
        const content = await contentProblems(panel)
        if (geometry.outside || geometry.overlaps.length || geometry.scrollHeight < 44 || content.length) {
          await page.screenshot({ path: testInfo.outputPath(`${viewport.width}x${viewport.height}.png`) })
        }
        expect.soft(geometry.outside, `${viewport.width}x${viewport.height} panel`).toBe(false)
        expect.soft(geometry.overlaps, `${viewport.width}x${viewport.height} overlaps`).toEqual([])
        expect.soft(geometry.scrollHeight, `${viewport.width}x${viewport.height} scroll area`).toBeGreaterThanOrEqual(44)
        expect.soft(content, `${viewport.width}x${viewport.height} content`).toEqual([])
        await expectVerticalCameraRail(page)
        if (mode !== 'editor') {
          expect.soft(await contentProblems(page.locator('.world-quick-actions')), `${viewport.width}x${viewport.height} quick actions`).toEqual([])
        }
      }
      await page.setViewportSize({ width: 320, height: 480 })
      await settledLayout(page)
      await panel.evaluate((element) => { element.scrollTop = element.scrollHeight })
      const action = mode === 'receipts' ? 'Add grocery run' : mode === 'objects' ? 'Edit room' : 'Cancel'
      await expectReachable(panel.getByRole('button', { name: action, exact: true }))
      await expectReachable(panel.getByRole('button', { name: 'Close panel', exact: true }))
      await panel.getByRole('button', { name: 'Close panel', exact: true }).click()
      await expect(panel).toHaveCount(0)
    })
  }

  test('placement confirmation stays reachable while the window resizes', { tag: '@room' }, async ({ page, accounts, emptyHousehold: owner }) => {
    const before = await accounts.store.get(owner.household.id)
    await page.goto('/kitchen')
    await waitForRoomReady(page)
    const editor = await openRoomEditor(page)
    await editor.getByRole('button', { name: 'Add objects', exact: true }).click()
    await editor.getByRole('button', { name: 'Preview Coffee machine', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Try Coffee machine', exact: true })
    await expect(confirmation).toBeVisible()
    for (const viewport of [
      { width: 320, height: 480 }, { width: 390, height: 844 },
      { width: 561, height: 620 }, { width: 800, height: 621 },
      { width: 844, height: 390 }, desktopViewports[0], desktopViewports[4], desktopViewports[8],
    ]) {
      await page.setViewportSize(viewport)
      await settledLayout(page)
      await expectContentFits(confirmation)
      await expectVerticalCameraRail(page)
      for (const name of ['Discard preview', 'Place object']) {
        await expectReachable(confirmation.getByRole('button', { name, exact: true }))
      }
      await expect(confirmation).toBeInViewport({ ratio: 1 })
    }
    await confirmation.getByRole('button', { name: 'Discard preview', exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    expect(await accounts.store.get(owner.household.id)).toEqual(before)
  })

  for (const viewport of viewports) {
    test(`ledger panels reflow long content at ${viewport.width}x${viewport.height}`, async ({ page, accounts }) => {
      await page.setViewportSize(viewport)
      await seedContent(page, accounts)
      await page.goto('/kitchen')
      await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
      await settledLayout(page)
      const panel = page.locator('.room-panel')
      await page.locator('.expense-shares summary').first().click()
      await expectContentFits(panel)
      const rowOverlaps = await page.locator('.expense-row').evaluateAll((rows) => rows.map((row) => {
        const boxes = ['.expense-description', '.expense-total', '.delete-expense'].map((selector) =>
          row.querySelector(selector)!.getBoundingClientRect(),
        )
        return boxes.some((box, index) => boxes.slice(index + 1).some((other) =>
          Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1
          && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1,
        ))
      }))
      expect(rowOverlaps).not.toContain(true)
      await page.getByRole('button', { name: 'Bills', exact: true }).click()
      await expectContentFits(panel)
      await expectReachable(page.getByRole('button', { name: 'New monthly bill', exact: true }))
      const newBillLabel = page.getByRole('button', { name: 'New monthly bill', exact: true }).locator('.compact-action-label')
      if (viewport.width <= 800) await expect(newBillLabel).toBeHidden()
      else await expect(newBillLabel).toBeVisible()

      for (const name of ['Monthly budget', 'Settle up', 'The roommates']) {
        await page.getByRole('navigation', { name: 'Household tools', exact: true }).getByRole('button', { name, exact: true }).click()
        await expectContentFits(panel)
      }
      await openShoppingBag(page)
      await expectContentFits(panel)
      await expect(page.getByRole('article', { name: itemName, exact: true })).toContainText(otherName)
      await page.getByRole('button', { name: 'Past runs', exact: true }).click()
      await page.locator('.shopping-run summary').click()
      await expectContentFits(panel)
      await expectReachable(page.getByRole('button', { name: 'Close panel', exact: true }))
    })

    test(`room controls remain on screen at ${viewport.width}x${viewport.height}`, { tag: '@room' }, async ({ page, accounts }) => {
      await page.setViewportSize(viewport)
      await seedContent(page, accounts)
      await page.goto('/kitchen')
      await waitForRoomReady(page)
      await settledLayout(page)
      const geometry = await page.locator('.game-home').evaluate((home) => {
        const selectors = ['.game-hud', '.house-tools', '.world-camera-controls', '.world-fridge-toggle', '.world-kettle-toggle', '.game-dock']
        const boxes = selectors.map((selector) => ({ selector, box: home.querySelector(selector)!.getBoundingClientRect() }))
        return {
          pageHeight: document.documentElement.scrollHeight,
          pageWidth: document.documentElement.scrollWidth,
          outside: boxes.filter(({ box }) => box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1)
            .map(({ selector }) => selector),
          overlaps: boxes.flatMap(({ selector, box }, index) => boxes.slice(index + 1).filter(({ box: other }) =>
            Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1
            && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1,
          ).map((other) => [selector, other.selector])),
        }
      })
      expect(geometry.pageHeight).toBeLessThanOrEqual(viewport.height)
      expect(geometry.pageWidth).toBeLessThanOrEqual(viewport.width)
      expect(geometry.outside).toEqual([])
      expect(geometry.overlaps).toEqual([])
      await expectContentFits(page.locator('.game-hud'))
      for (const name of ['House rules', 'How to play', 'Room style', 'Zoom in', 'Zoom out', 'Reset room view']) {
        await expectReachable(page.getByRole('button', { name, exact: true }))
      }
      await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
      await expect(page.locator('.kitchen-world')).toHaveAttribute('data-evening', 'true')
      await page.getByRole('button', { name: 'Close the fridge', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Peek inside', exact: true })).toHaveAttribute('aria-pressed', 'false')
      await page.getByRole('button', { name: 'Reset room view', exact: true }).click()
      await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
      await expectReachable(page.getByRole('button', { name: 'Close panel', exact: true }))
      await expect.poll(() => page.locator('.game-app').evaluate((app) => {
        const panel = app.querySelector('.room-panel')!.getBoundingClientRect()
        const dock = app.querySelector('.game-dock')!.getBoundingClientRect()
        const label = app.querySelector('.world-view-label')!.getBoundingClientRect()
        const overlaps = (box: DOMRect, other: DOMRect) =>
          Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1
          && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1
        return {
          panelCoversDock: overlaps(panel, dock),
          panelCoversRoom: overlaps(panel, app.querySelector('.kitchen-world')!.getBoundingClientRect()),
          labelCentered: Math.abs(label.left + label.width / 2 - innerWidth / 2) < 1,
          labelOverlaps: ['.game-identity', '.game-resources', '.world-camera-controls', '.room-panel']
            .filter((selector) => overlaps(label, app.querySelector(selector)!.getBoundingClientRect())),
        }
      })).toEqual({ panelCoversDock: false, panelCoversRoom: false, labelCentered: true, labelOverlaps: [] })
    })
  }

  for (const viewport of [viewports[0], viewports[2], viewports[5], desktopViewports[0], desktopViewports[4], desktopViewports[8]]) {
    test(`forms keep themed fields and saves usable at ${viewport.width}x${viewport.height}`, { tag: viewport.width >= 1920 ? '@room' : [] }, async ({ page, accounts }) => {
      if (viewport.width >= 1920) test.setTimeout(process.env.CI ? 180_000 : 90_000)
      const minimum = viewport.width <= 1024 ? 44 : 36
      await page.setViewportSize(viewport)
      const { guest } = await seedContent(page, accounts)
      await page.goto('/kitchen')
      await openGroceryForm(page)
      const dialog = page.getByRole('dialog')
      await page.getByLabel('What did you pick up?', { exact: true }).fill('A responsive grocery run')
      await page.getByLabel('Total (RON)', { exact: true }).fill('17.03')
      await chooseOption(page.getByRole('combobox', { name: 'Paid by', exact: true }), guest.id)
      await chooseOption(page.getByRole('combobox', { name: 'On which shelf?', exact: true }), 'dairy')
      await expectContentFits(dialog)
      const fields = await dialog.locator('input:not([type="checkbox"]), [role="combobox"], textarea').evaluateAll((elements) =>
        elements.map((element) => ({ font: Number.parseFloat(getComputedStyle(element).fontSize), width: element.getBoundingClientRect().width })),
      )
      for (const field of fields) {
        expect(field.font).toBeGreaterThanOrEqual(viewport.width <= 1024 ? 12 : 13)
        expect(field.width).toBeGreaterThanOrEqual(160)
      }
      for (const participant of await dialog.locator('.participant-option').all()) await expectReachable(participant, minimum)
      const save = page.getByRole('button', { name: 'Add & split the groceries', exact: true })
      await expectReachable(save, minimum)
      await save.click()
      await expect(dialog).toHaveCount(0)
      await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
      await expect(page.locator('.expense-row').filter({ hasText: 'A responsive grocery run' })).toContainText(money(1703, 'RON'))
      await page.getByRole('button', { name: 'Bills', exact: true }).click()
      await page.getByRole('button', { name: `Record payment for ${billName}`, exact: true }).click()
      await expectContentFits(dialog)
      await page.getByLabel('Amount paid (RON)', { exact: true }).fill('103.07')
      await chooseOption(page.getByRole('combobox', { name: 'Paid by', exact: true }), guest.id)
      await expectReachable(page.getByRole('button', { name: 'Record bill payment', exact: true }), minimum)
      await page.getByRole('button', { name: 'Record bill payment', exact: true }).click()
      await expect(page.locator('.bill-occurrence .bill-status')).toHaveText('Paid')
      await page.getByRole('button', { name: `Edit ${billName}`, exact: true }).click()
      await expectContentFits(dialog)
      await page.getByLabel('Default amount (RON)', { exact: true }).fill('205.09')
      await page.getByRole('button', { name: 'Save monthly bill', exact: true }).click()
      await expect(page.locator('.bill-schedule')).toContainText(money(20509, 'RON'))
      await page.getByRole('navigation', { name: 'Household tools', exact: true }).getByRole('button', { name: 'Settle up', exact: true }).click()
      await page.getByRole('button', { name: 'Record paid', exact: true }).click()
      await expectContentFits(dialog)
      await expectReachable(page.getByRole('button', { name: 'Yes, record payment', exact: true }), minimum)
      await page.getByRole('button', { name: 'Yes, record payment', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'All settled up.', exact: true })).toBeVisible()
      await expectContentFits(page.locator('.room-panel'))
      await page.getByRole('button', { name: 'Close panel', exact: true }).click()

      for (const name of ['House rules', 'Room style', 'How to play']) {
        await page.getByRole('button', { name, exact: true }).click()
        await expectContentFits(dialog)
        await expectReachable(page.getByRole('button', { name: 'Close dialog', exact: true }))
        await page.keyboard.press('Escape')
      }
      await page.getByRole('navigation', { name: 'Household tools', exact: true }).getByRole('button', { name: 'Chores', exact: true }).click()
      await page.getByRole('button', { name: 'Add chore', exact: true }).click()
      await page.getByLabel('Chore name', { exact: true }).fill('A responsive household chore')
      await expectContentFits(dialog)
      await expectReachable(page.getByRole('button', { name: 'Create chore', exact: true }), minimum)
      await page.getByRole('button', { name: 'Create chore', exact: true }).click()
      await expect(page.getByRole('article', { name: 'A responsive household chore', exact: true })).toBeVisible()
      await openShoppingBag(page)
      await page.getByRole('button', { name: 'Add item', exact: true }).click()
      await page.getByLabel('Item name', { exact: true }).fill('Responsive shopping item')
      await page.getByLabel('Quantity', { exact: true }).fill('2 cartons')
      await page.getByLabel('Notes', { exact: true }).fill('A long preference without spaces '.repeat(7).slice(0, 240))
      await expectContentFits(dialog)
      await page.getByRole('button', { name: 'Add to shopping list', exact: true }).click()
      const pickedUp = page.getByRole('checkbox', { name: 'Picked up Responsive shopping item', exact: true })
      await pickedUp.click()
      await expect(pickedUp).toBeChecked()
      await page.getByRole('button', { name: /^Basket / }).click()
      await page.getByRole('button', { name: 'Finish shopping', exact: true }).click()
      await expectContentFits(dialog)
      await page.getByLabel('Total (RON)', { exact: true }).fill('9.01')
      await expectReachable(page.getByRole('button', { name: 'Record shopping run', exact: true }), minimum)
      await page.getByRole('button', { name: 'Record shopping run', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await page.reload()
      await openShoppingBag(page)
      await page.getByRole('button', { name: 'Past runs', exact: true }).click()
      await expect(page.getByRole('article', { name: 'Shopping run', exact: true })).toContainText(money(901, 'RON'))
    })
  }

  for (const viewport of [...viewports, desktopViewports[0], desktopViewports[8]]) {
    test(`account dialogs reflow at ${viewport.width}x${viewport.height}`, async ({ page, accounts, baseURL }) => {
      await page.setViewportSize(viewport)
      await page.goto('/kitchen#account')
      const dialog = page.getByRole('dialog')
      const email = `${'a'.repeat(60)}@example.com`
      await page.getByLabel('Email address', { exact: true }).fill(email)
      await expectContentFits(dialog)
      await page.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
      await expect(page.getByLabel('Email sign-in code', { exact: true })).toBeVisible()
      await page.getByLabel('Email sign-in code', { exact: true }).fill(accounts.provider.codeFor(email))
      await page.getByLabel('Account display name', { exact: true }).fill(longName)
      await page.getByLabel('Name this browser', { exact: true }).fill(longName)
      await expectContentFits(dialog)
      await expectReachable(page.getByRole('button', { name: 'Verify and sign in', exact: true }))
      await page.getByRole('button', { name: 'Verify and sign in', exact: true }).click()
      await expect(dialog).toHaveAccessibleName('Your Roomlings account.')
      await page.getByLabel('Account display name', { exact: true }).fill(otherName)
      await page.getByRole('button', { name: 'Save account name', exact: true }).click()
      await expect(dialog.getByRole('status')).toContainText('Account name saved')
      await expectContentFits(dialog)

      await page.getByRole('button', { name: 'Create a kitchen', exact: true }).click()
      await page.getByLabel('What do you call home?', { exact: true }).fill(kitchenName)
      await expectContentFits(dialog)
      await page.getByRole('button', { name: 'Create our kitchen', exact: true }).click()
      await expect(page.getByRole('button', { name: `Open ${kitchenName}`, exact: true })).toBeVisible()
      await expectContentFits(dialog)
      await page.getByRole('button', { name: `Manage ${kitchenName}`, exact: true }).click()
      await expectContentFits(dialog)
      await page.getByRole('button', { name: 'Create seven-day invitation', exact: true }).click()
      await expectContentFits(dialog)
      const invitation = page.getByLabel('Account invitation link', { exact: true })
      await expectReachable(invitation)
      await invitation.focus()
      expect(await invitation.evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!)).toBe((await invitation.inputValue()).length)
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
      await page.getByRole('button', { name: 'Copy account invitation', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Account invitation copied', exact: true })).toBeVisible()
      await page.getByRole('button', { name: /^Revoke invitation / }).click()
      await expectContentFits(dialog)
      await page.getByRole('button', { name: 'Revoke invitation', exact: true }).click()
      await expect(dialog).toContainText('Revoked')
      await page.getByRole('button', { name: 'Back to account', exact: true }).click()

      await accounts.provider.send(email)
      const anotherSession = await fetch(`${accounts.origin}/api/account/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Roomlings-Request': '1' },
        body: JSON.stringify({ email, code: accounts.provider.codeFor(email), name: longName, label: otherName }),
      })
      expect(anotherSession.status).toBe(200)
      await anotherSession.json()
      await page.getByRole('button', { name: 'Refresh account sessions', exact: true }).click()
      await expect(page.getByRole('button', { name: `Revoke ${otherName}`, exact: true })).toBeVisible()
      await expectContentFits(dialog)
      await page.getByRole('button', { name: `Revoke ${otherName}`, exact: true }).click()
      await expectContentFits(dialog)
      await page.getByRole('button', { name: 'Revoke session', exact: true }).click()
      await expect(page.getByRole('button', { name: `Revoke ${otherName}`, exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Link existing kitchen access', exact: true }).click()
      await expectContentFits(dialog)
      const link = page.getByRole('button', { name: 'Link recovery identity to my account', exact: true })
      await expectReachable(link)
      await page.getByRole('button', { name: 'Back to account', exact: true }).click()
      await page.getByRole('button', { name: 'Accept an invitation', exact: true }).click()
      await expectContentFits(dialog)
      await expectReachable(page.getByRole('button', { name: 'Accept kitchen invitation', exact: true }))
      await page.getByRole('button', { name: 'Back to account', exact: true }).click()
      await page.getByRole('button', { name: 'Verify email again', exact: true }).click()
      await expect(page.getByLabel('Email address', { exact: true })).toBeDisabled()
      await expectContentFits(dialog)
      await page.getByRole('button', { name: 'Back to account', exact: true }).click()
      await page.getByRole('button', { name: `Open ${kitchenName}`, exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page).toHaveURL(/\/kitchen$/)
      await expect(page.locator('.game-house')).toContainText(kitchenName)
      await page.reload()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await openAccount(page)
      expect((await accountState(page)).memberships).toHaveLength(1)
    })
  }

  for (const viewport of [viewports[0], viewports[3], viewports[5]]) {
    test(`recovery forms retain usable controls at ${viewport.width}x${viewport.height}`, async ({ page, accounts, baseURL }) => {
      await page.setViewportSize(viewport)
      const { session } = await seedContent(page, accounts)
      await page.goto('/kitchen')
      await page.getByRole('button', { name: 'The roommates', exact: true }).click()
      await page.getByRole('button', { name: 'Recovery and devices', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await page.getByLabel('Name this browser', { exact: true }).fill(longName)
      await page.getByRole('button', { name: 'Save browser name', exact: true }).click()
      await expectContentFits(dialog)
      await page.getByRole('button', { name: 'Generate recovery code', exact: true }).click()
      const code = await page.getByLabel('Your private recovery code', { exact: true }).inputValue()
      await expectContentFits(dialog)
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
      await page.getByRole('button', { name: 'Copy recovery code', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Recovery code copied', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'I saved the code', exact: true }).click()
      await page.getByRole('button', { name: 'Replace recovery code', exact: true }).click()
      await expectReachable(page.locator('.access-checkbox'))
      await expectContentFits(dialog)
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.getByRole('button', { name: 'Use a recovery code', exact: true }).click()
      await page.getByLabel('Recovery code', { exact: true }).fill(code)
      await page.getByLabel('Name this browser', { exact: true }).fill(otherName)
      await page.route('**/api/recover', (route) => route.fulfill({
        status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Recovery is temporarily unavailable. Try again.' }),
      }))
      await page.getByRole('button', { name: 'Recover my access', exact: true }).click()
      await expect(dialog.getByRole('alert')).toContainText('temporarily unavailable')
      await expect(page.getByLabel('Recovery code', { exact: true })).toHaveValue(code)
      await expectContentFits(dialog)
      await page.unroute('**/api/recover')
      await page.getByRole('button', { name: 'Recover my access', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.locator('.game-house')).toContainText(kitchenName)
      expect(await page.evaluate(() => localStorage.getItem('roomlings.session'))).not.toBe(session.token)
      await page.reload()
      await expect(page.locator('.game-house')).toContainText(kitchenName)
    })
  }

  test('enlarged text reflows panels and account forms instead of shrinking labels', async ({ page, accounts }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedContent(page, accounts)
    await page.goto('/kitchen')
    await expect(page.locator('.game-home')).toBeVisible()
    await page.addStyleTag({ content: ':root { font-size: 24px; }' })
    await expect(page.locator('html')).toHaveCSS('font-size', '24px')
    await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
    await expectContentFits(page.locator('.room-panel'))
    const descriptionText = page.locator('.expense-description strong').first()
    await expect.poll(() => descriptionText.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(18)
    await page.getByRole('button', { name: 'Add grocery run', exact: true }).click()
    await expectContentFits(page.getByRole('dialog'))
    await expectReachable(page.getByRole('button', { name: 'Add & split the groceries', exact: true }))
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await openAccount(page)
    await expectContentFits(page.getByRole('dialog'))
    await expectReachable(page.getByRole('button', { name: 'Send sign-in code', exact: true }))
  })
})
