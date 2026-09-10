import { useMemo } from 'react'
import type { RefObject } from 'react'
import BathroomWorld from '../BathroomWorld.tsx'
import { bathroomChapters } from './roomTourChapters.ts'
import { sharedTourOverviewBounds } from './tourGeometry.ts'
import type { TourStatus } from './TourScene.tsx'

const stops = bathroomChapters.map((chapter) => chapter.target)
const initialFocus = { target: 'room' as const, id: 0 }

export default function BathroomTourScene({ progress, wake, reducedMotion, onStatus, onSelectChapter }: {
  progress: RefObject<number>; wake: RefObject<(() => void) | null>; reducedMotion: boolean
  onStatus: (status: TourStatus) => void; onSelectChapter?: (index: number) => void
}) {
  const tour = useMemo(() => ({ progress, wake, stops, overviewBounds: sharedTourOverviewBounds() }), [progress, wake])
  return <BathroomWorld preview roomStyle="original" paused={!onSelectChapter} panelOpen={false} dueChores={{}}
    motionReduced={reducedMotion} focusRequest={initialFocus} onStatus={onStatus} tour={tour}
    onOpenChores={(area) => {
      const index = bathroomChapters.findIndex((chapter) => chapter.target === (area ?? 'chores'))
      if (index < 0) throw new Error('That fixture does not belong to the bathroom exploration.')
      onSelectChapter?.(index)
    }}
    onRestock={() => onSelectChapter?.(bathroomChapters.length - 1)} />
}
