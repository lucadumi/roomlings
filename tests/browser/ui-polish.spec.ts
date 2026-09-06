import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { openGroceryForm } from './fixtures.ts'

async function surface(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element)
    const { width, height } = element.getBoundingClientRect()
    return { background: style.backgroundColor, border: style.borderColor, radius: style.borderRadius, width, height }
  })
}

async function expectNoOverflow(container: Locator) {
  expect(await container.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
}

async function expectTouchTarget(control: Locator) {
  const box = await control.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
}

test.describe('UI polish', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the room backdrop blends lighting changes and honors reduced motion', async ({ page }) => {
    await page.goto('/')
    const home = page.locator('.game-home')
    const world = page.locator('.kitchen-world')
    const opacity = () => home.evaluate((element) => Number(getComputedStyle(element, '::after').opacity))
    const transition = () => home.evaluate((element) => getComputedStyle(element, '::after').transitionProperty)
    await expect(world).toHaveAttribute('data-evening', 'false')
    await expect.poll(opacity).toBe(0)
    await expect.poll(transition).toBe('none')
    const daylight = await home.evaluate((element) => getComputedStyle(element).backgroundImage)
    expect(await home.evaluate((element) => getComputedStyle(element, '::after').backgroundImage)).not.toBe('none')

    await page.getByRole('button', { name: 'Switch to evening lighting', exact: true }).click()
    await expect(world).toHaveAttribute('data-evening', 'true')
    await expect.poll(opacity).toBe(1)
    await expect(home).toHaveCSS('background-image', daylight)

    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(transition).toBe('opacity')
    expect(await home.evaluate((element) => Number.parseFloat(getComputedStyle(element, '::after').transitionDuration))).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Switch to daylight', exact: true }).click()
    await expect(world).toHaveAttribute('data-evening', 'false')
    await expect.poll(opacity).toBe(0)
    await expect(home).toHaveCSS('background-image', daylight)
  })

  test('shared controls keep their surfaces, selection and keyboard focus', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto('/')
    const rules = page.getByRole('button', { name: 'House rules', exact: true })
    await expect(rules).toBeVisible()
    await expect(page.locator('.game-hud')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.game-bottom')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const controlSurface = await surface(rules)
    expect(controlSurface.background).not.toBe('rgba(0, 0, 0, 0)')
    const monthArrow = await surface(page.getByRole('button', { name: 'Previous month', exact: true }))

    await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
    await expect(page.getByRole('region', { name: 'The receipt book.' })).toBeFocused()
    expect(await surface(page.getByRole('button', { name: 'Close panel', exact: true }))).toEqual(controlSurface)
    expect(await surface(page.getByRole('button', { name: 'Previous month', exact: true }))).toEqual(monthArrow)
    await page.locator('.expense-row').last().scrollIntoViewIfNeeded()
    expect(await page.locator('.room-panel-scroll').evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

    const pot = page.getByRole('button', { name: 'View the house pot', exact: true })
    await pot.click()
    await expect(page.getByRole('region', { name: 'The little house pot.' })).toBeFocused()
    await expect(pot).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Monthly budget', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(await page.locator('.room-panel-scroll').evaluate((element) => element.scrollTop)).toBe(0)
    await page.keyboard.press('Escape')
    await expect(pot).toBeFocused()
    await expect(pot).toHaveAttribute('aria-pressed', 'false')

    await rules.click()
    const name = page.getByLabel('Kitchen name', { exact: true })
    await expect(name).toBeFocused()
    await expect(name).toHaveCSS('outline-style', 'solid')
    const focusColor = await name.evaluate((element) => {
      const swatch = document.createElement('span')
      swatch.hidden = true
      swatch.style.color = getComputedStyle(element).getPropertyValue('--focus-ring')
      document.body.append(swatch)
      const color = getComputedStyle(swatch).color
      swatch.remove()
      return color
    })
    await expect(name).toHaveCSS('outline-color', focusColor)
    const close = page.getByRole('button', { name: 'Close dialog', exact: true })
    expect(await surface(close)).toEqual(controlSurface)
    await page.keyboard.press('Shift+Tab')
    await expect(close).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: 'Save the house rules', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    await expect(close).toHaveCSS('outline-style', 'solid')
    await expect(close).toHaveCSS('outline-color', focusColor)
    await page.keyboard.press('Escape')
    await expect(rules).toBeFocused()
  })

  // The intermediate width also covers space reserved by non-overlay scrollbars on wider phones.
  for (const viewport of [{ width: 390, height: 844 }, { width: 374, height: 844 }, { width: 320, height: 568 }]) {
    test(`panels and forms stay usable at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await expect(page.locator('.world-camera-controls')).toBeVisible()
      await expectNoOverflow(page.locator('html'))
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
      const dock = await page.locator('.game-dock').boundingBox()
      expect(dock).not.toBeNull()
      expect(dock!.y + dock!.height).toBeLessThanOrEqual(viewport.height)
      const tools = await page.locator('.house-tools').boundingBox()
      const camera = await page.locator('.world-camera-controls').boundingBox()
      expect(tools).not.toBeNull()
      expect(camera).not.toBeNull()
      expect(tools!.y + tools!.height).toBeLessThanOrEqual(camera!.y)

      await page.getByRole('button', { name: 'Grocery runs', exact: true }).click()
      const panel = page.getByRole('region', { name: 'The receipt book.' })
      await expect(panel).toBeFocused()
      await expectNoOverflow(page.locator('.room-panel-scroll'))
      for (const name of ['Previous month', 'Next month', 'Add grocery run', 'Close panel']) {
        await expectTouchTarget(panel.getByRole('button', { name, exact: true }))
      }
      await panel.getByRole('button', { name: 'Previous month', exact: true }).click()
      await expect(panel.getByRole('button', { name: 'Next month', exact: true })).toBeEnabled()
      await panel.getByRole('button', { name: 'Next month', exact: true }).click()
      await expect(panel.getByRole('button', { name: 'Next month', exact: true })).toBeDisabled()
      await panel.getByRole('button', { name: 'Fruit & veg', exact: true }).click()
      await expect(panel.getByRole('button', { name: 'Fruit & veg', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expectTouchTarget(panel.getByRole('button', { name: 'Fruit & veg', exact: true }))
      const search = page.getByRole('textbox', { name: 'Search grocery runs', exact: true })
      await search.fill('Farmers')
      await expect(search).toHaveCSS('font-size', '16px')
      await expect(page.locator('.search-input')).toHaveCSS('outline-style', 'solid')
      await expect(page.locator('.expense-row')).toHaveCount(1)
      await expectTouchTarget(page.getByRole('button', { name: 'Remove Farmers market finds', exact: true }))

      await page.getByRole('button', { name: 'Monthly budget', exact: true }).click()
      await expect(page.getByRole('region', { name: 'The little house pot.' })).toBeFocused()
      await expectNoOverflow(page.locator('.panel-period'))
      if (viewport.width >= 374) {
        const month = await page.locator('.room-panel .month-control').boundingBox()
        const edit = await page.getByRole('button', { name: 'Edit monthly budget', exact: true }).boundingBox()
        expect(month).not.toBeNull()
        expect(edit).not.toBeNull()
        expect(edit!.y).toBeGreaterThanOrEqual(month!.y)
        expect(edit!.y + edit!.height).toBeLessThanOrEqual(month!.y + month!.height)
      }

      const people = page.getByRole('button', { name: 'The roommates', exact: true })
      await people.click()
      await expect(page.getByRole('region', { name: 'Your kind of people.' })).toBeFocused()
      expect(await page.locator('.room-panel-scroll').evaluate((element) => element.scrollTop)).toBe(0)
      await page.getByRole('button', { name: 'Edit house rules', exact: true }).click()
      await expectNoOverflow(page.getByRole('dialog'))
      await expect(page.getByRole('combobox', { name: 'Currency', exact: true })).toBeDisabled()
      await expectTouchTarget(page.getByRole('button', { name: 'Close dialog', exact: true }))
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(people).toBeFocused()

      await openGroceryForm(page)
      const description = page.getByLabel('What did you pick up?', { exact: true })
      await expect(description).toBeFocused()
      await description.fill('A careful little grocery run')
      await page.getByLabel('Total (EUR)', { exact: true }).fill('12.03')
      await expectNoOverflow(page.getByRole('dialog'))
      for (const participant of await page.locator('.participant-option').all()) await expectTouchTarget(participant)
      if (viewport.width === 320) {
        const date = await page.getByLabel('Date', { exact: true }).boundingBox()
        const total = await page.getByLabel('Total (EUR)', { exact: true }).boundingBox()
        const fullField = await description.boundingBox()
        expect(date).not.toBeNull()
        expect(total).not.toBeNull()
        expect(fullField).not.toBeNull()
        expect(date!.width).toBe(fullField!.width)
        expect(date!.y).toBeGreaterThanOrEqual(total!.y + total!.height)
      }
      const save = page.getByRole('button', { name: 'Add & split the groceries', exact: true })
      await save.scrollIntoViewIfNeeded()
      await expect(save).toBeInViewport({ ratio: 1 })
      await page.getByLabel('Total (EUR)', { exact: true }).fill('0')
      await save.click()
      await expect(page.getByRole('alert')).toContainText('Enter a positive amount')
      await expect(description).toHaveValue('A careful little grocery run')
      await expectNoOverflow(page.getByRole('dialog'))
    })
  }

  test('busy and rejected saves keep disabled controls and focus honest', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: 'House rules', exact: true }).click()
    await page.getByLabel('Kitchen name', { exact: true }).fill('A kitchen draft to keep')
    const save = page.getByRole('button', { name: 'Save the house rules', exact: true })
    const idleFill = await save.evaluate((element) => getComputedStyle(element).backgroundColor)
    let releaseSave!: () => void
    const pendingSave = new Promise<void>((resolve) => { releaseSave = resolve })
    await page.route('**/api/household', async (route) => {
      if (route.request().method() !== 'PATCH') { await route.continue(); return }
      await pendingSave
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The house rules could not be saved. Please try again.' }) })
    })
    try {
      await save.click()
      const saving = page.getByRole('button', { name: 'Saving...', exact: true })
      const dialog = page.getByRole('dialog')
      await expect(dialog).toHaveAttribute('aria-busy', 'true')
      await expect(saving).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled()
      await saving.hover()
      await expect(saving).toHaveCSS('background-color', idleFill)
      await page.keyboard.press('Tab')
      await expect(dialog).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeVisible()
      releaseSave()
      await expect(page.getByRole('alert')).toContainText('The house rules could not be saved')
      await expect(dialog).not.toHaveAttribute('aria-busy', 'true')
      await expect(page.getByLabel('Kitchen name', { exact: true })).toHaveValue('A kitchen draft to keep')
      await expect(save).toBeEnabled()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'House rules', exact: true })).toBeFocused()
    } finally {
      releaseSave()
    }
  })
})
