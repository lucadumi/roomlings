import { orderIllustrationFaces } from './illustrationDepth.ts'
import type { IllustrationFace, Point } from './illustrationDepth.ts'
import { roomAccents, roomPresets } from '../roomStyles.ts'

const palette = roomPresets.original.colors
export const homeFootprint = { width: 11.7, depth: 7.4 }
export const homeViewBox = [112, 76, 908, 714] as const
const face = (fill: string, points: Point[], opacity?: number): IllustrationFace => ({ points, fill, opacity })
const at = (surfaces: IllustrationFace[], x: number, z: number): IllustrationFace[] =>
  surfaces.map((surface) => ({ ...surface, points: surface.points.map(([px, py, pz]): Point => [px + x, py, pz + z]) }))

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

function oval(x: number, y: number, z: number, rx: number, rz = rx): Point[] {
  return Array.from({ length: 8 }, (_, index) => {
    const angle = index / 8 * Math.PI * 2
    return [x + Math.cos(angle) * rx, y, z + Math.sin(angle) * rz]
  })
}

function cylinder({ x, y, z, r, rz = r, h, top, front, side }: {
  x: number; y: number; z: number; r: number; rz?: number; h: number; top: string; front: string; side: string
}): IllustrationFace[] {
  const base = oval(x, y, z, r, rz)
  const rim = oval(x, y + h, z, r, rz)
  return [
    ...[0, 1, 2, 7].map((index) => {
      const next = (index + 1) % base.length
      return face(index < 4 ? front : side, [base[index], base[next], rim[next], rim[index]])
    }),
    face(top, rim),
  ]
}

function tap(x: number, y: number, z: number, height = 0.34): IllustrationFace[] {
  const metal = { top: '#e4e6d8', front: '#99a997', side: '#849a87' }
  return [
    ...box({ x, y, z, w: 0.055, h: height, d: 0.055, ...metal }),
    ...box({ x, y: y + height - 0.055, z, w: 0.055, h: 0.055, d: 0.25, ...metal }),
  ]
}

function mug(x: number, y: number, z: number): IllustrationFace[] {
  return [
    ...cylinder({ x, y, z, r: 0.14, h: 0.25, top: '#f4e9d0', front: '#bb7354', side: '#a05d42' }),
    face('#705842', oval(x, y + 0.255, z, 0.095)),
    ...[
      [[0.12, 0.17], [0.29, 0.17], [0.29, 0.21], [0.12, 0.21]],
      [[0.24, 0.09], [0.29, 0.09], [0.29, 0.17], [0.24, 0.17]],
      [[0.12, 0.04], [0.25, 0.04], [0.29, 0.09], [0.12, 0.09]],
    ].map((points) => face('#bb7354', points.map(([dx, dy]): Point => [x + dx, y + dy, z]))),
  ]
}

function chair(x: number, z: number, back: 'front' | 'left'): IllustrationFace[] {
  const timber = { top: '#e2c496', front: '#bf9964', side: '#a17b4f' }
  return [
    ...[x + 0.05, x + 0.56].flatMap((legX) => [z + 0.05, z + 0.55].flatMap((legZ) =>
      box({ x: legX, z: legZ, w: 0.075, h: 0.68, d: 0.075, ...timber }),
    )),
    ...box({ x, y: 0.68, z, w: 0.7, h: 0.12, d: 0.68, top: roomAccents.gold, front: '#c6a25e', side: '#a98c53' }),
    ...[0.04, 0.57].flatMap((offset) => box({
      x: back === 'front' ? x + offset : x + 0.02, y: 0.8, z: back === 'front' ? z + 0.58 : z + offset,
      w: 0.065, h: 0.48, d: 0.065, ...timber,
    })),
    ...box({
      x: x + 0.02, y: 1.03, z: back === 'front' ? z + 0.57 : z + 0.02,
      w: back === 'front' ? 0.65 : 0.085, h: 0.26, d: back === 'front' ? 0.085 : 0.63,
      top: '#e4c797', front: '#d6b580', side: '#bb9660',
    }),
  ]
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
  ...box({ x: 0, y: -0.26, z: 0, w: homeFootprint.width, h: 0.26, d: homeFootprint.depth, top: '#e0c49d', front: '#c4a27b', side: '#b8946d' }),
  face('#eee6d2', [[0, 0.01, 0], [5.85, 0.01, 0], [5.85, 0.01, 7.4], [0, 0.01, 7.4]]),
  ...Array.from({ length: 8 }, (_, x) => Array.from({ length: 10 }, (_, z) => face((x + z) % 2 ? palette.floorAlternate : palette.floor, [
    [0.16 + x * 0.71, 0.02, 0.16 + z * 0.72], [0.85 + x * 0.71, 0.02, 0.16 + z * 0.72],
    [0.85 + x * 0.71, 0.02, 0.86 + z * 0.72], [0.16 + x * 0.71, 0.02, 0.86 + z * 0.72],
  ]))).flat(),
  ...Array.from({ length: 12 }, (_, index) => face(index % 2 ? '#d9b688' : '#e2c296', [
    [5.85 + index * 0.485, 0.025, 0.16], [6.325 + index * 0.485, 0.025, 0.16],
    [6.325 + index * 0.485, 0.025, 7.4], [5.85 + index * 0.485, 0.025, 7.4],
  ])),
  face('#bacdbd', [[6.01, 0.03, 0.16], [11.7, 0.03, 0.16], [11.7, 0.03, 3.65], [6.01, 0.03, 3.65]]),
  ...Array.from({ length: 8 }, (_, x) => Array.from({ length: 5 }, (_, z) => face((x + z) % 2 ? '#dce7da' : '#d4e1d5', [
    [6.04 + x * 0.69, 0.035, 0.19 + z * 0.68], [6.7 + x * 0.69, 0.035, 0.19 + z * 0.68],
    [6.7 + x * 0.69, 0.035, 0.84 + z * 0.68], [6.04 + x * 0.69, 0.035, 0.84 + z * 0.68],
  ]))).flat(),
  face('#f0e7d0', [[8.28, 0.04, 1.65], [10.1, 0.04, 1.65], [10.1, 0.04, 2.63], [8.28, 0.04, 2.63]]),
  face('#d9c4a0', [[10.15, 0.04, 3.48], [11.42, 0.04, 3.48], [11.42, 0.04, 3.8], [10.15, 0.04, 3.8]]),
  face('#f6edd0', [[7.45, 0.04, 4.1], [11.22, 0.04, 4.1], [11.22, 0.04, 7.14], [7.45, 0.04, 7.14]]),
  ...[4.22, 6.94].map((z) => face('#c48b65', [[7.58, 0.045, z], [11.09, 0.045, z], [11.09, 0.045, z + 0.085], [7.58, 0.045, z + 0.085]])),
  face('#fff5d7', [[0.35, 0.04, 3.13], [1.86, 0.04, 2.54], [2.7, 0.04, 5.35], [0.35, 0.04, 6.34]], 0.48),
  shadow(3.5, 1.2, 4.2, 1.6), shadow(7.04, 1.52, 1.55, 2.15), shadow(10.76, 1.1, 1, 1.45),
  shadow(9.36, 5.04, 3.15, 1.5), shadow(8.95, 6.47, 1.9, 0.96), shadow(3, 5.3, 2.9, 2.15),
  shadow(11.13, 6.17, 0.7, 0.55), shadow(1.058, 6.58, 0.92, 0.644),
]

const fridge = at([
  ...box({ x: 0, z: 0, w: 1.11, h: 2.27, d: 0.96, top: palette.fridgeDoor, front: palette.fridge, side: palette.fridgeEdge }),
  ...box({ x: 0.03, y: 0.18, z: 0.97, w: 1.04, h: 1.32, d: 0.065, top: '#c8dfd0', front: palette.fridgeDoor, side: palette.fridgeEdge }),
  ...box({ x: 0.03, y: 1.55, z: 0.97, w: 1.04, h: 0.66, d: 0.065, top: '#c8dfd0', front: palette.fridgeDoor, side: palette.fridgeEdge }),
  ...[0.94, 1.62].flatMap((y) => box({ x: 0.88, y, z: 1.05, w: 0.065, h: y < 1 ? 0.42 : 0.31, d: 0.065, top: '#f5edd9', front: '#e4dfc9', side: '#b6bea7' })),
  face('#f8eecd', [[0.25, 1.71, 1.045], [0.57, 1.73, 1.045], [0.58, 2.04, 1.045], [0.26, 2.02, 1.045]]),
  ...box({ x: 0.38, y: 2.04, z: 1.05, w: 0.08, h: 0.06, d: 0.018, top: roomAccents.tomato, front: roomAccents.tomato, side: roomAccents.tomatoDark }),
], 0.45, 0.3)

const counters: IllustrationFace[] = [
  ...box({ x: 1.9, z: 0.3, w: 3.5, h: 1.08, d: 0.94, top: palette.cabinetPanel, front: palette.cabinet, side: '#496e5d' }),
  ...[1.99, 3.1, 4.21].flatMap((x) => [
    face(palette.cabinetPanel, [[x, 0.14, 1.25], [x + 1, 0.14, 1.25], [x + 1, 0.91, 1.25], [x, 0.91, 1.25]]),
    ...box({ x: x + 0.73, y: 0.74, z: 1.26, w: 0.16, h: 0.045, d: 0.04, top: '#eadbbd', front: '#f1e6cc', side: '#d5c6a7' }),
  ]),
  ...box({ x: 4.45, z: 1.24, w: 0.95, h: 1.08, d: 1.76, top: palette.cabinetPanel, front: palette.cabinet, side: '#496e5d' }),
  face(palette.cabinetPanel, [[4.54, 0.14, 3.01], [5.31, 0.14, 3.01], [5.31, 0.91, 3.01], [4.54, 0.91, 3.01]]),
  ...box({ x: 5.04, y: 0.74, z: 3.02, w: 0.16, h: 0.045, d: 0.04, top: '#eadbbd', front: '#f1e6cc', side: '#d5c6a7' }),
  ...box({ x: 1.82, y: 1.08, z: 0.24, w: 3.66, h: 0.12, d: 1.08, top: '#f4ecdb', front: '#ded2b9', side: '#d5c6ac' }),
  ...box({ x: 4.4, y: 1.08, z: 1.32, w: 1.08, h: 0.12, d: 1.75, top: '#f4ecdb', front: '#ded2b9', side: '#d5c6ac' }),
  face('#728577', [[3.77, 1.205, 0.43], [4.75, 1.205, 0.43], [4.75, 1.205, 1.02], [3.77, 1.205, 1.02]]),
  face('#b2c0ad', [[3.91, 1.21, 0.53], [4.61, 1.21, 0.53], [4.61, 1.21, 0.92], [3.91, 1.21, 0.92]]),
  ...tap(4.19, 1.2, 0.37),
  face('#657568', [[4.49, 1.205, 1.51], [5.22, 1.205, 1.51], [5.22, 1.205, 2.75], [4.49, 1.205, 2.75]]),
  ...[1.82, 2.42].flatMap((z) => [
    face('#bbc3ad', oval(4.83, 1.21, z, 0.235)), face('#485c4f', oval(4.83, 1.215, z, 0.17)),
  ]),
  ...cylinder({ x: 4.83, y: 1.22, z: 2.42, r: 0.18, h: 0.29, top: '#e8a384', front: roomAccents.tomato, side: roomAccents.tomatoDark }),
  ...cylinder({ x: 4.83, y: 1.51, z: 2.42, r: 0.15, h: 0.035, top: '#e6b68e', front: '#bc8664', side: '#a56e4d' }),
  ...cylinder({ x: 4.83, y: 1.545, z: 2.42, r: 0.042, h: 0.055, top: '#657568', front: '#485c4f', side: '#3e5044' }),
  face('#d27a55', [[4.96, 1.26, 2.42], [5.17, 1.45, 2.42], [5.2, 1.56, 2.42], [5.08, 1.53, 2.42], [4.96, 1.4, 2.42]]),
  ...[
    [[4.67, 1.55], [4.47, 1.51], [4.54, 1.47], [4.67, 1.49]],
    [[4.47, 1.51], [4.5, 1.3], [4.56, 1.35], [4.54, 1.47]],
    [[4.5, 1.3], [4.67, 1.28], [4.67, 1.34], [4.56, 1.35]],
  ].map((points) => face('#526653', points.map(([x, y]): Point => [x, y, 2.42]))),
]

const bath: IllustrationFace[] = [
  ...box({ x: 6.35, y: 0.11, z: 0.43, w: 1.36, h: 0.72, d: 1.95, top: '#f8f5e9', front: '#e9e9db', side: '#c6d1c2' }),
  face('#c6dacf', [[6.5, 0.835, 0.61], [7.55, 0.835, 0.61], [7.55, 0.835, 2.19], [6.5, 0.835, 2.19]]),
  face(roomAccents.water, [[6.57, 0.84, 0.68], [7.48, 0.84, 0.68], [7.48, 0.84, 2.1], [6.57, 0.84, 2.1]]),
  face('#b8e6dd', [[6.63, 0.845, 0.78], [7.42, 0.845, 0.78], [7.42, 0.845, 2.02], [6.63, 0.845, 2.02]]),
  ...tap(6.59, 0.83, 0.49, 0.3),
]

const vanity: IllustrationFace[] = [
  ...box({ x: 8.55, y: 0.1, z: 0.36, w: 1.4, h: 0.89, d: 0.83, top: palette.cabinetPanel, front: palette.cabinet, side: '#496e5d' }),
  ...[8.63, 9.29].flatMap((x) => [
    face(palette.cabinetPanel, [[x, 0.2, 1.2], [x + 0.58, 0.2, 1.2], [x + 0.58, 0.87, 1.2], [x, 0.87, 1.2]]),
    ...box({ x: x + 0.35, y: 0.74, z: 1.21, w: 0.14, h: 0.04, d: 0.035, top: '#eadbbd', front: '#f1e6cc', side: '#d5c6a7' }),
  ]),
  ...box({ x: 8.5, y: 0.99, z: 0.3, w: 1.5, h: 0.12, d: 0.95, top: '#f8f5e9', front: '#e9e9db', side: '#c6d1c2' }),
  ...cylinder({ x: 9.25, y: 1.11, z: 0.8, r: 0.43, rz: 0.3, h: 0.16, top: '#fffbed', front: '#e9e9db', side: '#c6d1c2' }),
  face('#b7cdc0', oval(9.25, 1.275, 0.8, 0.33, 0.21)),
  face('#d9e5d8', oval(9.25, 1.28, 0.8, 0.24, 0.13)),
  ...tap(9.22, 1.11, 0.41, 0.46),
  ...cylinder({ x: 8.7, y: 1.11, z: 0.81, r: 0.07, h: 0.21, top: '#e8a384', front: roomAccents.tomato, side: roomAccents.tomatoDark }),
  ...box({ x: 8.675, y: 1.32, z: 0.78, w: 0.11, h: 0.035, d: 0.06, top: '#a7b7a3', front: '#869e89', side: '#6c8779' }),
]

const toilet = at([
  ...box({ x: -0.31, y: 0.46, z: -0.59, w: 0.62, h: 0.62, d: 0.28, top: '#faf7eb', front: '#e9e9dc', side: '#c6d1c2' }),
  ...box({ x: -0.33, y: 1.08, z: -0.62, w: 0.66, h: 0.07, d: 0.34, top: '#fffbed', front: '#e1e5d6', side: '#c6d1c2' }),
  ...box({ x: -0.185, y: 0.08, z: -0.24, w: 0.37, h: 0.48, d: 0.56, top: '#f8f5e9', front: '#e9e9db', side: '#c6d1c2' }),
  ...cylinder({ x: 0, y: 0.42, z: 0, r: 0.36, rz: 0.49, h: 0.15, top: '#faf7eb', front: '#e9e9db', side: '#c6d1c2' }),
  face('#b9cbbf', oval(0, 0.575, 0.04, 0.23, 0.3)),
  face('#d7e5d9', oval(0, 0.58, 0.04, 0.15, 0.22)),
  ...box({ x: 0.1, y: 0.94, z: -0.3, w: 0.12, h: 0.04, d: 0.035, top: '#cad3c4', front: '#92a393', side: '#778e7c' }),
], 10.76, 1)

const sofa: IllustrationFace[] = [
  ...[8.22, 10.31].flatMap((x) => [4.58, 5.33].flatMap((z) => box({ x, z, w: 0.12, h: 0.2, d: 0.12, top: '#ac8059', front: '#916c4c', side: '#76573f' }))),
  ...box({ x: 8.08, y: 0.17, z: 4.43, w: 2.52, h: 0.36, d: 1.09, top: roomAccents.blue, front: '#8c96b0', side: '#65728d' }),
  ...box({ x: 8.08, y: 0.53, z: 4.37, w: 2.52, h: 0.74, d: 0.26, top: '#b0b7cb', front: '#9ba7bf', side: '#65728d' }),
  ...[8.3, 9.37].flatMap((x) => box({ x, y: 0.53, z: 4.66, w: 1, h: 0.21, d: 0.72, top: '#c7cedd', front: '#a8b3c8', side: '#828da9' })),
  ...[8.04, 10.42].flatMap((x) => box({ x, y: 0.53, z: 4.35, w: 0.22, h: 0.45, d: 1.2, top: '#b5bed1', front: '#9aa6bf', side: '#7280a0' })),
  face(roomAccents.tomato, [[9.86, 0.75, 4.91], [10.27, 0.75, 4.91], [10.27, 1.12, 4.72], [9.86, 1.12, 4.72]]),
  face('#ebb59b', [[9.86, 1.12, 4.72], [10.27, 1.12, 4.72], [10.27, 1.12, 4.63], [9.86, 1.12, 4.63]]),
  face(roomAccents.tomatoDark, [[10.27, 0.75, 4.91], [10.27, 0.75, 4.82], [10.27, 1.12, 4.63], [10.27, 1.12, 4.72]]),
]

const coffeeTable: IllustrationFace[] = [
  ...[8.26, 9.54].flatMap((x) => [6.12, 6.55].flatMap((z) => box({ x, z, w: 0.09, h: 0.57, d: 0.09, top: '#b17e51', front: '#ac7d52', side: '#90663f' }))),
  ...box({ x: 8.13, y: 0.57, z: 6, w: 1.62, h: 0.1, d: 0.73, top: '#d7b27c', front: '#b98c56', side: '#a67a4b' }),
  ...box({ x: 8.4, y: 0.67, z: 6.17, w: 0.59, h: 0.07, d: 0.39, top: roomAccents.tomato, front: roomAccents.tomatoDark, side: '#eee3c9' }),
  face('#f5ead0', [[8.46, 0.745, 6.22], [8.93, 0.745, 6.22], [8.93, 0.745, 6.51], [8.46, 0.745, 6.51]]),
]

const television: IllustrationFace[] = [
  ...box({ x: 6.01, y: 1.15, z: 5.16, w: 0.1, h: 1.03, d: 1.68, top: '#65716c', front: '#414c48', side: '#414c48' }),
  face('#657d80', [[6.115, 1.24, 5.25], [6.115, 2.09, 5.25], [6.115, 2.09, 6.75], [6.115, 1.24, 6.75]]),
  face('#8ca09a', [[6.12, 1.24, 5.25], [6.12, 1.54, 5.25], [6.12, 2.09, 6.25], [6.12, 2.09, 6.66]]),
]

export const homeFixtures = { fridge, counters, bath, vanity, toilet, sofa, coffeeTable, television }

const partitions: IllustrationFace[] = [
  // Continuous low sections reveal the fixtures and the L-shaped counter without pretending the rooms have no walls.
  ...box({ x: 5.85, z: 0.16, w: 0.16, h: 0.85, d: 3.49, top: '#dfcda7', front: '#d9c6a2', side: '#e9ddc0' }),
  ...box({ x: 6.01, z: 3.49, w: 3.99, h: 0.85, d: 0.16, top: '#dfcda7', front: '#e9ddc0', side: '#d5c3a0' }),
  ...box({ x: 10, z: 3.49, w: 0.15, h: 2.65, d: 0.16, top: '#dfcda7', front: '#e9ddc0', side: '#d5c3a0' }),
  ...box({ x: 10.15, y: 2.25, z: 3.49, w: 1.27, h: 0.4, d: 0.16, top: '#dfcda7', front: '#e9ddc0', side: '#d5c3a0' }),
  ...box({ x: 11.42, z: 3.49, w: 0.12, h: 2.65, d: 0.16, top: '#dfcda7', front: '#e9ddc0', side: '#d5c3a0' }),
  ...box({ x: 11.54, z: 0.16, w: 0.16, h: 0.85, d: 3.49, top: '#dfcda7', front: '#d9c6a2', side: '#e9ddc0' }),
  ...[10.13, 11.37].flatMap((x) => box({ x, z: 3.655, w: 0.08, h: 2.27, d: 0.045, top: '#e5cba0', front: '#c8a473', side: '#b08d60' })),
  ...box({ x: 10.13, y: 2.22, z: 3.655, w: 1.32, h: 0.08, d: 0.045, top: '#e5cba0', front: '#c8a473', side: '#b08d60' }),
  ...box({ x: 5.85, z: 4.88, w: 0.16, h: 2.4, d: 2.52, top: '#dfcda7', front: '#d9c6a2', side: '#e9ddc0' }),
]

export const homeSurfaces: IllustrationFace[] = [
  ...box({ x: 0, z: 0, w: homeFootprint.width, h: 3.25, d: 0.16, top: '#fff5df', front: palette.wall, side: palette.trim }),
  ...box({ x: 0, z: 0, w: 0.16, h: 3.25, d: homeFootprint.depth, top: '#fff5df', front: '#e8d1a2', side: palette.wall }),
  ...box({ x: 0.16, z: 0.16, w: 11.54, h: 0.14, d: 0.07, top: '#d4c6a7', front: '#c6b895', side: '#bfad89' }),
  ...box({ x: 0.16, z: 0.16, w: 0.07, h: 0.14, d: 7.24, top: '#d4c6a7', front: '#c6b895', side: '#d8c9a9' }),
  face('#bf9c6f', [[0.18, 1.35, 3.05], [0.18, 2.8, 3.05], [0.18, 2.8, 5.32], [0.18, 1.35, 5.32]]),
  face(roomAccents.sky, [[0.19, 1.5, 3.2], [0.19, 2.66, 3.2], [0.19, 2.66, 5.17], [0.19, 1.5, 5.17]]),
  face('#bfe8dd', [[0.2, 1.5, 3.2], [0.2, 1.9, 3.2], [0.2, 2.15, 4.4], [0.2, 1.65, 5.17], [0.2, 1.5, 5.17]]),
  ...box({ x: 0.19, y: 1.45, z: 4.13, w: 0.055, h: 1.25, d: 0.06, top: '#fff3d9', front: '#f5ebd4', side: '#f5ebd4' }),
  ...box({ x: 0.19, y: 2.02, z: 3.17, w: 0.06, h: 0.06, d: 2.02, top: '#fff3d9', front: '#f5ebd4', side: '#f5ebd4' }),
  ...box({ x: 0.18, y: 1.34, z: 3.02, w: 0.27, h: 0.08, d: 2.35, top: '#f4e8ce', front: '#d7c6a6', side: '#e6d6b6' }),
  ...partitions,
  face('#d1ddd0', [[6.01, 0.15, 0.17], [11.7, 0.15, 0.17], [11.7, 1.3, 0.17], [6.01, 1.3, 0.17]]),
  ...[0.61, 0.53].map((radius, index) => face(index ? '#d5e6df' : '#bf9c6f',
    oval(0, 0, 0, radius).map(([x, , z]): Point => [9.25 + x, 2.15 + z, 0.18 + index * 0.005]),
  )),
  face('#ecf1e4', [[8.89, 1.89, 0.19], [9.04, 1.79, 0.19], [9.57, 2.42, 0.19], [9.44, 2.53, 0.19]]),
  face(roomAccents.tomato, [[6.67, 1.44, 0.185], [7.25, 1.44, 0.185], [7.25, 2.02, 0.185], [6.67, 2.02, 0.185]]),
  ...box({ x: 6.6, y: 2.02, z: 0.18, w: 0.72, h: 0.045, d: 0.09, top: '#c7a57a', front: '#a88659', side: '#a88659' }),
  face('#edb095', [[6.68, 1.51, 0.19], [7.24, 1.51, 0.19], [7.24, 1.56, 0.19], [6.68, 1.56, 0.19]]),
  ...Object.values(homeFixtures).flat(),
  ...[2.15, 3.88].flatMap((x) => [4.25, 5.47].flatMap((z) => box({ x, z, w: 0.12, h: 1.08, d: 0.12, top: '#c69b68', front: '#af8050', side: '#906741' }))),
  ...box({ x: 1.95, y: 1.08, z: 4.02, w: 2.25, h: 0.14, d: 1.65, top: '#e2c496', front: '#c59f70', side: '#b48b5d' }),
  ...box({ x: 2.34, y: 1.225, z: 4.36, w: 0.5, h: 0.09, d: 0.69, top: '#f5edda', front: '#dbd0b8', side: '#c4b596' }),
  face(roomAccents.tomato, [[2.41, 1.32, 4.44], [2.77, 1.32, 4.44], [2.77, 1.32, 4.49], [2.41, 1.32, 4.49]]),
  face('#b8bf9e', [[2.41, 1.32, 4.59], [2.77, 1.32, 4.59], [2.77, 1.32, 4.63], [2.41, 1.32, 4.63]]),
  ...mug(3.48, 1.22, 4.62),
  ...chair(2.64, 5.97, 'front'), ...chair(1.19, 4.52, 'left'),
  ...plant(0.69, 6.21, 0.92), ...plant(10.95, 5.97, 0.75),
]

export const orderedHomeSurfaces = orderIllustrationFaces(homeSurfaces)
