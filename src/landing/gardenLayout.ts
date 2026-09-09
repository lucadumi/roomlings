import type { FramingArea } from '../camera.ts'

export type GardenRail = { x: number; width: number; visible: boolean; frame: FramingArea }
export type GardenLayout = {
  width: number
  height: number
  left: GardenRail
  right: GardenRail
  animate: boolean
}

export function gardenLayout(width: number, height: number, contentLeft: number, contentRight: number): GardenLayout {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)
    || ![contentLeft, contentRight].every(Number.isFinite) || contentLeft > contentRight) {
    throw new Error('The garden needs positive scene dimensions and ordered content edges.')
  }
  const leftWidth = Math.max(0, Math.min(width, contentLeft - 12))
  const rightX = Math.max(0, Math.min(width, contentRight + 12))
  const rail = (side: 'left' | 'right', space: number): GardenRail => {
    const frameWidth = Math.min(500, Math.max(300, space * 2.2 + 120), width * 0.38, height * 0.48)
    const frameHeight = frameWidth * 5 / 3
    const x = side === 'left' ? 0 : rightX
    return {
      x,
      width: space,
      visible: space >= 36,
      frame: {
        x: side === 'left' ? 12 : width - frameWidth - 12,
        y: side === 'left' ? height - frameHeight - height * 0.04 : height * 0.15,
        width: frameWidth,
        height: frameHeight,
      },
    }
  }
  return {
    width, height,
    left: rail('left', leftWidth),
    right: rail('right', width - rightX),
    animate: Math.max(leftWidth, width - rightX) >= 36,
  }
}
