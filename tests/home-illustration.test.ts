import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homeFixtures, homeFootprint, homeGround, homeSurfaces, homeViewBox, orderedHomeSurfaces } from '../src/landing/homeGeometry.ts'
import { orderIllustrationFaces, projectIllustration } from '../src/landing/illustrationDepth.ts'
import type { IllustrationFace, Point } from '../src/landing/illustrationDepth.ts'

function depthAt(face: IllustrationFace, x: number, y: number): number | null {
  for (let index = 1; index < face.points.length - 1; index++) {
    const triangle = [face.points[0], face.points[index], face.points[index + 1]]
    const [a, b, c] = triangle.map(projectIllustration)
    const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if (Math.abs(determinant) < 1e-8) continue
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / determinant
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / determinant
    const w = 1 - u - v
    if (Math.min(u, v, w) < -1e-8) continue
    const depths = triangle.map(([px, py, pz]) => px + py * 23 / 30 + pz)
    return u * depths[0] + v * depths[1] + w * depths[2]
  }
  return null
}

function surfaceAt(point: Point): boolean {
  const projected = projectIllustration(point)
  const expectedDepth = point[0] + point[1] * 23 / 30 + point[2]
  return homeSurfaces.some((face) => {
    const depth = depthAt(face, ...projected)
    return depth !== null && Math.abs(depth - expectedDepth) < 1e-7
  })
}

function bounds(surfaces: IllustrationFace[]) {
  const points = surfaces.flatMap((surface) => surface.points)
  return {
    min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))),
  }
}

test('illustration surfaces paint back to front independently of their source order', () => {
  const points: Point[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
  const near: IllustrationFace = { fill: 'near', points: points.map(([x, y, z]) => [x + 2, y + 46 / 30, z + 2]) }
  const far = { fill: 'far', points }
  for (const input of [[near, far], [far, near]]) {
    assert.deepEqual(orderIllustrationFaces(input).map((face) => face.fill), ['far', 'near'])
  }
})

test('crossing faces are split instead of giving an entire object the wrong layer', () => {
  const first: IllustrationFace = { fill: 'first', points: [[0, 0, 0], [0, 3, 0], [0, 3, 3], [0, 0, 3]] }
  const second: IllustrationFace = { fill: 'second', points: [[-1, 0, 1.2], [2, 0, 1.2], [2, 3, 1.2], [-1, 3, 1.2]] }
  const result = orderIllustrationFaces([first, second])
  assert.ok(result.length > 2)
  assert.ok(result.every((face) => face.points.every((point) => point.every(Number.isFinite))))
})

test('subpixel slivers created by clipping do not invalidate the depth ordering', () => {
  const wall: IllustrationFace = { fill: 'wall', points: [[0, 0, 0], [0, 2, 0], [0, 2, 2], [0, 0, 2]] }
  const crossing: IllustrationFace = { fill: 'crossing', points: [[-1, 0.5, 0], [0.0001, 0.5, 1], [-1, 0.5, 2]] }
  assert.deepEqual(orderIllustrationFaces([wall, crossing]).map((face) => face.fill), ['crossing', 'wall'])
})

test('the expanded home illustration has correct occlusion across all rooms and walls', () => {
  let samples = 0
  let originalLayerErrors = 0
  for (let x = homeViewBox[0] + 13.37; x < homeViewBox[0] + homeViewBox[2]; x += 17) for (let y = homeViewBox[1] + 18.59; y < homeViewBox[1] + homeViewBox[3]; y += 17) {
    let nearest: { fill: string; depth: number } | null = null
    let original: string | undefined
    for (const face of homeSurfaces) {
      const depth = depthAt(face, x, y)
      if (depth === null) continue
      original = face.fill
      if (!nearest || depth >= nearest.depth - 1e-8) nearest = { fill: face.fill, depth }
    }
    if (!nearest) continue
    samples++
    if (original !== nearest.fill) originalLayerErrors++
    const painted = orderedHomeSurfaces.filter((face) => depthAt(face, x, y) !== null).at(-1)
    assert.equal(painted?.fill, nearest.fill, `Incorrect foreground at ${x}, ${y}`)
  }
  assert.ok(samples > 600)
  assert.ok(originalLayerErrors > 0, 'The scenario must include the original layering defects.')
  assert.ok(orderedHomeSurfaces.length < 1500, 'Keep the static SVG lightweight.')
  assert.ok(homeGround.every((face) => face.points.every(([, y]) => y <= 0.045)))
})

test('the bathroom has a complete cutaway perimeter and a border-only doorway', () => {
  for (const y of [0.2, 1.1, 2.1]) {
    for (const x of [10.07, 11.47]) assert.ok(surfaceAt([x, y, 3.65]), 'Both doorway jambs must reach the lintel.')
    for (const x of [10.3, 10.8, 11.25]) assert.ok(!surfaceAt([x, y, 3.65]), 'The opening must have neither a wall nor a door leaf.')
  }
  for (const x of [10.3, 10.8, 11.25]) assert.ok(surfaceAt([x, 2.45, 3.65]), 'Keep the lintel above the doorway.')
  for (const x of [6.5, 8.25, 9.75]) {
    assert.ok(surfaceAt([x, 0.6, 3.65]), 'A continuous wall must separate the bath from the living area.')
    assert.ok(!surfaceAt([x, 1.4, 3.65]), 'The near wall must be cut away deliberately to reveal the bathroom.')
  }
  for (const z of [0.4, 1.4, 3.4]) {
    assert.ok(surfaceAt([6.01, 0.6, z]), 'Keep the kitchen-side partition footprint.')
    assert.ok(surfaceAt([11.7, 0.6, z]), 'The exterior return must close the bathroom footprint.')
  }
  assert.ok(!surfaceAt([6.01, 1.4, 1.4]), 'The kitchen-side cut must reveal the right-hand worktop return.')
  assert.ok(!surfaceAt([6.01, 0.6, 4.15]), 'The living area must retain its open connection to the shared passage.')
})

test('the shared passage connects the dining area, living area and bathroom without furniture obstacles', () => {
  const passages = [
    { x: [4.38, 5.75], z: [3.25, 7.1] },
    { x: [5.72, 11.3], z: [3.82, 4.2] },
    { x: [10.25, 11.29], z: [1.7, 4.2] },
    { x: [7.98, 10.25], z: [1.55, 3.3] },
    { x: [7.13, 7.9], z: [4.2, 7.1] },
  ]
  for (const passage of passages) {
    for (const surface of homeSurfaces) {
      const xs = surface.points.map(([x]) => x)
      const ys = surface.points.map(([, y]) => y)
      const zs = surface.points.map(([, , z]) => z)
      const overlaps = Math.max(...ys) > 0.1 && Math.min(...ys) < 2.1
        && Math.max(...xs) > passage.x[0] && Math.min(...xs) < passage.x[1]
        && Math.max(...zs) > passage.z[0] && Math.min(...zs) < passage.z[1]
      assert.ok(!overlaps, `A surface obstructs the shared passage: ${JSON.stringify(surface.points)}`)
    }
  }
})

test('the fridge sits beside a rear cabinet run with a connected right-hand worktop return', () => {
  const fridge = bounds(homeFixtures.fridge)
  const counters = bounds(homeFixtures.counters)
  assert.ok(fridge.max[0] + 0.2 < counters.min[0], 'The fridge must not overlap the cabinet run.')
  assert.ok(Math.abs(fridge.min[2] - counters.min[2]) < 0.1, 'The fridge and cabinets must share the rear wall.')
  assert.ok(fridge.max[2] < 1.45, 'Do not move the fridge out into the kitchen in front of the cabinets.')
  for (const point of [[2.5, 1.2, 0.8], [4.8, 1.2, 1.3], [4.8, 1.2, 2.9]] as Point[]) {
    assert.ok(surfaceAt(point), 'The rear counter and right return must have a continuous worktop.')
  }
  assert.ok(!surfaceAt([3.5, 1.2, 2]), 'Keep the working space inside the L open.')
})

test('the enlarged floorplan keeps full-size fixtures separated in the real rooms arrangement', () => {
  assert.ok(homeFootprint.width * homeFootprint.depth > 8 * 6 * 1.7)
  const bath = bounds(homeFixtures.bath)
  const vanity = bounds(homeFixtures.vanity)
  const toilet = bounds(homeFixtures.toilet)
  assert.ok(vanity.min[0] - bath.max[0] > 0.7, 'The vanity belongs behind the central bathroom floor, not against the tub.')
  assert.ok(toilet.min[0] - vanity.max[0] > 0.35, 'Leave visible floor between the vanity and WC.')
  assert.ok(toilet.min[0] - bath.max[0] > 2.5, 'The WC must be clearly separated from the tub on the opposite side.')
  assert.ok(Math.abs(bath.max[0] - bath.min[0] - 1.36) < 1e-7)
  assert.ok(Math.abs(bath.max[2] - bath.min[2] - 1.95) < 1e-7)
  assert.ok(toilet.max[0] - toilet.min[0] > 0.7)
  const sofa = bounds(homeFixtures.sofa)
  const table = bounds(homeFixtures.coffeeTable)
  const tv = bounds(homeFixtures.television)
  assert.ok(sofa.max[0] - sofa.min[0] >= 2.5, 'Keep the sofa proportions instead of miniaturizing it.')
  assert.ok(table.min[2] > sofa.max[2] + 0.4, 'The coffee table belongs in front of the sofa with leg room.')
  assert.ok(tv.max[0] < table.min[0] && tv.max[0] < sofa.min[0], 'The wall-mounted TV belongs along the left side of the living area.')
})

test('the TV is flush-mounted on a real wall with no console or stand beneath it', () => {
  const screen = bounds(homeFixtures.television)
  assert.ok(screen.min[1] >= 1.15 - 1e-7, 'The TV fixture must contain only the raised screen, without feet or a stand.')
  assert.ok(Math.abs(screen.min[0] - 6.01) < 1e-7, 'Mount the back of the TV directly on the wall.')
  const obstructsSpaceBelow = homeSurfaces.some((surface) => {
    const volume = bounds([surface])
    return volume.max[1] > 0.06 && volume.min[1] < 1.1
      && volume.max[0] > 6.03 && volume.min[0] < 7
      && volume.max[2] > 5.05 && volume.min[2] < 6.95
  })
  assert.ok(!obstructsSpaceBelow, 'No console, tabletop feet or pedestal may remain beneath the TV.')
  for (const y of [screen.min[1] + 0.01, screen.max[1] + 0.05]) {
    for (const z of [screen.min[2] + 0.01, screen.max[2] - 0.01]) {
      assert.ok(surfaceAt([screen.min[0], y, z]), 'The wall must extend behind the whole mounted screen.')
    }
  }
})

test('the cutaway keeps recognizable kitchen, bathroom and living-room fixtures visible', () => {
  const landmarks: { name: string; point: Point; fill: string }[] = [
    { name: 'cooking hob', point: [4.83, 1.215, 1.82], fill: '#485c4f' },
    { name: 'kitchen sink', point: [4.23, 1.21, 0.7], fill: '#b2c0ad' },
    { name: 'bathtub', point: [7.03, 0.845, 1.3], fill: '#b8e6dd' },
    { name: 'vanity basin', point: [9.25, 1.28, 0.8], fill: '#d9e5d8' },
    { name: 'toilet bowl', point: [10.76, 0.58, 1.04], fill: '#d7e5d9' },
    { name: 'sofa seat', point: [8.78, 0.74, 4.92], fill: '#c7cedd' },
    { name: 'TV screen', point: [6.115, 1.95, 5.5], fill: '#657d80' },
    { name: 'clear wall beneath the TV', point: [6.01, 0.9, 6], fill: '#e9ddc0' },
  ]
  for (const { name, point, fill } of landmarks) {
    const projected = projectIllustration(point)
    const foreground = orderedHomeSurfaces.filter((face) => depthAt(face, ...projected) !== null).at(-1)
    assert.equal(foreground?.fill, fill, `The ${name} is obscured by another room.`)
  }
  for (const face of [...homeGround, ...homeSurfaces]) for (const point of face.points) {
    const [x, y] = projectIllustration(point)
    assert.ok(x > homeViewBox[0] && x < homeViewBox[0] + homeViewBox[2] && y > homeViewBox[1] && y < homeViewBox[1] + homeViewBox[3], 'Keep the expanded floorplan inside its measured hero view box.')
  }
})

test('invalid illustration points fail explicitly', () => {
  assert.throws(() => orderIllustrationFaces([{ fill: 'red', points: [] }]), /three finite points/)
  assert.throws(() => orderIllustrationFaces([{ fill: 'red', points: [[NaN, 0, 0], [1, 0, 0], [0, 1, 0]] }]), /finite points/)
})
