import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { Box3, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import type { BufferGeometry, Object3D } from 'three'
import {
  availableComponentSlots, componentAllowedInRoom, componentCatalog, componentIsRetired, componentPositionOffered,
  createRoomComponent, defaultRoomComponents, newHouseholdRoomComponents, roomSlots, validateRoomComponents,
} from '../shared/roomComponents.ts'
import type { ComponentKind, RoomComponent, RoomSlotId } from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { buildBathroomModel } from '../src/bathroomModel.ts'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { buildLivingRoomModel } from '../src/livingRoomModel.ts'
import { buildRoomComponentModel } from '../src/roomComponentModels.ts'
import { createRoomComponentScene, visibleRoomBounds } from '../src/roomComponentScene.ts'
import {
  componentPlacements, kitchenShelves, kitchenWorktops, roomShellBounds, roomShellLayout,
} from '../src/roomLayout.ts'
import { componentSurfaces, roomZoneUsage } from '../shared/roomZones.ts'

const contactTolerance = 0.01
const penetrationTolerance = 0.006
const rooms = ['kitchen', 'bathroom', 'living-room'] as const
const expectedAuditCounts = {
  kitchen: { candidates: 62, legalPairs: 1773 },
  bathroom: { candidates: 27, legalPairs: 328 },
  'living-room': { candidates: 12, legalPairs: 53 },
} as const
const nonPhysicalEnvelopeKinds = new Set<ComponentKind>(['rug'])
const permittedContactPairs = [
  ['bathroom-bath|bathroom-bath-tray', 'bath tray rests across the tub rim'],
  ['bathroom-cleaning-caddy|bathroom-supply-shelf', 'bathroom caddy is a shelf-supported fixture'],
  ['bathroom-sink|bathroom-hair-dryer', 'vanity hair dryer rests on the basin counter'],
  ['bathroom-sink|bathroom-soap-dispenser', 'soap dispenser rests on the basin counter'],
  ['bathroom-sink|bathroom-vanity-accessory', 'vanity accessory rests on the basin counter'],
  ['kitchen-counters|kitchen-dish-rack', 'dish-rack position is on the fitted counter'],
  ['kitchen-counters|kitchen-hob', 'hob is inset into the fitted counter'],
  ['kitchen-counters|kitchen-kettle', 'kettle rests on the hob/counter work surface'],
  ['kitchen-counters|kitchen-soap-dispenser', 'soap dispenser rests on the sink counter'],
  ['kitchen-counters|kitchen-undercounter', 'fitted appliance occupies its cabinet bay'],
  ['kitchen-counters|kitchen-washing-machine', 'fitted washer occupies its cabinet bay'],
  ['kitchen-counters|kitchen-dryer', 'fitted dryer occupies its cabinet bay'],
  ['kitchen-counters|kitchen-oven', 'fitted oven occupies its cabinet bay'],
  ['kitchen-hob|kitchen-kettle', 'kettle rests directly on a burner'],
  ['kitchen-sink|kitchen-soap-dispenser', 'soap dispenser sits beside the sink basin'],
  ['kitchen-table|kitchen-seating', 'stools tuck under the dining table overhang'],
  ['kitchen-table|kitchen-house-pot', 'house pot rests on the table'],
  ['kitchen-table|kitchen-receipt-book', 'receipt book rests on the table'],
  ['kitchen-table|kitchen-settlement-envelope', 'settlement envelope rests on the table'],
  ['kitchen-table|kitchen-shopping-bag', 'shopping bag rests on the table'],
  ['kitchen-table|kitchen-table-center', 'table centerpiece rests on the dining table'],
  ['living-room-bookshelf|living-room-shelf-accessory', 'shelf accessory rests in an open bookshelf bay'],
  ['living-room-coffee-table|living-room-table-top', 'coffee-table object rests on the table top'],
  ['living-room-curtains|living-room-windowsill', 'window ledge objects sit behind curtain folds and are triangle-tested separately'],
  ['living-room-media-unit|living-room-media-accessory', 'media accessory rests on the console surface'],
] as const

type Candidate = {
  roomId: RoomId
  slotId: RoomSlotId
  kind: ComponentKind
  variant: string
}
type PhysicalRecord = {
  component: RoomComponent
  bounds: Box3
  parts: Box3[]
}

function meshes(root: Object3D): Mesh[] {
  const result: Mesh[] = []
  root.traverseVisible((object) => { if (object instanceof Mesh) result.push(object) })
  return result
}

function cleanup(t: TestContext, root: Object3D, materials: readonly MeshStandardMaterial[]) {
  t.after(() => {
    new Set<BufferGeometry>(meshes(root).map((mesh) => mesh.geometry)).forEach((geometry) => geometry.dispose())
    new Set(materials).forEach((material) => material.dispose())
  })
}

function activeKinds(slotId: RoomSlotId): ComponentKind[] {
  const slot = roomSlots.find((candidate) => candidate.id === slotId)!
  return slot.kinds.filter((kind) =>
    !componentIsRetired(kind) && componentAllowedInRoom(kind, slot.roomId) && componentPositionOffered(kind, slot.id))
}

function offeredKindsForSweep(slotId: RoomSlotId): ComponentKind[] {
  const defaults = defaultRoomComponents()
  const slot = roomSlots.find((candidate) => candidate.id === slotId)!
  if (slot.defaultKind) return activeKinds(slotId)
  return activeKinds(slotId).filter((kind) =>
    availableComponentSlots(defaults, slot.roomId, kind, { ignoreZoneCapacity: true }).some((candidate) => candidate.id === slot.id))
}

function activeCandidates(roomId: RoomId): Candidate[] {
  return roomSlots.filter((slot) => slot.roomId === roomId && !defaultRoomComponents().some((component) => component.slotId === slot.id))
    .flatMap((slot) => offeredKindsForSweep(slot.id).flatMap((kind) =>
      componentCatalog[kind].variants.map((variant) => ({ roomId, slotId: slot.id, kind, variant: variant.id }))))
}

function componentFor(candidate: Candidate, idPrefix = 'audit'): RoomComponent {
  return { ...createRoomComponent(candidate.kind, candidate.slotId, `${idPrefix}-${candidate.slotId}-${candidate.kind}-${candidate.variant}`), variant: candidate.variant }
}

function legalLayout(roomId: RoomId, candidates: readonly Candidate[]): RoomComponent[] | null {
  if (new Set(candidates.map((candidate) => candidate.slotId)).size !== candidates.length) return null
  const layout = [
    ...defaultRoomComponents().filter((component) => !candidates.some((candidate) => candidate.slotId === component.slotId)),
    ...candidates.map((candidate, index) => componentFor(candidate, `pair-${index}`)),
  ]
  if (validateRoomComponents(layout)) return null
  if (roomZoneUsage(layout, roomId).some((zone) => zone.used > zone.capacity)) return null
  return layout
}

function maximalLegalLayout(roomId: RoomId): RoomComponent[] {
  let layout = defaultRoomComponents()
  for (const candidate of activeCandidates(roomId)) {
    if (layout.some((component) => component.slotId === candidate.slotId && component.installed)) continue
    const next = legalLayout(roomId, [
      ...layout.filter((component) => component.roomId === roomId && !component.id.startsWith('default-'))
        .map(({ slotId, kind, variant }) => ({ roomId, slotId, kind, variant }) as Candidate),
      candidate,
    ])
    if (next) layout = next
  }
  return layout
}

function hasVolumeOverlap(left: Box3, right: Box3, tolerance = penetrationTolerance): boolean {
  const overlap = left.clone().intersect(right)
  return !overlap.isEmpty() && overlap.getSize(new Vector3()).toArray().every((size) => size > tolerance)
}

function overlapSize(left: Box3, right: Box3): Vector3 {
  return left.clone().intersect(right).getSize(new Vector3())
}

function isDescendant(object: Object3D, root: Object3D): boolean {
  for (let item: Object3D | null = object; item; item = item.parent) {
    if (item === root) return true
  }
  return false
}

function componentParts(root: Object3D, component?: RoomComponent): Box3[] {
  const parts = meshes(root)
    .filter((mesh) => !(component?.slotId === 'kitchen-counters' && mesh.name === 'Continuous L-shaped worktop'))
    .map((mesh) => new Box3().setFromObject(mesh, true))
  if (component?.slotId === 'kitchen-counters') {
    parts.push(...kitchenWorktops.map((top) => new Box3(
      new Vector3(top.position[0] - top.width / 2, top.top - 0.15, top.position[2] - top.depth / 2),
      new Vector3(top.position[0] + top.width / 2, top.top, top.position[2] + top.depth / 2),
    )))
  }
  return parts
}

function partsOverlap(left: readonly Box3[], right: readonly Box3[]): boolean {
  return left.some((a) => right.some((b) => hasVolumeOverlap(a, b)))
}

function contactFootprint(root: Object3D, bottom: number): Box3 {
  const footprint = new Box3()
  for (const part of componentParts(root)) {
    if (part.min.y <= bottom + 0.08) footprint.union(part)
  }
  return footprint.isEmpty() ? new Box3().setFromObject(root, true) : footprint
}

function recordFor(component: RoomComponent, root: Object3D, room: Group): PhysicalRecord {
  return { component, bounds: visibleRoomBounds(room, root), parts: componentParts(root, component) }
}

function buildEmptyRoom(t: TestContext, roomId: RoomId) {
  const room = new Group()
  const model = roomId === 'kitchen' ? buildKitchenModel(room)
    : roomId === 'bathroom' ? buildBathroomModel(room) : buildLivingRoomModel(room)
  const componentModel = 'scenery' in model ? model.scenery : model
  const scene = createRoomComponentScene(room, roomId, {
    bindings: componentModel.componentBindings, fixtures: componentModel.componentFixtures, styleMaterials: model.styleMaterials,
  })
  t.after(() => scene.dispose())
  cleanup(t, room, model.materials)
  return { room, scene }
}

function buildCandidate(t: TestContext, component: RoomComponent) {
  const model = buildRoomComponentModel(component, 'original')
  model.stateObjects?.forEach(({ root }) => { root.visible = true })
  cleanup(t, model.root, model.materials)
  return model.root
}

function supportSurfaces(roomId: RoomId, room: Group): { name: string; top: number; bounds: Box3 }[] {
  const measured: { name: string; top: number; bounds: Box3 }[] = []
  room.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const bounds = new Box3().setFromObject(object, true)
    const size = bounds.getSize(new Vector3())
    if (size.y <= 0.16 && size.x >= 0.3 && size.z >= 0.25) measured.push({ name: object.name || object.geometry.type, top: bounds.max.y, bounds })
  })
  if (roomId === 'kitchen') {
    return [
      ...kitchenWorktops.map((top) => ({
        name: top.name, top: top.top,
        bounds: new Box3(
          new Vector3(top.position[0] - top.width / 2, top.top - 0.03, top.position[2] - top.depth / 2),
          new Vector3(top.position[0] + top.width / 2, top.top + 0.03, top.position[2] + top.depth / 2),
        ),
      })),
      ...kitchenShelves.map((shelf) => ({
        name: shelf.name, top: shelf.top,
        bounds: new Box3(
          new Vector3(shelf.position[0] - shelf.width / 2, shelf.top - 0.03, shelf.position[2] - shelf.depth / 2),
          new Vector3(shelf.position[0] + shelf.width / 2, shelf.top + 0.03, shelf.position[2] + shelf.depth / 2),
        ),
      })),
      ...measured,
    ]
  }
  return measured
}

function horizontalSupportSurface(roomId: RoomId, room: Group, root: Object3D, y: number) {
  const inset = 0.018
  const footprint = contactFootprint(root, y)
  const support = supportSurfaces(roomId, room).find((surface) =>
    footprint.min.x >= surface.bounds.min.x - contactTolerance && footprint.max.x <= surface.bounds.max.x + contactTolerance
    && footprint.min.z >= surface.bounds.min.z - contactTolerance && footprint.max.z <= surface.bounds.max.z + contactTolerance
    && Math.abs(y - surface.top) <= 0.035)
  if (support) return support
  const points = [
    [footprint.min.x + inset, footprint.min.z + inset], [footprint.min.x + inset, footprint.max.z - inset],
    [footprint.max.x - inset, footprint.min.z + inset], [footprint.max.x - inset, footprint.max.z - inset],
    [(footprint.min.x + footprint.max.x) / 2, (footprint.min.z + footprint.max.z) / 2],
  ] as const
  return points.every(([x, z]) => new Raycaster(new Vector3(x, y + 0.25, z), new Vector3(0, -1, 0)).intersectObject(room, true)
    .some((hit) => !isDescendant(hit.object, root) && hit.point.y <= y + contactTolerance && Math.abs(hit.point.y - y) <= 0.08))
}

function assertSupported(roomId: RoomId, component: RoomComponent, root: Object3D, room: Group) {
  const placement = componentPlacements[component.slotId]
  if (!placement) return
  const bounds = visibleRoomBounds(room, root)
  if (placement.surface === 'floor' || placement.surface === 'fitted') {
    assert.ok(bounds.min.y >= -contactTolerance, `${component.slotId} (${component.kind}) must not sink below the floor`)
    if (placement.surface === 'floor') assert.ok(bounds.min.y <= 0.08, `${component.slotId} (${component.kind}) must rest on the floor`)
    return
  }
  if (placement.surface === 'wall') {
    const { inner } = roomShellLayout(roomId)
    const wallGap = Math.min(
      Math.abs(bounds.min.z - inner.back), Math.abs(bounds.min.x - inner.left), Math.abs(bounds.max.x - inner.right),
    )
    assert.ok(wallGap <= 0.08, `${component.slotId} (${component.kind}) must stay mounted to an interior wall face`)
    assert.ok(bounds.min.z >= inner.back - contactTolerance, `${component.slotId} (${component.kind}) must not penetrate the back wall`)
    assert.ok(bounds.min.x >= inner.left - contactTolerance, `${component.slotId} (${component.kind}) must not penetrate the left wall`)
    assert.ok(bounds.max.x <= inner.right + contactTolerance, `${component.slotId} (${component.kind}) must not penetrate the right wall`)
    return
  }
  if (placement.surface === 'counter' || placement.surface === 'table' || placement.surface === 'bath') {
    assert.ok(Math.abs(bounds.min.y - placement.position[1]) <= 0.08,
      `${component.slotId} (${component.kind}) must use the authored support height`)
    assert.ok(horizontalSupportSurface(roomId, room, root, placement.position[1]),
      `${component.slotId} (${component.kind}) must keep its physical footprint on a real support surface`)
  }
}

function allowedContact(a: PhysicalRecord, b: PhysicalRecord): string | null {
  if (nonPhysicalEnvelopeKinds.has(a.component.kind) || nonPhysicalEnvelopeKinds.has(b.component.kind)) return 'rug is a flat floor covering'
  if ((a.component.slotId === 'kitchen-counters' && b.component.slotId === 'kitchen-sink')
    || (a.component.slotId === 'kitchen-sink' && b.component.slotId === 'kitchen-counters')) {
    return 'sink is inset into the fitted counter'
  }
  const explicit = permittedContactPairs.find(([key]) => {
    const [left, right] = key.split('|')
    return (left === a.component.slotId && right === b.component.slotId) || (left === b.component.slotId && right === a.component.slotId)
  })?.[1]
  if (explicit) return explicit
  const aSurface = componentSurfaces[a.component.slotId]
  const bSurface = componentSurfaces[b.component.slotId]
  const overlap = overlapSize(a.bounds, b.bounds)
  if (overlap.y <= contactTolerance) return 'touching faces share a support plane'
  const aOnB = ['counter', 'table', 'bath'].includes(aSurface ?? '') && b.bounds.max.y <= a.bounds.min.y + 0.09
  const bOnA = ['counter', 'table', 'bath'].includes(bSurface ?? '') && a.bounds.max.y <= b.bounds.min.y + 0.09
  if ((aOnB || bOnA) && overlap.y <= 0.09) return 'supported object rests on a fixture surface'
  if ((aSurface === 'fitted' && b.component.kind === 'counters') || (bSurface === 'fitted' && a.component.kind === 'counters')) {
    return 'fitted appliance is installed inside a cabinet bay'
  }
  return null
}

function assertNoUnexpectedOverlap(a: PhysicalRecord, b: PhysicalRecord) {
  const collision = a.parts.some((left) => b.parts.some((right) => hasVolumeOverlap(left, right)))
  if (!collision) return null
  const reason = allowedContact(a, b)
  assert.ok(reason, `${a.component.slotId} (${a.component.kind}) must clear ${b.component.slotId} (${b.component.kind}); `
    + `overlap ${overlapSize(a.bounds, b.bounds).toArray().map((value) => value.toFixed(4)).join(', ')}`)
  return reason
}

function assertRoomClearance(roomId: RoomId, record: PhysicalRecord) {
  const shell = roomShellBounds(roomId).expandByScalar(0.025)
  assert.ok(record.bounds.min.x >= shell.min.x && record.bounds.max.x <= shell.max.x,
    `${record.component.slotId} (${record.component.kind}) must stay inside room width`)
  assert.ok(record.bounds.min.z >= shell.min.z && record.bounds.max.z <= shell.max.z,
    `${record.component.slotId} (${record.component.kind}) must stay inside room depth`)
  assert.ok(record.bounds.min.y >= shell.min.y && record.bounds.max.y <= shell.max.y,
    `${record.component.slotId} (${record.component.kind}) must stay inside room height`)
}

function pairCount(roomId: RoomId, candidates: readonly Candidate[]): number {
  let count = 0
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    if (legalLayout(roomId, [candidates[i], candidates[j]])) count++
  }
  return count
}

test('active living-room wall offers remain available after classifying the TV as wall-mounted', () => {
  const defaults = defaultRoomComponents()
  assert.deepEqual(availableComponentSlots(defaults, 'living-room', 'wall-art').map((slot) => slot.id), ['living-room-wall-art'])
  assert.deepEqual(availableComponentSlots(defaults, 'living-room', 'tv').map((slot) => slot.id), [])
  assert.equal(defaults.some((component) => component.slotId === 'living-room-bins'), false)
  assert.deepEqual(roomZoneUsage(defaults, 'living-room').find((zone) => zone.surface === 'wall'), {
    surface: 'wall', label: 'Wall', used: 2, capacity: 3,
  })
})

test('retired legacy-only kinds are excluded from the new-placement audit surface', () => {
  for (const kind of ['vacuum', 'toothbrush-holder', 'dish-rack'] as const) {
    assert.equal(componentIsRetired(kind), true)
    for (const roomId of rooms) assert.deepEqual(availableComponentSlots(defaultRoomComponents(), roomId, kind), [])
  }
})

for (const roomId of rooms) {
  test(`active ${roomId} candidates clear default fixtures and satisfy support geometry`, (t) => {
    const candidates = activeCandidates(roomId)
    assert.equal(candidates.length, expectedAuditCounts[roomId].candidates)
    const { room, scene } = buildEmptyRoom(t, roomId)
    const defaults = defaultRoomComponents()
    let checked = 0
    const exceptionReasons = new Set<string>()
    for (const candidate of candidates) {
      const component = componentFor(candidate, 'candidate')
      scene.update([...defaults.filter((item) => item.slotId !== component.slotId), component], 'original')
      const candidateRecord = recordFor(component, scene.actors.get(component.id)!, room)
      assertRoomClearance(roomId, candidateRecord)
      assertSupported(roomId, component, scene.actors.get(component.id)!, room)
      for (const other of defaults.filter((item) => item.roomId === roomId && item.slotId !== component.slotId)) {
        const otherRoot = scene.actors.get(other.id)
        if (!otherRoot) continue
        const reason = assertNoUnexpectedOverlap(candidateRecord, recordFor(other, otherRoot, room))
        if (reason) exceptionReasons.add(reason)
      }
      checked++
    }
    t.diagnostic(`${roomId}: checked ${checked} active candidates against complete default fixtures; exceptions: ${[...exceptionReasons].sort().join('; ') || 'none'}`)
  })

  test(`active ${roomId} candidates have exhaustive legal pairwise clearance`, (t) => {
    const candidates = activeCandidates(roomId)
    const expectedPairs = expectedAuditCounts[roomId].legalPairs
    assert.equal(pairCount(roomId, candidates), expectedPairs)
    const records = new Map<Candidate, PhysicalRecord>()
    for (const candidate of candidates) {
      const component = componentFor(candidate, 'cached')
      const root = buildCandidate(t, component)
      records.set(candidate, { component, bounds: new Box3().setFromObject(root, true), parts: componentParts(root, component) })
    }
    let checked = 0
    const exceptionReasons = new Set<string>()
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
      const left = candidates[i]
      const right = candidates[j]
      if (!legalLayout(roomId, [left, right])) continue
      const reason = assertNoUnexpectedOverlap(records.get(left)!, records.get(right)!)
      if (reason) exceptionReasons.add(reason)
      checked++
    }
    assert.equal(checked, expectedPairs)
    t.diagnostic(`${roomId}: checked ${checked} simultaneously legal active candidate pairs; exceptions: ${[...exceptionReasons].sort().join('; ') || 'none'}`)
  })

  test(`${roomId} default, starter and maximal active compositions have no unexpected physical overlaps`, (t) => {
    const layouts = [
      { name: 'default', components: defaultRoomComponents() },
      { name: 'new-household starter', components: newHouseholdRoomComponents(randomUUID) },
      { name: 'maximal active', components: maximalLegalLayout(roomId) },
    ]
    for (const { name, components } of layouts) {
      assert.equal(validateRoomComponents(components), null, `${name} ${roomId} layout must be component-valid`)
      assert.ok(roomZoneUsage(components, roomId).every((zone) => zone.used <= zone.capacity), `${name} ${roomId} layout must respect zone budgets`)
      const preview = createConfiguredRoomPreview(roomId, 'original', components)
      t.after(() => preview.dispose())
      const records = components.filter((component) => component.roomId === roomId && preview.componentScene.actors.has(component.id))
        .map((component) => recordFor(component, preview.componentScene.actors.get(component.id)!, preview.room))
      const exceptionReasons = new Set<string>()
      for (const record of records) {
        assertRoomClearance(roomId, record)
        assertSupported(roomId, record.component, preview.componentScene.actors.get(record.component.id)!, preview.room)
      }
      for (let i = 0; i < records.length; i++) for (let j = i + 1; j < records.length; j++) {
        const reason = assertNoUnexpectedOverlap(records[i], records[j])
        if (reason) exceptionReasons.add(reason)
      }
      t.diagnostic(`${roomId} ${name}: checked ${records.length} placed objects; exceptions: ${[...exceptionReasons].sort().join('; ') || 'none'}`)
    }
  })
}

test('dynamic kitchen door and lid envelopes retain placement clearance', (t) => {
  const room = new Group()
  const model = buildKitchenModel(room)
  const scene = createRoomComponentScene(room, 'kitchen', {
    bindings: model.scenery.componentBindings, fixtures: model.scenery.componentFixtures, styleMaterials: model.styleMaterials,
  })
  t.after(() => {
    scene.dispose()
    const geometries = new Set<BufferGeometry>()
    room.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
    geometries.forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
  })
  const components = maximalLegalLayout('kitchen')
  scene.update(components, 'original')
  room.updateMatrixWorld(true)
  const placed = components.filter((component) => component.roomId === 'kitchen' && component.slotId !== 'kitchen-fridge'
    && !['kitchen-counters', 'kitchen-sink', 'kitchen-hob'].includes(component.slotId))
    .map((component) => recordFor(component, scene.actors.get(component.id)!, room))
  for (const door of model.doors) {
    for (const angle of [0, -0.4, -0.8, -1.2, -1.6, -1.97]) {
      door.rotation.y = angle
      room.updateMatrixWorld(true)
      const doorParts = componentParts(door)
      for (const { component, parts } of placed) {
        assert.equal(partsOverlap(doorParts, parts), false, `${component.slotId} must leave the fridge door sweep clear`)
      }
    }
  }
  const kettle = scene.actors.get('default-kitchen-kettle')!
  const lid = model.scenery.kettleLid
  const kettleBounds = visibleRoomBounds(room, kettle)
  lid.position.y += 0.18
  room.updateMatrixWorld(true)
  const liftedLid = new Box3().setFromObject(lid, true)
  assert.ok(kettleBounds.expandByVector(new Vector3(0.03, 0.25, 0.03)).containsBox(liftedLid),
    'The kettle lid lift must stay within the kettle placement envelope')
})

test('active wall-mounted spice rack offers exclude unsupported countertop history while remaining buildable', (t) => {
  assert.deepEqual(availableComponentSlots(defaultRoomComponents(), 'kitchen', 'spice-rack', { ignoreZoneCapacity: true })
    .map((slot) => slot.id).sort(), ['kitchen-left-wall', 'kitchen-spice-rack', 'kitchen-wall-art'])
  for (const slotId of ['kitchen-spice-rack', 'kitchen-wall-art', 'kitchen-left-wall'] as const) {
    const root = buildCandidate(t, createRoomComponent('spice-rack', slotId, `spice-${slotId}`))
    const bounds = new Box3().setFromObject(root, true)
    assert.ok(!bounds.isEmpty())
    assert.ok(bounds.min.toArray().every(Number.isFinite) && bounds.max.toArray().every(Number.isFinite))
  }
})
