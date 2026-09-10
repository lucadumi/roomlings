import { z } from 'zod'
import type { ChoreInput, Household } from './domain.ts'
import {
  componentAllowedInRoom, componentCatalog, componentChoreArea, componentChoreMatches, componentStateInputSchema, getRoomComponents,
  roomComponentSchema, roomComponentsPatchSchema, validateRoomComponents,
} from './roomComponents.ts'
import type { RoomComponent, RoomComponentsPatch } from './roomComponents.ts'

export class RoomComponentError extends Error {
  readonly status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.status = status
  }
}

export function requireInstalledComponent(household: Household, id: string): RoomComponent {
  const component = getRoomComponents(household).find((component) => component.id === id)
  if (!component) throw new RoomComponentError(404, 'That object was not found in this home.')
  if (!component.installed) throw new RoomComponentError(409, 'This object has been removed from the room. Your existing shopping and history are still safe.')
  return component
}

export function choreComponentFields(household: Household, input: Pick<ChoreInput, 'roomId' | 'area' | 'componentId'>) {
  if (!input.componentId) return { componentId: input.componentId, componentName: undefined }
  const component = requireInstalledComponent(household, input.componentId)
  if (component.roomId !== input.roomId || (input.area !== null && componentChoreArea(component) !== input.area)) {
    throw new RoomComponentError(400, 'Choose an object in the chore room and its matching area.')
  }
  return { componentId: component.id, componentName: component.name }
}

export function applyRoomComponentPatch(household: Household, input: RoomComponentsPatch, now: string): void {
  const patch = roomComponentsPatchSchema.parse(input)
  const current = getRoomComponents(household)
  const byId = new Map(current.map((component) => [component.id, component]))
  const changes = new Map<string, RoomComponent>()
  for (const { componentVersion, linkedChores: _linkedChores, ...change } of patch.changes) {
    const previous = byId.get(change.id)
    if (previous) {
      if (componentVersion !== previous.version) throw new RoomComponentError(409, `${previous.name} changed. Review its latest settings before applying.`)
      if (change.roomId !== previous.roomId || change.kind !== previous.kind) {
        throw new RoomComponentError(400, 'An existing object keeps its identity and room. Remove it before adding a different type of object.')
      }
    } else if (componentVersion !== null || !z.string().uuid().safeParse(change.id).success || !change.installed) {
      throw new RoomComponentError(400, 'Add a new object with a fresh identifier, or restore a saved object.')
    }
    const placing = change.installed && (!previous?.installed || change.slotId !== previous.slotId)
    if (placing && !componentAllowedInRoom(change.kind, change.roomId)) {
      throw new RoomComponentError(400, `${componentCatalog[change.kind].name} is not available for new placements in this room.`)
    }
    changes.set(change.id, roomComponentSchema.parse({
      ...change, version: previous ? previous.version + 1 : 0,
      state: previous?.state ?? null, stateChangedAt: previous?.stateChangedAt ?? null, stateChangedBy: previous?.stateChangedBy ?? null,
    }))
  }
  const components = [
    ...current.map((component) => changes.get(component.id) ?? component),
    ...[...changes.values()].filter((component) => !byId.has(component.id)),
  ]
  const invalid = validateRoomComponents(components)
  if (invalid) throw new RoomComponentError(409, invalid)
  const choreChanges = new Map<string, Household['chores']['items'][number]>()
  for (const change of patch.changes) {
    const previous = byId.get(change.id)
    if (!previous?.installed || change.installed) continue
    const linked = household.chores.items.filter((chore) => !chore.archived && componentChoreMatches(chore, previous))
    if (linked.length && !change.linkedChores) {
      throw new RoomComponentError(400, `Choose whether to archive ${previous.name}'s linked chores or keep them as room chores.`)
    }
    for (const chore of linked) {
      choreChanges.set(chore.id, {
        ...chore, version: chore.version + 1, updatedAt: now,
        ...(change.linkedChores === 'archive' ? { archived: true } : { componentId: null, componentName: undefined }),
      })
    }
  }
  household.roomComponents = components
  household.chores.items = household.chores.items.map((chore) => choreChanges.get(chore.id) ?? chore)
}

export function setRoomComponentState(
  household: Household, id: string, input: z.infer<typeof componentStateInputSchema>, memberId: string, now: string,
): void {
  const checked = componentStateInputSchema.parse(input)
  const current = requireInstalledComponent(household, id)
  if (current.version !== checked.componentVersion) throw new RoomComponentError(409, 'This object changed. Review its latest state before continuing.')
  if (!household.members.some((member) => member.id === memberId && !member.inactive)) {
    throw new RoomComponentError(400, 'Only an active roommate can update an object state.')
  }
  const supported = componentCatalog[current.kind].states
  if (!supported.length || (checked.state !== null && !supported.some((state) => state.id === checked.state))) {
    throw new RoomComponentError(400, 'Choose a state supported by this object.')
  }
  if (checked.state === current.state) throw new RoomComponentError(409, 'This object already has that state.')
  household.roomComponents = getRoomComponents(household).map((component) => component.id !== id ? component : {
    ...component, state: checked.state, stateChangedAt: now, stateChangedBy: memberId, version: component.version + 1,
  })
}
