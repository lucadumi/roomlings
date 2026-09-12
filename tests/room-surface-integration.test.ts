import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Group, Mesh, MeshStandardMaterial } from 'three'
import type { BufferGeometry, Object3D } from 'three'
import { defaultRoomComponents } from '../shared/roomComponents.ts'
import { buildBathroomModel } from '../src/bathroomModel.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { applyRoomStyle, roomPresets } from '../src/roomStyles.ts'
import { roomMaterialSurface } from '../src/surfaceMaterials.ts'
import type { RoomSurface } from '../src/surfaceMaterials.ts'

function surfaces(root: Object3D): Set<RoomSurface | undefined> {
  const found = new Set<RoomSurface | undefined>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof MeshStandardMaterial) found.add(roomMaterialSurface(material))
    }
  })
  return found
}

test('the original living-room remapping retains fabric, paper and paint as distinct surfaces', (t) => {
  const components = defaultRoomComponents()
  const preview = createConfiguredRoomPreview('living-room', 'original', components)
  t.after(() => preview.dispose())
  const sofa = preview.componentScene.actors.get('default-living-room-sofa')!
  const caddy = preview.componentScene.actors.get('default-living-room-cleaning-caddy')!
  const table = preview.componentScene.actors.get('default-living-room-coffee-table')!
  assert.deepEqual(surfaces(sofa), new Set(['fabric', 'wood']))
  assert.ok(surfaces(caddy).has('paint'))
  assert.ok(surfaces(table).has('wood'))
  assert.ok(surfaces(table).has('paper'))
  const sofaMaterials = new Set<MeshStandardMaterial>()
  const caddyMaterials = new Set<MeshStandardMaterial>()
  for (const [root, set] of [[sofa, sofaMaterials], [caddy, caddyMaterials]] as const) {
    root.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) set.add(object.material)
    })
  }
  const beforeCaddy = [...caddyMaterials].map((material) => material.color.getHexString())
  const originalMaps = [...sofaMaterials].map((material) => material.bumpMap)
  const changed = components.map((component) => component.id === 'default-living-room-sofa'
    ? { ...component, finish: 'tomato' as const } : component)
  assert.deepEqual(preview.componentScene.update(changed, 'original'), { changed: true, shadowsChanged: false })
  assert.deepEqual([...caddyMaterials].map((material) => material.color.getHexString()), beforeCaddy)
  assert.deepEqual([...sofaMaterials].map((material) => material.bumpMap), originalMaps)
  assert.deepEqual(surfaces(sofa), new Set(['fabric', 'wood']))
  assert.deepEqual(preview.componentScene.update(components, 'sage'), { changed: true, shadowsChanged: false })
  assert.ok([...sofaMaterials].some((material) => material.color.getHexString() === roomPresets.sage.colors.fridge.slice(1)))
})

test('bathroom textiles and paper retain their roles and shared palette colors', (t) => {
  const room = new Group()
  const model = buildBathroomModel(room)
  t.after(() => {
    const geometries = new Set<BufferGeometry>()
    room.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  })
  const mat = room.getObjectByName('Vanity bath mat')
  assert.ok(mat instanceof Mesh && mat.material instanceof MeshStandardMaterial)
  assert.equal(roomMaterialSurface(mat.material), 'fabric')
  const textileBorder = model.materials.find((material) => material.name === 'fridgeEdge fabric')
  assert.ok(textileBorder)
  assert.equal(textileBorder.color, model.styleMaterials.fridgeEdge.color)
  assert.ok(surfaces(model.actors.get('toilet')!).has('paper'))
  assert.ok(surfaces(model.actors.get('bath')!).has('ceramic'))
  const geometry = mat.geometry
  const texture = mat.material.bumpMap
  applyRoomStyle(model.styleMaterials, 'clay')
  assert.equal(mat.material.color.getHexString(), roomPresets.clay.colors.fridgeDoor.slice(1))
  assert.equal(textileBorder.color.getHexString(), roomPresets.clay.colors.fridgeEdge.slice(1))
  assert.equal(mat.geometry, geometry)
  assert.equal(mat.material.bumpMap, texture)
})
