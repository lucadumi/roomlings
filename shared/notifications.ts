import { z } from 'zod'
import { roomComponentIdSchema } from './roomComponents.ts'

export const notificationPreferencesSchema = z.object({ chores: z.boolean(), money: z.boolean() }).strict()
export const notificationSettingsSchema = z.object({
  householdId: z.string().uuid(), memberId: z.string().uuid(),
  preferences: notificationPreferencesSchema, pushAvailable: z.boolean(),
}).strict()
export const pushEnvironmentSchema = z.enum(['sandbox', 'production'])
export const pushDeviceSchema = z.object({
  installationId: z.string().uuid(),
  token: z.string().min(2).max(1024).regex(/^(?:[a-fA-F0-9]{2})+$/).transform((token) => token.toLowerCase()),
  environment: pushEnvironmentSchema,
}).strict()
const notificationTarget = {
  version: z.literal(1), householdId: z.string().uuid(), componentId: roomComponentIdSchema.optional(),
}
export const notificationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ ...notificationTarget, kind: z.literal('chores') }).strict(),
  z.object({ ...notificationTarget, kind: z.literal('expense'), expenseId: z.string().uuid() }).strict(),
  z.object({ ...notificationTarget, kind: z.literal('settlement'), settlementId: z.string().uuid() }).strict(),
])
export const notificationBodies = {
  chores: 'You have chores due today.',
  expense: 'A new expense was recorded.',
  settlement: 'A repayment was recorded.',
} as const

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>
export type PushDevice = z.infer<typeof pushDeviceSchema>
export type PushEnvironment = z.infer<typeof pushEnvironmentSchema>
export type NotificationTarget = z.infer<typeof notificationTargetSchema>
export type NotificationKind = NotificationTarget['kind']
