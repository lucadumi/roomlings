import type { Household, ShoppingItem } from './domain.ts'

export function inBasket(item: ShoppingItem, memberId: string): boolean {
  return item.pickedUp && item.claimedBy === memberId
}

export function canEditShoppingItem(item: ShoppingItem, memberId: string): boolean {
  return !item.pickedUp && (item.claimedBy === null || item.claimedBy === memberId)
}

export function checkoutItems(
  household: Household,
  memberId: string,
  selection: readonly Pick<ShoppingItem, 'id' | 'version'>[],
): ShoppingItem[] | null {
  if (!selection.length || new Set(selection.map((item) => item.id)).size !== selection.length) return null
  const current = new Map(household.shopping.items.map((item) => [item.id, item]))
  const selected: ShoppingItem[] = []
  for (const requested of selection) {
    const item = current.get(requested.id)
    if (!item || item.version !== requested.version || !inBasket(item, memberId)) return null
    selected.push(item)
  }
  return selected
}
