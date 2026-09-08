import type { Object3D } from 'three'

export function tourChapterForObject(object: Object3D, root: Object3D): number | null {
  for (let current: Object3D | null = object; current && current !== root; current = current.parent) {
    switch (current.userData.action) {
      case 'roommates': return 0
      case 'fridge':
      case 'stock': return 1
      case 'ledger': return 2
      case 'budget': return 3
      case 'settle': return 4
    }
    switch (current.userData.utility) {
      case 'chores':
      case 'supplies':
      case 'sink': return 0
    }
  }
  return null
}
