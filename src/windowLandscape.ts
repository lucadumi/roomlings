import { Mesh, Shape, ShapeGeometry } from 'three'
import type { Group, MeshStandardMaterial } from 'three'

type Point = readonly [number, number]
type Cloud = readonly [x: number, y: number, width: number]
type WindowView = {
  left: number; right: number; bottom: number; top: number; z: number; layerDepth?: number
  clouds?: readonly Cloud[]
}
type LandscapeMaterials = { cloud: MeshStandardMaterial; hills: MeshStandardMaterial; trees: MeshStandardMaterial }

export function buildWindowLandscape(parent: Group, view: WindowView, materials: LandscapeMaterials): void {
  const { left, right, bottom, top, z, layerDepth = 0.01, clouds = [[2.32, 1.51, 0.62], [3.41, 1.15, 0.48]] } = view
  if (![left, right, bottom, top, z, layerDepth].every(Number.isFinite)
    || right <= left || top <= bottom || layerDepth <= 0) {
    throw new Error('The window landscape needs finite bounds and positive layer spacing.')
  }
  if (clouds.some(([x, y, width]) => ![x, y, width].every(Number.isFinite) || width <= 0
    || x - width / 2 < 0 || x + width / 2 > 4.2 || y - 0.04 < 0 || y + 0.16 > 1.94)) {
    throw new Error('Window clouds must stay within their artwork bounds.')
  }
  const silhouette = (name: string, points: readonly Point[], depth: number, material: MeshStandardMaterial) => {
    const shape = new Shape()
    // The lounge artwork is fitted to each window, independently of the room geometry.
    points.forEach(([x, y], index) => {
      const horizontal = left + x * (right - left) / 4.2
      const vertical = bottom + y * (top - bottom) / 1.94
      if (index) shape.lineTo(horizontal, vertical)
      else shape.moveTo(horizontal, vertical)
    })
    shape.closePath()
    const mesh = new Mesh(new ShapeGeometry(shape), material)
    mesh.name = name
    mesh.position.z = depth
    parent.add(mesh)
  }
  silhouette('Distant window hills', [[0, 0], [4.2, 0], [4.2, 0.44], [3.47, 0.67],
    [2.75, 0.41], [1.85, 0.69], [1.01, 0.42], [0, 0.61]], z, materials.hills)
  silhouette('Distant window trees', [[0, 0], [4.2, 0], [4.2, 0.21], [3.42, 0.4],
    [2.75, 0.19], [1.83, 0.38], [0.91, 0.15], [0, 0.27]], z + layerDepth, materials.trees)
  for (const [x, y, width] of clouds) {
    silhouette('Distant window cloud', [[x - width / 2, y - 0.04], [x + width / 2, y - 0.04],
      [x + width / 2, y + 0.04], [x + width * 0.18, y + 0.04], [x, y + 0.16],
      [x - width * 0.2, y + 0.06], [x - width / 2, y + 0.05]], z + layerDepth * 0.7, materials.cloud)
  }
}
