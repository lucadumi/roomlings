import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Color, Mesh, MeshStandardMaterial } from 'three'
import type { Object3D } from 'three'
import { roomStyleSchema } from '../shared/domain.ts'
import type { RoomStyle } from '../shared/domain.ts'
import { componentFinishes, componentFinishSchema } from '../shared/componentFinishes.ts'
import {
  componentFinishes as publicFinishes, componentFinishSchema as publicFinishSchema,
  createRoomComponent, defaultRoomComponents, roomComponentSchema,
} from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'
import { buildComponentThumbnail, clearComponentThumbnails, componentThumbnailKey } from '../src/componentThumbnail.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { roomPresets } from '../src/roomStyles.ts'

const expectedFinishes = {
  room: { name: 'Match room colors', color: null },
  cream: { name: 'Warm cream', color: '#fcf9f1' },
  sage: { name: 'Sage green', color: '#81b29a' },
  tomato: { name: 'Tomato red', color: '#e07a5f' },
  clay: { name: 'Terracotta', color: '#c58d71' },
  walnut: { name: 'Walnut', color: '#806044' },
  ocean: { name: 'Ocean', color: '#5f8195' },
  teal: { name: 'Teal', color: '#70968f' },
  plum: { name: 'Plum', color: '#725879' },
  lilac: { name: 'Lilac', color: '#a48faf' },
  lime: { name: 'Olive', color: '#879367' },
  lemon: { name: 'Butter yellow', color: '#d3bd85' },
  berry: { name: 'Berry', color: '#986b7a' },
  rose: { name: 'Rose', color: '#c7969b' },
}

test('finish metadata keeps every persisted identifier, name and color and preserves public imports', () => {
  assert.deepEqual(componentFinishes, expectedFinishes)
  assert.deepEqual(componentFinishSchema.options, Object.keys(expectedFinishes))
  assert.equal(publicFinishes, componentFinishes)
  assert.equal(publicFinishSchema, componentFinishSchema)
  const colors = Object.values(componentFinishes).flatMap(({ color }) => color ? [color] : [])
  assert.equal(new Set(colors).size, colors.length)
  for (const color of colors) assert.match(color, /^#[0-9a-f]{6}$/)
  for (const component of defaultRoomComponents()) {
    for (const finish of componentFinishSchema.options) {
      assert.equal(roomComponentSchema.parse({ ...component, finish }).finish, finish)
    }
    for (const finish of [undefined, null, '', 'Teal', '#70968f', 1, ['teal'], { color: '#70968f' }]) {
      assert.equal(componentFinishSchema.safeParse(finish).success, false)
      assert.equal(roomComponentSchema.safeParse({ ...component, finish }).success, false)
    }
  }
})

function perceptualColor(hex: string) {
  // OKLab uses Three's linear-sRGB channels to measure chroma separately from lightness.
  const { r, g, b } = new Color(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const blueYellow = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { lightness, chroma: Math.hypot(a, blueYellow) }
}

test('new finishes reduce perceptual chroma by at least 40% without becoming nearly white', () => {
  const vibrant = {
    ocean: '#0077b6', teal: '#0a9396', plum: '#5a189a', lilac: '#c77dff',
    lime: '#80b918', lemon: '#ffd60a', berry: '#a4133c', rose: '#ff8fab',
  }
  for (const finish of Object.keys(vibrant) as (keyof typeof vibrant)[]) {
    const current = perceptualColor(componentFinishes[finish].color!)
    const previous = perceptualColor(vibrant[finish])
    assert.ok(current.chroma <= previous.chroma * 0.6, `${finish} must be materially less chromatic, not merely lighter`)
    assert.ok(current.chroma <= 0.1, `${finish} must remain a restrained medium-tone finish`)
    assert.ok(current.lightness >= 0.4 && current.lightness <= 0.82, `${finish} must not turn into black or near-white paint`)
  }
})

test('all new room surfaces stay low-chroma while the main colored surfaces retain medium tones', () => {
  for (const style of ['coastal', 'lavender', 'citrus', 'rose'] as const) {
    for (const [surface, color] of Object.entries(roomPresets[style].colors)) {
      assert.ok(perceptualColor(color).chroma <= 0.1, `${style} ${surface} must not reintroduce saturated paint`)
    }
    for (const surface of ['wall', 'cabinetPanel', 'fridgeDoor'] as const) {
      const { lightness } = perceptualColor(roomPresets[style].colors[surface])
      assert.ok(lightness >= 0.4 && lightness <= 0.84, `${style} ${surface} must keep meaningful depth rather than fade to white`)
    }
  }
})

test('approved object finishes match the cabinet and appliance anchors in each new room family', () => {
  for (const [style, cabinet, appliance] of [
    ['coastal', 'ocean', 'teal'], ['lavender', 'plum', 'lilac'],
    ['citrus', 'lime', 'lemon'], ['rose', 'berry', 'rose'],
  ] as const) {
    assert.equal(componentFinishes[cabinet].color, roomPresets[style].colors.cabinetPanel)
    assert.equal(componentFinishes[appliance].color, roomPresets[style].colors.fridgeDoor)
  }
})

function meshes(root: Object3D): Mesh[] {
  const found: Mesh[] = []
  root.traverseVisible((object) => { if (object instanceof Mesh) found.push(object) })
  return found
}

function colors(root: Object3D): string[] {
  return meshes(root).flatMap((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    .filter((material): material is MeshStandardMaterial => material instanceof MeshStandardMaterial)
    .map((material) => material.color.getHexString()))
}

function configuration(roomId: RoomId) {
  const defaults = defaultRoomComponents()
  const fitted = defaults.find((component) => component.id === (roomId === 'kitchen' ? 'default-kitchen-fridge' : 'default-bathroom-sink'))
  assert.ok(fitted)
  const added = roomId === 'kitchen'
    ? createRoomComponent('dishwasher', 'kitchen-undercounter', 'palette-dishwasher')
    : createRoomComponent('washing-machine', 'bathroom-laundry', 'palette-washer')
  return { components: [...defaults, added], targets: [fitted, added] }
}

for (const roomId of ['kitchen', 'bathroom'] as const) {
  test(`every finish survives every ${roomId} preset without replacing actors, materials or cached shadows`, (context) => {
    const { components, targets } = configuration(roomId)
    const preview = createConfiguredRoomPreview(roomId, 'original', components)
    context.after(() => preview.dispose())
    const scene = preview.componentScene
    const actors = targets.map((component) => {
      const actor = scene.actors.get(component.id)
      assert.ok(actor)
      return actor
    })
    const neighbor = scene.actors.get(roomId === 'kitchen' ? 'default-kitchen-table' : 'default-bathroom-bath')
    assert.ok(neighbor)
    const baseline = new Map<RoomStyle, string[][]>()
    for (const style of roomStyleSchema.options) {
      assert.equal(scene.update(components, style).shadowsChanged, false)
      baseline.set(style, [...actors, neighbor].map(colors))
    }
    const originalMeshes = meshes(preview.room)
    const resources = originalMeshes.map((mesh) => ({ mesh, geometry: mesh.geometry, material: mesh.material }))
    const originalActors = [...scene.actors]
    const originalAnchors = [...scene.anchors]
    const bounds = scene.bounds.clone()
    for (const finish of [...componentFinishSchema.options.filter((finish) => finish !== 'room'), 'room'] as const) {
      const configured = components.map((component) => targets.some((target) => target.id === component.id) ? { ...component, finish } : component)
      for (const style of roomStyleSchema.options) {
        assert.deepEqual(scene.update(configured, style), { changed: true, shadowsChanged: false })
        assert.deepEqual([...scene.actors], originalActors)
        assert.deepEqual([...scene.anchors], originalAnchors)
        assert.deepEqual(meshes(preview.room), originalMeshes)
        assert.ok(scene.bounds.equals(bounds))
        for (const { mesh, geometry, material } of resources) {
          assert.equal(mesh.geometry, geometry)
          assert.equal(mesh.material, material)
        }
        for (const [index, actor] of actors.entries()) {
          const color = componentFinishes[finish].color
          if (color) assert.ok(colors(actor).includes(color.slice(1)), `${targets[index].kind} must visibly use ${finish} in ${style}`)
          else assert.deepEqual(colors(actor), baseline.get(style)![index], `Match room colors must restore ${targets[index].kind} in ${style}`)
        }
        assert.deepEqual(colors(neighbor), baseline.get(style)![actors.length], `Changing ${finish} must not recolor a neighboring object`)
      }
    }
  })

  test(`${roomId} saved-room previews and object thumbnails use every supported palette and finish`, (context) => {
    context.after(clearComponentThumbnails)
    const { components, targets } = configuration(roomId)
    const newFinishes = ['ocean', 'teal', 'plum', 'lilac', 'lime', 'lemon', 'berry', 'rose'] as const
    const imageKeys = new Set<string>()
    for (const [index, style] of roomStyleSchema.options.entries()) {
      const configured = components.map((component) => {
        const target = targets.findIndex((target) => target.id === component.id)
        return target < 0 ? component : { ...component, finish: newFinishes[(index + target) % newFinishes.length] }
      })
      const preview = createConfiguredRoomPreview(roomId, style, configured)
      try {
        const palette = roomPresets[style].colors
        const roomColors = colors(preview.room)
        for (const color of [palette.wall, palette.floor, palette.floorAlternate]) assert.ok(roomColors.includes(color.slice(1)), `${roomId} preview must render ${style} surfaces`)
        for (const [target, component] of targets.entries()) {
          const actor = preview.componentScene.actors.get(component.id)
          assert.ok(actor)
          const finish = newFinishes[(index + target) % newFinishes.length]
          assert.ok(colors(actor).includes(componentFinishes[finish].color!.slice(1)), `${roomId} preview must render saved ${finish}`)
          const original = buildComponentThumbnail(component, style)
          try {
            const before = colors(original.root)
            for (const finish of componentFinishSchema.options) {
              const configured = { ...component, finish }
              const thumbnail = buildComponentThumbnail(configured, style)
              try {
                const color = componentFinishes[finish].color
                if (color) assert.ok(colors(thumbnail.root).includes(color.slice(1)), `${component.kind} thumbnail must render ${finish} in ${style}`)
                else assert.deepEqual(colors(thumbnail.root), before)
                assert.deepEqual(colors(original.root), before, 'A custom finish must not tint the cached original thumbnail')
                const key = componentThumbnailKey(configured, style)
                assert.equal(imageKeys.has(key), false, 'Each visual palette and finish combination needs its own cached image')
                imageKeys.add(key)
              } finally { thumbnail.dispose() }
            }
          } finally { original.dispose() }
        }
      } finally { preview.dispose() }
    }
    assert.equal(imageKeys.size, targets.length * roomStyleSchema.options.length * componentFinishSchema.options.length)
  })
}
