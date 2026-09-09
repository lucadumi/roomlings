import { z } from 'zod'
import { accountRoleSchema, accountVersionSchema } from './accounts.ts'
import { mutationInputSchema, nameSchema, retainedMemberLimit } from './domain.ts'

const id = z.string().uuid()
export const delegatedRoomRoleSchema = accountRoleSchema.exclude(['owner'])
export const roomRoleChangeSchema = accountVersionSchema.extend({
  role: delegatedRoomRoleSchema,
  ...mutationInputSchema.partial().shape,
}).superRefine((input, context) => {
  if ((input.mutationId === undefined) !== (input.mutationVersion === undefined)) {
    context.addIssue({ code: 'custom', message: 'A retry needs both its change identifier and original kitchen version.' })
  }
  if (input.mutationVersion !== undefined && input.mutationVersion > input.version) {
    context.addIssue({ code: 'custom', message: 'The change cannot precede its original kitchen version.' })
  }
})

export const roomAccessSchema = z.object({
  householdId: id,
  memberId: id,
  version: z.number().int().nonnegative(),
  role: accountRoleSchema,
  members: z.array(z.object({
    memberId: id,
    name: nameSchema,
    role: accountRoleSchema,
    active: z.boolean(),
  })).min(1).max(retainedMemberLimit),
}).superRefine((access, context) => {
  const actor = access.members.find((member) => member.memberId === access.memberId)
  if (!actor?.active || actor.role !== access.role) {
    context.addIssue({ code: 'custom', message: 'Room access must belong to the current active roommate.' })
  }
  if (new Set(access.members.map((member) => member.memberId)).size !== access.members.length
    || access.members.filter((member) => member.role === 'owner').length > 1
    || access.members.some((member) => !member.active && member.role !== 'member')) {
    context.addIssue({ code: 'custom', message: 'Each roommate has one role; only active roommates can administer a room.' })
  }
})

export type RoomAccess = z.infer<typeof roomAccessSchema>
export type RoomRole = z.infer<typeof accountRoleSchema>
export type DelegatedRoomRole = z.infer<typeof delegatedRoomRoleSchema>
