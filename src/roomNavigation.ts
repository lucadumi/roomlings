export const roomCatalog = {
  kitchen: { label: 'The kitchen' },
} as const

export type RoomId = keyof typeof roomCatalog
export const defaultRoom: RoomId = 'kitchen'
export const roomPath = (id: RoomId = defaultRoom) => `/rooms/${id}`
export const samplePath = (id: RoomId = defaultRoom) => `/sample/${id}`

export type EntryRoute =
  | { kind: 'home' | 'unavailable' }
  | { kind: 'room' | 'sample' | 'legacy'; roomId: RoomId }

function isRoomId(value: string): value is RoomId {
  return Object.hasOwn(roomCatalog, value)
}

export function resolveEntry(pathname: string, hash = ''): EntryRoute {
  const path = pathname.replace(/\/+$/, '') || '/'
  const access = new URLSearchParams(hash.replace(/^#/, ''))
  if (path === '/') {
    return ['account', 'account-invite', 'join', 'recover'].some((key) => access.has(key))
      ? { kind: 'legacy', roomId: defaultRoom } : { kind: 'home' }
  }
  if (path === '/welcome') return { kind: 'home' }
  if (path === '/kitchen') return { kind: 'legacy', roomId: defaultRoom }
  const match = /^\/(rooms|sample)(?:\/([^/]+))?$/.exec(path)
  if (!match) return { kind: 'unavailable' }
  const roomId = match[2] ?? defaultRoom
  return isRoomId(roomId) ? { kind: match[1] === 'sample' ? 'sample' : 'room', roomId } : { kind: 'unavailable' }
}
