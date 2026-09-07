import type { KitchenAction } from './room.ts'

export type SceneFocus = KitchenAction | 'room' | 'fridge' | 'brew'
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
}

export function cameraFraming(width: number, height: number, focus: SceneFocus, wholeRoom: boolean): {
  center: [number, number, number]; halfHeight: number
} {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Camera framing needs a positive viewport width and height.')
  }
  const aspect = width / height
  if (wholeRoom) return { center: views.room.center, halfHeight: Math.max(4.65, 6.8 / aspect) }
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
