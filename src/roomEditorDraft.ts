import { z } from 'zod'
import { roomComponentSchema, roomSlots, validateRoomComponents } from '../shared/roomComponents.ts'
import type { RoomComponent, RoomComponentChange } from '../shared/roomComponents.ts'
import { componentPlacementReason } from './componentAvailability.ts'
import { sameComponentConfiguration } from './componentConfiguration.ts'

export type ComponentDraft = { base: RoomComponent | null; value: RoomComponent; linkedChores?: RoomComponentChange['linkedChores'] }
export type ComponentDrafts = Record<string, ComponentDraft>

export function withoutComponentDraft(drafts: ComponentDrafts, id: string): ComponentDrafts {
  const next = { ...drafts }
  delete next[id]
  return next
}

export function previewComponentDrafts(current: readonly RoomComponent[], drafts: ComponentDrafts): RoomComponent[] {
  const ids = new Set(current.map((component) => component.id))
  return [
    ...current.map((component) => {
      const draft = drafts[component.id]
      if (!draft) return component
      const value = draft.value
      if (value.version === component.version && value.state === component.state
        && value.stateChangedAt === component.stateChangedAt && value.stateChangedBy === component.stateChangedBy) return value
      return {
        ...draft.value, version: component.version,
        state: component.state, stateChangedAt: component.stateChangedAt, stateChangedBy: component.stateChangedBy,
      }
    }),
    ...Object.values(drafts).filter((draft) => !ids.has(draft.value.id)).map((draft) => draft.value),
  ]
}

export function stageRoomComponent(
  current: readonly RoomComponent[], drafts: ComponentDrafts, value: RoomComponent, linkedChores?: ComponentDraft['linkedChores'],
): ComponentDrafts {
  const existing = drafts[value.id]
  const base = existing ? existing.base : current.find((component) => component.id === value.id) ?? null
  if ((!base && !value.installed) || (base && sameComponentConfiguration(base, value))) return withoutComponentDraft(drafts, value.id)
  return { ...drafts, [value.id]: { base, value, linkedChores: linkedChores ?? existing?.linkedChores } }
}

export function storeRoomComponent(current: readonly RoomComponent[], drafts: ComponentDrafts, component: RoomComponent): ComponentDrafts {
  if (!roomSlots.find((slot) => slot.id === component.slotId)?.removable) {
    throw new Error('This fitted object stays in the room. You can still customize it.')
  }
  return stageRoomComponent(current, drafts, { ...component, installed: false }, 'pause')
}

export function roomDraftPlacementReason(current: readonly RoomComponent[], preview: readonly RoomComponent[]): string | null {
  const saved = new Map(current.map((component) => [component.id, component]))
  for (const component of preview) {
    const previous = saved.get(component.id)
    if (!component.installed || (previous?.installed && component.slotId === previous.slotId)) continue
    const reason = componentPlacementReason(preview, component.roomId, component.kind, component.slotId, component.id)
    if (reason) return reason
  }
  return null
}

export function stageRoomPlacement(
  current: readonly RoomComponent[], drafts: ComponentDrafts, candidate: RoomComponent, storageIds: readonly string[] = [],
): ComponentDrafts {
  const value = roomComponentSchema.parse({ ...candidate, installed: true })
  if (!current.some((component) => component.id === value.id) && !z.string().uuid().safeParse(value.id).success) {
    throw new Error('Use HTTPS or localhost to safely add a room object. This preview is read-only.')
  }
  const accepted = previewComponentDrafts(current, drafts)
  let next = drafts
  for (const id of storageIds) {
    const component = accepted.find((component) => component.id === id && component.roomId === candidate.roomId && component.installed)
    if (!component || component.id === candidate.id) throw new Error('Review the objects chosen for Storage before placing this object.')
    next = storeRoomComponent(current, next, component)
  }
  next = stageRoomComponent(current, next, value)
  const preview = previewComponentDrafts(current, next)
  const reason = validateRoomComponents(preview) ?? roomDraftPlacementReason(current, preview)
  if (reason) throw new Error(reason)
  return next
}

export function inspectionRoomComponents(
  accepted: readonly RoomComponent[], candidate: RoomComponent, storageIds: readonly string[] = [],
): RoomComponent[] {
  const present = accepted.some((component) => component.id === candidate.id)
  const preview = accepted.map((component) => component.id === candidate.id ? candidate
    : component.installed && component.roomId === candidate.roomId
      && (component.slotId === candidate.slotId || storageIds.includes(component.id)) ? { ...component, installed: false } : component)
  return present ? preview : [...preview, candidate]
}
