import { MathUtils } from 'three'

export function frameSeconds(previous: number, current: number): number {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) throw new Error('Animation timing needs finite timestamps.')
  // Exponential damping is stable over long frames; capping time makes slow devices animate in slow motion.
  return Math.max(0, (current - previous) / 1000)
}

export function dampTo(current: number, target: number, rate: number, delta: number, epsilon = 0.001): number {
  const next = MathUtils.damp(current, target, rate, delta)
  return Math.abs(next - target) < epsilon ? target : next
}
