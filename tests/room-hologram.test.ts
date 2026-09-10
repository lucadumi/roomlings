import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import {
  BackSide, Box3, BoxGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Raycaster, Vector3,
} from 'three'
import type { Material, Object3D } from 'three'
import { componentFinishes, createRoomComponent, defaultRoomComponents } from '../shared/roomComponents.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import type { RoomId } from '../shared/rooms.ts'
import { batchStaticMeshes } from '../src/batchStaticMeshes.ts'
import { buildBathroomModel } from '../src/bathroomModel.ts'
import { buildKitchenModel } from '../src/kitchenModel.ts'
import { createContactShadowTexture } from '../src/lighting.ts'
import { dampTo } from '../src/motion.ts'
import { createRoomComponentScene, isSceneObjectVisible, visibleRoomBounds } from '../src/roomComponentScene.ts'
import { createRoomHologram } from '../src/roomHologram.ts'
import { roomAccents, roomPresets } from '../src/roomStyles.ts'

function meshes(root: Object3D) {
  const result: Mesh[] = []
  root.traverse((object) => { if (object instanceof Mesh) result.push(object) })
  return result
}

function materials(root: Object3D): Material[] {
  return [...new Set(meshes(root).flatMap((mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]))]
}

function outlines(root: Object3D) {
  const result: LineSegments[] = []
  root.traverse((object) => { if (object instanceof LineSegments) result.push(object) })
  return result
}

function fixture(t: TestContext) {
  const room = new Group()
  const geometry = new BoxGeometry()
  const material = new MeshStandardMaterial({ color: roomAccents.tomato, roughness: 0.35, metalness: 0.3, flatShading: true })
  const makeMesh = (parent: Group) => {
    const mesh: Mesh = new Mesh(geometry, material)
    mesh.castShadow = mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const wall = makeMesh(room)
  wall.position.set(-3, 1, 0)
  wall.scale.set(1, 3, 4)
  const floor = makeMesh(room)
  floor.position.set(0, -1, 0)
  floor.scale.set(7, 0.2, 6)
  floor.castShadow = false
  const cabinet = new Group()
  room.add(cabinet)
  const cabinetMesh = makeMesh(cabinet)
  const candidate = new Group()
  cabinet.add(candidate)
  candidate.position.set(0, 2, 0)
  const candidateMesh = makeMesh(candidate)
  const neighbor = new Group()
  candidate.add(neighbor)
  neighbor.position.set(0, 1.5, 0)
  const neighborMesh = makeMesh(neighbor)
  const hidden = makeMesh(room)
  hidden.visible = false
  const shadowMaterial = new MeshBasicMaterial({ color: '#535d45', transparent: true, opacity: 0.2 })
  const shadowGeometry = new PlaneGeometry(8, 6)
  const contact = new Mesh(shadowGeometry, shadowMaterial)
  contact.userData.componentContact = true
  contact.raycast = () => {}
  const contactGroup = new Group()
  contactGroup.add(contact)
  room.add(contactGroup)
  const ground = new Mesh(shadowGeometry, shadowMaterial)
  ground.castShadow = true
  const roots = [cabinet, candidate, neighbor]
  const hologram = createRoomHologram(room, ground)
  t.after(() => {
    hologram.dispose()
    geometry.dispose()
    material.dispose()
    shadowMaterial.dispose()
    shadowGeometry.dispose()
  })
  return { room, wall, floor, cabinetMesh, candidate, candidateMesh, neighbor, neighborMesh, hidden, contact, ground, material, roots, hologram }
}

function roomFixture(t: TestContext, roomId: RoomId) {
  const room = new Group()
  const model = roomId === 'kitchen' ? buildKitchenModel(room) : buildBathroomModel(room)
  const componentModel = 'scenery' in model ? model.scenery : model
  const shadowTexture = createContactShadowTexture()
  const scene = createRoomComponentScene(room, roomId, {
    bindings: componentModel.componentBindings, fixtures: componentModel.componentFixtures,
    styleMaterials: model.styleMaterials, shadowTexture,
  })
  const ground = new Mesh(new PlaneGeometry(15, 13), new MeshBasicMaterial({ transparent: true, opacity: 0.2 }))
  const hologram = createRoomHologram(room, ground)
  t.after(() => {
    hologram.dispose()
    scene.dispose()
    new Set(meshes(room).map((mesh) => mesh.geometry)).forEach((geometry) => geometry.dispose())
    model.materials.forEach((material) => material.dispose())
    ground.geometry.dispose()
    ground.material.dispose()
    shadowTexture.dispose()
  })
  return { room, model, scene, ground, hologram }
}

test('holograms cover the entire room but stop at the candidate and nested component boundaries', (t) => {
  const { room, wall, floor, cabinetMesh, candidate, candidateMesh, neighborMesh, hidden, contact, ground, material, roots, hologram } = fixture(t)
  const originals = meshes(room).map((mesh) => ({ mesh, geometry: mesh.geometry, parent: mesh.parent, id: mesh.id }))
  const color = material.color.getHexString()
  assert.deepEqual(hologram.update(candidate, roots), { changed: true, shadowsChanged: true })
  for (const mesh of [wall, floor, cabinetMesh, neighborMesh, hidden]) {
    assert.ok(mesh.material instanceof MeshBasicMaterial)
    assert.equal(mesh.material.color.getHexString(), roomAccents.leafLight.slice(1))
    assert.equal(mesh.material.transparent, true)
    assert.equal(mesh.material.depthWrite, false)
    assert.ok(mesh.material.opacity > 0 && mesh.material.opacity < 0.4)
    assert.equal(mesh.castShadow, false)
    assert.equal(mesh.receiveShadow, false)
    assert.equal(outlines(mesh).length, 1)
  }
  assert.equal(candidateMesh.material, material)
  assert.equal(candidateMesh.castShadow, true)
  assert.equal(candidateMesh.receiveShadow, true)
  assert.equal(outlines(candidateMesh).length, 0)
  assert.equal(material.color.getHexString(), color)
  assert.equal(material.roughness, 0.35)
  assert.equal(material.metalness, 0.3)
  assert.equal(material.flatShading, true)
  assert.equal(hidden.visible, false)
  assert.equal(contact.visible, false)
  assert.equal(outlines(contact).length, 0)
  assert.equal(ground.visible, false)
  assert.equal(ground.castShadow, false)
  for (const { mesh, geometry, parent, id } of originals) {
    assert.equal(mesh.geometry, geometry)
    assert.equal(mesh.parent, parent)
    assert.equal(mesh.id, id)
  }
})

test('clearing or disposing a preview restores material arrays, identities, visibility and shadow flags', (t) => {
  const { room, wall, ground, candidate, roots, hologram, material } = fixture(t)
  const back = material.clone()
  back.side = BackSide
  t.after(() => back.dispose())
  const originalMaterials = [material, back, material, back, material, back]
  wall.material = originalMaterials
  ground.visible = false
  const originals = meshes(room).map((mesh) => ({
    mesh, material: mesh.material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, visible: mesh.visible,
  }))
  hologram.update(candidate, roots)
  const lineMaterials = new Set(outlines(room).flatMap((outline) => Array.isArray(outline.material) ? outline.material : [outline.material]))
  const lineDisposals = new Map([...lineMaterials].map((entry) => [entry, 0]))
  lineMaterials.forEach((entry) => entry.addEventListener('dispose', () => lineDisposals.set(entry, lineDisposals.get(entry)! + 1)))
  assert.ok(Array.isArray(wall.material))
  assert.equal(wall.material.length, originalMaterials.length)
  wall.material.forEach((entry, index) => assert.equal(entry.side, originalMaterials[index].side))
  assert.deepEqual(hologram.update(null, roots), { changed: true, shadowsChanged: true })
  assert.equal(wall.material, originalMaterials)
  for (const saved of originals) {
    assert.equal(saved.mesh.material, saved.material)
    assert.equal(saved.mesh.castShadow, saved.castShadow)
    assert.equal(saved.mesh.receiveShadow, saved.receiveShadow)
    assert.equal(saved.mesh.visible, saved.visible)
  }
  assert.equal(ground.visible, false)
  assert.equal(ground.castShadow, true)
  assert.equal(outlines(room).length, 0)
  for (const count of lineDisposals.values()) assert.equal(count, 1)
  assert.deepEqual(hologram.update(undefined), { changed: false, shadowsChanged: false })
  hologram.update(candidate, roots)
  hologram.dispose()
  hologram.dispose()
  assert.equal(wall.material, originalMaterials)
  assert.equal(outlines(room).length, 0)
  assert.equal(ground.visible, false)
  assert.throws(() => hologram.update(candidate, roots), /disposed room hologram/)
})

test('switching, hiding or losing the candidate cannot leave the room ghosted', (t) => {
  const { room, wall, candidate, candidateMesh, neighbor, neighborMesh, roots, hologram, material } = fixture(t)
  hologram.update(candidate, roots)
  assert.deepEqual(hologram.update(neighbor, roots), { changed: true, shadowsChanged: true })
  assert.notEqual(candidateMesh.material, material)
  assert.equal(neighborMesh.material, material)
  assert.equal(neighborMesh.castShadow, true)
  neighbor.visible = false
  assert.deepEqual(hologram.update(neighbor, roots), { changed: true, shadowsChanged: true })
  assert.equal(hologram.candidate, null)
  assert.equal(wall.material, material)
  assert.equal(neighbor.visible, false)
  neighbor.visible = true
  hologram.update(candidate, roots)
  candidate.removeFromParent()
  assert.deepEqual(hologram.update(candidate, roots), { changed: true, shadowsChanged: true })
  assert.equal(wall.material, material)
  assert.equal(candidateMesh.material, material)
  assert.equal(outlines(candidate).length, 0)
  assert.deepEqual(hologram.update(new Group(), roots), { changed: false, shadowsChanged: false })
  assert.deepEqual(hologram.update(room, roots), { changed: false, shadowsChanged: false })
})

test('outlines follow mesh transforms without intercepting rays or changing measured bounds', (t) => {
  const { room, wall, candidate, roots, hologram } = fixture(t)
  const before = visibleRoomBounds(room)
  const fullBounds = new Box3().setFromObject(room)
  const ray = new Raycaster(new Vector3(-3, 1, 10), new Vector3(0, 0, -1))
  const hits = ray.intersectObject(wall, true).map(({ object, distance }) => [object.id, distance])
  hologram.update(candidate, roots)
  assert.deepEqual(visibleRoomBounds(room), before)
  assert.deepEqual(new Box3().setFromObject(room), fullBounds)
  assert.deepEqual(ray.intersectObject(wall, true).map(({ object, distance }) => [object.id, distance]), hits)
  const [outline] = outlines(wall)
  assert.ok(outline)
  assert.deepEqual(ray.intersectObject(outline), [])
  assert.equal(outline.castShadow, false)
  assert.equal(outline.receiveShadow, false)
  assert.ok(outline.material instanceof LineBasicMaterial)
  assert.equal(outline.material.depthWrite, false)
  wall.position.add(new Vector3(0.3, 0.2, 0.1))
  wall.rotation.y = 0.4
  wall.scale.set(0.8, 1.2, 1.5)
  room.rotation.y = 0.2
  room.updateMatrixWorld(true)
  assert.deepEqual(outline.matrixWorld.toArray(), wall.matrixWorld.toArray())
  assert.deepEqual(outline.scale.toArray(), [1, 1, 1])
  const movedBounds = visibleRoomBounds(room)
  hologram.update(null)
  assert.deepEqual(visibleRoomBounds(room), movedBounds)
})

test('stable updates reuse outline resources and shadow maps, including normal-material animation writes', (t) => {
  const { room, wall, candidate, candidateMesh, roots, material, hologram } = fixture(t)
  hologram.update(candidate, roots)
  const originalOutlines = outlines(room)
  const originalMaterials = materials(room)
  const resources = [...originalOutlines.map((outline) => outline.geometry), ...originalMaterials.filter((entry) => entry !== material)]
  let disposals = 0
  resources.forEach((resource) => resource.addEventListener('dispose', () => { disposals++ }))
  for (let index = 0; index < 8; index++) {
    hologram.prepareUpdate()
    material.color.set(index % 2 ? roomAccents.tomato : roomAccents.blue)
    assert.deepEqual(hologram.update(candidate, roots), { changed: false, shadowsChanged: false })
    assert.deepEqual(outlines(room), originalOutlines)
    assert.deepEqual(materials(room), originalMaterials)
  }
  assert.equal(disposals, 0)
  candidateMesh.visible = false
  assert.equal(hologram.update(candidate, roots).shadowsChanged, true)
  assert.deepEqual(hologram.update(candidate, roots), { changed: false, shadowsChanged: false })
  candidateMesh.visible = true
  assert.equal(hologram.update(candidate, roots).shadowsChanged, true)
  hologram.prepareUpdate()
  wall.castShadow = false
  wall.receiveShadow = false
  material.transparent = true
  material.opacity = 0.3
  assert.equal(hologram.update(candidate, roots).shadowsChanged, false)
  assert.ok(wall.material instanceof MeshBasicMaterial)
  assert.equal(wall.material.opacity, 0.22 * 0.3)
  hologram.update(null)
  assert.equal(wall.castShadow, false)
  assert.equal(wall.receiveShadow, false)
  assert.equal(wall.material, material)
  assert.equal(material.opacity, 0.3)
})

test('geometry and material replacements retire only stale hologram resources', (t) => {
  const { room, wall, candidate, roots, hologram, material } = fixture(t)
  const independent = material.clone()
  wall.material = independent
  const replacement = new MeshStandardMaterial({ color: roomAccents.cream })
  const replacementGeometry = new BoxGeometry(2, 2, 2)
  t.after(() => { independent.dispose(); replacement.dispose(); replacementGeometry.dispose() })
  hologram.update(candidate, roots)
  const [originalOutline] = outlines(wall)
  const ghostMaterial = wall.material
  assert.ok(!Array.isArray(ghostMaterial))
  let edgesDisposed = 0
  let ghostDisposed = 0
  let originalDisposed = 0
  originalOutline.geometry.addEventListener('dispose', () => { edgesDisposed++ })
  ghostMaterial.addEventListener('dispose', () => { ghostDisposed++ })
  wall.geometry.addEventListener('dispose', () => { originalDisposed++ })
  independent.addEventListener('dispose', () => { originalDisposed++ })
  hologram.prepareUpdate()
  wall.geometry = replacementGeometry
  wall.material = replacement
  hologram.update(candidate, roots)
  assert.equal(edgesDisposed, 1)
  assert.equal(ghostDisposed, 1)
  assert.equal(originalDisposed, 0)
  assert.notEqual(outlines(wall)[0], originalOutline)
  const [replacementOutline] = outlines(wall)
  let replacementDisposed = 0
  replacementOutline.geometry.addEventListener('dispose', () => { replacementDisposed++ })
  wall.removeFromParent()
  hologram.update(candidate, roots)
  assert.equal(replacementDisposed, 1)
  assert.equal(outlines(wall).length, 0)
  assert.equal(wall.material, replacement)
  assert.equal(room.getObjectById(wall.id), undefined)
  hologram.dispose()
  assert.equal(edgesDisposed, 1)
  assert.equal(ghostDisposed, 1)
  assert.equal(replacementDisposed, 1)
})

for (const roomId of ['kitchen', 'bathroom'] as const) {
  test(`${roomId} batching, palette changes and object finishes stay live throughout a placement`, (t) => {
    const { room, model, scene, ground, hologram } = roomFixture(t, roomId)
    const component = roomId === 'kitchen'
      ? createRoomComponent('dishwasher', 'kitchen-undercounter', 'preview')
      : createRoomComponent('washing-machine', 'bathroom-laundry', 'preview')
    const defaults = defaultRoomComponents()
    const layout = [...defaults, component]
    scene.update(layout, 'original')
    batchStaticMeshes(room, 'scenery' in model ? model.scenery.preserved : new Set())
    const originals = meshes(room).map((mesh) => ({
      mesh, geometry: mesh.geometry, material: mesh.material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow,
    }))
    const bounds = visibleRoomBounds(room)
    const actor = scene.actors.get(component.id)!
    const anchor = scene.anchors.get(component.id)
    const candidateMaterials = materials(actor)
    const candidateMeshes = new Set(meshes(actor))
    const paint = candidateMaterials.find((material) => material.name === 'fridge')
    assert.ok(paint instanceof MeshStandardMaterial)
    hologram.update(actor, scene.actors.values())
    for (const saved of originals) {
      if (saved.mesh.userData.componentContact) {
        assert.equal(saved.mesh.visible, false)
      } else if (candidateMeshes.has(saved.mesh)) {
        assert.equal(saved.mesh.material, saved.material)
      } else {
        assert.notEqual(saved.mesh.material, saved.material, `${roomId}: every existing surface must be a hologram`)
        assert.equal(saved.mesh.castShadow, false)
        assert.equal(saved.mesh.receiveShadow, false)
      }
    }
    const neighborId = roomId === 'kitchen' ? 'default-kitchen-fridge' : 'default-bathroom-bath'
    const edited: RoomComponent[] = layout.map((entry) => entry.id === component.id ? { ...entry, finish: 'tomato' }
      : entry.id === neighborId ? { ...entry, finish: 'walnut' } : entry)
    assert.deepEqual(scene.update(edited, 'coastal'), { changed: true, shadowsChanged: false })
    assert.deepEqual(hologram.update(actor, scene.actors.values()), { changed: false, shadowsChanged: false })
    assert.equal(paint.color.getHexString(), componentFinishes.tomato.color!.slice(1))
    assert.equal(paint.emissive.getHexString(), '000000')
    assert.equal(scene.actors.get(component.id), actor)
    assert.equal(scene.anchors.get(component.id), anchor)
    assert.deepEqual(materials(actor), candidateMaterials)
    assert.deepEqual(visibleRoomBounds(room), bounds)
    assert.equal(ground.visible, false)
    hologram.update(null)
    assert.equal(model.styleMaterials.wall.color.getHexString(), roomPresets.coastal.colors.wall.slice(1))
    assert.ok(materials(scene.actors.get(neighborId)!).some((material) => material instanceof MeshStandardMaterial
      && material.color.getHexString() === componentFinishes.walnut.color!.slice(1)))
    assert.equal(ground.visible, true)
    assert.equal(outlines(room).length, 0)
    for (const saved of originals) {
      assert.equal(saved.mesh.geometry, saved.geometry)
      assert.equal(saved.mesh.material, saved.material)
      assert.equal(saved.mesh.castShadow, saved.castShadow)
      assert.equal(saved.mesh.receiveShadow, saved.receiveShadow)
      if (saved.mesh.userData.componentContact) assert.equal(saved.mesh.visible, true)
    }
    assert.equal(JSON.stringify(layout), JSON.stringify([...defaults, component]))
  })
}

test('optional actors can be replaced while ghosted or while they are the candidate', (t) => {
  const { room, scene, hologram } = roomFixture(t, 'kitchen')
  const defaults = defaultRoomComponents()
  const dishwasher = createRoomComponent('dishwasher', 'kitchen-undercounter', 'preview')
  const microwave = createRoomComponent('microwave', 'kitchen-small-appliance', 'appliance')
  scene.update([...defaults, dishwasher, microwave], 'original')
  const candidate = scene.actors.get(dishwasher.id)!
  const oldAppliance = scene.actors.get(microwave.id)!
  hologram.update(candidate, scene.actors.values())
  const oldResources = [...outlines(oldAppliance).map((outline) => outline.geometry), ...materials(oldAppliance)]
  const disposals = new Map(oldResources.map((resource) => [resource, 0]))
  oldResources.forEach((resource) => resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource)! + 1)))
  const toaster = createRoomComponent('toaster', 'kitchen-small-appliance', microwave.id)
  scene.update([...defaults, dishwasher, toaster], 'original')
  hologram.update(candidate, scene.actors.values())
  assert.equal(oldAppliance.parent, null)
  assert.equal(outlines(oldAppliance).length, 0)
  for (const count of disposals.values()) assert.equal(count, 1)
  const nextCandidate = scene.actors.get(toaster.id)!
  hologram.update(nextCandidate, scene.actors.values())
  assert.equal(outlines(nextCandidate).length, 0)
  assert.ok(outlines(candidate).length > 0)
  scene.update([...defaults, dishwasher, microwave], 'original')
  const replacement = scene.actors.get(microwave.id)!
  const normalMaterials = materials(replacement)
  assert.notEqual(replacement, nextCandidate)
  assert.equal(hologram.update(replacement, scene.actors.values()).shadowsChanged, true)
  assert.deepEqual(materials(replacement), normalMaterials)
  assert.equal(outlines(replacement).length, 0)
  assert.equal(nextCandidate.parent, null)
  assert.equal(scene.componentForObject(meshes(replacement).find((mesh) => isSceneObjectVisible(mesh))!)?.id, microwave.id)
  scene.update([...defaults, dishwasher], 'original')
  hologram.update(scene.actors.get(microwave.id), scene.actors.values())
  assert.equal(hologram.candidate, null)
  assert.equal(outlines(room).length, 0)
  for (const count of disposals.values()) assert.equal(count, 1)
})

test('manual-state visibility stays live for candidate and holographic actors', (t) => {
  const { scene, hologram } = roomFixture(t, 'bathroom')
  const defaults = defaultRoomComponents()
  const washer = createRoomComponent('washing-machine', 'bathroom-laundry', 'washer')
  scene.update([...defaults, washer], 'original')
  const actor = scene.actors.get(washer.id)!
  const stateGroup = actor.getObjectByName('Manual everyday state')!
  const stateMaterials = materials(stateGroup)
  assert.equal(stateGroup.visible, false)
  hologram.update(actor, scene.actors.values())
  assert.equal(scene.update([...defaults, { ...washer, state: 'running' }], 'original').shadowsChanged, true)
  assert.equal(hologram.update(actor, scene.actors.values()).changed, true)
  assert.equal(stateGroup.visible, true)
  assert.deepEqual(materials(stateGroup), stateMaterials)
  const sink = scene.actors.get('default-bathroom-sink')!
  hologram.update(sink, scene.actors.values())
  assert.ok(materials(stateGroup).every((material) => material instanceof MeshBasicMaterial))
  scene.update([...defaults, { ...washer, state: 'idle' }], 'original')
  hologram.update(sink, scene.actors.values())
  assert.equal(stateGroup.visible, false)
  scene.update([...defaults, { ...washer, state: 'running' }], 'original')
  hologram.update(sink, scene.actors.values())
  assert.equal(stateGroup.visible, true)
  assert.deepEqual(hologram.update(sink, scene.actors.values()), { changed: false, shadowsChanged: false })
  hologram.update(null)
  assert.equal(stateGroup.visible, true)
  assert.deepEqual(materials(stateGroup), stateMaterials)
  assert.equal(scene.componentForObject(meshes(stateGroup)[0])?.state, 'running')
})

test('both world integrations use the actual pending actor, suppress its edit tint and restore before disposal', () => {
  for (const file of ['KitchenWorld.tsx', 'BathroomWorld.tsx']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    assert.match(source, /placementPreviewId = null/)
    assert.match(source, /componentScene\.actors\.get\(previewId\)/)
    assert.match(source, /latest\.selectedComponentId !== previewId \? latest\.selectedComponentId : null/)
    assert.match(source, /hologram\.update\(placementCandidate, componentScene\.actors\.values\(\)\)/)
    assert.match(source, /shadowsDirty \|\|= hologramUpdate\.shadowsChanged/)
    assert.ok(source.indexOf('hologram.dispose()') < source.indexOf('componentScene.dispose()'))
  }
  const bathroom = readFileSync(new URL('../src/BathroomWorld.tsx', import.meta.url), 'utf8')
  assert.match(bathroom, /latest\.editMode && !preview && !latest\.tour \? latest\.placementPreviewId : null/)
  const kitchen = readFileSync(new URL('../src/KitchenWorld.tsx', import.meta.url), 'utf8')
  assert.match(kitchen, /targetRotation = preferredRoomRotation\(selectedObject\.slotId\)/)
  assert.match(kitchen, /now - lastShadowFrame >= 250/)
})

test('placement cameras use measured room bounds instead of candidate closeups without locking manual zoom', () => {
  for (const file of ['KitchenWorld.tsx', 'BathroomWorld.tsx']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    assert.match(source, /const closeRoom = usesRoomEntryFraming\(/)
    assert.match(source, /placementPreview: !!placementCandidate/)
    assert.match(source, /const selectedBounds = !placementCandidate &&/)
    assert.match(source, /const desiredZoom = latest\.overviewFocus \? 1 : currentControls\.zoom/)
    assert.match(source, /placementCandidate !== hologram\.candidate\)[\s\S]*?currentControls\.zoom = placementPreviewZoom; setZoom\(placementPreviewZoom\)/)
    assert.match(source, /const placementBounds = placementCandidate \? visibleRoomBounds\(room, placementCandidate\) : null/)
    assert.match(source, /desiredCenter\.lerp\(placementBounds\.getCenter/)
    assert.match(source, /data-framing=\{placementPreview \|\| overviewFocus \? 'whole' : 'close'\}/)
    assert.match(source, /onClick=\{\(\) => changeZoom\(1\)\}/)
    assert.match(source, /onClick=\{\(\) => controls\.current\?\.reset\(\)\}/)
  }
  const kitchen = readFileSync(new URL('../src/KitchenWorld.tsx', import.meta.url), 'utf8')
  assert.match(kitchen, /const focusedBounds = placementCandidate \|\| latest\.overviewFocus \|\| currentControls\.roomView \? undefined/)
  assert.match(kitchen, /cameraFraming\(area\.width, area\.height, 'room', true, \{\s*bounds: roomBounds/)
  assert.match(kitchen, /closeRoom \? roomEntryFraming\(viewport\.width, viewport\.height, area\)/)
  const bathroom = readFileSync(new URL('../src/BathroomWorld.tsx', import.meta.url), 'utf8')
  assert.match(bathroom, /const framedFocus = placementCandidate \|\| latest\.overviewFocus/)
  assert.match(bathroom, /const bounds = framedFocus === 'room' \? componentScene\.bounds/)
  assert.match(bathroom, /closeRoom \? roomEntryFraming\(viewport\.width, viewport\.height, frameArea, room\.rotation\.y\)/)
  assert.match(bathroom, /bathroomFraming\(frameArea\.width, frameArea\.height, bounds, room\.rotation\.y, pitch\)/)
})

test('both reset controls use the entry camera path and are unpressed whenever zoom differs from 100%', () => {
  for (const file of ['KitchenWorld.tsx', 'BathroomWorld.tsx']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    assert.match(source, /aria-label="Reset room view" title="Reset room view" aria-pressed=\{roomViewReset && zoom === 1\}><Maximize/)
    assert.doesNotMatch(source, /Frame the whole room|currentControls\.wholeRoom/)
    assert.match(source, /currentControls\.roomView = true/)
    assert.match(source, /resetView: currentControls\.roomView/)
    assert.match(source, /const selectedBounds = !placementCandidate &&[^\n]*!currentControls\.roomView/)
    assert.match(source, /const desiredZoom = latest\.overviewFocus \? 1 : currentControls\.zoom/)
    assert.doesNotMatch(source, /lastOverviewFocus/)
    assert.match(source, /setZoom\(currentControls\.zoom\)|setZoom\(next\)/)
    assert.match(source, /pinchZoom \* a\.distanceTo\(b\) \/ pinchDistance/)
    assert.match(source, /Math\.exp\(-event\.deltaY \* units \* 0\.0015\)/)
  }
  const kitchen = readFileSync(new URL('../src/KitchenWorld.tsx', import.meta.url), 'utf8')
  assert.match(kitchen, /targetRotation = preferredRoomRotation\(pendingActor \? componentScene\.componentForObject\(pendingActor\)\?\.slotId : undefined\)/)
})

test('kettle steam has no idle baseline, fades out after the actual cycle, and respects reduced motion', () => {
  const source = readFileSync(new URL('../src/KitchenWorld.tsx', import.meta.url), 'utf8')
  assert.match(source, /const isBrewing = !!componentScene\.componentAtSlot\('kitchen-kettle'\) && now - brewStarted < 12_000/)
  assert.match(source, /if \(isBrewing !== wasBrewing\) \{ wasBrewing = isBrewing; setBrewing\(isBrewing\)/)
  assert.match(source, /const brewTarget = isBrewing && !reducedMotion\.matches \? 1 : 0/)
  assert.match(source, /brewIntensity = reducedMotion\.matches \? 0 : dampTo\(brewIntensity, brewTarget, 4, delta\)/)
  assert.match(source, /puff\.visible = !reducedMotion\.matches && brewIntensity > 0/)
  assert.match(source, /puff\.material\.opacity = fade \* fade \* 0\.3 \* brewIntensity/)
  assert.match(source, /const targetY = base \+ \(lifted && action !== 'light' && action !== 'brew' && !reducedMotion\.matches \? 0\.06 : 0\)/)
  assert.match(source, /const lidHeight = 0\.39 \+ Math\.abs\(Math\.sin\(now \/ 140\)\) \* 0\.012 \* brewIntensity/)
  assert.match(source, /scenery\.kettleLid\.position\.y = lidHeight/)
  for (const reduced of [false, true]) {
    let intensity = 0
    const step = (brewing: boolean) => {
      const target = brewing && !reduced ? 1 : 0
      intensity = reduced ? 0 : dampTo(intensity, target, 4, 0.1)
      return { visible: !reduced && intensity > 0, opacity: 0.3 * intensity }
    }
    assert.deepEqual(step(false), { visible: false, opacity: 0 })
    for (let elapsed = 0; elapsed < 12_000; elapsed += 100) step(true)
    assert.equal(intensity, reduced ? 0 : 1)
    const fading = step(false)
    assert.equal(fading.visible, !reduced)
    if (!reduced) assert.ok(fading.opacity > 0 && fading.opacity < 0.3)
    for (let elapsed = 0; elapsed < 3000; elapsed += 100) step(false)
    assert.deepEqual(step(false), { visible: false, opacity: 0 })
    assert.equal(0.39 + Math.abs(Math.sin(15_000 / 140)) * 0.012 * intensity, 0.39)
  }
})
