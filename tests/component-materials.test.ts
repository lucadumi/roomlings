import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Mesh, MeshStandardMaterial } from 'three'
import type { Object3D } from 'three'
import { componentKinds, createRoomComponent, defaultRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import type { ComponentKind, RoomComponent } from '../shared/roomComponents.ts'
import { roomIds } from '../shared/rooms.ts'
import { componentMaterialAppearance, componentMaterialColors } from '../src/componentMaterials.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { buildComponentThumbnail, clearComponentThumbnails } from '../src/componentThumbnail.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { roomMaterialSurface } from '../src/surfaceMaterials.ts'

function model(t: TestContext, component: RoomComponent, style: 'original' | 'linen' = 'original') {
  const result = buildRoomComponentModel(component, style)
  t.after(() => {
    const geometries = new Set<Mesh['geometry']>()
    result.root.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    geometries.forEach((geometry) => geometry.dispose())
    result.materials.forEach((material) => material.dispose())
  })
  return result
}

function component(kind: ComponentKind): RoomComponent {
  const slot = roomSlots.find((slot) => slot.kinds.includes(kind))
  assert.ok(slot)
  return createRoomComponent(kind, slot.id, `materials-${kind}`)
}

function visibleMaterials(root: Object3D): Set<MeshStandardMaterial> {
  const materials = new Set<MeshStandardMaterial>()
  root.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof MeshStandardMaterial) materials.add(material)
    }
  })
  return materials
}

function signature(root: Object3D) {
  return new Set([...visibleMaterials(root)].map((material) =>
    JSON.stringify([roomMaterialSurface(material), material.color.getHexString(), material.opacity])))
}

test('natural body defaults use their proper material without inheriting refrigerator paint', (t) => {
  for (const kind of componentKinds) {
    const candidate = component(kind)
    const appearance = componentMaterialAppearance(candidate)
    if (!appearance) continue
    for (const style of ['original', 'linen'] as const) {
      const built = model(t, candidate, style)
      const body = built.materials.find((material) => material.name === 'Original body finish')
      assert.ok(body, `${kind} needs its explicit body material`)
      assert.equal(body.color.getHexString(), appearance.body.color.slice(1), `${kind}: natural body color`)
      assert.equal(roomMaterialSurface(body), appearance.body.surface, `${kind}: natural body surface`)
      assert.ok(visibleMaterials(built.root).has(body), `${kind}: its natural material must actually be visible`)
      assert.ok(built.finishes.includes(body), `${kind}: saved color overrides must still address its body`)
      assert.equal(built.styleSurfaces.has(body), false, `${kind}: room presets must not turn neutral appliances green`)
    }
  }
})

test('glass vessels are transparent but screens and appliance windows remain opaque', (t) => {
  for (const kind of ['blender', 'grinder', 'water-filter', 'storage-jars', 'cereal-dispenser', 'reed-diffuser'] as const) {
    const materials = [...visibleMaterials(model(t, component(kind)).root)]
    const glass = materials.filter((material) => roomMaterialSurface(material) === 'clear-glass')
    assert.ok(glass.length, `${kind} needs real transparent vessel glass`)
    for (const material of glass) {
      assert.equal(material.color.getHexString(), componentMaterialColors.glass.slice(1))
      assert.equal(material.transparent, true)
      assert.equal(material.depthWrite, false)
    }
  }
  for (const kind of ['oven', 'washing-machine', 'dryer', 'microwave', 'tv'] as const) {
    const materials = [...visibleMaterials(model(t, component(kind)).root)]
    assert.ok(materials.some((material) => roomMaterialSurface(material) === 'glass'))
    assert.ok(materials.every((material) => !material.transparent), `${kind}: do not invent see-through electronics`)
  }
})

test('food and oil colors do not change to walnut when the room palette changes', (t) => {
  for (const kind of ['storage-jars', 'cereal-dispenser', 'reed-diffuser'] as const) {
    const candidate = component(kind)
    const first = model(t, candidate, 'original')
    const second = model(t, candidate, 'linen')
    const contents = (root: Object3D) => new Set([...visibleMaterials(root)]
      .filter((material) => roomMaterialSurface(material) === 'food' || material.name === 'Diffuser oil')
      .map((material) => material.color.getHexString()))
    assert.ok(contents(first.root).size)
    assert.deepEqual(contents(first.root), contents(second.root))
  }
})

test('modal thumbnails and placed components agree before, during and after a saved finish override', (t) => {
  t.after(() => clearComponentThumbnails())
  for (const roomId of roomIds) {
    const kind = roomId === 'living-room' ? 'air-purifier' : 'first-aid-kit'
    const slot = roomSlots.find((slot) => slot.roomId === roomId && slot.kinds.includes(kind))
    assert.ok(slot)
    const candidate = createRoomComponent(kind, slot.id, `preview-materials-${roomId}`)
    const defaults = defaultRoomComponents().filter((item) => item.slotId !== slot.id)
    const preview = createConfiguredRoomPreview(roomId, 'original', [...defaults, candidate])
    t.after(() => preview.dispose())
    const actor = preview.componentScene.actors.get(candidate.id)
    assert.ok(actor)
    for (const finish of ['room', 'tomato', 'room'] as const) {
      const changed = { ...candidate, finish }
      const update = preview.componentScene.update([...defaults, changed], 'linen')
      assert.equal(update.shadowsChanged, false, 'Finish changes must retain geometry and cached shadows.')
      assert.equal(preview.componentScene.actors.get(candidate.id), actor)
      const thumbnail = buildComponentThumbnail(changed, 'linen')
      try { assert.deepEqual(signature(actor), signature(thumbnail.root)) }
      finally { thumbnail.dispose() }
      if (kind === 'first-aid-kit') {
        assert.ok([...visibleMaterials(actor)].some((material) =>
          material.color.getHexString() === componentMaterialColors.medical.slice(1)),
        'An overridden case color must not recolor its medical cross.')
      }
    }
  }
})
