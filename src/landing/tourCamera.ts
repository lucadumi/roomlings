import { Box3, Vector3 } from 'three'
import { cameraFraming, fitRoomBounds } from '../camera.ts'
import { tourChapters, tourFrame } from './tour.ts'

export function tourCameraFraming(progress: number, width: number, height: number, reducedMotion = false): {
  center: [number, number, number]; halfHeight: number
} {
  if (!Number.isFinite(progress)) throw new Error('Room exploration needs finite progress.')
  const last = tourChapters.length - 1
  const step = (reducedMotion ? 0 : Math.max(0, Math.min(1, progress))) * last
  const index = Math.min(last - 1, Math.floor(step))
  const amount = step - index
  const eased = amount * amount * (3 - 2 * amount)
  const frame = (at: number) => {
    if (at === 0 || at === last) return cameraFraming(width, height, 'room', true)
    const view = tourFrame(at / last, width, height)
    return fitRoomBounds(width, height, new Box3(new Vector3(...view.bounds[0]), new Vector3(...view.bounds[1])))
  }
  const from = frame(index)
  const to = frame(index + 1)
  return {
    center: [
      from.center[0] + (to.center[0] - from.center[0]) * eased,
      from.center[1] + (to.center[1] - from.center[1]) * eased,
      from.center[2] + (to.center[2] - from.center[2]) * eased,
    ],
    halfHeight: from.halfHeight + (to.halfHeight - from.halfHeight) * eased,
  }
}
