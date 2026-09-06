import { z } from 'zod'
import { nameSchema } from './domain.ts'

export const recoveryCodePrefix = 'roomlings-'
export const recoveryCodeSchema = z.string().trim()
  .regex(/^roomlings-[A-Za-z0-9_-]{43}$/, 'Paste the complete recovery code.')
export const recoverInputSchema = z.object({ code: recoveryCodeSchema, label: nameSchema })
export const deviceNameInputSchema = z.object({ label: nameSchema })
export const recoveryRotationInputSchema = z.object({
  version: z.number().int().nonnegative(),
  revokeOthers: z.boolean().default(false),
})
export const deviceSchema = z.object({
  id: z.string().uuid(),
  label: nameSchema,
  createdAt: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  current: z.boolean(),
})
export const accessStateSchema = z.object({
  devices: z.array(deviceSchema),
  recovery: z.object({
    enabled: z.boolean(),
    version: z.number().int().nonnegative(),
    updatedAt: z.string().datetime().nullable(),
  }),
}).refine((state) => state.devices.filter((device) => device.current).length === 1, 'The current browser session is missing.')
export const recoveryRotationSchema = z.object({ code: recoveryCodeSchema, access: accessStateSchema })

export type Device = z.infer<typeof deviceSchema>
export type AccessState = z.infer<typeof accessStateSchema>
export type RecoveryRotationInput = z.infer<typeof recoveryRotationInputSchema>
export type RecoveryRotation = z.infer<typeof recoveryRotationSchema>
