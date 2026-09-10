import { Box3, Group, Mesh } from 'three'
import type { BufferGeometry, Object3D } from 'three'
import { buildBathroomModel } from '../bathroomModel.ts'
import { buildKitchenModel } from '../kitchenModel.ts'
import { visibleRoomBounds } from '../roomComponentScene.ts'

export type KitchenTourBounds = { room: Box3; groceries: Box3; receipts: Box3; budget: Box3 }
export const tourDoorAngles = [-1.97, -1.72] as const
let overviewBounds: Box3 | undefined

export function sharedTourOverviewBounds(): Box3 {
  if (overviewBounds) return overviewBounds.clone()
  const bounds = new Box3()
  for (const roomId of ['kitchen', 'bathroom'] as const) {
    const room = new Group()
    const model = roomId === 'kitchen' ? buildKitchenModel(room) : buildBathroomModel(room)
    try {
      bounds.union('scenery' in model ? measureKitchenTourBounds(room, model).room : visibleRoomBounds(room).expandByScalar(0.25))
    } finally {
      const geometries = new Set<BufferGeometry>()
      room.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
      geometries.forEach((geometry) => geometry.dispose())
      model.materials.forEach((material) => material.dispose())
    }
  }
  overviewBounds = bounds
  return bounds.clone()
}

export function measureKitchenTourBounds(room: Group, model: ReturnType<typeof buildKitchenModel>): KitchenTourBounds {
  const ledger = model.scenery.actors.get('ledger')
  const budget = model.scenery.actors.get('budget')
  if (!ledger || !budget) throw new Error('The kitchen tour needs its receipt book and house pot.')
  const bounds: KitchenTourBounds = { room: new Box3(), groceries: new Box3(), receipts: new Box3(), budget: new Box3() }
  const doors = model.doors.map((door) => door.rotation.y)
  const receipts = model.scenery.receipts.map((receipt) => ({
    y: receipt.position.y, rotation: receipt.rotation.y, visible: receipt.visible,
  }))
  const union = (target: Box3, object: Object3D) => target.union(visibleRoomBounds(room, object))
  try {
    for (const amount of [0, 0.5, 0.8, 1]) {
      model.doors.forEach((door, index) => { door.rotation.y = tourDoorAngles[index ? 1 : 0] * amount })
      model.scenery.receipts.forEach((receipt, index) => {
        receipt.visible = index < 5
        receipt.position.y = 0.038 + index * 0.012 + index * amount * 0.055
        receipt.rotation.y = Math.sin(index * 2) * 0.04 + amount * index * 0.045
      })
      union(bounds.room, room)
      union(bounds.groceries, model.kitchen)
      union(bounds.receipts, ledger)
      union(bounds.budget, budget)
    }
  } finally {
    model.doors.forEach((door, index) => { door.rotation.y = doors[index] })
    model.scenery.receipts.forEach((receipt, index) => {
      receipt.position.y = receipts[index].y
      receipt.rotation.y = receipts[index].rotation
      receipt.visible = receipts[index].visible
    })
    room.updateMatrixWorld(true)
  }
  for (const volume of Object.values(bounds)) {
    if (volume.isEmpty() || ![...volume.min.toArray(), ...volume.max.toArray()].every(Number.isFinite)) {
      throw new Error('The kitchen tour needs finite visible room and object bounds.')
    }
    volume.expandByScalar(0.25)
  }
  return bounds
}
