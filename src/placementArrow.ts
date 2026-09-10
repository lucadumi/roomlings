import { ExtrudeGeometry, Mesh, MeshStandardMaterial, Shape, Vector3 } from 'three'
import type { Box3, Object3D } from 'three'
import { baseCameraOffset } from './camera.ts'
import { roomAccents } from './roomStyles.ts'

export function createPlacementArrow(room: Object3D) {
  const outline = new Shape()
  outline.moveTo(0, -0.14)
  outline.lineTo(-0.15, 0.12)
  outline.lineTo(0.15, 0.12)
  outline.closePath()
  const geometry = new ExtrudeGeometry(outline, { depth: 0.07, bevelEnabled: false, steps: 1, curveSegments: 1 })
  geometry.translate(0, 0, -0.035)
  const material = new MeshStandardMaterial({
    name: 'Placement triangle red', color: roomAccents.tomato, roughness: 0.8, flatShading: true,
  })
  const object = new Mesh(geometry, material)
  object.name = 'Placement triangle'
  object.visible = false
  object.userData.roomTransient = true
  object.rotation.y = Math.atan2(baseCameraOffset[0], baseCameraOffset[2])
  object.castShadow = false
  object.receiveShadow = false
  object.raycast = () => {}
  const position = new Vector3()
  let disposed = false

  return {
    object,
    update(bounds: Box3 | null, now: number, animate: boolean): boolean {
      if (disposed) throw new Error('The disposed placement triangle cannot be updated.')
      if (!bounds) { object.visible = false; return false }
      if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray(), now].every(Number.isFinite)) {
        throw new Error('The placement triangle needs finite object bounds and animation time.')
      }
      const bob = animate ? Math.sin(now * Math.PI * 2 / 1600) * 0.065 : 0
      bounds.getCenter(position)
      position.y = bounds.max.y + 0.46 + bob
      room.localToWorld(position)
      object.parent?.worldToLocal(position)
      object.position.copy(position)
      object.visible = true
      return animate
    },
    dispose() {
      if (disposed) return
      disposed = true
      object.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
