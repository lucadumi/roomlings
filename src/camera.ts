import { Vector3 } from 'three'
import type { Box3 } from 'three'
import type { KitchenAction, KitchenUtility } from './room.ts'

export type SceneFocus = KitchenAction | KitchenUtility | 'room' | 'fridge' | 'brew'
export type FocusRequest = { target: SceneFocus; id: number }
export const baseCameraOffset: [number, number, number] = [9, 7.85, 13]
export type FramingArea = { x: number; y: number; width: number; height: number }

export const focusLabels: Record<SceneFocus, string> = {
  room: 'The kitchen',
  fridge: 'The shared fridge',
  stock: 'The shopping bag',
  ledger: 'The receipt book',
  budget: 'The house pot',
  roommates: 'Your people',
  settle: 'The repayment envelope',
  brew: 'A little tea break',
  chores: 'Room chores',
  supplies: 'Room supplies',
  sink: 'The sink',
  counters: 'The counters',
  floor: 'The floor',
}

const views: Record<SceneFocus, { center: [number, number, number]; halfHeight: number; width: number }> = {
  room: { center: [-0.1, 1.85, -0.05], halfHeight: 4.45, width: 9.4 },
  fridge: { center: [-2.7, 1.95, -2.05], halfHeight: 2.9, width: 4.2 },
  stock: { center: [-0.65, 1.65, 0.65], halfHeight: 2.85, width: 4.6 },
  ledger: { center: [0.85, 1.2, 1.35], halfHeight: 2.7, width: 4.3 },
  budget: { center: [0.45, 2, -2.1], halfHeight: 2.65, width: 4.1 },
  roommates: { center: [3.45, 2.8, -2.9], halfHeight: 2.65, width: 4.1 },
  settle: { center: [1.75, 1.15, 1.1], halfHeight: 2.7, width: 4.2 },
  brew: { center: [1.65, 2, -2.25], halfHeight: 2.65, width: 4.1 },
  chores: { center: [-1.55, 0.75, -0.45], halfHeight: 2.4, width: 3.6 },
  supplies: { center: [-4.55, 1.9, -1.8], halfHeight: 2.4, width: 3.6 },
  sink: { center: [3.35, 1.7, -2.56], halfHeight: 2.6, width: 4.1 },
  counters: { center: [2.05, 1.3, -2.56], halfHeight: 2.9, width: 5.3 },
  floor: { center: [0, 0.6, 0], halfHeight: 4.25, width: 9.4 },
}

export function cameraFraming(width: number, height: number, focus: SceneFocus, wholeRoom: boolean, wholeRoomView: {
  bounds?: Box3; rotation?: number; pitch?: number
} = {}): {
  center: [number, number, number]; halfHeight: number
} {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Camera framing needs a positive viewport width and height.')
  }
  const aspect = width / height
  if (wholeRoom) {
    const { bounds, rotation = 0, pitch = 0 } = wholeRoomView
    const min = bounds?.min.toArray() ?? [-5.4, -0.4, -3.5]
    const max = bounds?.max.toArray() ?? [5.4, 5.1, 3.5]
    if (![...min, ...max, rotation, pitch].every(Number.isFinite) || bounds?.isEmpty()) {
      throw new Error('Whole-room framing needs finite bounds and camera angles.')
    }
    const center = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
    const axis = new Vector3(0, 1, 0)
    const backward = new Vector3(baseCameraOffset[0], baseCameraOffset[1] + pitch, baseCameraOffset[2]).normalize()
    const right = new Vector3().crossVectors(axis, backward).normalize()
    const up = new Vector3().crossVectors(backward, right).normalize()
    let halfHeight = Math.max(4.65, 6.8 / aspect)
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      const corner = new Vector3(x, y, z).sub(center).applyAxisAngle(axis, rotation)
      halfHeight = Math.max(halfHeight, Math.abs(corner.dot(up)) + 0.18, (Math.abs(corner.dot(right)) + 0.18) / aspect)
    }
    return { center: [center.x, center.y, center.z], halfHeight }
  }
  if (focus === 'room') {
    return aspect < 0.9
      ? { center: [-0.7, 1.6, -0.9], halfHeight: 4.6 }
      : { center: views.room.center, halfHeight: Math.max(4.45, 4.7 / aspect) }
  }
  const view = views[focus]
  return { center: view.center, halfHeight: Math.max(view.halfHeight, view.width / (2 * aspect)) }
}

export function cameraProjection(width: number, height: number, area: FramingArea, halfHeight: number, zoom: number) {
  if (![width, height, area.width, area.height, halfHeight, zoom].every((value) => Number.isFinite(value) && value > 0)
    || !Number.isFinite(area.x) || !Number.isFinite(area.y)) {
    throw new Error('Camera projection needs a valid viewport, framing area, and zoom.')
  }
  const vertical = halfHeight * height / area.height
  const horizontal = halfHeight * width / area.height
  // Keep the selected object in the unobscured area while the canvas covers the whole screen.
  const x = horizontal * (1 - (area.x + area.width / 2) * 2 / width) / zoom
  const y = vertical * ((area.y + area.height / 2) * 2 / height - 1) / zoom
  return { left: -horizontal + x, right: horizontal + x, top: vertical + y, bottom: -vertical + y }
}

export function fitRoomBounds(width: number, height: number, bounds: Box3, rotation = 0, pitch = 0): {
  center: [number, number, number]; halfHeight: number
} {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)
    || ![...bounds.min.toArray(), ...bounds.max.toArray(), rotation, pitch].every(Number.isFinite) || bounds.isEmpty()) {
    throw new Error('Room framing needs positive scene dimensions and finite bounds.')
  }
  const center = bounds.getCenter(new Vector3())
  const axis = new Vector3(0, 1, 0)
  const backward = new Vector3(baseCameraOffset[0], baseCameraOffset[1] + pitch, baseCameraOffset[2]).normalize()
  const right = new Vector3().crossVectors(axis, backward).normalize()
  const up = new Vector3().crossVectors(backward, right).normalize()
  let horizontal = 0
  let vertical = 0
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const corner = new Vector3(x, y, z).sub(center).applyAxisAngle(axis, rotation)
    horizontal = Math.max(horizontal, Math.abs(corner.dot(right)))
    vertical = Math.max(vertical, Math.abs(corner.dot(up)))
  }
  center.applyAxisAngle(axis, rotation)
  return {
    center: [center.x, center.y, center.z],
    halfHeight: Math.max(1.25, vertical + 0.18, (horizontal + 0.18) * height / width) * 1.08,
  }
}
