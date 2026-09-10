import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { Object3D } from 'three'
import { componentCatalog, createRoomComponent, defaultRoomComponents, roomSlots } from '../shared/roomComponents.ts'
import {
  buildComponentThumbnail, clearComponentThumbnails, componentThumbnailCamera, componentThumbnailKey,
} from '../src/componentThumbnail.ts'
import { componentAvailability, groupedRoomComponents } from '../src/componentAvailability.ts'
import { roomAccents } from '../src/roomStyles.ts'

function colors(root: Object3D) {
  const result: string[] = []
  root.traverseVisible((object) => {
    if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof MeshStandardMaterial) result.push(material.color.getHexString())
    }
  })
  return result
}

test('every component and variant has a centered, unclipped preview built from its real model', (context) => {
  context.after(clearComponentThumbnails)
  for (const slot of roomSlots) for (const kind of slot.kinds) for (const variant of componentCatalog[kind].variants) {
    const component = { ...createRoomComponent(kind, slot.id, `preview-${slot.id}`), variant: variant.id }
    const model = buildComponentThumbnail(component, 'original')
    try {
      const label = `${slot.id}: ${kind} ${variant.id}`
      assert.ok(colors(model.root).length, label)
      const size = model.bounds.getSize(new Vector3())
      assert.ok(Math.abs(Math.max(size.x, size.y, size.z) - 3) < 1e-8, label)
      assert.ok(model.bounds.getCenter(new Vector3()).length() < 1e-8, label)
      const camera = componentThumbnailCamera(model.bounds)
      for (const x of [model.bounds.min.x, model.bounds.max.x]) for (const y of [model.bounds.min.y, model.bounds.max.y]) for (const z of [model.bounds.min.z, model.bounds.max.z]) {
        const point = new Vector3(x, y, z).project(camera)
        assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1, `${label} must fit its preview`)
      }
    } finally { model.dispose() }
  }
})

test('preview finishes do not recolor the shared original model and nonvisual edits reuse images', (context) => {
  context.after(clearComponentThumbnails)
  const component = createRoomComponent('fridge', 'kitchen-fridge', 'preview-fridge')
  const original = buildComponentThumbnail(component, 'original')
  const before = colors(original.root)
  const red = buildComponentThumbnail({ ...component, finish: 'tomato' }, 'original')
  try {
    assert.ok(colors(red.root).includes(roomAccents.tomato.slice(1)))
    assert.deepEqual(colors(original.root), before)
    assert.equal(componentThumbnailKey(component, 'original'), componentThumbnailKey({
      ...component, name: 'Another name', supplies: [], version: 8,
    }, 'original'))
    assert.notEqual(componentThumbnailKey(component, 'original'), componentThumbnailKey({ ...component, finish: 'tomato' }, 'original'))
  } finally { red.dispose(); original.dispose() }
})

test('a rotated return position retains the same readable model orientation in its thumbnail', (context) => {
  context.after(clearComponentThumbnails)
  const counter = buildComponentThumbnail(createRoomComponent('stand-mixer', 'kitchen-coffee', 'counter-mixer'), 'original')
  const fitted = buildComponentThumbnail(createRoomComponent('stand-mixer', 'kitchen-stand-mixer', 'return-mixer'), 'original')
  try {
    assert.ok(counter.bounds.min.distanceTo(fitted.bounds.min) < 0.000001)
    assert.ok(counter.bounds.max.distanceTo(fitted.bounds.max) < 0.000001)
    const vertices = (root: Object3D) => {
      const result: Vector3[] = []
      root.traverseVisible((object) => {
        if (!(object instanceof Mesh)) return
        const points = object.geometry.getAttribute('position')
        for (let index = 0; index < points.count; index++) {
          result.push(new Vector3().fromBufferAttribute(points, index).applyMatrix4(object.matrixWorld))
        }
      })
      return result
    }
    const original = vertices(counter.root)
    const moved = vertices(fitted.root)
    assert.equal(original.length, moved.length)
    assert.ok(original.every((point, index) => point.distanceTo(moved[index]) < 0.000001))
  } finally {
    counter.dispose()
    fitted.dispose()
  }
})

test('availability distinguishes saved objects, unsaved placements and occupied shared positions', () => {
  const saved = defaultRoomComponents()
  assert.equal(componentAvailability('dishwasher', 'kitchen', saved, saved).status, 'available')
  const dishwasher = createRoomComponent('dishwasher', 'kitchen-undercounter', 'preview-dishwasher')
  const draft = [...saved, dishwasher]
  assert.equal(componentAvailability('dishwasher', 'kitchen', draft, saved).status, 'preview')
  assert.equal(componentAvailability('washing-machine', 'kitchen', draft, saved).status, 'occupied')
  assert.equal(componentAvailability('washing-machine', 'kitchen', draft, saved).free, 0)
  assert.equal(componentAvailability('washing-machine', 'bathroom', draft, saved).status, 'available')
  assert.equal(componentAvailability('dishwasher', 'kitchen', draft, draft).status, 'placed')
  assert.equal(componentAvailability('dishwasher', 'kitchen', saved, draft).label, 'Available in preview')
  const plants = componentAvailability('plant', 'kitchen', saved, saved)
  assert.equal(plants.placed, 2)
  assert.ok(plants.free >= 2)
  const groups = groupedRoomComponents(saved.filter((component) => component.roomId === 'kitchen'))
  assert.equal(groups.filter((group) => group.kind === 'plant').length, 1)
  assert.equal(groups.find((group) => group.kind === 'plant')?.items.length, 2)
})
