import { z } from 'zod'
import { centsSchema, currencies, householdSchema, nameSchema } from './domain.ts'
import type { Session } from './domain.ts'
import { recoveryCodeSchema } from './access.ts'

const id = z.string().uuid()
const timestamp = z.string().datetime()
export const accountEmailSchema = z.string().trim().toLowerCase().email().max(254)
export const accountRoleSchema = z.enum(['owner', 'member'])
export const accountSchema = z.object({
  id, email: accountEmailSchema, name: nameSchema, createdAt: timestamp,
})
export const accountMembershipSchema = z.object({
  householdId: id, householdName: nameSchema, memberId: id,
  currency: z.enum(currencies), role: accountRoleSchema,
})
export const accountDeviceSchema = z.object({
  id, label: nameSchema, createdAt: timestamp, lastUsedAt: timestamp,
  expiresAt: timestamp, current: z.boolean(),
})
export const accountKitchenSessionSchema = z.object({
  token: z.null(), memberId: id, household: householdSchema,
})
export const accountStateSchema = z.object({
  configured: z.boolean(),
  deletionPending: z.literal(true).optional(),
  account: accountSchema.nullable(),
  memberships: z.array(accountMembershipSchema),
  devices: z.array(accountDeviceSchema),
  csrfToken: z.string().min(32).nullable(),
  session: accountKitchenSessionSchema.nullable(),
}).superRefine((state, context) => {
  if (state.deletionPending && (!state.account || state.session !== null || state.memberships.length || state.devices.length !== 1)) {
    context.addIssue({ code: 'custom', message: 'Pending deletion can expose only the account and its current browser, not household access.' })
  }
  if (!state.account) {
    if (state.csrfToken !== null || state.session !== null || state.devices.length || state.memberships.length) {
      context.addIssue({ code: 'custom', message: 'Signed-out account access cannot contain private session data.' })
    }
    return
  }
  if (!state.csrfToken || state.devices.filter((device) => device.current).length !== 1) {
    context.addIssue({ code: 'custom', message: 'The current account session is missing.' })
  }
  if (new Set(state.memberships.map((membership) => membership.householdId)).size !== state.memberships.length) {
    context.addIssue({ code: 'custom', message: 'An account can only have one active identity in each kitchen.' })
  }
  const session = state.session
  if (session && (!state.memberships.some((membership) => membership.householdId === session.household.id && membership.memberId === session.memberId)
    || !session.household.members.some((member) => member.id === session.memberId))) {
    context.addIssue({ code: 'custom', message: 'The selected kitchen must belong to this account.' })
  }
})
export const accountMemberSchema = z.object({
  memberId: id, name: nameSchema, role: accountRoleSchema,
  linked: z.boolean(), active: z.boolean(),
})
export const accountInvitationSchema = z.object({
  id, createdAt: timestamp, expiresAt: timestamp, revokedAt: timestamp.nullable(),
  uses: z.number().int().nonnegative(),
})
export const householdAccessSchema = z.object({
  household: householdSchema, memberId: id, role: accountRoleSchema,
  members: z.array(accountMemberSchema),
  invitations: z.array(accountInvitationSchema),
})
export const accountInviteCodeSchema = z.string().trim().regex(
  /^roomlings-invite-[A-Za-z0-9_-]{43}$/, 'Paste a current account invitation or open the link your roommate shared.',
)
export const accountInvitationResultSchema = z.object({
  code: accountInviteCodeSchema,
  invitation: accountInvitationSchema,
  access: householdAccessSchema,
})
export const sendAccountCodeSchema = z.object({ email: accountEmailSchema })
export const verifyAccountCodeSchema = sendAccountCodeSchema.extend({
  code: z.string().trim().regex(/^\d{6,10}$/, 'Enter the sign-in code from your email.'),
  name: nameSchema,
  label: nameSchema.default('Saved browser'),
})
export const linkAccountSchema = z.object({
  token: z.string().min(20).max(200).optional(),
  recoveryCode: recoveryCodeSchema.optional(),
}).refine((input) => Number(input.token !== undefined) + Number(input.recoveryCode !== undefined) === 1,
  'Use either your existing browser access or your recovery code to link a roommate identity.')
export const accountVersionSchema = z.object({ version: z.number().int().nonnegative() })
export const createAccountHouseholdSchema = z.object({
  name: nameSchema, memberName: nameSchema, currency: z.enum(currencies), budget: centsSchema,
  requestId: id.optional(),
})
export const accountHouseholdCreationReceiptSchema = z.object({
  requestId: id, memberId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
})
export const accountRecoveryCodeCount = 10
export const accountRecoveryCodePrefix = 'roomlings-account-'
export const accountRecoveryCodeSchema = z.string().trim().toLowerCase().regex(
  /^roomlings-account-[a-f0-9]{4}(?:-[a-f0-9]{4}){7}$/,
  'Enter one unused account recovery code, not an email code or a kitchen recovery code.',
)
export const accountRecoverySignInSchema = z.object({
  email: accountEmailSchema,
  code: accountRecoveryCodeSchema,
  label: nameSchema.default('Saved browser'),
})
export const accountRecoveryStateSchema = accountVersionSchema.extend({
  remaining: z.number().int().min(0).max(accountRecoveryCodeCount),
  updatedAt: timestamp.nullable(),
}).superRefine((state, context) => {
  if ((state.version === 0) !== (state.updatedAt === null) || (state.version === 0 && state.remaining !== 0)) {
    context.addIssue({ code: 'custom', message: 'Recovery-code status must describe the current saved set.' })
  }
})
export const accountRecoveryResultSchema = z.object({
  codes: z.array(accountRecoveryCodeSchema).length(accountRecoveryCodeCount),
  recovery: accountRecoveryStateSchema,
}).superRefine((result, context) => {
  if (new Set(result.codes).size !== accountRecoveryCodeCount || result.recovery.remaining !== accountRecoveryCodeCount) {
    context.addIssue({ code: 'custom', message: 'A new recovery-code set must contain ten distinct unused codes.' })
  }
})
export const createAccountInvitationSchema = accountVersionSchema.extend({
  expiresInDays: z.number().int().min(1).max(30).default(7),
})
export const acceptAccountInvitationSchema = z.object({ code: accountInviteCodeSchema, memberName: nameSchema })
export const transferOwnershipSchema = accountVersionSchema.extend({ memberId: id })
export const deleteAccountSchema = z.object({ confirmation: accountEmailSchema })

export type AccountState = z.infer<typeof accountStateSchema>
export type Account = z.infer<typeof accountSchema>
export type AccountMembership = z.infer<typeof accountMembershipSchema>
export type AccountDevice = z.infer<typeof accountDeviceSchema>
export type HouseholdAccess = z.infer<typeof householdAccessSchema>
export type AccountInvitationResult = z.infer<typeof accountInvitationResultSchema>
export type AccountKitchenSession = z.infer<typeof accountKitchenSessionSchema>
export type KitchenSession = Session | AccountKitchenSession
export type AccountRecoverySignIn = z.infer<typeof accountRecoverySignInSchema>
export type AccountRecoveryState = z.infer<typeof accountRecoveryStateSchema>
export type AccountRecoveryResult = z.infer<typeof accountRecoveryResultSchema>
export type CreateAccountHousehold = z.infer<typeof createAccountHouseholdSchema>
