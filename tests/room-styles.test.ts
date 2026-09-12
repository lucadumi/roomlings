import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { roomStyleSchema } from '../shared/domain.ts'
import { applyRoomStyle, roomAccents, roomPresets } from '../src/roomStyles.ts'
import { componentFinishes } from '../shared/roomComponents.ts'
import { buildRoom } from '../src/room.ts'
import type { Shapes } from '../src/room.ts'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'
import { buildBathroomModel } from '../src/bathroomModel.ts'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { assertRoomSurface } from './surface-fixture.ts'

const styles = ['original', 'sage', 'clay', 'linen', 'coastal', 'lavender', 'citrus', 'rose'] as const

test('the eight existing room presets retain their IDs and distinct furniture accents', () => {
  assert.deepEqual(roomStyleSchema.options, styles)
  assert.deepEqual(Object.keys(roomPresets), styles)
  assert.equal(new Set(Object.values(roomPresets).map((preset) => JSON.stringify(preset.colors))).size, styles.length)
  for (const preset of Object.values(roomPresets)) {
    for (const color of Object.values(preset.colors)) assert.match(color, /^#[0-9a-f]{6}$/)
    assert.deepEqual(Object.keys(preset.colors), Object.keys(roomPresets.original.colors))
    assert.ok(preset.name.trim() && preset.description.trim())
  }
  assert.equal(new Set(styles.map((style) => roomPresets[style].colors.fridge)).size, styles.length)
  assert.equal(new Set(styles.map((style) => roomPresets[style].colors.cabinetPanel)).size, styles.length)
})

test('all room color families share neutral architecture instead of painting the entire room', () => {
  for (const style of styles) {
    for (const surface of ['wall', 'trim', 'floor', 'floorAlternate'] as const) {
      const color = roomPresets[style].colors[surface]
      assert.equal(color, roomPresets.original.colors[surface])
      const channels = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16))
      assert.ok(Math.max(...channels) - Math.min(...channels) <= 20, `${style} ${surface} must remain neutral`)
    }
  }
})

test('accent presets preserve their natural wood finishes', () => {
  const woods = {
    original: ['#ba9164', '#e4bf88', '#c5a375'],
    sage: ['#a27c51', '#d0ab73', '#856644'],
    clay: ['#af815b', '#dcba87', '#8e6848'],
    linen: ['#4e3528', '#6a4834', '#a17751'],
    coastal: ['#8c7157', '#b7a184', '#705b47'],
    lavender: ['#8b726b', '#b69d90', '#6e5954'],
    citrus: ['#8c7657', '#b29c79', '#6f5e45'],
    rose: ['#6f5851', '#8f7467', '#574741'],
  }
  for (const style of styles) {
    const colors = roomPresets[style].colors
    assert.deepEqual([colors.wood, colors.lightWood, colors.woodGrain], woods[style])
  }
})

test('existing individual object finishes keep their original colors', () => {
  assert.equal(componentFinishes.cream.color, roomAccents.cream)
  assert.equal(componentFinishes.sage.color, '#81b29a')
  assert.equal(componentFinishes.tomato.color, roomAccents.tomato)
  assert.equal(componentFinishes.clay.color, roomAccents.terracotta)
  assert.deepEqual(
    (['ocean', 'teal', 'plum', 'lilac', 'lime', 'lemon', 'berry', 'rose'] as const).map((finish) => componentFinishes[finish].color),
    ['#5f8195', '#70968f', '#725879', '#a48faf', '#879367', '#d3bd85', '#986b7a', '#c7969b'],
  )
})

test('room finishes update batched material references without rebuilding or recoloring other objects', (t) => {
  const room = new Group()
  const materials: MeshStandardMaterial[] = []
  const shapes: Shapes = {
    material(color, roughness = 0.9) {
      const material = new MeshStandardMaterial({ color, roughness, flatShading: true })
      materials.push(material)
      return material
    },
    box(parent, dimensions, position, material) {
      const mesh = new Mesh(new BoxGeometry(...dimensions), material)
      mesh.position.set(...position)
      parent.add(mesh)
      return mesh
    },
    cylinder(parent, radius, height, position, material, top = radius) {
      const mesh = new Mesh(new CylinderGeometry(top, radius, height, 8), material)
      mesh.position.set(...position)
      parent.add(mesh)
      return mesh
    },
  }
  const scenery = buildRoom(room, shapes, 'linen')
  for (const surface of ['wall', 'floor', 'cabinet', 'cabinetPanel', 'counter', 'wood', 'lightWood', 'woodGrain'] as const) {
    assert.equal(scenery.styleMaterials[surface].color.getHexString(), roomPresets.linen.colors[surface].slice(1))
  }
  const finishes = {
    ...scenery.styleMaterials,
    fridge: shapes.material(roomPresets.original.colors.fridge, 0.6),
    fridgeDoor: shapes.material(roomPresets.original.colors.fridgeDoor, 0.6),
    fridgeEdge: shapes.material(roomPresets.original.colors.fridgeEdge),
  }
  const unchanged = materials.filter((material) => !Object.values(finishes).includes(material))
    .map((material) => ({ material, color: material.color.getHexString() }))
  assert.deepEqual(Object.keys(finishes).sort(), Object.keys(roomPresets.original.colors).sort())
  const preserved = new Set([...scenery.coins, ...scenery.receipts, ...scenery.steam, scenery.kettleLid])
  batchStaticMeshes(room, preserved)
  const children = [...room.children]
  const floor = scenery.utilityActors.get('floor')?.children.find((object) => object instanceof Mesh && object.material === finishes.floor)
  assert.ok(floor instanceof Mesh)
  assert.equal(floor.name, 'Static room details')
  const geometry = floor.geometry
  for (const style of styles) {
    applyRoomStyle(finishes, style)
    for (const surface of [
      'wall', 'trim', 'floor', 'floorAlternate', 'fridge', 'fridgeDoor', 'fridgeEdge',
      'cabinet', 'cabinetPanel', 'counter', 'wood', 'lightWood', 'woodGrain',
    ] as const) {
      assert.equal(finishes[surface].color.getHexString(), roomPresets[style].colors[surface].slice(1))
      assert.equal(finishes[surface].flatShading, true)
    }
    assert.equal(floor.material, finishes.floor)
    assert.equal(floor.geometry, geometry)
    assert.deepEqual(room.children, children)
    for (const { material, color } of unchanged) assert.equal(material.color.getHexString(), color)
  }
  t.after(() => {
    room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
    materials.forEach((material) => material.dispose())
  })
})

for (const roomId of ['kitchen', 'bathroom'] as const) {
  test(`every preset repaints the existing ${roomId} material references without rebuilding`, (t) => {
    const room = new Group()
    const model = roomId === 'kitchen' ? buildKitchenModel(room, 'rose') : buildBathroomModel(room, 'rose')
    t.after(() => {
      room.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
      model.materials.forEach((material) => material.dispose())
    })
    const finishes = model.styleMaterials
    for (const [surface, material] of Object.entries(finishes)) {
      assert.equal(material.color.getHexString(), roomPresets.rose.colors[surface as keyof typeof finishes].slice(1))
    }
    batchStaticMeshes(room, 'scenery' in model ? model.scenery.preserved : new Set())
    const children = [...room.children]
    const meshes: Mesh[] = []
    room.traverse((object) => { if (object instanceof Mesh) meshes.push(object) })
    const saved = meshes.map((mesh) => ({ mesh, geometry: mesh.geometry, material: mesh.material }))
    const unchanged = model.materials.filter((material) => !Object.values(finishes).some((source) => source.color === material.color))
      .map((material) => ({ material, color: material.color.getHexString() }))
    for (const style of styles) {
      applyRoomStyle(finishes, style)
      for (const [surface, material] of Object.entries(finishes)) {
        assert.equal(material.color.getHexString(), roomPresets[style].colors[surface as keyof typeof finishes].slice(1))
        assertRoomSurface(material)
      }
      assert.deepEqual(room.children, children)
      const currentMeshes: Mesh[] = []
      room.traverse((object) => { if (object instanceof Mesh) currentMeshes.push(object) })
      assert.deepEqual(currentMeshes, meshes)
      for (const { mesh, geometry, material } of saved) {
        assert.equal(mesh.geometry, geometry)
        assert.equal(mesh.material, material)
      }
      for (const { material, color } of unchanged) assert.equal(material.color.getHexString(), color)
    }
  })
}
