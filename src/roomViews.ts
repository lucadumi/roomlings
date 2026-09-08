import { lazy } from 'react'
import type { RoomId } from './roomNavigation.ts'

const KitchenWorld = lazy(() => import('./KitchenWorld.tsx'))

export const roomViews = {
  kitchen: KitchenWorld,
} satisfies Record<RoomId, typeof KitchenWorld>
