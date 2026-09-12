import { BoxGeometry, BufferGeometry, Float32BufferAttribute, LatheGeometry, TorusGeometry, Vector2 } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

type Size = readonly [number, number, number]
type RoundedRing = readonly [width: number, depth: number, y: number, radius: number]
const fullTurn = Math.PI * 2

export function createRoomBoxGeometry(size: Size, radius = 0): BoxGeometry {
  if (!size.every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(radius) || radius < 0) {
    throw new RangeError('Room boxes need positive dimensions and a non-negative corner radius.')
  }
  if (radius === 0) return new BoxGeometry(...size)
  const limit = Math.min(...size) / 2
  const originalRadius = Math.min(radius, limit)
  // Leave thin trim and paper details alone; spend extra geometry on visible curves.
  if (originalRadius < 0.012) return new RoundedBoxGeometry(...size, 1, originalRadius)
  const roundedRadius = Math.min(originalRadius * 1.6, limit)
  return new RoundedBoxGeometry(...size, roundedRadius >= 0.04 ? 3 : 2, roundedRadius)
}

export function roomRadialSegments(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Room curves need a positive radius.')
  return radius < 0.12 ? 16 : radius < 0.35 ? 24 : 32
}

export function createRoomTorusGeometry(radius: number, tube: number, arc = fullTurn): TorusGeometry {
  if (!Number.isFinite(tube) || tube <= 0 || !Number.isFinite(arc) || arc <= 0 || arc > fullTurn) {
    throw new RangeError('Room rings need a positive tube radius and an arc within one full turn.')
  }
  return new TorusGeometry(radius, tube, 8, Math.max(16, Math.ceil(roomRadialSegments(radius) * arc / fullTurn)), arc)
}

export function createRoomCupGeometry(bottom: number, top: number, height: number, wall: number): LatheGeometry {
  if (![bottom, top, height, wall].every((value) => Number.isFinite(value) && value > 0)
    || wall >= Math.min(bottom, top, height) / 2) {
    throw new RangeError('Room vessels need positive dimensions and a wall thinner than their cavity.')
  }
  return new LatheGeometry([
    [0, 0], [bottom, 0], [top, height], [top - wall, height],
    [bottom - wall, wall], [0, wall],
  ].map(([x, y]) => new Vector2(x, y)), roomRadialSegments(Math.max(bottom, top)))
}

export function createRoomBasinGeometry([width, height, depth]: Size, wall: number): BufferGeometry {
  if (![width, height, depth, wall].every((value) => Number.isFinite(value) && value > 0)
    || wall >= Math.min(width, height, depth) / 4) {
    throw new RangeError('Room basins need positive dimensions and walls thinner than their cavity.')
  }
  const rim = Math.min(width, depth) / 8
  const bevel = Math.min(wall / 2, rim / 4)
  const radius = Math.min(width, depth) * 0.11
  const profile = [
    [width - rim * 2.1, depth - rim * 2.1, 0],
    [width - rim * 1.6, depth - rim * 1.6, height - wall * 1.5],
    [width - bevel * 2, depth - bevel * 2, height - wall],
    [width, depth, height - bevel],
    [width - bevel * 2, depth - bevel * 2, height],
    [width - rim * 2, depth - rim * 2, height],
    [width - rim * 2.2, depth - rim * 2.2, height - bevel],
    [width - rim * 2.1 - wall, depth - rim * 2.1 - wall, wall + bevel],
    [width - rim * 2.1 - wall * 2, depth - rim * 2.1 - wall * 2, wall],
  ]
  return roundedProfileGeometry(profile.map<RoundedRing>(([w, d, y]) => [w, d, y, radius]), [4, 5])
}

export function createRoomLoafGeometry([width, height, depth]: Size): BufferGeometry {
  if (![width, height, depth].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Room loaves need positive dimensions.')
  }
  const curve = Math.min(width, depth)
  const edge = curve * 0.05
  return roundedProfileGeometry([
    [width - edge * 2, depth - edge * 2, 0, edge],
    [width, depth, height * 0.08, edge * 1.5],
    [width, depth, height * 0.36, curve * 0.125],
    [width * 0.97, depth * 0.96, height * 0.64, curve * 0.23],
    [width * 0.86, depth * 0.79, height * 0.88, curve * 0.3],
    [width * 0.7, depth * 0.54, height, curve * 0.24],
  ])
}

function roundedProfileGeometry(profile: readonly RoundedRing[], flatTops: readonly number[] = []): BufferGeometry {
  const width = Math.max(...profile.map(([w]) => w))
  const depth = Math.max(...profile.map(([, d]) => d))
  const cornerSteps = 6
  const ringSize = (cornerSteps + 1) * 4
  const positions: number[] = []
  const normals: number[] = []
  const uv: number[] = []
  const indices: number[] = []
  for (const [ring, [w, d, y, radius]] of profile.entries()) {
    const r = Math.min(radius, w / 2, d / 2)
    for (let corner = 0; corner < 4; corner++) {
      const sx = corner < 2 ? 1 : -1
      const sz = corner === 0 || corner === 3 ? -1 : 1
      const cx = sx * (w / 2 - r)
      const cz = sz * (d / 2 - r)
      for (let step = 0; step <= cornerSteps; step++) {
        const angle = -Math.PI / 2 + (corner + step / cornerSteps) * Math.PI / 2
        const nx = Math.cos(angle)
        const nz = Math.sin(angle)
        const x = cx + nx * r
        const z = cz + nz * r
        positions.push(x, y, z)
        uv.push(x / width + 0.5, z / depth + 0.5)
        if (ring === profile.length - 1 || flatTops.includes(ring)) {
          normals.push(0, 1, 0)
        } else {
          let radial = 0
          let vertical = 0
          for (const from of [ring - 1, ring]) {
            if (from < 0) continue
            const [w0, d0, y0, radius0] = profile[from]
            const [w1, d1, y1, radius1] = profile[from + 1]
            const dr = Math.min(radius1, w1 / 2, d1 / 2) - Math.min(radius0, w0 / 2, d0 / 2)
            const dx = (w1 - w0) / 2 * sx + dr * (nx - sx)
            const dz = (d1 - d0) / 2 * sz + dr * (nz - sz)
            const outward = dx * nx + dz * nz
            const length = Math.hypot(y1 - y0, outward)
            radial += (y1 - y0) / length
            vertical -= outward / length
          }
          const length = Math.hypot(radial, vertical)
          normals.push(nx * radial / length, vertical / length, nz * radial / length)
        }
      }
    }
  }
  // Shared rings keep the rounded shell continuous.
  for (let ring = 0; ring < profile.length - 1; ring++) for (let point = 0; point < ringSize; point++) {
    const a = ring * ringSize + point
    const b = ring * ringSize + (point + 1) % ringSize
    const c = a + ringSize
    const d = b + ringSize
    indices.push(a, c, b, b, c, d)
  }
  for (const [ring, inside] of [[0, false], [profile.length - 1, true]] as const) {
    let start = ring * ringSize
    if (!inside) {
      start = positions.length / 3
      for (let point = 0; point < ringSize; point++) {
        const index = ring * ringSize + point
        positions.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2])
        normals.push(0, -1, 0)
        uv.push(uv[index * 2], uv[index * 2 + 1])
      }
    }
    const center = positions.length / 3
    positions.push(0, profile[ring][2], 0)
    normals.push(0, inside ? 1 : -1, 0)
    uv.push(0.5, 0.5)
    for (let point = 0; point < ringSize; point++) {
      const a = start + point
      const b = start + (point + 1) % ringSize
      indices.push(center, inside ? b : a, inside ? a : b)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  // Profile normals avoid triangle-weighted corner blotches and keep flat surfaces flat.
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  return geometry
}
