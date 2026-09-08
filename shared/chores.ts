import { choreCompletionSchema, choreInputSchema, choreSchema, dateSchema } from './domain.ts'
import type { Chore, ChoreCompletion, Member } from './domain.ts'

export class ChoreError extends Error {
  readonly status: 400 | 409
  constructor(status: 400 | 409, message: string) {
    super(message)
    this.status = status
  }
}

function activeTurn(chore: Chore, members: Member[], start = chore.turn): number | null {
  const active = new Set(members.filter((member) => !member.inactive).map((member) => member.id))
  for (let offset = 0; offset < chore.rotation.length; offset++) {
    const turn = (start + offset) % chore.rotation.length
    if (active.has(chore.rotation[turn])) return turn
  }
  return null
}

export function choreAssignee(chore: Chore, members: Member[]): Member | null {
  const turn = activeTurn(chore, members)
  return turn === null ? null : members.find((member) => member.id === chore.rotation[turn] && !member.inactive) ?? null
}

export function choreStatus(chore: Chore, today: string): 'archived' | 'completed' | 'overdue' | 'due' | 'upcoming' {
  if (chore.archived) return 'archived'
  if (chore.dueDate === null) return 'completed'
  if (chore.dueDate < today) return 'overdue'
  return chore.dueDate === today ? 'due' : 'upcoming'
}

export function canUndoChore(chore: Chore | undefined, completion: ChoreCompletion): boolean {
  return !!chore && chore.id === completion.choreId && !chore.archived && completion.undoneAt === null
    && chore.version === completion.resultVersion && chore.occurrence === completion.occurrence + 1
}

export function nextChoreDate(dueDate: string, repeatDays: number, today: string): string {
  const scheduled = Date.parse(`${choreInputSchema.shape.dueDate.parse(dueDate)}T00:00:00Z`)
  const current = Date.parse(`${dateSchema.parse(today)}T00:00:00Z`)
  const interval = choreInputSchema.shape.repeatDays.unwrap().parse(repeatDays) * 86_400_000
  // UTC date arithmetic counts calendar days without local daylight-saving offsets.
  const intervals = Math.max(1, Math.floor((current - scheduled) / interval) + 1)
  const next = scheduled + intervals * interval
  if (next > Date.parse('9999-12-31T00:00:00Z')) {
    throw new ChoreError(400, 'This repeat schedule goes beyond the supported calendar. Choose an earlier due date.')
  }
  return dateSchema.parse(new Date(next).toISOString().slice(0, 10))
}

function requireActiveMember(members: Member[], memberId: string) {
  if (!members.some((member) => member.id === memberId && !member.inactive)) {
    throw new ChoreError(400, 'Only an active roommate in this home can complete or undo a chore.')
  }
}

export function completeChore(
  chore: Chore, members: Member[], memberId: string, completionId: string, completedAt: string, today: string,
): { chore: Chore; completion: ChoreCompletion } {
  requireActiveMember(members, memberId)
  if (chore.archived) throw new ChoreError(409, 'Restore this archived chore before completing it.')
  if (chore.dueDate === null) throw new ChoreError(409, 'This one-off chore is already completed. Undo its completion or set a new due date.')
  const currentTurn = activeTurn(chore, members) ?? chore.turn
  const nextTurn = (currentTurn + 1) % chore.rotation.length
  const updated = choreSchema.parse({
    ...chore, version: chore.version + 1, occurrence: chore.occurrence + 1, updatedAt: completedAt,
    dueDate: chore.repeatDays === null ? null : nextChoreDate(chore.dueDate, chore.repeatDays, today),
    turn: activeTurn(chore, members, nextTurn) ?? nextTurn,
  })
  const completion = choreCompletionSchema.parse({
    id: completionId, choreId: chore.id, occurrence: chore.occurrence, title: chore.title,
    roomId: chore.roomId, area: chore.area, dueDate: chore.dueDate, turn: chore.turn,
    assignedTo: choreAssignee(chore, members)?.id ?? null, completedBy: memberId, completedAt,
    resultVersion: updated.version, undoneAt: null, undoneBy: null,
  })
  return { chore: updated, completion }
}

export function undoChoreCompletion(
  chore: Chore, completion: ChoreCompletion, members: Member[], memberId: string, undoneAt: string,
): { chore: Chore; completion: ChoreCompletion } {
  requireActiveMember(members, memberId)
  if (!canUndoChore(chore, completion)) {
    throw new ChoreError(409, 'This completion can no longer be undone because the chore changed, was archived, or was already undone.')
  }
  return {
    chore: choreSchema.parse({
      ...chore, dueDate: completion.dueDate, turn: completion.turn, occurrence: completion.occurrence,
      version: chore.version + 1, updatedAt: undoneAt,
    }),
    completion: choreCompletionSchema.parse({ ...completion, undoneAt, undoneBy: memberId }),
  }
}
