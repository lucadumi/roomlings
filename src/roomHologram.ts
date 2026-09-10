import { EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { roomAccents } from './roomStyles.ts'

type ShadowState = { castShadow: boolean; receiveShadow: boolean; visible: boolean }
type MeshState = ShadowState & {
  material: Mesh['material']
  ghostMaterial: Mesh['material'] | null
  geometry: BufferGeometry
  outline: LineSegments<EdgesGeometry, LineBasicMaterial> | null
  ghosted: boolean
  hidden: boolean
  applied: boolean
  rendered: ShadowState | null
}

function shadowState(object: Object3D): ShadowState {
  return { castShadow: object.castShadow, receiveShadow: object.receiveShadow, visible: object.visible }
}

function visibleCandidate(room: Object3D, candidate: Object3D | null | undefined): Object3D | null {
  if (!candidate || candidate === room) return null
  for (let object: Object3D | null = candidate; object; object = object.parent) {
    if (!object.visible) return null
    if (object === room) return candidate
  }
  return null
}

export function createRoomHologram(room: Object3D, groundShadow?: Object3D) {
  const meshes = new Map<Mesh, MeshState>()
  const surfaces = new Map<Material, MeshBasicMaterial>()
  let outlines: LineBasicMaterial | null = null
  let candidate: Object3D | null = null
  let groundState: ShadowState | null = null
  let groundApplied = false
  let disposed = false

  const restore = (mesh: Mesh, saved: MeshState) => {
    if (!saved.applied) return
    if (mesh.material === saved.ghostMaterial) mesh.material = saved.material
    mesh.castShadow = saved.castShadow
    mesh.receiveShadow = saved.receiveShadow
    if (saved.hidden) mesh.visible = saved.visible
    saved.applied = false
  }
  const restoreGround = () => {
    if (!groundShadow || !groundState || !groundApplied) return
    Object.assign(groundShadow, groundState)
    groundApplied = false
  }
  const removeOutline = (saved: MeshState) => {
    if (!saved.outline) return
    saved.outline.removeFromParent()
    saved.outline.geometry.dispose()
    saved.outline = null
  }
  const clear = () => {
    for (const [mesh, saved] of meshes) { restore(mesh, saved); removeOutline(saved) }
    meshes.clear()
    surfaces.forEach((material) => material.dispose())
    surfaces.clear()
    outlines?.dispose()
    outlines = null
    restoreGround()
    groundState = null
  }
  const prepareUpdate = () => {
    if (disposed) throw new Error('The disposed room hologram cannot be updated.')
    // Animations must write to real materials, not to the temporary mint surfaces.
    for (const [mesh, saved] of meshes) restore(mesh, saved)
    restoreGround()
  }

  return {
    get candidate() { return candidate },
    prepareUpdate,
    update(nextCandidate: Object3D | null | undefined, componentRoots: Iterable<Object3D> = []) {
      prepareUpdate()
      const next = visibleCandidate(room, nextCandidate)
      let changed = candidate !== next
      let shadowsChanged = changed
      candidate = next
      if (!candidate) {
        clear()
        return { changed, shadowsChanged }
      }

      const boundaries = new Set(componentRoots)
      boundaries.add(candidate)
      const retained = new Set<Mesh>()
      const usedMaterials = new Set<Material>()
      const surfaceFor = (source: Material) => {
        usedMaterials.add(source)
        let material = surfaces.get(source)
        if (!material) {
          material = new MeshBasicMaterial({
            name: 'Room placement hologram surface', color: roomAccents.leafLight,
            transparent: true, depthWrite: false, toneMapped: false,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          })
          surfaces.set(source, material)
          changed = true
        }
        const opacity = 0.22 * (source.transparent ? source.opacity : 1)
        if (material.opacity !== opacity || material.visible !== source.visible) changed = true
        if (material.side !== source.side) { material.side = source.side; material.needsUpdate = true; changed = true }
        material.opacity = opacity
        material.visible = source.visible
        return material
      }
      const visit = (object: Object3D, inCandidate: boolean, parentVisible: boolean) => {
        if (boundaries.has(object)) inCandidate = object === candidate
        let visible = parentVisible && object.visible
        if (object instanceof Mesh) {
          retained.add(object)
          let saved = meshes.get(object)
          if (!saved) {
            saved = {
              ...shadowState(object), material: object.material, ghostMaterial: null,
              geometry: object.geometry, outline: null, ghosted: false, hidden: false, applied: false, rendered: null,
            }
            meshes.set(object, saved)
            changed = true
          }
          const hidden = !!object.userData.componentContact || object === groundShadow
          const ghosted = !hidden && !inCandidate
          const geometryChanged = saved.geometry !== object.geometry
          if (saved.material !== object.material || geometryChanged || saved.ghosted !== ghosted || saved.hidden !== hidden) changed = true
          if (geometryChanged && ((!ghosted && !hidden && object.castShadow) || saved.rendered?.castShadow)) shadowsChanged = true
          saved.material = object.material
          Object.assign(saved, shadowState(object))
          saved.ghosted = ghosted
          saved.hidden = hidden
          if (ghosted) {
            if (Array.isArray(saved.material)) {
              const materials = saved.material.map(surfaceFor)
              const previous = saved.ghostMaterial
              if (!Array.isArray(previous) || previous.length !== materials.length
                || materials.some((material, index) => previous[index] !== material)) saved.ghostMaterial = materials
            } else saved.ghostMaterial = surfaceFor(saved.material)
            object.material = saved.ghostMaterial
            if (geometryChanged) removeOutline(saved)
            if (!saved.outline) {
              outlines ??= new LineBasicMaterial({
                name: 'Room placement hologram outlines', color: roomAccents.leafDark,
                transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false,
              })
              saved.outline = new LineSegments(new EdgesGeometry(object.geometry, 20), outlines)
              saved.outline.name = 'Room placement hologram outline'
              saved.outline.userData.roomTransient = true
              saved.outline.raycast = () => {}
              object.add(saved.outline)
            }
            const sources = Array.isArray(saved.material) ? saved.material : [saved.material]
            saved.outline.visible = sources.some((material) => material.visible && (!material.transparent || material.opacity > 0))
            saved.outline.layers.mask = object.layers.mask
            saved.outline.frustumCulled = object.frustumCulled
            saved.outline.renderOrder = object.renderOrder + 1
          } else {
            removeOutline(saved)
            saved.ghostMaterial = null
          }
          if (hidden) { object.visible = false; visible = false }
          if (ghosted || hidden) {
            object.castShadow = false
            object.receiveShadow = false
            saved.applied = true
          }
          const sources = Array.isArray(saved.material) ? saved.material : [saved.material]
          const rendered = {
            castShadow: object.castShadow, receiveShadow: object.receiveShadow,
            visible: visible && sources.some((material) => material.visible),
          }
          if (saved.rendered) {
            if (saved.rendered.visible !== rendered.visible) changed = true
            if (saved.rendered.castShadow !== rendered.castShadow || saved.rendered.receiveShadow !== rendered.receiveShadow
              || (saved.rendered.visible !== rendered.visible && (saved.rendered.castShadow || rendered.castShadow))) shadowsChanged = true
          } else if (rendered.castShadow && rendered.visible) shadowsChanged = true
          saved.geometry = object.geometry
          saved.rendered = rendered
        }
        for (const child of object.children) visit(child, inCandidate, visible)
      }
      visit(room, false, true)
      for (const [mesh, saved] of meshes) {
        if (retained.has(mesh)) continue
        if (saved.rendered?.castShadow && saved.rendered.visible) shadowsChanged = true
        removeOutline(saved)
        meshes.delete(mesh)
        changed = true
      }
      for (const [source, material] of surfaces) {
        if (usedMaterials.has(source)) continue
        material.dispose()
        surfaces.delete(source)
      }
      if (outlines && ![...meshes.values()].some((saved) => saved.outline)) {
        outlines.dispose()
        outlines = null
      }
      if (groundShadow && (!(groundShadow instanceof Mesh) || !retained.has(groundShadow))) {
        groundState = shadowState(groundShadow)
        groundShadow.visible = false
        groundShadow.castShadow = false
        groundShadow.receiveShadow = false
        groundApplied = true
      }
      return { changed: changed || shadowsChanged, shadowsChanged }
    },
    dispose() {
      if (disposed) return
      clear()
      candidate = null
      disposed = true
    },
  }
}
