import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Box3, DirectionalLight, Group, Mesh, Raycaster, Vector3 } from 'three'
import { addContactShadows, createContactShadowTexture, createRoomLights, daylight, fitRoomShadowBounds } from '../src/lighting.ts'
import { createConfiguredRoomPreview } from '../src/householdRoomPreview.ts'
import { completeRoomLayout } from './room-layout-fixture.ts'
import { roomRotationPeriod } from '../src/camera.ts'

describe('room lighting', () => {
  it('adds front and overhead fill without creating more shadow maps', () => {
    const lights = createRoomLights()
    assert.equal(lights.fillLights.length, 3)
    assert.ok(lights.fillLights.includes(lights.fill))
    assert.equal(new Set(lights.fillLights.map((light) => light.position.toArray().join(','))).size, 3)
    for (const fill of lights.fillLights) {
      assert.equal(fill.parent, lights.group)
      assert.equal(fill.intensity, daylight.fill)
      assert.equal(fill.castShadow, false)
      assert.equal(fill.shadow.map, null)
    }
    assert.deepEqual(lights.group.children.filter((light) => light instanceof DirectionalLight && light.castShadow), [lights.sunlight])
    assert.equal(lights.sunlight.shadow.autoUpdate, false)
    lights.sunlight.shadow.dispose()
  })

  it('keeps the entire room inside its shadow volume throughout a drag', () => {
    const { group, sunlight } = createRoomLights()
    group.updateMatrixWorld(true)
    sunlight.shadow.updateMatrices(sunlight)
    const camera = sunlight.shadow.camera
    const axis = new Vector3(0, 1, 0)
    for (let step = 0; step <= 100; step++) {
      const angle = -roomRotationPeriod / 2 + roomRotationPeriod * step / 100
      for (const x of [-5.3, 5.3]) for (const y of [-0.3, 5.1]) for (const z of [-3.5, 3.5]) {
        const point = new Vector3(x, y, z).applyAxisAngle(axis, angle).applyMatrix4(camera.matrixWorldInverse)
        assert.ok(point.x > camera.left && point.x < camera.right)
        assert.ok(point.y > camera.bottom && point.y < camera.top)
        assert.ok(-point.z > camera.near && -point.z < camera.far)
      }
    }
    assert.equal(sunlight.shadow.autoUpdate, false)
    assert.equal(sunlight.shadow.needsUpdate, true)
    sunlight.shadow.dispose()
  })

  for (const roomId of ['kitchen', 'bathroom', 'living-room'] as const) {
    it(`fits every corner of the fully equipped ${roomId} throughout its continuous drag range`, (context) => {
      const model = createConfiguredRoomPreview(roomId, 'original', completeRoomLayout())
      const lights = createRoomLights(model.componentScene.bounds)
      context.after(() => { model.dispose(); lights.sunlight.shadow.dispose() })
      lights.group.updateMatrixWorld(true)
      lights.sunlight.shadow.updateMatrices(lights.sunlight)
      const camera = lights.sunlight.shadow.camera
      const bounds = model.componentScene.bounds
      const axis = new Vector3(0, 1, 0)
      for (let step = 0; step <= 200; step++) {
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new Vector3(x, y, z).applyAxisAngle(axis, -roomRotationPeriod / 2 + roomRotationPeriod * step / 200).applyMatrix4(camera.matrixWorldInverse)
          assert.ok(point.x > camera.left && point.x < camera.right)
          assert.ok(point.y > camera.bottom && point.y < camera.top)
          assert.ok(-point.z > camera.near && -point.z < camera.far)
        }
      }
      assert.equal(lights.sunlight.shadow.autoUpdate, false)
    })
  }

  it('rejects invalid measured lighting bounds and refreshes the cache when the scene grows', () => {
    assert.throws(() => createRoomLights(new Box3()), /finite, nonempty/)
    const bounds = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1))
    const { sunlight } = createRoomLights(bounds)
    const originalWidth = sunlight.shadow.camera.right - sunlight.shadow.camera.left
    sunlight.shadow.needsUpdate = false
    fitRoomShadowBounds(sunlight, bounds.expandByScalar(3))
    assert.equal(sunlight.shadow.needsUpdate, true)
    assert.ok(sunlight.shadow.camera.right - sunlight.shadow.camera.left > originalWidth)
    assert.throws(() => fitRoomShadowBounds(sunlight, new Box3(new Vector3(NaN, 0, 0), new Vector3(1, 2, 1))), /finite, nonempty/)
    sunlight.shadow.dispose()
  })

  it('creates a symmetric contact mask with a soft, transparent edge', () => {
    const texture = createContactShadowTexture()
    const { data, width, height } = texture.image
    assert.ok(data)
    const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3]
    assert.equal(width, height)
    assert.equal(alpha(0, 0), 0)
    assert.equal(alpha(0, height / 2), 0)
    assert.ok(alpha(width / 2, height / 2) > 250)
    assert.ok(alpha(width / 4, height / 2) > 0)
    assert.ok(alpha(width / 4, height / 2) < alpha(width / 2, height / 2))
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      assert.equal(alpha(x, y), alpha(width - x - 1, height - y - 1))
    }
    texture.dispose()
  })

  it('shares contact-shadow resources without intercepting object picking', () => {
    const parent = new Group()
    const texture = createContactShadowTexture()
    const { material, geometry } = addContactShadows(parent, texture, [
      { position: [0, 0.01, 0], size: [2, 1] },
      { position: [3, 0.01, 0], size: [1, 1] },
    ])
    assert.equal(parent.children.length, 2)
    for (const child of parent.children) {
      assert.ok(child instanceof Mesh)
      assert.equal(child.geometry, geometry)
      assert.equal(child.material, material)
      assert.equal(child.castShadow, false)
    }
    assert.equal(material.transparent, true)
    assert.equal(material.depthWrite, false)
    parent.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(0, 2, 0), new Vector3(0, -1, 0))
    assert.deepEqual(ray.intersectObjects(parent.children), [])
    geometry.dispose()
    material.dispose()
    texture.dispose()
  })
})
