import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { RoomId } from './roomNavigation.ts'
import type { RoomWorldProps } from './roomViewTypes.ts'

const KitchenWorld = lazy(() => import('./KitchenWorld.tsx'))
const BathroomWorld = lazy(() => import('./BathroomWorld.tsx'))

export const roomViews = {
  kitchen: KitchenWorld,
  bathroom: BathroomWorld,
} satisfies Record<RoomId, LazyExoticComponent<ComponentType<RoomWorldProps>>>
