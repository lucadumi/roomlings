import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homeGround, homeSurfaces, orderedHomeSurfaces } from '../src/landing/homeGeometry.ts'
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

test('the home illustration has correct occlusion across the original furniture and walls', () => {
  let samples = 0
  let originalLayerErrors = 0
  for (let x = 195.37; x < 835; x += 17) for (let y = 94.59; y < 610; y += 17) {
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
  assert.ok(samples > 300)
  assert.ok(originalLayerErrors > 0, 'The scenario must include the original layering defects.')
  assert.ok(orderedHomeSurfaces.length < 1500, 'Keep the static SVG lightweight.')
  assert.ok(homeGround.every((face) => face.points.every(([, y]) => y <= 0.045)))
})

test('invalid illustration points fail explicitly', () => {
  assert.throws(() => orderIllustrationFaces([{ fill: 'red', points: [] }]), /three finite points/)
  assert.throws(() => orderIllustrationFaces([{ fill: 'red', points: [[NaN, 0, 0], [1, 0, 0], [0, 1, 0]] }]), /finite points/)
})
