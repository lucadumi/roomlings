export type Point = readonly [number, number, number]
export type IllustrationFace = { points: Point[]; fill: string; opacity?: number }
export type OrderedFace = IllustrationFace & { source: number }

const epsilon = 1e-7
const view: Point = [1, 23 / 30, 1]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
]

export function projectIllustration([x, y, z]: Point): [number, number] {
  return [466 + (x - z) * 46, 285 + (x + z) * 23 - y * 60]
}

function plane(points: Point[]) {
  for (let index = 1; index < points.length - 1; index++) {
    const normal = cross(subtract(points[index], points[0]), subtract(points[index + 1], points[0]))
    const length = Math.hypot(...normal)
    if (length <= epsilon) continue
    const unit: Point = [normal[0] / length, normal[1] / length, normal[2] / length]
    return { normal: unit, offset: dot(unit, points[0]) }
  }
  return null
}

function projectedArea(points: Point[]) {
  const projected = points.map(projectIllustration)
  return Math.abs(projected.reduce((area, point, index) => {
    const next = projected[(index + 1) % projected.length]
    return area + point[0] * next[1] - next[0] * point[1]
  }, 0)) / 2
}

function clean(points: Point[]) {
  return points.filter((point, index) =>
    Math.hypot(...subtract(point, points[(index + points.length - 1) % points.length])) > epsilon,
  )
}

function partition(faces: OrderedFace[]): OrderedFace[] {
  if (!faces.length) return []
  const splitter = faces.reduce((largest, face) => projectedArea(face.points) > projectedArea(largest.points) ? face : largest)
  const boundary = plane(splitter.points)
  if (!boundary) throw new Error('The illustration contains a face without a plane.')
  const front: OrderedFace[] = []
  const back: OrderedFace[] = []
  const coplanar: OrderedFace[] = []
  for (const face of faces) {
    const distances = face.points.map((point) => dot(boundary.normal, point) - boundary.offset)
    const positive = distances.some((distance) => distance > epsilon)
    const negative = distances.some((distance) => distance < -epsilon)
    if (!positive && !negative) { coplanar.push(face); continue }
    if (!negative) { front.push(face); continue }
    if (!positive) { back.push(face); continue }
    const near: Point[] = []
    const far: Point[] = []
    for (let index = 0; index < face.points.length; index++) {
      const point = face.points[index]
      const distance = distances[index]
      const nextIndex = (index + 1) % face.points.length
      const nextDistance = distances[nextIndex]
      if (distance >= -epsilon) near.push(point)
      if (distance <= epsilon) far.push(point)
      if ((distance > epsilon && nextDistance < -epsilon) || (distance < -epsilon && nextDistance > epsilon)) {
        const next = face.points[nextIndex]
        const t = distance / (distance - nextDistance)
        const intersection: Point = [
          point[0] + (next[0] - point[0]) * t,
          point[1] + (next[1] - point[1]) * t,
          point[2] + (next[2] - point[2]) * t,
        ]
        near.push(intersection)
        far.push(intersection)
      }
    }
    for (const [points, side] of [[near, front], [far, back]] as const) {
      const clipped = clean(points)
      if (clipped.length >= 3 && projectedArea(clipped) > epsilon && plane(clipped)) side.push({ ...face, points: clipped })
    }
  }
  const facing = dot(boundary.normal, view) > 0
  return [
    ...partition(facing ? back : front),
    ...coplanar.sort((a, b) => a.source - b.source),
    ...partition(facing ? front : back),
  ]
}

export function orderIllustrationFaces(faces: IllustrationFace[]): OrderedFace[] {
  const planar = faces.flatMap((face, source): OrderedFace[] => {
    if (face.points.length < 3 || face.points.some((point) => !point.every(Number.isFinite))) {
      throw new Error('Illustration faces need at least three finite points.')
    }
    const boundary = plane(face.points)
    if (!boundary) return []
    const flat = face.points.every((point) => Math.abs(dot(boundary.normal, point) - boundary.offset) <= epsilon)
    const parts = flat ? [face.points] : face.points.slice(1, -1).map((point, index) => [face.points[0], point, face.points[index + 2]])
    return parts.filter((points) => projectedArea(points) > epsilon).map((points) => ({ ...face, points, source }))
  })
  // Splitting crossing planes avoids the overlaps left by sorting whole objects or face centers.
  return partition(planar)
}
