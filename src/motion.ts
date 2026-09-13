import { MathUtils, Vector3 } from 'three'
import type { FramingArea } from './camera.ts'

export function frameSeconds(previous: number, current: number): number {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) throw new Error('Animation timing needs finite timestamps.')
  // Exponential damping is stable over long frames; capping time makes slow devices animate in slow motion.
  return Math.max(0, (current - previous) / 1000)
}

export function dampTo(current: number, target: number, rate: number, delta: number, epsilon = 0.001): number {
  const next = MathUtils.damp(current, target, rate, delta)
  return Math.abs(next - target) < epsilon ? target : next
}

export type Spring = { value: number; velocity: number }

// Exact critically damped motion carries velocity through retargeting and remains frame-rate independent.
export function springTo(spring: Spring, target: number, rate: number, delta: number, epsilon = 0.001): Spring {
  if (!Number.isFinite(target) || !Number.isFinite(rate) || rate <= 0) throw new Error('Spring motion needs a finite target and a positive rate.')
  if (!Number.isFinite(spring.value) || !Number.isFinite(spring.velocity) || !Number.isFinite(delta) || delta < 0) throw new Error('Spring motion needs finite state and a non-negative time step.')
  if (!Number.isFinite(epsilon) || epsilon <= 0) throw new Error('Spring motion needs a positive settling threshold.')
  if (delta === 0) return spring
  const offset = spring.value - target
  const scaled = (spring.velocity + rate * offset) * delta
  const decay = Math.exp(-rate * delta)
  const value = (offset + scaled) * decay + target
  const velocity = (spring.velocity - rate * scaled) * decay
  return Math.abs(value - target) < epsilon && Math.abs(velocity) < epsilon ? { value: target, velocity: 0 } : { value, velocity }
}

export function springVector3To(value: Vector3, velocity: Vector3, target: Vector3, rate: number, delta: number, epsilon = 0.001): void {
  const x = springTo({ value: value.x, velocity: velocity.x }, target.x, rate, delta, epsilon)
  const y = springTo({ value: value.y, velocity: velocity.y }, target.y, rate, delta, epsilon)
  const z = springTo({ value: value.z, velocity: velocity.z }, target.z, rate, delta, epsilon)
  value.set(x.value, y.value, z.value)
  velocity.set(x.velocity, y.velocity, z.velocity)
}

export class CameraProjectionMotion {
  readonly area: FramingArea = { x: 0, y: 0, width: 1, height: 1 }
  moving = false
  private readonly state: Record<keyof FramingArea, Spring> = {
    x: { value: 0, velocity: 0 }, y: { value: 0, velocity: 0 },
    width: { value: 1, velocity: 0 }, height: { value: 1, velocity: 0 },
  }

  update(target: FramingArea, viewport: { width: number; height: number }, delta: number, snap: boolean): FramingArea {
    this.moving = false
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const dimension = key === 'x' || key === 'width' ? viewport.width : viewport.height
      if (!Number.isFinite(dimension) || dimension <= 0) throw new Error('Camera projection needs a positive viewport.')
      if (!Number.isFinite(target[key])) throw new Error('Camera projection needs finite bounds.')
      const destination = target[key] / dimension
      this.state[key] = snap ? { value: destination, velocity: 0 } : springTo(this.state[key], destination, 16, delta, 0.0001)
      const moving = this.state[key].value !== destination || this.state[key].velocity !== 0
      this.area[key] = moving ? this.state[key].value * dimension : target[key]
      this.moving ||= moving
    }
    return this.area
  }
}
