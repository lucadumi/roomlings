export const tourChapters = [
  { id: 'hello', label: 'A little home', short: 'Hello' },
  { id: 'groceries', label: 'The grocery run', short: 'Groceries' },
  { id: 'receipts', label: 'The shared ledger', short: 'Receipts' },
  { id: 'house-pot', label: 'The house pot', short: 'House pot' },
  { id: 'come-in', label: 'Make yourself at home', short: 'Come in' },
] as const

type Point = [number, number, number]
type Frame = {
  position: Point
  target: Point
  fov: number
  screen: [number, number]
  door: number
  paper: number
  coins: number
  evening: number
}

const frames: readonly Frame[] = [
  { position: [11, 9, 13], target: [0, 1.65, -0.1], fov: 35, screen: [0.69, 0.55], door: 0.08, paper: 0, coins: 0.45, evening: 0 },
  { position: [-0.3, 4.9, 5.6], target: [-2.5, 1.9, -1.8], fov: 36, screen: [0.7, 0.56], door: 1, paper: 0, coins: 0.45, evening: 0 },
  { position: [3.6, 4.8, 5.6], target: [1, 1.62, 1.45], fov: 36, screen: [0.69, 0.57], door: 0.8, paper: 1, coins: 0.45, evening: 0 },
  { position: [3.1, 4.7, 3.2], target: [0.1, 2.1, -2.3], fov: 34, screen: [0.68, 0.57], door: 0.65, paper: 0, coins: 0.8, evening: 0.12 },
  { position: [11.8, 9.2, 13.5], target: [0, 1.65, -0.1], fov: 35, screen: [0.32, 0.55], door: 0.8, paper: 0, coins: 0.8, evening: 0.48 },
]

const clamp = (value: number) => Math.min(1, Math.max(0, value))
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount
const mixPoint = (from: Point, to: Point, amount: number): Point => [
  mix(from[0], to[0], amount), mix(from[1], to[1], amount), mix(from[2], to[2], amount),
]

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
  const compact = width < 1000 || width / height <= 1.15
  const overview = reducedMotion ? 1 : 1 - Math.min(1, step, frames.length - 1 - step)
  // Narrow screens keep the room below the copy instead of shrinking it beside the text.
  const distance = compact
    ? mix(1.1, Math.max(1.7, 1.13 * height / width), overview)
    : mix(1, Math.max(1.16, 1.9 * height / width), overview)
  for (let axis = 0; axis < 3; axis++) position[axis] = target[axis] + (position[axis] - target[axis]) * distance
  return {
    position,
    target,
    fov: mix(from.fov, to.fov, eased),
    screen: compact ? [0.5, 0.7] : [mix(from.screen[0], to.screen[0], eased), mix(from.screen[1], to.screen[1], eased)],
    door: reducedMotion ? 0.8 : mix(from.door, to.door, eased),
    paper: reducedMotion ? 0 : mix(from.paper, to.paper, eased),
    coins: reducedMotion ? 0.65 : mix(from.coins, to.coins, eased),
    evening: reducedMotion ? 0 : mix(from.evening, to.evening, eased),
  }
}
