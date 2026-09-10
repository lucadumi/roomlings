import { Vector3 } from 'three'
import type { Box3 } from 'three'
import type { RoomSlotId } from '../shared/roomComponents.ts'
import type { KitchenAction, KitchenUtility } from './room.ts'
import { componentPlacements, kitchenLayout, roomFootprints, roomShellBounds } from './roomLayout.ts'

export type SceneFocus = KitchenAction | KitchenUtility | 'room' | 'fridge' | 'brew'
export type FocusRequest = { target: SceneFocus; id: number }
export const baseCameraOffset: [number, number, number] = [9, 7.85, 13]
export const placementPreviewZoom = 1.2
export type FramingArea = { x: number; y: number; width: number; height: number }

export function preferredRoomRotation(slotId?: RoomSlotId): number {
  const placement = slotId ? componentPlacements[slotId] : undefined
  return placement?.surface === 'fitted' && placement.rotation === -Math.PI / 2 ? 0.75 : 0
}

export function usesRoomEntryFraming(view: {
  focus: string
  selectedComponentId?: string | null
  resetView?: boolean
  panelOpen?: boolean
  overviewFocus?: boolean
  placementPreview?: boolean
  publicPreview?: boolean
}): boolean {
  return !view.overviewFocus && !view.placementPreview && !view.publicPreview
    && (!!view.resetView || (!view.panelOpen && view.focus === 'room' && !view.selectedComponentId))
}

export function roomFramingArea(canvas: FramingArea, stage: FramingArea, controls?: FramingArea): FramingArea {
  const overlaps = controls && controls.width > 0 && controls.height > 0
    && controls.y < stage.y + stage.height && controls.y + controls.height > stage.y
    && controls.x > stage.x && controls.x < stage.x + stage.width
  const right = overlaps ? controls.x - 12 : stage.x + stage.width
  return { x: stage.x - canvas.x, y: stage.y - canvas.y, width: Math.max(1, right - stage.x), height: stage.height }
}

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
  room: { center: [0, 1.85, roomFootprints.kitchen.centerZ], halfHeight: 4.45, width: roomFootprints.kitchen.width },
  fridge: { center: [kitchenLayout.fridge[0], 1.95, -2.05], halfHeight: 2.9, width: 4.2 },
  stock: { center: kitchenLayout.stock, halfHeight: 2.85, width: 4.6 },
  ledger: { center: kitchenLayout.ledger, halfHeight: 2.7, width: 4.3 },
  budget: { center: kitchenLayout.budget, halfHeight: 2.65, width: 4.1 },
  roommates: { center: kitchenLayout.roommates, halfHeight: 2.65, width: 4.1 },
  settle: { center: kitchenLayout.settle, halfHeight: 2.7, width: 4.2 },
  brew: { center: [kitchenLayout.kettle[0], 2.1, kitchenLayout.kettle[2]], halfHeight: 2.65, width: 4.1 },
  chores: { center: kitchenLayout.chores, halfHeight: 2.4, width: 3.6 },
  supplies: { center: kitchenLayout.supplies, halfHeight: 2.4, width: 3.6 },
  sink: { center: [3.5, 1.7, -2.56], halfHeight: 2.6, width: 4.1 },
  counters: { center: kitchenLayout.counters, halfHeight: 2.9, width: roomFootprints.kitchen.width },
  floor: { center: [0, 0.6, roomFootprints.kitchen.centerZ], halfHeight: 4.25, width: roomFootprints.kitchen.width },
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
  if (wholeRoom || focus === 'floor') {
    const { bounds = roomShellBounds('kitchen'), rotation = 0, pitch = 0 } = wholeRoomView
    if (![...bounds.min.toArray(), ...bounds.max.toArray(), rotation, pitch].every(Number.isFinite) || bounds.isEmpty()) {
      throw new Error('Whole-room framing needs finite bounds and camera angles.')
    }
    const fitted = fitRoomBounds(width, height, bounds, rotation, pitch)
    return { center: bounds.getCenter(new Vector3()).toArray(), halfHeight: fitted.halfHeight }
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

export function roomEntryFraming(width: number, height: number, area: FramingArea, rotation = 0) {
  const frame = cameraFraming(width, height, 'room', false)
  if (![area.width, area.height].every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(rotation)) {
    throw new Error('Room entry framing needs a measured scene area and a finite angle.')
  }
  const center = new Vector3(...frame.center).applyAxisAngle(new Vector3(0, 1, 0), rotation)
  return { center: center.toArray(), halfHeight: frame.halfHeight * area.height / height }
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

export function roomCameraZoom(zoom: number, closeRoom: boolean): number {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('Room camera zoom needs a positive finite value.')
  return closeRoom ? zoom * 1.2 : zoom
}
