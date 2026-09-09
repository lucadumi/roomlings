import { orderIllustrationFaces } from './illustrationDepth.ts'
import type { IllustrationFace, Point } from './illustrationDepth.ts'
import { roomAccents, roomPresets } from '../roomStyles.ts'

const palette = roomPresets.original.colors
const face = (fill: string, points: Point[], opacity?: number): IllustrationFace => ({ points, fill, opacity })

function box({ x, y = 0, z, w, h, d, top, front, side }: {
  x: number; y?: number; z: number; w: number; h: number; d: number; top: string; front: string; side: string
}): IllustrationFace[] {
  return [
    face(side, [[x + w, y, z], [x + w, y, z + d], [x + w, y + h, z + d], [x + w, y + h, z]]),
    face(front, [[x, y, z + d], [x + w, y, z + d], [x + w, y + h, z + d], [x, y + h, z + d]]),
    face(top, [[x, y + h, z], [x + w, y + h, z], [x + w, y + h, z + d], [x, y + h, z + d]]),
  ]
}

function shadow(x: number, z: number, w: number, d: number): IllustrationFace {
  return face('#57664a', Array.from({ length: 12 }, (_, index): Point => {
    const angle = index / 12 * Math.PI * 2
    return [x + Math.cos(angle) * w / 2, 0.015, z + Math.sin(angle) * d / 2]
  }), 0.13)
}

function plant(x: number, z: number, size = 1): IllustrationFace[] {
  const center: Point = [x + size * 0.22, size * 0.48, z + size * 0.22]
  return [
    ...box({ x, z, w: size * 0.44, d: size * 0.44, h: size * 0.5, top: '#765942', front: roomAccents.terracotta, side: '#b65935' }),
    ...[[-0.5, 1.2, 0.1], [0.4, 1.4, -0.2], [0.12, 1.75, 0.1], [-0.15, 1.25, 0.65], [0.6, 1.05, 0.35]].map(([dx, dy, dz], index) =>
      face([roomAccents.leaf, roomAccents.leafLight, roomAccents.leafDark, '#92bca1', '#c2d9c8'][index], [
        center, [center[0] + dx * size * 0.35, dy * size * 0.75, center[2] + dz * size * 0.2],
        [center[0] + dx * size, dy * size, center[2] + dz * size],
        [center[0] + dx * size * 0.7 + size * 0.12, dy * size * 0.6, center[2] + dz * size * 0.7],
      ]),
    ),
  ]
}

export const homeGround: IllustrationFace[] = [
  ...box({ x: 0, y: -0.26, z: 0, w: 8, h: 0.26, d: 6, top: '#e0c49d', front: '#c4a27b', side: '#b8946d' }),
  face('#eee6d2', [[0, 0.01, 0], [4.6, 0.01, 0], [4.6, 0.01, 6], [0, 0.01, 6]]),
  ...Array.from({ length: 7 }, (_, x) => Array.from({ length: 9 }, (_, z) => face((x + z) % 2 ? palette.floorAlternate : palette.floor, [
    [x * 0.64 + 0.06, 0.02, z * 0.65 + 0.06], [x * 0.64 + 0.69, 0.02, z * 0.65 + 0.06],
    [x * 0.64 + 0.69, 0.02, z * 0.65 + 0.7], [x * 0.64 + 0.06, 0.02, z * 0.65 + 0.7],
  ]))).flat(),
  ...Array.from({ length: 8 }, (_, index) => face(index % 2 ? '#d9b688' : '#e2c296', [
    [4.6 + index * 0.42, 0.025, 2.5], [5.01 + index * 0.42, 0.025, 2.5],
    [5.01 + index * 0.42, 0.025, 6], [4.6 + index * 0.42, 0.025, 6],
  ])),
  face('#d1dfd1', [[4.6, 0.03, 0], [8, 0.03, 0], [8, 0.03, 2.5], [4.6, 0.03, 2.5]]),
  face('#f6edd0', [[4.72, 0.04, 3.04], [7.83, 0.04, 3.04], [7.83, 0.04, 5.68], [4.72, 0.04, 5.68]]),
  ...[3.13, 5.47].map((z) => face('#c48b65', [[4.84, 0.045, z], [7.7, 0.045, z], [7.7, 0.045, z + 0.085], [4.84, 0.045, z + 0.085]])),
  face('#fff5d7', [[0.35, 0.04, 3.13], [1.86, 0.04, 2.54], [2.7, 0.04, 4.35], [0.35, 0.04, 5.34]], 0.48),
  shadow(2.6, 1.04, 3.8, 1.6), shadow(6.4, 1.25, 2.8, 1.55), shadow(7.09, 4.36, 1.75, 2.7),
  shadow(5.6, 4.5, 1.55, 1.3), shadow(2.8, 4.3, 2.9, 2.15),
  shadow(7.59, 2.33, 0.7, 0.49), shadow(1.058, 5.478, 0.92, 0.644),
]

export const homeSurfaces: IllustrationFace[] = [
  ...box({ x: 0, z: 0, w: 8, h: 3.25, d: 0.16, top: '#fff5df', front: palette.wall, side: palette.trim }),
  ...box({ x: 0, z: 0, w: 0.16, h: 3.25, d: 6, top: '#fff5df', front: '#e8d1a2', side: palette.wall }),
  ...box({ x: 0.16, z: 0.16, w: 7.84, h: 0.14, d: 0.07, top: '#d4c6a7', front: '#c6b895', side: '#bfad89' }),
  ...box({ x: 0.16, z: 0.16, w: 0.07, h: 0.14, d: 5.84, top: '#d4c6a7', front: '#c6b895', side: '#d8c9a9' }),
  face('#bf9c6f', [[0.18, 1.35, 3.05], [0.18, 2.8, 3.05], [0.18, 2.8, 5.32], [0.18, 1.35, 5.32]]),
  face(roomAccents.sky, [[0.19, 1.5, 3.2], [0.19, 2.66, 3.2], [0.19, 2.66, 5.17], [0.19, 1.5, 5.17]]),
  face('#bfe8dd', [[0.2, 1.5, 3.2], [0.2, 1.9, 3.2], [0.2, 2.15, 4.4], [0.2, 1.65, 5.17], [0.2, 1.5, 5.17]]),
  ...box({ x: 0.19, y: 1.45, z: 4.13, w: 0.055, h: 1.25, d: 0.06, top: '#fff3d9', front: '#f5ebd4', side: '#f5ebd4' }),
  ...box({ x: 0.19, y: 2.02, z: 3.17, w: 0.06, h: 0.06, d: 2.02, top: '#fff3d9', front: '#f5ebd4', side: '#f5ebd4' }),
  ...box({ x: 0.18, y: 1.34, z: 3.02, w: 0.27, h: 0.08, d: 2.35, top: '#f4e8ce', front: '#d7c6a6', side: '#e6d6b6' }),
  ...box({ x: 0.7, z: 0.25, w: 3.28, h: 1.08, d: 0.94, top: palette.cabinetPanel, front: palette.cabinet, side: '#496e5d' }),
  ...[0.84, 1.87, 2.9].flatMap((x) => [
    face(palette.cabinetPanel, [[x, 0.14, 1.2], [x + 0.9, 0.14, 1.2], [x + 0.9, 0.91, 1.2], [x, 0.91, 1.2]]),
    ...box({ x: x + 0.64, y: 0.74, z: 1.21, w: 0.16, h: 0.045, d: 0.04, top: '#eadbbd', front: '#f1e6cc', side: '#d5c6a7' }),
  ]),
  ...box({ x: 0.63, y: 1.08, z: 0.2, w: 3.43, h: 0.12, d: 1.06, top: '#f4ecdb', front: '#ded2b9', side: '#d5c6ac' }),
  face('#728577', [[2.7, 1.205, 0.37], [3.68, 1.205, 0.37], [3.68, 1.205, 0.96], [2.7, 1.205, 0.96]]),
  face('#b2c0ad', [[2.84, 1.21, 0.47], [3.54, 1.21, 0.47], [3.54, 1.21, 0.86], [2.84, 1.21, 0.86]]),
  ...box({ x: 3.12, y: 1.2, z: 0.32, w: 0.055, h: 0.34, d: 0.055, top: '#d6d9c9', front: '#99a997', side: '#849a87' }),
  ...box({ x: 3.12, y: 1.49, z: 0.32, w: 0.055, h: 0.055, d: 0.25, top: '#e4e6d8', front: '#99a997', side: '#849a87' }),
  ...box({ x: 1.01, y: 1.2, z: 0.48, w: 0.45, h: 0.4, d: 0.4, top: '#dfa080', front: roomAccents.tomato, side: roomAccents.tomatoDark }),
  ...box({ x: 1.04, y: 1.59, z: 0.51, w: 0.38, h: 0.05, d: 0.34, top: '#d6a779', front: '#9f6e45', side: '#886040' }),
  ...box({ x: 1.69, y: 1.2, z: 0.65, w: 0.28, h: 0.26, d: 0.26, top: '#efe3c8', front: '#d5b57c', side: '#b69b6a' }),
  ...box({ x: 0.32, z: 1.43, w: 1.11, h: 2.27, d: 0.96, top: palette.fridgeDoor, front: palette.fridge, side: palette.fridgeEdge }),
  ...box({ x: 0.35, y: 0.18, z: 2.4, w: 1.04, h: 1.32, d: 0.065, top: '#c8dfd0', front: palette.fridgeDoor, side: palette.fridgeEdge }),
  ...box({ x: 0.35, y: 1.55, z: 2.4, w: 1.04, h: 0.66, d: 0.065, top: '#c8dfd0', front: palette.fridgeDoor, side: palette.fridgeEdge }),
  ...box({ x: 1.2, y: 0.94, z: 2.48, w: 0.065, h: 0.42, d: 0.065, top: '#f5edd9', front: '#e4dfc9', side: '#b6bea7' }),
  ...box({ x: 1.2, y: 1.62, z: 2.48, w: 0.065, h: 0.31, d: 0.065, top: '#f5edd9', front: '#e4dfc9', side: '#b6bea7' }),
  face('#f8eecd', [[0.57, 1.71, 2.475], [0.89, 1.73, 2.475], [0.9, 2.04, 2.475], [0.58, 2.02, 2.475]]),
  ...box({ x: 0.7, y: 2.04, z: 2.48, w: 0.08, h: 0.06, d: 0.018, top: roomAccents.tomato, front: roomAccents.tomato, side: roomAccents.tomatoDark }),
  face('#a5b99e', [[5.25, 1.54, 0.17], [7.45, 1.54, 0.17], [7.45, 2.7, 0.17], [5.25, 2.7, 0.17]]),
  face('#d1ddd0', [[5.39, 1.66, 0.18], [7.3, 1.66, 0.18], [7.3, 2.58, 0.18], [5.39, 2.58, 0.18]]),
  face('#e4ebdc', [[5.39, 1.66, 0.185], [6.19, 1.66, 0.185], [7.12, 2.58, 0.185], [6.3, 2.58, 0.185]]),
  ...box({ x: 5.25, y: 0.1, z: 0.5, w: 2.35, h: 0.69, d: 1.22, top: '#f8f5e9', front: '#e9e9db', side: '#c6d1c2' }),
  face(roomAccents.water, [[5.45, 0.795, 0.7], [7.36, 0.795, 0.7], [7.36, 0.795, 1.5], [5.45, 0.795, 1.5]]),
  face('#b8e6dd', [[5.56, 0.8, 0.82], [7.25, 0.8, 0.82], [7.25, 0.8, 1.38], [5.56, 0.8, 1.38]]),
  ...box({ x: 7.05, y: 0.79, z: 0.59, w: 0.07, h: 0.27, d: 0.07, top: '#eef0e7', front: '#94a89b', side: '#6c8779' }),
  ...box({ x: 7.05, y: 1, z: 0.59, w: 0.07, h: 0.06, d: 0.26, top: '#eef0e7', front: '#94a89b', side: '#6c8779' }),
  ...box({ x: 4.6, z: 0.16, w: 0.16, h: 1.76, d: 2.44, top: '#f7ecd6', front: '#d9c6a2', side: '#e9ddc0' }),
  face(roomAccents.tomato, [[4.77, 1.07, 0.69], [4.77, 1.72, 0.69], [4.77, 1.72, 1.26], [4.77, 1.02, 1.26]]),
  ...box({ x: 4.73, y: 1.72, z: 0.64, w: 0.1, h: 0.055, d: 0.69, top: '#c7a57a', front: '#a88659', side: '#a88659' }),
  ...plant(7.31, 2.05, 0.7),
  ...box({ x: 6.64, y: 0.15, z: 3.1, w: 1.1, h: 0.38, d: 2.35, top: roomAccents.blue, front: '#656b89', side: roomAccents.ink }),
  ...box({ x: 7.48, y: 0.51, z: 3.1, w: 0.26, h: 0.73, d: 2.35, top: '#b0b7cb', front: '#8c96b0', side: '#65728d' }),
  ...[3.28, 4.29].flatMap((z) => box({ x: 6.68, y: 0.53, z, w: 0.76, h: 0.19, d: 0.94, top: '#c7cedd', front: '#a8b3c8', side: '#828da9' })),
  ...[3.09, 5.28].flatMap((z) => box({ x: 6.59, y: 0.53, z, w: 1.18, h: 0.48, d: 0.2, top: '#b5bed1', front: '#9aa6bf', side: '#7280a0' })),
  ...box({ x: 7.01, y: 0.73, z: 3.48, w: 0.38, h: 0.34, d: 0.39, top: '#ebb59b', front: roomAccents.tomato, side: roomAccents.tomatoDark }),
  ...[5.05, 6.04].flatMap((x) => [3.98, 4.78].flatMap((z) => box({ x, z, w: 0.1, h: 0.7, d: 0.1, top: '#b17e51', front: '#ac7d52', side: '#90663f' }))),
  ...box({ x: 4.92, y: 0.7, z: 3.86, w: 1.35, h: 0.12, d: 1.12, top: '#d7b27c', front: '#b98c56', side: '#a67a4b' }),
  ...box({ x: 5.2, y: 0.83, z: 4.05, w: 0.59, h: 0.07, d: 0.45, top: roomAccents.tomato, front: roomAccents.tomatoDark, side: '#eee3c9' }),
  face('#f5ead0', [[5.23, 0.905, 4.1], [5.71, 0.905, 4.1], [5.71, 0.905, 4.43], [5.23, 0.905, 4.43]]),
  ...[1.95, 3.68].flatMap((x) => [3.25, 4.47].flatMap((z) => box({ x, z, w: 0.12, h: 1.08, d: 0.12, top: '#c69b68', front: '#af8050', side: '#906741' }))),
  ...box({ x: 1.75, y: 1.08, z: 3.02, w: 2.25, h: 0.14, d: 1.65, top: '#e2c496', front: '#c59f70', side: '#b48b5d' }),
  ...box({ x: 2.14, y: 1.225, z: 3.36, w: 0.5, h: 0.09, d: 0.69, top: '#f5edda', front: '#dbd0b8', side: '#c4b596' }),
  face(roomAccents.tomato, [[2.21, 1.32, 3.44], [2.57, 1.32, 3.44], [2.57, 1.32, 3.49], [2.21, 1.32, 3.49]]),
  face('#b8bf9e', [[2.21, 1.32, 3.59], [2.57, 1.32, 3.59], [2.57, 1.32, 3.63], [2.21, 1.32, 3.63]]),
  ...box({ x: 3.15, y: 1.22, z: 3.48, w: 0.27, h: 0.3, d: 0.27, top: '#f0e9d4', front: '#bb7354', side: '#a05d42' }),
  ...box({ x: 2.46, y: 0.12, z: 5.14, w: 0.54, h: 0.58, d: 0.13, top: '#b99565', front: '#b99565', side: '#8e7049' }),
  ...box({ x: 2.44, y: 0.7, z: 4.94, w: 0.72, h: 0.15, d: 0.67, top: roomAccents.gold, front: '#c6a25e', side: '#a98c53' }),
  ...plant(0.69, 5.11, 0.92),
]

export const orderedHomeSurfaces = orderIllustrationFaces(homeSurfaces)
