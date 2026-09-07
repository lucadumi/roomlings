export const tourChapters = [
  { id: 'hello', label: 'The shared room', short: 'Room' },
  { id: 'groceries', label: 'Groceries', short: 'Groceries' },
  { id: 'receipts', label: 'Bills and receipts', short: 'Bills' },
  { id: 'house-pot', label: 'Monthly budget', short: 'Budget' },
  { id: 'come-in', label: 'Fair repayments', short: 'Balances' },
] as const

type Point = [number, number, number]
export type TourLayout = {
  width: number
  height: number
  start: FramingArea
  end: FramingArea
  top: number
  bottom: number
}

type Frame = {
  position: Point
  target: Point
  fov: number
  screen: [number, number]
  door: number
  paper: number
  coins: number
  evening: number
  bounds: [Point, Point]
}

const frames: readonly Frame[] = [
  { position: [11, 9, 13], target: [0, 1.65, -0.1], fov: 35, screen: [0.5, 0.5], door: 0.08, paper: 0, coins: 0.45, evening: 0, bounds: [[-5.4, -0.4, -3.5], [5.4, 5.1, 3.5]] },
  { position: [-0.3, 4.9, 5.6], target: [-2.5, 1.9, -1.8], fov: 36, screen: [0.5, 0.5], door: 1, paper: 0, coins: 0.45, evening: 0, bounds: [[-5, 0.1, -3.2], [-1.4, 3.8, 1.1]] },
  { position: [3.6, 4.8, 5.6], target: [1, 1.62, 1.45], fov: 36, screen: [0.5, 0.5], door: 0.8, paper: 1, coins: 0.45, evening: 0, bounds: [[-1.4, 0.9, 0.15], [2.8, 2.8, 2.45]] },
  { position: [3.1, 4.7, 3.2], target: [0.1, 2.1, -2.3], fov: 34, screen: [0.5, 0.5], door: 0.65, paper: 0, coins: 0.8, evening: 0.12, bounds: [[-1, 1.65, -3.2], [2.8, 3.4, -1.4]] },
  { position: [11.8, 9.2, 13.5], target: [0, 1.65, -0.1], fov: 35, screen: [0.5, 0.5], door: 0.8, paper: 0, coins: 0.8, evening: 0.48, bounds: [[-5.4, -0.4, -3.5], [5.4, 5.1, 3.5]] },
]

const clamp = (value: number) => Math.min(1, Math.max(0, value))
const mix = (from: number, to: number, amount: number) => from * (1 - amount) + to * amount
const mixPoint = (from: Point, to: Point, amount: number): Point => [
  mix(from[0], to[0], amount), mix(from[1], to[1], amount), mix(from[2], to[2], amount),
]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const normalize = (point: Point): Point => {
  const length = Math.hypot(...point)
  if (!Number.isFinite(length) || length === 0) throw new Error('A tour camera needs a valid viewing direction.')
  return [point[0] / length, point[1] / length, point[2] / length]
}

export function tourArea(progress: number, layout: TourLayout, reducedMotion = false): FramingArea {
  if (!Number.isFinite(progress) || ![layout.width, layout.height, layout.start.width, layout.start.height, layout.end.width, layout.end.height].every((value) => Number.isFinite(value) && value > 0)
    || ![layout.start.x, layout.start.y, layout.end.x, layout.end.y, layout.top, layout.bottom].every(Number.isFinite)) {
    throw new Error('The tour needs a valid measured layout.')
  }
  const t = reducedMotion ? 0 : clamp(progress * (frames.length - 1) - (frames.length - 2))
  const eased = t * t * (3 - 2 * t)
  const x = mix(layout.start.x, layout.end.x, eased)
  const y = mix(layout.start.y, layout.end.y, eased)
  const width = mix(layout.start.width, layout.end.width, eased)
  const height = mix(layout.start.height, layout.end.height, eased)
  const top = Math.max(y, layout.top)
  const bottom = Math.min(y + height, layout.bottom)
  return { x, y: top, width, height: Math.max(0, bottom - top) }
}

export function scrollProgress(scroll: number, stops: readonly number[]): number {
  if (!Number.isFinite(scroll) || stops.length < 2
    || stops.some((stop, index) => !Number.isFinite(stop) || (index > 0 && stop <= stops[index - 1]))) {
    throw new Error('A scroll tour needs finite, increasing chapter positions.')
  }
  if (scroll <= stops[0]) return 0
  for (let index = 1; index < stops.length; index++) {
    if (scroll < stops[index]) {
      return (index - 1 + (scroll - stops[index - 1]) / (stops[index] - stops[index - 1])) / (stops.length - 1)
    }
  }
  return 1
}

export function tourFrame(progress: number, width: number, height: number, reducedMotion = false): Frame {
  if (!Number.isFinite(progress) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('A kitchen tour needs finite progress and a positive viewport.')
  }
  const step = (reducedMotion ? 0 : clamp(progress)) * (frames.length - 1)
  const index = Math.min(frames.length - 2, Math.floor(step))
  const t = step - index
  const eased = t * t * (3 - 2 * t)
  const from = frames[index]
  const to = frames[index + 1]
  const position = mixPoint(from.position, to.position, eased)
  const target = mixPoint(from.target, to.target, eased)
  const bounds: [Point, Point] = [mixPoint(from.bounds[0], to.bounds[0], eased), mixPoint(from.bounds[1], to.bounds[1], eased)]
  const back = normalize([position[0] - target[0], position[1] - target[1], position[2] - target[2]])
  const right = normalize([back[2], 0, -back[0]])
  const up: Point = [back[1] * right[2], back[2] * right[0] - back[0] * right[2], -back[1] * right[0]]
  const fov = mix(from.fov, to.fov, eased)
  const vertical = Math.tan(fov * Math.PI / 360) * 0.9
  const horizontal = vertical * width / height
  let distance = 0
  // Fit the visible object volume to the actual CSS scene area, not a device breakpoint.
  for (const x of [bounds[0][0], bounds[1][0]]) for (const y of [bounds[0][1], bounds[1][1]]) for (const z of [bounds[0][2], bounds[1][2]]) {
    const point: Point = [x - target[0], y - target[1], z - target[2]]
    distance = Math.max(distance, dot(point, back) + Math.abs(dot(point, right)) / horizontal, dot(point, back) + Math.abs(dot(point, up)) / vertical)
  }
  for (let axis = 0; axis < 3; axis++) position[axis] = target[axis] + back[axis] * distance
  return {
    position,
    target,
    fov,
    screen: [0.5, 0.5],
    bounds,
    door: reducedMotion ? 0.8 : mix(from.door, to.door, eased),
    paper: reducedMotion ? 0 : mix(from.paper, to.paper, eased),
    coins: reducedMotion ? 0.65 : mix(from.coins, to.coins, eased),
    evening: reducedMotion ? 0 : mix(from.evening, to.evening, eased),
  }
}
import type { FramingArea } from '../camera.ts'
