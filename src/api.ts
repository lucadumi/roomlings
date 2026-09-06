import { householdSchema } from '../shared/domain.ts'
import type { Household, Session } from '../shared/domain.ts'
import { z } from 'zod'

export class RequestError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export async function request<T>(path: string, options: { token?: string; body?: unknown; method?: string; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
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
  } catch {
    throw new RequestError(response.status, 'The kitchen server returned an unreadable response. Please try again.')
  }
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(data)
    throw new RequestError(response.status, parsed.success ? parsed.data.error : 'The kitchen could not complete that request.')
  }
  return data as T
}

export const sessionSchema = z.object({ token: z.string().min(20), memberId: z.string().uuid(), household: householdSchema })
const storageKey = 'roomlings.session'
const savedKitchensKey = 'roomlings.kitchens'
const savedKitchenSchema = z.object({
  token: z.string().min(20),
  householdId: z.string().uuid(),
  memberId: z.string().uuid(),
  name: z.string(),
  memberName: z.string(),
})
export type SavedKitchen = z.infer<typeof savedKitchenSchema>

export function readToken(): string | null {
  // Existing kitchens migrate when rememberKitchen saves a successfully restored session.
  return localStorage.getItem(storageKey) ?? localStorage.getItem('coldshare.session')
}

export function saveToken(token: string): void {
  localStorage.setItem(storageKey, token)
}

export function savedKitchens(): SavedKitchen[] {
  const saved = localStorage.getItem(savedKitchensKey) ?? localStorage.getItem('coldshare.kitchens')
  if (!saved) return []
  return z.array(savedKitchenSchema).parse(JSON.parse(saved))
}

export function rememberKitchen(session: Session): SavedKitchen[] {
  const saved = savedKitchens()
  const member = session.household.members.find((member) => member.id === session.memberId)
  if (!member) throw new Error('The session does not belong to a roommate in this kitchen.')
  const next = [{
    token: session.token, householdId: session.household.id, memberId: session.memberId,
    name: session.household.name, memberName: member.name,
  }, ...saved.filter((kitchen) => kitchen.token !== session.token)]
  localStorage.setItem(savedKitchensKey, JSON.stringify(next))
  saveToken(session.token)
  return next
}

export async function createDemo(): Promise<Session> {
  return sessionSchema.parse(await request('/demo', { body: {} }))
}

export async function getHousehold(token: string): Promise<{ household: Household; memberId: string }> {
  return z.object({ household: householdSchema, memberId: z.string().uuid() }).parse(await request('/household', { token }))
}
