import type { RoomComponent } from '../shared/roomComponents.ts'

export function componentDisplayName(component: RoomComponent, components: readonly RoomComponent[], label = component.name): string {
  const matches = components.filter((other) => other.roomId === component.roomId && other.name === component.name)
  if (!matches.some((other) => other.id !== component.id)) return label
  const index = matches.findIndex((other) => other.id === component.id)
  return `${label} ${index < 0 ? matches.length + 1 : index + 1}`
}
