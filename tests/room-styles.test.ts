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

const styles = ['original', 'sage', 'clay', 'linen', 'coastal', 'lavender', 'citrus', 'rose'] as const

test('every supported room preset has distinct finishes and the default uses the Coolors sage and clay palette', () => {
  assert.deepEqual(roomStyleSchema.options, styles)
  assert.deepEqual(Object.keys(roomPresets), styles)
  assert.equal(new Set(Object.values(roomPresets).map((preset) => JSON.stringify(preset.colors))).size, styles.length)
  for (const preset of Object.values(roomPresets)) {
    for (const color of Object.values(preset.colors)) assert.match(color, /^#[0-9a-f]{6}$/)
    assert.deepEqual(Object.keys(preset.colors), Object.keys(roomPresets.original.colors))
    assert.ok(preset.name.trim() && preset.description.trim())
  }
  assert.deepEqual(roomPresets.original.colors, {
    wall: '#faf7ee', trim: '#ded5c4', floor: '#f4f5ef', floorAlternate: '#d2e2d5',
    fridge: '#81b29a', fridgeDoor: '#acd0ba', fridgeEdge: '#5d8b73',
    cabinet: '#5d8973', cabinetPanel: '#83b099', counter: '#fffdf7',
    wood: '#ba9164', lightWood: '#e4bf88', woodGrain: '#c5a375',
  })
})

test('Sage, Clay and Linen retain their saved palette values', () => {
  assert.deepEqual(roomPresets.sage.colors, {
    wall: '#b1cabb', trim: '#7b9c89', floor: '#faf8f1', floorAlternate: '#90b29b',
    fridge: '#ede9db', fridgeDoor: '#fffdf5', fridgeEdge: '#b4ae9d',
    cabinet: '#426450', cabinetPanel: '#5a836b', counter: '#fcfaf4',
    wood: '#a27c51', lightWood: '#d0ab73', woodGrain: '#856644',
  })
  assert.deepEqual(roomPresets.clay.colors, {
    wall: '#e0af89', trim: '#c28f6e', floor: '#f7e3c5', floorAlternate: '#ca9676',
    fridge: '#cb7057', fridgeDoor: '#e49376', fridgeEdge: '#a75b46',
    cabinet: '#c78a69', cabinetPanel: '#e0ae88', counter: '#fffaf0',
    wood: '#af815b', lightWood: '#dcba87', woodGrain: '#8e6848',
  })
  assert.deepEqual(roomPresets.linen.colors, {
    wall: '#f1eee3', trim: '#b9b6a6', floor: '#eeeae0', floorAlternate: '#73786c',
    fridge: '#ded5c1', fridgeDoor: '#fbf1d8', fridgeEdge: '#b5a68c',
    cabinet: '#e1d9c7', cabinetPanel: '#f7efdc', counter: '#57564b',
    wood: '#4e3528', lightWood: '#6a4834', woodGrain: '#a17751',
  })
})

test('softened families use their Coolors anchors and remain distinct across major room surfaces', () => {
  const anchors = {
    coastal: { wall: '#a6bbc6', cabinetPanel: '#5f8195', fridgeDoor: '#70968f', floorAlternate: '#b9cbd0', counter: '#eeeae0', lightWood: '#b7a184' },
    lavender: { wall: '#afa0ba', cabinetPanel: '#725879', fridgeDoor: '#a48faf', floorAlternate: '#b4a2bb', counter: '#eee7e7', lightWood: '#b69d90' },
    citrus: { wall: '#c5be9c', cabinetPanel: '#879367', fridgeDoor: '#d3bd85', floorAlternate: '#b6bd92', counter: '#f0eadb', lightWood: '#b29c79' },
    rose: { wall: '#c6acb0', cabinetPanel: '#986b7a', fridgeDoor: '#c7969b', floorAlternate: '#d4b9ba', counter: '#eee6df', lightWood: '#8f7467' },
  }
  const channels = (color: string) => [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16))
  const difference = (first: string, second: string) => Math.max(...channels(first).map((value, index) => Math.abs(value - channels(second)[index])))
  for (const style of ['coastal', 'lavender', 'citrus', 'rose'] as const) {
    const colors = roomPresets[style].colors
    for (const [surface, color] of Object.entries(anchors[style])) {
      assert.equal(colors[surface as keyof typeof colors], color, `${style} must use its softened Coolors color`)
    }
    for (const other of styles.filter((other) => other !== style)) {
      const changed = (['wall', 'floorAlternate', 'fridgeDoor', 'cabinetPanel'] as const)
        .filter((surface) => difference(colors[surface], roomPresets[other].colors[surface]) >= 30)
      assert.ok(changed.length >= 3, `${style} must be distinct from ${other} on at least three major surfaces`)
    }
  }
})

test('individual object finishes use the same palette as the rooms', () => {
  assert.equal(componentFinishes.cream.color, roomAccents.cream)
  assert.equal(componentFinishes.sage.color, roomPresets.original.colors.fridge)
  assert.equal(componentFinishes.tomato.color, roomAccents.tomato)
  assert.equal(componentFinishes.clay.color, roomAccents.terracotta)
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
    const unchanged = model.materials.filter((material) => !Object.values(finishes).includes(material))
      .map((material) => ({ material, color: material.color.getHexString() }))
    for (const style of styles) {
      applyRoomStyle(finishes, style)
      for (const [surface, material] of Object.entries(finishes)) {
        assert.equal(material.color.getHexString(), roomPresets[style].colors[surface as keyof typeof finishes].slice(1))
        assert.equal(material.flatShading, true)
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
