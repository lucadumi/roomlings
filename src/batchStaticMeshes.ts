import { BufferGeometry, InstancedMesh, Mesh, Object3D, SkinnedMesh } from 'three'
import type { Material } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export function batchStaticMeshes(root: Object3D, preserved: ReadonlySet<Object3D>): void {
  const retired = new Set<BufferGeometry>()

  const visit = (parent: Object3D) => {
    for (const child of [...parent.children]) visit(child)
    const batches = new Map<string, Mesh<BufferGeometry, Material>[]>()
    for (const child of parent.children) {
      if (!(child instanceof Mesh) || child instanceof InstancedMesh || child instanceof SkinnedMesh
        || preserved.has(child) || !child.visible || child.children.length
        || Array.isArray(child.material) || child.material.transparent || child.material.opacity !== 1
        || !child.material.depthWrite || Object.keys(child.userData).length
        || Object.keys(child.geometry.morphAttributes).length
        || child.geometry.drawRange.start !== 0 || child.geometry.drawRange.count !== Infinity) continue
      const sourceGeometry: BufferGeometry = child.geometry
      const attributes = Object.entries(sourceGeometry.attributes).map(([name, attribute]) =>
        `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`,
      ).sort().join(',')
      const key = [
        child.material.uuid, child.castShadow, child.receiveShadow, child.renderOrder,
        child.frustumCulled, child.layers.mask, attributes,
      ].join('|')
      const batch = batches.get(key)
      if (batch) batch.push(child)
      else batches.set(key, [child])
    }
    for (const meshes of batches.values()) {
      if (meshes.length < 2) continue
      const geometries = meshes.map((mesh) => {
        if (mesh.matrixAutoUpdate) mesh.updateMatrix()
        const clone = mesh.geometry.clone()
        const geometry = clone.index ? clone.toNonIndexed() : clone
        if (geometry !== clone) clone.dispose()
        return geometry.applyMatrix4(mesh.matrix)
      })
      let geometry: BufferGeometry | null
      try {
        geometry = mergeGeometries(geometries)
      } finally {
        geometries.forEach((part) => part.dispose())
      }
      if (!geometry) throw new Error('Static room geometry could not be combined.')
      geometry.computeBoundingSphere()
      const first = meshes[0]
      const combined = new Mesh(geometry, first.material)
      combined.name = 'Static room details'
      combined.castShadow = first.castShadow
      combined.receiveShadow = first.receiveShadow
      combined.renderOrder = first.renderOrder
      combined.frustumCulled = first.frustumCulled
      combined.layers.mask = first.layers.mask
      for (const mesh of meshes) {
        parent.remove(mesh)
        retired.add(mesh.geometry)
      }
      parent.add(combined)
    }
  }

  // Group boundaries retain their animation transforms and object-picking metadata.
  visit(root)
  const retained = new Set<BufferGeometry>()
  root.traverse((object) => { if (object instanceof Mesh) retained.add(object.geometry) })
  for (const geometry of retired) if (!retained.has(geometry)) geometry.dispose()
}
