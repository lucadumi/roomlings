import { useMemo } from 'react'
import type { RefObject } from 'react'
import LivingRoomWorld from '../LivingRoomWorld.tsx'
import { livingRoomChapters } from './roomTourChapters.ts'
import type { TourStatus } from './TourScene.tsx'
import { sharedTourOverviewBounds } from './tourGeometry.ts'

const stops = livingRoomChapters.map((chapter) => chapter.target)
const initialFocus = { target: 'room' as const, id: 0 }

export default function LivingRoomTourScene({ progress, wake, reducedMotion, onStatus, onSelectChapter }: {
  progress: RefObject<number>; wake: RefObject<(() => void) | null>; reducedMotion: boolean
  onStatus: (status: TourStatus) => void; onSelectChapter?: (index: number) => void
}) {
  const tour = useMemo(() => ({ progress, wake, stops, overviewBounds: sharedTourOverviewBounds() }), [progress, wake])
  return <LivingRoomWorld preview roomStyle="original" paused={!onSelectChapter} panelOpen={false} dueChores={{}}
    motionReduced={reducedMotion} focusRequest={initialFocus} onStatus={onStatus} tour={tour}
    onOpenChores={(area) => {
      const target = area === 'seating' ? 'sofa' : area ?? 'chores'
      const index = livingRoomChapters.findIndex((chapter) => chapter.target === target)
      if (index < 0) throw new Error('That object does not belong to the living room exploration.')
      onSelectChapter?.(index)
    }}
    onRestock={() => onSelectChapter?.(livingRoomChapters.length - 1)} />
}
