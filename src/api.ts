import { householdSchema } from '../shared/domain.ts'
import type { Household } from '../shared/domain.ts'
import { accountStateSchema } from '../shared/accounts.ts'
import type { AccountMembership, AccountState, KitchenSession } from '../shared/accounts.ts'
import { z } from 'zod'

export class RequestError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code }
}

export async function request<T>(path: string, options: {
  token?: string | null; csrfToken?: string | null; householdId?: string
  body?: unknown; method?: string; signal?: AbortSignal
} = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: {
        'X-Roomlings-Request': '1',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
        ...(options.householdId ? { 'X-Roomlings-Household': options.householdId } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: options.signal ?? AbortSignal.timeout(15_000),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new RequestError(0, 'The kitchen is offline. Your saved expenses are safe; reconnect and try again.')
  }
  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (response.status >= 500) {
      throw new RequestError(response.status, 'The server is temporarily unavailable. Your request was not confirmed; wait a moment and try again.', 'SERVER_UNAVAILABLE')
    }
    throw new RequestError(response.status, 'The server returned an unreadable response. Please try again.')
  }
  if (!response.ok) {
    const parsed = z.object({ error: z.string(), code: z.string().optional() }).safeParse(data)
    throw new RequestError(response.status, parsed.success ? parsed.data.error : 'The kitchen could not complete that request.', parsed.success ? parsed.data.code : undefined)
  }
  return data as T
}

export const sessionSchema = z.object({ token: z.string().min(20), memberId: z.string().uuid(), household: householdSchema })
const storageKey = 'roomlings.session'
const savedKitchensKey = 'roomlings.kitchens'
const accessModeKey = 'roomlings.access-mode'
const savedKitchenSchema = z.object({
  token: z.string().min(20),
  householdId: z.string().uuid(),
  memberId: z.string().uuid(),
  name: z.string(),
  memberName: z.string(),
  expired: z.literal(true).optional(),
})
// Retain old records without offering retired examples as personal kitchen shortcuts.
const storedKitchensSchema = z.array(savedKitchenSchema.extend({ demo: z.boolean().optional() }))
export type SavedKitchen = z.infer<typeof savedKitchenSchema>
export type SavedKitchenChange = Pick<SavedKitchen, 'expired'> & Partial<Pick<SavedKitchen, 'name' | 'memberName'>>

export function readToken(): string | null {
  // Existing kitchens migrate when rememberKitchen saves a successfully restored session.
  return localStorage.getItem(storageKey) ?? localStorage.getItem('coldshare.session')
}

export function saveToken(token: string): void {
  localStorage.setItem(storageKey, token)
  localStorage.setItem(accessModeKey, 'browser')
}

export function readAccessMode(): string | null {
  return localStorage.getItem(accessModeKey)
}

export function preferAccountAccess(): void {
  localStorage.setItem(accessModeKey, 'account')
}

export function savedKitchens(): SavedKitchen[] {
  const saved = localStorage.getItem(savedKitchensKey) ?? localStorage.getItem('coldshare.kitchens')
  if (!saved) return []
  return storedKitchensSchema.parse(JSON.parse(saved))
    .filter((kitchen) => kitchen.demo !== true).map((kitchen) => savedKitchenSchema.parse(kitchen))
}

export function updateSavedKitchen(token: string, change: SavedKitchenChange): SavedKitchen[] {
  const updates = [savedKitchensKey, 'coldshare.kitchens'].flatMap((key) => {
    const value = localStorage.getItem(key)
    if (!value) return []
    const kitchens = storedKitchensSchema.parse(JSON.parse(value))
    return kitchens.some((kitchen) => kitchen.token === token) ? [{ key, kitchens }] : []
  })
  for (const { key, kitchens } of updates) {
    localStorage.setItem(key, JSON.stringify(kitchens.map((kitchen) =>
      kitchen.token === token ? { ...kitchen, ...change } : kitchen)))
  }
  return savedKitchens()
}

export function rememberKitchen(session: KitchenSession): SavedKitchen[] {
  const saved = savedKitchens()
  if (session.token === null) {
    preferAccountAccess()
    return saved
  }
  const member = session.household.members.find((member) => member.id === session.memberId)
  if (!member) throw new Error('The session does not belong to a roommate in this kitchen.')
  const stored = localStorage.getItem(savedKitchensKey) ?? localStorage.getItem('coldshare.kitchens')
  const previous = stored ? storedKitchensSchema.parse(JSON.parse(stored)) : []
  const next = [{
    token: session.token, householdId: session.household.id, memberId: session.memberId,
    name: session.household.name, memberName: member.name,
  }, ...previous.filter((kitchen) => kitchen.token !== session.token
    && (kitchen.householdId !== session.household.id || kitchen.memberId !== session.memberId))]
  localStorage.setItem(savedKitchensKey, JSON.stringify(next))
  saveToken(session.token)
  return savedKitchens()
}

export async function getHousehold(token: string | null, householdId?: string): Promise<{ household: Household; memberId: string }> {
  return z.object({ household: householdSchema, memberId: z.string().uuid() }).parse(await request('/household', { token, householdId }))
}

export async function getAccountState(signal?: AbortSignal): Promise<AccountState> {
  return accountStateSchema.parse(await request('/account', { signal }))
}

export function sameKitchenSession(left: KitchenSession | null, right: KitchenSession | null): boolean {
  return left !== null && right !== null && left.token === right.token
    && left.memberId === right.memberId && left.household.id === right.household.id
}

export function forgetAccountKitchens(memberships: AccountMembership[]): SavedKitchen[] {
  const belongs = (kitchen: SavedKitchen) => memberships.some((membership) =>
    membership.householdId === kitchen.householdId && membership.memberId === kitchen.memberId)
  const removedTokens = new Set<string>()
  for (const key of [savedKitchensKey, 'coldshare.kitchens']) {
    const value = localStorage.getItem(key)
    if (!value) continue
    const kitchens = storedKitchensSchema.parse(JSON.parse(value))
    for (const kitchen of kitchens.filter(belongs)) removedTokens.add(kitchen.token)
    localStorage.setItem(key, JSON.stringify(kitchens.filter((kitchen) => !belongs(kitchen))))
  }
  for (const key of [storageKey, 'coldshare.session']) {
    const token = localStorage.getItem(key)
    if (token && removedTokens.has(token)) localStorage.removeItem(key)
  }
  preferAccountAccess()
  return savedKitchens()
}
