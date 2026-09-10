import type { RoomComponent, RoomComponentChange } from '../shared/roomComponents.ts'

export type ComponentConfiguration = Omit<RoomComponentChange, 'componentVersion' | 'linkedChores'>

export function componentConfiguration(component: RoomComponent): ComponentConfiguration {
  const { id, kind, roomId, slotId, name, variant, finish, supplies, installed } = component
  return { id, kind, roomId, slotId, name, variant, finish, supplies, installed }
}

export function sameComponentConfiguration(left: RoomComponent, right: RoomComponent): boolean {
  return JSON.stringify(componentConfiguration(left)) === JSON.stringify(componentConfiguration(right))
}

export function hasComponentConfigurationChanges(current: readonly RoomComponent[], preview: readonly RoomComponent[]): boolean {
  if (current.length !== preview.length) return true
  const original = new Map(current.map((component) => [component.id, component]))
  return preview.some((component) => {
    const before = original.get(component.id)
    original.delete(component.id)
    return !before || !sameComponentConfiguration(before, component)
  })
}
