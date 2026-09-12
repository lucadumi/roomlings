import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  Box3, BoxGeometry, CylinderGeometry, Group, Light, Matrix4, Mesh, MeshStandardMaterial, Vector3,
} from 'three'
import type { Material, Object3D } from 'three'
import { componentKinds, createRoomComponent, defaultRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import type { ComponentKind, RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import {
  buildComponentThumbnail, clearComponentThumbnails, componentThumbnailCamera,
} from '../src/componentThumbnail.ts'
import { componentThumbnailSelection, setComponentThumbnailRepresentative } from '../src/componentPresentation.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { createRoomComponentScene } from '../src/roomComponentScene.ts'
import { roomModels } from '../src/roomModels.ts'
import { componentPlacements } from '../src/roomLayout.ts'

function dispose(root: Object3D, materials: readonly Material[]) {
  const geometries = new Set<Mesh['geometry']>()
  root.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}

function meshes(root: Object3D, boundaries: ReadonlySet<Object3D> = new Set(), visible = true): Mesh[] {
  const result: Mesh[] = []
  const visit = (object: Object3D) => {
    if (object !== root && boundaries.has(object)) return
    if (visible && (!object.visible || object instanceof Light)) return
    if (object instanceof Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      if (visible && materials.every((material) => !material.visible || material.opacity === 0)) return
      result.push(object)
    }
    object.children.forEach(visit)
  }
  visit(root)
  return result
}

function fixture(component: RoomComponent) {
  if (component.variant === 'original' && roomSlots.find((slot) => slot.id === component.slotId)?.defaultKind === component.kind) {
    const room = new Group()
    const model = roomModels[component.roomId](room, 'original')
    const bindings = 'scenery' in model ? model.scenery.componentBindings : model.componentBindings
    const binding = bindings.get(component.slotId)
    if (binding) return {
      root: binding.root, boundaries: new Set([...bindings.values()].map((binding) => binding.root)),
      dispose: () => dispose(room, model.materials),
    }
    dispose(room, model.materials)
  }
  const model = buildRoomComponentModel(component, 'original')
  return { root: model.root, boundaries: new Set<Group>(), dispose: () => dispose(model.root, model.materials) }
}

function componentFor(kind: ComponentKind, slotId?: RoomSlotId) {
  const slot = slotId ?? roomSlots.find((slot) => slot.kinds.includes(kind))?.id
  assert.ok(slot)
  return createRoomComponent(kind, slot, `thumbnail-${slot}-${kind}`)
}

function meshBounds(parts: readonly Mesh[], orientation = new Matrix4()) {
  const bounds = new Box3()
  for (const part of parts) {
    part.updateWorldMatrix(true, false)
    part.geometry.computeBoundingBox()
    assert.ok(part.geometry.boundingBox)
    bounds.union(part.geometry.boundingBox.clone().applyMatrix4(new Matrix4().multiplyMatrices(orientation, part.matrixWorld)))
  }
  return bounds
}

const representatives = [
  { kind: 'seating', slot: 'kitchen-seating', complete: 10, selected: 5 },
  { kind: 'curtains', slot: 'kitchen-curtains', complete: 12, selected: 3 },
  { kind: 'curtains', slot: 'living-room-curtains', complete: 25, selected: 11 },
  { kind: 'cutting-boards', slot: 'kitchen-cutting-boards', complete: 7, selected: 2 },
  { kind: 'pet-bowls', slot: 'kitchen-pet-bowls', complete: 5, selected: 2 },
  { kind: 'storage-jars', complete: 13, selected: 4 },
] as const

test('representative selection is explicit, keeps whole groups and does not affect normal batching metadata', () => {
  const root = new Group()
  const wrapper = new Group()
  const representative = new Group()
  const geometry = new BoxGeometry()
  const material = new MeshStandardMaterial()
  const body = new Mesh(geometry, material)
  const detail = new Mesh(geometry, material)
  const unrelated = new Mesh(geometry, material)
  representative.add(body, detail)
  wrapper.add(unrelated, representative)
  root.add(wrapper)
  try {
    assert.equal(componentThumbnailSelection(root), undefined)
    setComponentThumbnailRepresentative(root, representative)
    const expected = new Set([root, wrapper, representative, body, detail])
    assert.deepEqual(componentThumbnailSelection(root), expected)
    wrapper.remove(unrelated)
    wrapper.add(unrelated)
    unrelated.position.set(900, -700, 400)
    assert.deepEqual(componentThumbnailSelection(root), expected, 'Ordering and nearby shapes must not determine an item.')
    root.traverse((object) => {
      assert.equal(object.visible, true)
      assert.deepEqual(object.userData, {}, 'Thumbnail metadata must not opt room meshes out of static batching.')
    })
    const compound = new Group()
    compound.add(root)
    assert.equal(componentThumbnailSelection(compound), undefined, 'An embedded repeated set must not crop its enclosing object.')
    assert.throws(() => setComponentThumbnailRepresentative(compound), /complete model parts/)
  } finally {
    geometry.dispose()
    material.dispose()
  }
})

for (const entry of representatives) {
  const component = componentFor(entry.kind, 'slot' in entry ? entry.slot : undefined)
  test(`${component.slotId}: a card fits one complete representative instead of the room assembly`, (t) => {
    t.after(clearComponentThumbnails)
    const source = fixture(component)
    const thumbnail = buildComponentThumbnail(component, 'original')
    try {
      const selection = componentThumbnailSelection(source.root)
      assert.ok(selection)
      const original = meshes(source.root, source.boundaries)
      const expected = original.filter((mesh) => selection.has(mesh))
      const visible = meshes(thumbnail.root)
      assert.equal(original.length, entry.complete)
      assert.equal(meshes(thumbnail.root, new Set(), false).length, entry.complete, 'Hidden parts remain owned for cleanup.')
      assert.equal(expected.length, entry.selected)
      assert.equal(visible.length, entry.selected)
      for (const [index, mesh] of visible.entries()) {
        const part = expected[index]
        assert.deepEqual(mesh.geometry.getAttribute('position').array, part.geometry.getAttribute('position').array)
        assert.deepEqual(mesh.position.toArray(), part.position.toArray())
        assert.deepEqual(mesh.quaternion.toArray(), part.quaternion.toArray())
        assert.deepEqual(mesh.scale.toArray(), part.scale.toArray())
      }
      const front = new Matrix4().makeRotationY(-(componentPlacements[component.slotId]?.rotation ?? 0))
      const selectedSize = meshBounds(expected, front).getSize(new Vector3())
      selectedSize.multiplyScalar(3 / Math.max(selectedSize.x, selectedSize.y, selectedSize.z))
      assert.ok(thumbnail.bounds.getSize(new Vector3()).distanceTo(selectedSize) < 1e-6)
      assert.ok(thumbnail.bounds.getCenter(new Vector3()).length() < 1e-6)
      assert.ok(meshBounds(visible).equals(thumbnail.bounds))
      const assembly = new Box3().setFromObject(thumbnail.root).getSize(new Vector3())
      assert.ok(Math.max(assembly.x, assembly.y, assembly.z) > 3.05, 'Hidden siblings must not shrink the card or its contact shadow.')
      const camera = componentThumbnailCamera(thumbnail.bounds)
      for (const x of [thumbnail.bounds.min.x, thumbnail.bounds.max.x]) for (const y of [thumbnail.bounds.min.y, thumbnail.bounds.max.y]) {
        for (const z of [thumbnail.bounds.min.z, thumbnail.bounds.max.z]) {
          const point = new Vector3(x, y, z).project(camera)
          assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1)
        }
      }
      if (entry.kind === 'seating') {
        assert.deepEqual(visible.map((mesh) => {
          assert.ok(mesh.geometry instanceof CylinderGeometry)
          return mesh.geometry.parameters.height
        }).sort(), [0.045, 0.12, 0.78, 0.78, 0.78])
      } else if (entry.kind === 'cutting-boards') {
        assert.equal(visible.filter((mesh) => mesh.name === 'Left cutting board').length, 1)
        assert.equal(visible.filter((mesh) => mesh.name === 'Right cutting board').length, 0)
      } else if (entry.kind === 'pet-bowls') {
        assert.deepEqual(visible.map((mesh) => mesh.name), ['Pet bowl', 'Pet bowl contents'])
      }
      assert.equal(meshes(source.root, source.boundaries).length, entry.complete, 'The original room remains fully visible.')
    } finally {
      source.dispose()
      thumbnail.dispose()
    }
  })
}

test('ordinary compound objects retain all structural pieces and contents, including manual-state clothes', (t) => {
  t.after(clearComponentThumbnails)
  const repeated = new Set<ComponentKind>(representatives.map(({ kind }) => kind))
  for (const kind of componentKinds.filter((kind) => !repeated.has(kind))) {
    const component = componentFor(kind)
    if (kind === 'drying-rack') component.state = 'drying'
    if (kind === 'dish-rack') component.state = 'dishes-drying'
    const source = fixture(component)
    const thumbnail = buildComponentThumbnail(component, 'original')
    try {
      assert.equal(componentThumbnailSelection(source.root), undefined, kind)
      assert.equal(meshes(thumbnail.root).length, meshes(source.root, source.boundaries).length, `${kind} stays a whole object.`)
    } finally {
      source.dispose()
      thumbnail.dispose()
    }
  }
})

test('placed, selected and full-room-preview scene actors retain the complete repeated sets', (t) => {
  t.after(clearComponentThumbnails)
  const triangles = (root: Object3D) => meshes(root).reduce((count, mesh) =>
    count + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3, 0)
  for (const entry of representatives) {
    const component = componentFor(entry.kind, 'slot' in entry ? entry.slot : undefined)
    const source = fixture(component)
    const room = new Group()
    const model = roomModels[component.roomId](room, 'original')
    const bindings = 'scenery' in model ? model.scenery.componentBindings : model.componentBindings
    const fixtures = 'scenery' in model ? model.scenery.componentFixtures : model.componentFixtures
    const scene = createRoomComponentScene(room, component.roomId, { bindings, fixtures, styleMaterials: model.styleMaterials })
    const thumbnail = buildComponentThumbnail(component, 'original')
    try {
      const components = [...defaultRoomComponents().filter((item) => item.slotId !== component.slotId), component]
      for (const selected of [null, component.id, null]) {
        scene.update(components, 'original', selected)
        const actor = scene.actors.get(component.id)
        assert.ok(actor, component.slotId)
        assert.equal(triangles(actor), triangles(source.root), component.slotId)
        assert.ok(triangles(actor) > triangles(thumbnail.root))
        assert.ok(meshBounds(meshes(actor)).min.distanceTo(meshBounds(meshes(source.root)).min) < 1e-6)
        assert.ok(meshBounds(meshes(actor)).max.distanceTo(meshBounds(meshes(source.root)).max) < 1e-6)
      }
    } finally {
      thumbnail.dispose()
      scene.dispose()
      dispose(room, model.materials)
      source.dispose()
    }
  }
})

test('generated thumbnail disposal releases hidden and visible geometry and materials exactly once', (t) => {
  t.after(clearComponentThumbnails)
  for (const kind of ['pet-bowls', 'cutting-boards', 'storage-jars'] as const) {
    const thumbnail = buildComponentThumbnail(componentFor(kind), 'original')
    const all = meshes(thumbnail.root, new Set(), false)
    assert.ok(all.length > meshes(thumbnail.root).length)
    const resources = new Set([
      ...all.map((mesh) => mesh.geometry),
      ...all.flatMap((mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]),
    ])
    const disposed = new Map([...resources].map((resource) => [resource, 0]))
    resources.forEach((resource) => resource.addEventListener('dispose', () => disposed.set(resource, disposed.get(resource)! + 1)))
    thumbnail.dispose()
    assert.ok([...disposed.values()].every((count) => count === 1), kind)
  }
})

test('fitted thumbnails keep shared geometry alive until fixture cleanup, including hidden siblings', (t) => {
  t.after(clearComponentThumbnails)
  const component = { ...componentFor('seating'), finish: 'tomato' as const }
  const thumbnail = buildComponentThumbnail(component, 'original')
  const all = meshes(thumbnail.root, new Set(), false)
  const disposed = new Map(all.map((mesh) => [mesh.geometry, 0]))
  for (const geometry of disposed.keys()) geometry.addEventListener('dispose', () => disposed.set(geometry, disposed.get(geometry)! + 1))
  thumbnail.dispose()
  assert.ok([...disposed.values()].every((count) => count === 0))
  const next = buildComponentThumbnail(component, 'original')
  assert.equal(meshes(next.root).length, 5)
  assert.equal(meshes(next.root, new Set(), false).length, 10)
  next.dispose()
  clearComponentThumbnails()
  assert.ok([...disposed.values()].every((count) => count === 1))
})
