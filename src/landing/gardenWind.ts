import { dampTo } from '../motion.ts'

export const maximumGardenWind = 0.075
export const gardenSwayPadding = 0.25
export type GardenWind = { gust: number; lean: number }

export function gardenScrollGust(distance: number, milliseconds: number, height: number): number {
  if (![distance, milliseconds, height].every(Number.isFinite) || milliseconds < 0 || height <= 0) {
    throw new Error('Garden wind needs a finite scroll distance, elapsed time and positive viewport height.')
  }
  return Math.max(-maximumGardenWind, Math.min(maximumGardenWind, distance / Math.max(16, Math.min(64, milliseconds)) / height * 45))
}

export function advanceGardenWind(wind: GardenWind, seconds: number): GardenWind {
  if (![wind.gust, wind.lean, seconds].every(Number.isFinite) || seconds < 0) {
    throw new Error('Garden wind needs finite motion values and nonnegative elapsed time.')
  }
  return {
    gust: dampTo(wind.gust, 0, 3, seconds, 0.0001),
    lean: dampTo(wind.lean, wind.gust, 8, seconds, 0.0001),
  }
}
