import { roomIdSchema } from '../shared/rooms.ts'
import type { RoomId } from '../shared/rooms.ts'

export { roomCatalog } from '../shared/rooms.ts'
export type { RoomId } from '../shared/rooms.ts'
export const defaultRoom: RoomId = 'kitchen'
export const roomPath = (id: RoomId = defaultRoom) => `/rooms/${id}`

export const legalPages = [
  { id: 'privacy', path: '/privacy', label: 'Privacy' },
  { id: 'terms', path: '/terms', label: 'Terms' },
  { id: 'contact', path: '/contact', label: 'Contact' },
] as const
export type LegalPage = typeof legalPages[number]['id']

export type EntryRoute =
  | { kind: 'home' }
  | { kind: 'legal'; page: LegalPage }
  | { kind: 'unavailable' }
  | { kind: 'room' | 'legacy'; roomId: RoomId }

function isRoomId(value: string): value is RoomId {
  return roomIdSchema.safeParse(value).success
}

export function resolveEntry(pathname: string, hash = ''): EntryRoute {
  const path = pathname.replace(/\/+$/, '') || '/'
  const access = new URLSearchParams(hash.replace(/^#/, ''))
  if (path === '/') {
    return ['account', 'account-invite', 'join', 'recover'].some((key) => access.has(key))
      ? { kind: 'legacy', roomId: defaultRoom } : { kind: 'home' }
  }
  if (path === '/welcome') return { kind: 'home' }
  const legal = legalPages.find((page) => page.path === path)
  if (legal) return { kind: 'legal', page: legal.id }
  if (path === '/kitchen') return { kind: 'legacy', roomId: defaultRoom }
  const match = /^\/rooms(?:\/([^/]+))?$/.exec(path)
  if (!match) return { kind: 'unavailable' }
  const roomId = match[1] ?? defaultRoom
  return isRoomId(roomId) ? { kind: 'room', roomId } : { kind: 'unavailable' }
}
