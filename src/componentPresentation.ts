import type { Object3D } from 'three'

// Keep presentation metadata out of userData, which opts meshes out of normal room batching.
const thumbnailRepresentatives = new WeakMap<Object3D, readonly Object3D[]>()

export function setComponentThumbnailRepresentative(root: Object3D, ...parts: Object3D[]): void {
  if (!parts.length) throw new Error('A thumbnail representative needs its complete model parts.')
  thumbnailRepresentatives.set(root, parts)
}

export function componentThumbnailSelection(root: Object3D): ReadonlySet<Object3D> | undefined {
  const parts = thumbnailRepresentatives.get(root)
  if (!parts) return undefined
  const selected = new Set<Object3D>([root])
  for (const part of parts) {
    let ancestor: Object3D | null = part
    while (ancestor && ancestor !== root) {
      selected.add(ancestor)
      ancestor = ancestor.parent
    }
    if (!ancestor) throw new Error('Thumbnail representative parts must belong to their component.')
    part.traverse((object) => selected.add(object))
  }
  return selected
}
