import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Box3, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import type { Object3D } from 'three'
import { componentCatalog, createRoomComponent, defaultRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { kitchenLayout, roomShellLayout } from '../src/roomLayout.ts'
import { roomMaterialSurface } from '../src/surfaceMaterials.ts'
import { pickablePoint } from './room-layout-fixture.ts'
import { meshSurfaceMaterials } from './surface-fixture.ts'

function componentModel(t: TestContext, component: RoomComponent) {
  const model = buildRoomComponentModel(component, 'original')
  model.root.updateMatrixWorld(true)
  t.after(() => {
    model.root.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
    model.materials.forEach((material) => material.dispose())
  })
  return model
}

function speakerMaterials(root: Object3D) {
  const materials = new Set<MeshStandardMaterial>()
  for (const name of ['Left media speaker', 'Right media speaker']) {
    const speaker = root.getObjectByName(name)
    assert.ok(speaker)
    speaker.traverse((object) => {
      if (!(object instanceof Mesh)) return
      meshSurfaceMaterials(object).forEach((material) => materials.add(material))
    })
  }
  return materials
}

test('the hood has a sloped chimney canopy above the hob and meets the right wall', (t) => {
  const room = new Group()
  const model = buildKitchenModel(room)
  t.after(() => {
    room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
    model.materials.forEach((material) => material.dispose())
  })
  room.updateMatrixWorld(true)
  const hob = model.scenery.componentBindings.get('kitchen-hob')!.root
  const hood = room.getObjectByName('Kitchen extractor hood')
  assert.ok(hood)
  assert.equal(hood.parent, hob)
  const canopy = new Box3().setFromObject(hood.getObjectByName('Extractor canopy')!, true)
  const chimney = new Box3().setFromObject(hood.getObjectByName('Extractor chimney')!, true)
  const filter = new Box3().setFromObject(hood.getObjectByName('Extractor filter')!, true)
  const taper = hood.getObjectByName('Extractor tapered canopy')
  assert.ok(taper instanceof Mesh)
  const points = taper.geometry.getAttribute('position')
  const widthAt = (top: boolean) => {
    const xs = Array.from({ length: points.count }, (_, index) => index)
      .filter((index) => (points.getY(index) > 0) === top).map((index) => points.getX(index))
    return Math.max(...xs) - Math.min(...xs)
  }
  assert.ok(Math.abs(widthAt(false) - 1.25) < 1e-6)
  assert.ok(Math.abs(widthAt(true) - 0.46) < 1e-6)
  assert.ok(widthAt(false) > widthAt(true) * 2, 'the canopy must slope inward rather than remain a flat slab')
  assert.ok(canopy.min.y > 3 && canopy.min.y - 1.798 > 1.2)
  assert.ok(Math.abs(canopy.max.y - chimney.min.y) < 1e-6)
  assert.ok(Math.abs(chimney.max.x - roomShellLayout('kitchen').inner.right) < 1e-6)
  assert.ok(chimney.max.y < 4.5)
  assert.ok(canopy.min.x < kitchenLayout.hob[0] - 0.45 && canopy.max.x > kitchenLayout.hob[0] + 0.45)
  assert.ok(canopy.min.z < kitchenLayout.hob[2] - 0.475 && canopy.max.z > kitchenLayout.hob[2] + 0.475)
  assert.ok(Math.abs(filter.max.y - canopy.min.y) < 1e-6)
  hood.traverse((object) => {
    if (!(object instanceof Mesh)) return
    assert.ok(object.material instanceof MeshStandardMaterial)
    assert.equal(roomMaterialSurface(object.material), 'metal')
    assert.ok(object.material.roughness >= 0.98)
    assert.ok(model.materials.includes(object.material))
  })
})

test('the upright stereo pair rests on the cabinet and stays beneath the TV', (t) => {
  const cabinet = componentModel(t, createRoomComponent('media-unit', 'living-room-media-unit', 'cabinet'))
  const tv = componentModel(t, createRoomComponent('tv', 'living-room-tv', 'tv'))
  const tvBounds = new Box3().setFromObject(tv.root, true)
  const top = cabinet.root.getObjectByName('Media cabinet top')!
  assert.deepEqual(new Box3().setFromObject(top, true).getSize(new Vector3()).toArray().map((value) => +value.toFixed(3)),
    [0.97, 0.1, 3.4])
  const bounds: Box3[] = []
  for (const name of ['Left media speaker', 'Right media speaker']) {
    const speaker = cabinet.root.getObjectByName(name)
    assert.ok(speaker)
    const parts: Mesh[] = []
    speaker.traverse((object) => { if (object instanceof Mesh) parts.push(object) })
    const enclosures = parts.filter((part) => part.name === 'Single-piece speaker enclosure')
    assert.equal(enclosures.length, 1, 'Each speaker must have one solid enclosure')
    const body = enclosures[0]
    assert.equal(body.geometry.type, 'BoxGeometry')
    const vertices = body.geometry.getAttribute('position')
    assert.equal(vertices.count, 24, 'The speaker must not have rounded edges or bevel segments')
    const corners = new Set(Array.from({ length: vertices.count }, (_, index) =>
      [vertices.getX(index), vertices.getY(index), vertices.getZ(index)].join(',')))
    assert.equal(corners.size, 8)
    assert.equal(speaker.getObjectByName('Speaker top control'), undefined)
    assert.deepEqual(body.geometry.groups.map(({ materialIndex }) => materialIndex), [0, 1, 0])
    const drivers = parts.filter((part) => part.name === 'Flush speaker driver circle')
    assert.equal(drivers.length, 2)
    assert.equal(parts.length, 3, 'Do not reintroduce a separate grille panel or controls')
    for (const driver of drivers) {
      assert.equal(driver.geometry.type, 'RingGeometry')
      assert.equal(driver.position.z, 0.131)
      assert.equal(driver.castShadow, false)
      driver.geometry.computeBoundingBox()
      assert.equal(driver.geometry.boundingBox!.getSize(new Vector3()).z, 0)
    }
    const box = new Box3().setFromObject(speaker, true)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    assert.ok(size.y > size.z * 1.5 && size.y < 0.65)
    assert.ok(box.max.y < tvBounds.min.y - 0.1)
    const support = new Raycaster(new Vector3(center.x, box.min.y + 0.01, center.z), new Vector3(0, -1, 0)).intersectObject(top)[0]
    assert.ok(support && Math.abs(box.min.y - support.point.y) < 1e-6)
    assert.ok(new Vector3(0, 0, 1).transformDirection(speaker.matrixWorld).x > 0.999)
    bounds.push(box)
  }
  assert.equal(bounds[0].intersectsBox(bounds[1]), false)
  for (const material of speakerMaterials(cabinet.root)) {
    assert.ok(material.roughness >= 0.98)
    assert.ok(cabinet.materials.includes(material))
  }
})

test('both speakers leave every supported media accessory and variant in its authored position', (t) => {
  const cabinet = componentModel(t, createRoomComponent('media-unit', 'living-room-media-unit', 'cabinet'))
  const speakers = ['Left media speaker', 'Right media speaker'].map((name) =>
    new Box3().setFromObject(cabinet.root.getObjectByName(name)!, true))
  for (const kind of roomSlots.find((slot) => slot.id === 'living-room-media-accessory')!.kinds) {
    for (const variant of componentCatalog[kind].variants) {
      const model = componentModel(t, { ...createRoomComponent(kind, 'living-room-media-accessory', `accessory-${kind}`), variant: variant.id })
      const bounds = new Box3().setFromObject(model.root, true)
      assert.ok(speakers.every((speaker) => !speaker.intersectsBox(bounds)), `${kind}/${variant.id} keeps its existing space`)
    }
  }
})

test('speakers keep natural colors through cabinet finishes and room presets without new object records', (t) => {
  const components = defaultRoomComponents()
  const before = JSON.stringify(components)
  const preview = createConfiguredRoomPreview('living-room', 'original', components)
  t.after(() => preview.dispose())
  const cabinet = preview.componentScene.actors.get('default-living-room-media-unit')!
  const materials = speakerMaterials(cabinet)
  const colors = [...materials].map((material) => material.color.getHexString())
  const changed = components.map((component) => component.kind === 'media-unit' ? { ...component, finish: 'tomato' as const } : component)
  preview.componentScene.update(changed, 'rose')
  assert.deepEqual([...speakerMaterials(cabinet)], [...materials])
  assert.deepEqual([...materials].map((material) => material.color.getHexString()), colors)
  assert.equal(preview.componentScene.actors.size, components.filter((component) => component.roomId === 'living-room').length)
  assert.equal(components.some((component) => component.kind === 'speaker'), false)
  assert.equal(JSON.stringify(components), before)
})

test('the hood and both speakers remain pickable parts of their existing household objects after batching', (t) => {
  for (const [roomId, id, names] of [
    ['kitchen', 'default-kitchen-hob', ['Kitchen extractor hood']],
    ['living-room', 'default-living-room-media-unit', ['Left media speaker', 'Right media speaker']],
  ] as const) {
    const preview = createConfiguredRoomPreview(roomId, 'original', defaultRoomComponents())
    t.after(() => preview.dispose())
    preview.room.updateMatrixWorld(true)
    for (const name of names) {
      const object = preview.room.getObjectByName(name)
      assert.ok(object)
      assert.ok(pickablePoint(preview.room, object, (mesh) => preview.componentScene.componentForObject(mesh)?.id === id),
        `${name} must open its existing household object`)
    }
  }
})
