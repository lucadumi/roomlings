import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Group, Mesh, Raycaster, Vector3 } from 'three'
import { addContactShadows, createContactShadowTexture, createRoomLights } from '../src/lighting.ts'

describe('room lighting', () => {
  it('keeps the entire room inside its shadow volume throughout a drag', () => {
    const { group, sunlight } = createRoomLights()
    group.updateMatrixWorld(true)
    sunlight.shadow.updateMatrices(sunlight)
    const camera = sunlight.shadow.camera
    const axis = new Vector3(0, 1, 0)
    for (let step = 0; step <= 30; step++) {
      const angle = -0.75 + step * 0.05
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
