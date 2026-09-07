import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { createHousehold, openGroceryForm } from './fixtures.ts'

async function expectCenteredLabel(label: Locator) {
  await expect(label).toBeVisible()
  const geometry = await label.evaluate((element) => new Promise<{ offset: number; overlap: number }>((resolve) => {
    const start = performance.now()
    let offset = 0
    let overlap = 0
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      offset = Math.max(offset, Math.abs(bounds.x + bounds.width / 2 - innerWidth / 2))
      const neighbors = document.querySelector('.room-panel')
        ? document.querySelectorAll('.room-panel, .room-caption, .game-demo, .house-tools, .game-identity, .game-resources') : []
      for (const neighbor of neighbors) {
        const box = neighbor.getBoundingClientRect()
        overlap = Math.max(overlap, Math.max(0, Math.min(bounds.right, box.right) - Math.max(bounds.left, box.left))
          * Math.max(0, Math.min(bounds.bottom, box.bottom) - Math.max(bounds.top, box.top)))
      }
      if (performance.now() - start < 450) requestAnimationFrame(measure)
      else resolve({ offset, overlap })
    }
    requestAnimationFrame(measure)
  }))
  expect(geometry.offset).toBeLessThan(1)
  expect(geometry.overlap).toBe(0)
}

async function expectSeparateTitleAndClose(container: Locator) {
  const title = await container.getByRole('heading', { level: 2 }).first().boundingBox()
  const close = await container.getByRole('button', { name: /^Close (dialog|panel)$/ }).boundingBox()
  expect(title).not.toBeNull()
  expect(close).not.toBeNull()
  expect(title!.x + title!.width).toBeLessThanOrEqual(close!.x - 10)
  expect(await container.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
}

test.describe('UI consistency', () => {
  test.use({ reducedMotion: 'reduce' })

  for (const viewport of [{ width: 1440, height: 960 }, { width: 1024, height: 900 }, { width: 850, height: 900 }, { width: 801, height: 900 }, { width: 390, height: 844 }]) {
    test(`focus labels stay centered while panels change at ${viewport.width}px`, { tag: '@room' }, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      const world = page.locator('.kitchen-world')
      const label = page.locator('.world-view-label')
      await expect(page.locator('.world-canvas canvas')).toBeVisible()
      await expect(label).toBeHidden()
      await page.getByRole('button', { name: 'Close the fridge', exact: true }).click()
      await expect(label).toHaveText('The shared fridge')
      await expectCenteredLabel(label)

      for (const [button, title] of [
        ['Grocery runs', 'The receipt book'],
        ['Monthly budget', 'The house pot'],
        ['Shopping bag, plan and record groceries', 'The shopping bag'],
        ['Settle up', 'The repayment envelope'],
        ['The roommates', 'Your people'],
      ]) {
        await page.locator('.game-dock').getByRole('button', { name: button, exact: true }).click()
        await expect(label).toHaveText(title)
        await expectCenteredLabel(label)
      }
      if (viewport.width > 800) {
        await page.getByRole('button', { name: 'Peek inside', exact: true }).click()
        await expect(label).toHaveText('The shared fridge')
        await expectCenteredLabel(label)
      }
      await page.getByRole('button', { name: 'Close panel', exact: true }).click()
      await expect(world).toHaveAttribute('data-focus', 'room')
      await expect(label).toBeHidden()
    })
  }

  for (const viewport of [{ width: 1440, height: 960 }, { width: 320, height: 568 }]) {
    test(`shared headings omit boilerplate and leave room for close controls at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      for (const button of ['Grocery runs', 'Monthly budget', 'Shopping bag, plan and record groceries', 'Settle up', 'The roommates']) {
        await page.locator('.game-dock').getByRole('button', { name: button, exact: true }).click()
        const panel = page.locator('.room-panel')
        await expect(panel).toBeVisible()
        await expect(panel).not.toContainText('A LITTLE HOUSEKEEPING')
        await expectSeparateTitleAndClose(panel)
      }
      await page.getByRole('button', { name: 'Close panel', exact: true }).click()
      for (const button of ['House rules', 'How to play', 'Room style']) {
        const trigger = page.getByRole('button', { name: button, exact: true })
        await trigger.click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await expect(dialog).not.toContainText('A LITTLE HOUSEKEEPING')
        await expectSeparateTitleAndClose(dialog)
        await page.keyboard.press('Escape')
        await expect(trigger).toBeFocused()
      }
      await openGroceryForm(page)
      await expect(page.getByRole('dialog')).not.toContainText('A LITTLE HOUSEKEEPING')
      await expectSeparateTitleAndClose(page.getByRole('dialog'))
      await expect(page.getByLabel('What did you pick up?', { exact: true })).toBeFocused()
    })
  }

  test('grocery counts and category selections agree with the visible ledger', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
    const rows = page.locator('.expense-row')
    const total = await rows.count()
    const summaryCount = page.locator('.grocery-summary > div').filter({ has: page.getByText('GROCERY RUNS', { exact: true }) }).locator('strong')
    const resultCount = page.locator('.ledger-section .count-pill')
    await expect(summaryCount).toHaveText(String(total))
    await expect(resultCount).toHaveText(String(total))
    await expect(page.locator('.ledger-section .section-heading')).not.toContainText('LITTLE RUNS, SHARED GOODNESS')

    const category = page.locator('.category-breakdown').getByRole('button', { name: /Fruit & veg/ })
    await category.click()
    await expect(category).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.category-tabs').getByRole('button', { name: 'Fruit & veg', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const search = page.getByRole('textbox', { name: 'Search grocery runs', exact: true })
    await search.fill('Farmers')
    await expect(rows).toHaveCount(1)
    await expect(resultCount).toHaveText('1')
    await expect(summaryCount).toHaveText(String(total))
    await search.fill('No matching grocery run')
    await expect(rows).toHaveCount(0)
    await expect(resultCount).toHaveText('0')
    await search.clear()
    await page.locator('.category-tabs').getByRole('button', { name: 'Everything', exact: true }).click()
    await expect(category).toHaveAttribute('aria-pressed', 'false')
    await expect(rows).toHaveCount(total)
    await expect(resultCount).toHaveText(String(total))
  })

  test('full-width access actions keep their gap inside sections without changing button rows', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.game-dock')).toBeVisible()
    await page.locator('.game-app').evaluate((app) => {
      const fixture = document.createElement('div')
      fixture.className = 'modal access-spacing-fixture'
      fixture.innerHTML = `<div class="access-content">
        <button class="button secondary full">First direct action</button><button class="button secondary full">Second direct action</button>
        <section class="access-section">
          <button class="button secondary full">Create a kitchen</button><button class="button secondary full">Accept an invitation</button>
          <div class="button-row"><button class="button secondary">Cancel</button><button class="button primary">Continue</button></div>
        </section>
      </div>`
      app.append(fixture)
    })
    const fixture = page.locator('.access-spacing-fixture')
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 960 })
      const gaps: number[] = []
      for (const [first, second] of [
        ['First direct action', 'Second direct action'],
        ['Create a kitchen', 'Accept an invitation'],
      ]) {
        const upper = await fixture.getByRole('button', { name: first, exact: true }).boundingBox()
        const lower = await fixture.getByRole('button', { name: second, exact: true }).boundingBox()
        expect(upper).not.toBeNull()
        expect(lower).not.toBeNull()
        const gap = lower!.y - upper!.y - upper!.height
        expect(gap).toBeGreaterThanOrEqual(12)
        gaps.push(gap)
      }
      expect(Math.abs(gaps[0] - gaps[1])).toBeLessThan(1)
      await expect(fixture.getByRole('button', { name: 'Continue', exact: true })).toHaveCSS('margin-top', '0px')
    }
  })

  test('a single grocery run and an empty repayment history have truthful labels', async ({ page, request }) => {
    const session = await createHousehold(request, 'UI consistency kitchen', 'Robin')
    await page.addInitScript((token) => localStorage.setItem('roomlings.session', token), session.token)
    await page.goto('/')
    await openGroceryForm(page)
    await page.getByLabel('What did you pick up?', { exact: true }).fill('One grocery run')
    await page.getByLabel('Total (EUR)', { exact: true }).fill('1.00')
    await page.getByRole('button', { name: 'Add & split the groceries', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Monthly budget', exact: true }).click()
    await expect(page.locator('.budget-labels')).toContainText('1 grocery run')
    await expect(page.locator('.budget-labels')).not.toContainText('1 grocery runs')
    await page.locator('.game-dock').getByRole('button', { name: 'Settle up', exact: true }).click()
    await expect(page.locator('.repayments-panel')).not.toContainText('zero payments')
    await expect(page.locator('.repayments-panel')).toContainText('No repayments are needed.')
    await expect(page.locator('.payment-history').getByRole('heading')).toHaveText('Payment history')
    await expect(page.locator('.payment-history')).toContainText('No repayments recorded yet.')
  })

  test('outstanding repayments are not presented as already paid', async ({ page }) => {
    await page.goto('/')
    await page.locator('.game-dock').getByRole('button', { name: 'Settle up', exact: true }).click()
    await expect(page.locator('.repayments-panel').getByRole('heading')).toHaveText('Suggested repayments')
    expect(await page.locator('.transfer-row').count()).toBeGreaterThan(0)
    await expect(page.locator('.payment-history').getByRole('heading')).toHaveText('Payment history')
    await expect(page.locator('.room-panel')).not.toContainText('All paid, all good.')
  })
})

test('camera movement copy also describes zooming out', { tag: '@room' }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const world = page.locator('.kitchen-world')
  await page.getByRole('button', { name: 'Close the fridge', exact: true }).click()
  await expect(world).toHaveAttribute('data-focus', 'fridge')
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  // Capture the transient state in the browser, even if rendering delays the click response.
  const movement = await world.evaluateHandle((element) => {
    const samples: { text: string | null; offset: number }[] = []
    const observer = new MutationObserver(() => {
      const label = element.querySelector('.world-view-label')
      const status = element.querySelector('.view-moving')
      if (element.getAttribute('data-camera-moving') !== 'true' || !label || !status) return
      const bounds = label.getBoundingClientRect()
      samples.push({ text: status.textContent, offset: Math.abs(bounds.x + bounds.width / 2 - innerWidth / 2) })
    })
    observer.observe(element, { attributes: true, attributeFilter: ['data-camera-moving'], childList: true, characterData: true, subtree: true })
    return { samples, disconnect: () => observer.disconnect() }
  })
  try {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await expect(page.locator('.world-camera-controls > span')).toHaveText('80%')
    await expect.poll(() => movement.evaluate((state) => state.samples.length)).toBeGreaterThan(0)
    for (const sample of await movement.evaluate((state) => state.samples)) {
      expect(sample.text).toBe('Adjusting view')
      expect(sample.offset).toBeLessThan(1)
    }
  } finally {
    await movement.evaluate((state) => state.disconnect())
    await movement.dispose()
  }
  await expect(world).toHaveAttribute('data-camera-moving', 'false')
  await expect(page.locator('.world-view-label')).toHaveText('The shared fridge')
})
