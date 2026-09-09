import {
  Box3, Color, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  PlaneGeometry, Vector3,
} from 'three'
import type { BufferGeometry, DataTexture } from 'three'
import { componentFinishes, componentPositionSupported, defaultRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import type { RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import type { RoomStyle } from '../shared/domain.ts'
import type { RoomId } from '../shared/rooms.ts'
import { batchStaticMeshes } from './batchStaticMeshes.ts'
import { buildRoomComponentModel } from './roomComponentModels.ts'
import type { ComponentBinding, ComponentBindings, ComponentFixtures, ComponentModel } from './roomComponentTypes.ts'
import { applyRoomStyle, roomAccents, roomPresets } from './roomStyles.ts'
import type { RoomStyleMaterials } from './roomStyles.ts'

const defaults = defaultRoomComponents()

export const kitchenActionSlots = {
  fridge: 'kitchen-fridge', stock: 'kitchen-shopping-bag', ledger: 'kitchen-receipt-book',
  budget: 'kitchen-house-pot', roommates: 'kitchen-noticeboard', settle: 'kitchen-settlement-envelope',
  brew: 'kitchen-kettle', light: 'kitchen-light',
} as const satisfies Record<string, RoomSlotId>
export const kitchenUtilitySlots = {
  chores: 'kitchen-cleaning-caddy', supplies: 'kitchen-supply-shelf', sink: 'kitchen-sink', counters: 'kitchen-counters',
} as const satisfies Record<string, RoomSlotId>
export const bathroomTargetSlots = {
  sink: 'bathroom-sink', mirror: 'bathroom-mirror', toilet: 'bathroom-toilet', bath: 'bathroom-bath',
  chores: 'bathroom-cleaning-caddy', supplies: 'bathroom-supply-shelf',
} as const satisfies Record<string, RoomSlotId>
export const livingRoomTargetSlots = {
  sofa: 'living-room-sofa', surfaces: 'living-room-coffee-table', plants: 'living-room-plant', bins: 'living-room-bins',
  chores: 'living-room-cleaning-caddy', supplies: 'living-room-supply-shelf',
} as const satisfies Record<string, RoomSlotId>

export function installedRoomComponents(components: readonly RoomComponent[] | undefined, roomId: RoomId): RoomComponent[] {
  const ids = new Set<string>()
  const slots = new Set<RoomSlotId>()
  const current = components ?? defaults
  return current.filter((component) => {
    if (!component.installed || component.roomId !== roomId || ids.has(component.id) || slots.has(component.slotId)
      || !componentPositionSupported(component.slotId, current)) return false
    ids.add(component.id)
    slots.add(component.slotId)
    return true
  })
}

export function componentAtSlot(components: readonly RoomComponent[] | undefined, slotId: RoomSlotId) {
  return (components ?? defaults).find((component) => component.slotId === slotId && component.installed)
}

export function componentLabel(component: RoomComponent | undefined, original: string): string {
  if (!component) return original
  const fallback = defaults.find((item) => item.slotId === component.slotId)
  return fallback?.name === component.name ? original : component.name
}

export function componentAccessibleName(component: RoomComponent, components: readonly RoomComponent[]): string {
  if (!components.some((other) => other.id !== component.id && other.name === component.name)) return component.name
  return `${component.name}, ${roomSlots.find((slot) => slot.id === component.slotId)!.name}`
}

export function isSceneObjectVisible(object: Object3D, root?: Object3D): boolean {
  for (let item: Object3D | null = object; item; item = item.parent) {
    if (!item.visible) return false
    if (item === root) break
  }
  return true
}

export function visibleRoomBounds(room: Group, root: Object3D = room): Box3 {
  room.updateMatrixWorld(true)
  const inverse = new Matrix4().copy(room.matrixWorld).invert()
  const transform = new Matrix4()
  const bounds = new Box3()
  const part = new Box3()
  root.traverseVisible((object) => {
    if (!(object instanceof Mesh) || object.userData.componentContact || object.userData.roomTransient) return
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
    if (!object.geometry.boundingBox) return
    transform.multiplyMatrices(inverse, object.matrixWorld)
    bounds.union(part.copy(object.geometry.boundingBox).applyMatrix4(transform))
  })
  return bounds
}

type PreparedBinding = {
  binding: ComponentBinding
  sources: Map<MeshStandardMaterial, MeshStandardMaterial>
}
type Actor = {
  component: RoomComponent
  binding: ComponentBinding
  generated?: ComponentModel
  prepared?: PreparedBinding
  baseColors: Map<MeshStandardMaterial, Color>
  anchor: Object3D
  contacts: Group
}

export function createRoomComponentScene(room: Group, roomId: RoomId, options: {
  bindings: ComponentBindings
  fixtures?: ComponentFixtures
  styleMaterials: RoomStyleMaterials
  shadowTexture?: DataTexture
}) {
  const records = new Map<string, Actor>()
  const actors = new Map<string, Group>()
  const anchors = new Map<string, Object3D>()
  const rootIds = new Map<Object3D, string>()
  const originals = new Map<RoomSlotId, PreparedBinding>()
  const boundaries = new Set([...options.bindings.values()].map((binding) => binding.root))
  const initialVisibility = new Map<Object3D, boolean>()
  const clonedMaterials = new Map<MeshStandardMaterial, MeshStandardMaterial>()
  const bounds = new Box3()
  const contactGeometry = new PlaneGeometry(1, 1)
  const contactMaterial = new MeshBasicMaterial({
    map: options.shadowTexture ?? null, color: '#535d45', opacity: 0.22,
    transparent: true, depthWrite: false, toneMapped: false,
  })
  let disposed = false
  let visualKey = ''
  let activeStyle: RoomStyle = 'original'

  // Isolate only an object's finish surfaces, stopping at nested component boundaries.
  for (const [slotId, binding] of options.bindings) {
    const sources = new Map<MeshStandardMaterial, MeshStandardMaterial>()
    const replacements = new Map<MeshStandardMaterial, MeshStandardMaterial>()
    for (const source of binding.finishes) {
      const clone = source.clone()
      replacements.set(source, clone)
      sources.set(clone, source)
      clonedMaterials.set(clone, source)
    }
    const visit = (object: Object3D) => {
      if (object !== binding.root && boundaries.has(object as Group)) return
      if (object instanceof Mesh) {
        const replace = (material: MeshStandardMaterial) => replacements.get(material) ?? material
        object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material)
      }
      object.children.forEach(visit)
    }
    visit(binding.root)
    initialVisibility.set(binding.root, binding.root.visible)
    originals.set(slotId, { binding: { ...binding, finishes: [...sources.keys()] }, sources })
  }
  for (const fixture of options.fixtures?.values() ?? []) {
    for (const object of [...fixture.vacant, ...fixture.occupied]) initialVisibility.set(object, object.visible)
  }

  const disposeGenerated = (model: ComponentModel) => {
    const geometries = new Set<BufferGeometry>()
    model.root.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    model.root.removeFromParent()
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  }
  const removeActor = (record: Actor) => {
    record.anchor.removeFromParent()
    record.contacts.removeFromParent()
    if (record.generated) disposeGenerated(record.generated)
    else record.binding.root.visible = false
  }
  const makeActor = (component: RoomComponent): Actor => {
    const original = originals.get(component.slotId)
    const useOriginal = component.variant === 'original' && roomSlots.find((slot) => slot.id === component.slotId)?.defaultKind === component.kind
      ? original : undefined
    const generated = useOriginal ? undefined : buildRoomComponentModel(component, activeStyle)
    const binding = useOriginal ? useOriginal.binding : generated!
    if (generated) {
      room.add(generated.root)
      batchStaticMeshes(generated.root, new Set())
    }
    binding.root.visible = true
    const actorBounds = visibleRoomBounds(room, binding.root)
    const point = binding.anchor
      ? new Vector3(...binding.anchor)
      : actorBounds.getCenter(new Vector3()).setY(actorBounds.max.y + 0.18)
    const anchor = new Object3D()
    anchor.name = 'Room object label anchor'
    anchor.position.copy(binding.root.worldToLocal(room.localToWorld(point)))
    binding.root.add(anchor)
    const contacts = new Group()
    contacts.name = 'Room object contact shadows'
    if (options.shadowTexture) {
      for (const footprint of binding.contacts ?? []) {
        const shadow = new Mesh(contactGeometry, contactMaterial)
        shadow.name = 'Furniture contact shadow'
        shadow.position.set(...footprint.position)
        shadow.rotation.x = -Math.PI / 2
        shadow.scale.set(...footprint.size, 1)
        shadow.userData.componentContact = true
        shadow.raycast = () => {}
        contacts.add(shadow)
      }
      room.add(contacts)
    }
    return {
      component, binding, generated, prepared: useOriginal, anchor, contacts,
      baseColors: new Map(binding.finishes.map((material) => [material, material.color.clone()])),
    }
  }
  return {
    actors, anchors, bounds,
    update(components: readonly RoomComponent[] | undefined, style: RoomStyle, selectedId: string | null = null) {
      if (disposed) throw new Error('The disposed room component scene cannot be updated.')
      const installed = installedRoomComponents(components, roomId)
      const key = JSON.stringify([style, selectedId, installed.map(({ id, kind, slotId, variant, name, finish, state }) =>
        [id, kind, slotId, variant, name, finish, state])])
      if (key === visualKey) return { changed: false, shadowsChanged: false }
      visualKey = key
      activeStyle = style
      applyRoomStyle(options.styleMaterials, style)
      let shadowsChanged = false
      const next = new Map(installed.map((component) => [component.id, component]))
      for (const [id, record] of records) {
        const component = next.get(id)
        if (!component || component.kind !== record.component.kind || component.variant !== record.component.variant
          || component.slotId !== record.component.slotId) {
          removeActor(record)
          records.delete(id)
          shadowsChanged = true
        }
      }
      actors.clear()
      anchors.clear()
      rootIds.clear()
      const installedSlots = new Set(installed.map((component) => component.slotId))
      for (const [slotId, original] of originals) {
        const defaultKind = roomSlots.find((slot) => slot.id === slotId)?.defaultKind
        const visible = installed.some((component) => component.slotId === slotId && component.variant === 'original' && component.kind === defaultKind)
        if (original.binding.root.visible !== visible) shadowsChanged = true
        original.binding.root.visible = visible
      }
      for (const [slotId, fixture] of options.fixtures ?? []) {
        for (const [objects, visible] of [[fixture.vacant, !installedSlots.has(slotId)], [fixture.occupied, installedSlots.has(slotId)]] as const) {
          for (const object of objects) {
            if (object.visible !== visible) shadowsChanged = true
            object.visible = visible
          }
        }
      }
      for (const component of installed) {
        let record = records.get(component.id)
        if (!record) {
          record = makeActor(component)
          records.set(component.id, record)
          shadowsChanged = true
        }
        record.component = component
        record.binding.root.visible = true
        record.binding.root.name = component.name
        if (record.generated) {
          for (const [material, surface] of record.generated.styleSurfaces) material.color.set(roomPresets[style].colors[surface])
          for (const entry of record.generated.stateObjects ?? []) {
            const visible = entry.states.includes(component.state ?? '')
            if (entry.root.visible !== visible) shadowsChanged = true
            entry.root.visible = visible
          }
          if (record.generated.indicator) {
            const color = component.state === 'running' ? roomAccents.terracotta
              : component.state?.startsWith('needs-') || component.state === 'dirty' ? roomAccents.tomato
                : component.state?.startsWith('ready') ? roomAccents.leaf : roomAccents.ink
            record.generated.indicator.color.set(color)
            record.generated.indicator.emissive.set(color)
          }
        }
        const finishColor = componentFinishes[component.finish].color
        for (const material of record.binding.finishes) {
          const source = record.prepared?.sources.get(material)
          const surface = record.generated?.styleSurfaces.get(material)
          if (finishColor) material.color.set(finishColor)
          else if (source) material.color.copy(source.color)
          else if (surface) material.color.set(roomPresets[style].colors[surface])
          else material.color.copy(record.baseColors.get(material)!)
          material.emissive.copy(source?.emissive ?? new Color('#000000'))
          material.emissiveIntensity = source?.emissiveIntensity ?? 1
          if (component.id === selectedId) {
            material.emissive.set(roomAccents.leafLight)
            material.emissiveIntensity = 0.16
          }
        }
        actors.set(component.id, record.binding.root)
        anchors.set(component.id, record.anchor)
        rootIds.set(record.binding.root, component.id)
      }
      if (shadowsChanged || bounds.isEmpty()) bounds.copy(visibleRoomBounds(room))
      return { changed: true, shadowsChanged }
    },
    componentForObject(object: Object3D): RoomComponent | null {
      if (!isSceneObjectVisible(object, room)) return null
      for (let item: Object3D | null = object; item && item !== room; item = item.parent) {
        const id = rootIds.get(item)
        if (id) return records.get(id)?.component ?? null
      }
      return null
    },
    componentAtSlot(slotId: RoomSlotId): RoomComponent | undefined {
      return [...records.values()].find((record) => record.component.slotId === slotId)?.component
    },
    getBounds(id: string): Box3 | undefined {
      const record = records.get(id)
      if (!record) return undefined
      return visibleRoomBounds(room, record.binding.root)
        .expandByPoint(room.worldToLocal(record.anchor.getWorldPosition(new Vector3())))
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const record of records.values()) removeActor(record)
      room.traverse((object) => {
        if (!(object instanceof Mesh)) return
        const restore = (material: MeshStandardMaterial) => clonedMaterials.get(material) ?? material
        object.material = Array.isArray(object.material) ? object.material.map(restore) : restore(object.material)
      })
      for (const [material] of clonedMaterials) material.dispose()
      for (const [object, visible] of initialVisibility) object.visible = visible
      records.clear()
      actors.clear()
      anchors.clear()
      rootIds.clear()
      contactGeometry.dispose()
      contactMaterial.dispose()
    },
  }
}

export type RoomComponentScene = ReturnType<typeof createRoomComponentScene>
