import { ExtrudeGeometry, Mesh, MeshStandardMaterial, Shape, Vector3 } from 'three'
import type { Box3, Object3D } from 'three'
import { baseCameraOffset, cameraFraming, projectRoomOrbitBounds } from './camera.ts'
import { roomAccents } from './roomStyles.ts'

const triangleTop = 0.12
const triangleHalfWidth = 0.15
const triangleDepth = 0.07
const markerGap = 0.46
const bobAmplitude = 0.065

export function placementPreviewCenter(bounds: Box3, target: Vector3): Vector3 {
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
    throw new Error('The placement preview needs finite object bounds.')
  }
  bounds.getCenter(target)
  // Reserve the full bobbing range so the camera stays still while the triangle moves.
  target.y += (markerGap + triangleTop + bobAmplitude) / 2
  return target
}

export function placementPreviewSize(bounds: Box3, width: number, height: number, zoom: number) {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('Placement framing needs a positive finite zoom.')
  const center = placementPreviewCenter(bounds, new Vector3())
  const framed = bounds.clone()
  const radius = Math.hypot(triangleHalfWidth, triangleDepth / 2)
  framed.min.x = Math.min(framed.min.x, center.x - radius)
  framed.max.x = Math.max(framed.max.x, center.x + radius)
  framed.min.z = Math.min(framed.min.z, center.z - radius)
  framed.max.z = Math.max(framed.max.z, center.z + radius)
  framed.max.y += markerGap + triangleTop + bobAmplitude
  const { horizontal, vertical } = projectRoomOrbitBounds(framed)
  const pixelsPerUnit = height * zoom / (2 * cameraFraming(width, height, 'room', false).halfHeight)
  return { width: horizontal * 2 * pixelsPerUnit + 4, height: vertical * 2 * pixelsPerUnit + 4 }
}

export function createPlacementArrow(room: Object3D) {
  const outline = new Shape()
  outline.moveTo(0, -0.14)
  outline.lineTo(-triangleHalfWidth, triangleTop)
  outline.lineTo(triangleHalfWidth, triangleTop)
  outline.closePath()
  const geometry = new ExtrudeGeometry(outline, { depth: triangleDepth, bevelEnabled: false, steps: 1, curveSegments: 1 })
  geometry.translate(0, 0, -triangleDepth / 2)
  const material = new MeshStandardMaterial({
    name: 'Placement triangle red', color: roomAccents.tomato, roughness: 1, flatShading: true,
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
    update(bounds: Box3 | null, now: number, animate: boolean, cameraRotation = 0): boolean {
      if (disposed) throw new Error('The disposed placement triangle cannot be updated.')
      if (!bounds) { object.visible = false; return false }
      if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray(), now, cameraRotation].every(Number.isFinite)) {
        throw new Error('The placement triangle needs finite object bounds and animation time.')
      }
      const bob = animate ? Math.sin(now * Math.PI * 2 / 1600) * bobAmplitude : 0
      bounds.getCenter(position)
      position.y = bounds.max.y + markerGap + bob
      room.localToWorld(position)
      object.parent?.worldToLocal(position)
      object.position.copy(position)
      object.rotation.y = Math.atan2(baseCameraOffset[0], baseCameraOffset[2]) - cameraRotation
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
