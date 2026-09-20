import { z } from 'zod'

// Retention instrumentation only. The client never sends who else was involved, what was
// bought, what anything cost or what any item was called, and the server takes the household
// and member from the session rather than the payload.
export const analyticsEventKinds = ['app_opened', 'notification_opened', 'invite_shared', 'invite_accepted'] as const
export const analyticsEventKindSchema = z.enum(analyticsEventKinds)
export const analyticsLocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const analyticsEventSchema = z.object({
  kind: analyticsEventKindSchema,
  occurredAt: z.string().datetime(),
  localDate: analyticsLocalDateSchema,
}).strict()
export const analyticsBatchSchema = z.object({ events: z.array(analyticsEventSchema).min(1).max(50) }).strict()
export const analyticsAcceptedSchema = z.object({ recorded: z.number().int().nonnegative() }).strict()
export const analyticsDayCountSchema = z.object({
  localDate: analyticsLocalDateSchema, kind: analyticsEventKindSchema,
  members: z.number().int().nonnegative(), occurrences: z.number().int().nonnegative(),
}).strict()

export type AnalyticsEventKind = z.infer<typeof analyticsEventKindSchema>
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>
export type AnalyticsBatch = z.infer<typeof analyticsBatchSchema>
export type AnalyticsDayCount = z.infer<typeof analyticsDayCountSchema>
