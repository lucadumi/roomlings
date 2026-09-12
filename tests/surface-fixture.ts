import assert from 'node:assert/strict'
import type { Mesh } from 'three'
import { MeshStandardMaterial, NoColorSpace, SRGBColorSpace } from 'three'
import { roomMaterialSurface } from '../src/surfaceMaterials.ts'

export function meshSurfaceMaterials(mesh: Mesh): MeshStandardMaterial[] {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => {
    assert.ok(material instanceof MeshStandardMaterial)
    return material
  })
}

export function assertRoomSurface(material: MeshStandardMaterial): void {
  const surface = roomMaterialSurface(material)
  assert.ok(surface, `${material.name || 'Room material'} needs a physical surface role`)
  assert.ok(material.roughness >= 0.98, `${material.name || surface} must retain a matte finish`)
  assert.equal(material.flatShading, ['foliage', 'plaster', 'tile', 'light'].includes(surface))
  if (surface === 'wood' || surface === 'fabric') assert.equal(material.map?.colorSpace, SRGBColorSpace)
  else assert.equal(material.map, null)
  if (['rubber', 'glass', 'clear-glass', 'foliage', 'food', 'light'].includes(surface)) {
    assert.equal(material.bumpMap, null)
    assert.equal(material.roughnessMap, null)
  } else {
    assert.equal(material.bumpMap?.colorSpace, NoColorSpace)
    assert.equal(material.bumpMap, material.roughnessMap)
    assert.equal(material.bumpMap?.generateMipmaps, true)
  }
}
