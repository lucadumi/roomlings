import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { applyRoomStyle, roomPresets } from '../src/roomStyles.ts'
import { buildRoom } from '../src/room.ts'
import type { Shapes } from '../src/room.ts'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'

const styles = ['original', 'sage', 'clay', 'linen'] as const

test('every supported room preset has distinct finishes and Original keeps the existing colors', () => {
  assert.deepEqual(Object.keys(roomPresets), styles)
  assert.equal(new Set(Object.values(roomPresets).map((preset) => JSON.stringify(preset.colors))).size, 4)
  for (const preset of Object.values(roomPresets)) {
    for (const color of Object.values(preset.colors)) assert.match(color, /^#[0-9a-f]{6}$/)
  }
  assert.deepEqual(roomPresets.original.colors, {
    wall: '#efe3c8', trim: '#ded0b0', floor: '#e4e7d9', floorAlternate: '#d3dcc6',
    fridge: '#9eb399', fridgeDoor: '#b1c4a7', fridgeEdge: '#8b9d82',
    cabinet: '#879f91', cabinetPanel: '#94ac9b', counter: '#f1e9d7',
    wood: '#bb895c', lightWood: '#d7ad78', woodGrain: '#c69c6b',
  })
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
