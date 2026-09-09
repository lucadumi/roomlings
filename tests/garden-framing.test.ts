import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Box3, Mesh, Vector3 } from 'three'
import { fitRoomBounds } from '../src/camera.ts'
import { createGardenView } from '../src/landing/gardenView.ts'
import { gardenLayout } from '../src/landing/gardenLayout.ts'
import { gardenSwayPadding, maximumGardenWind } from '../src/landing/gardenWind.ts'

for (const side of ['left', 'right'] as const) {
  test(`${side} garden uses larger silhouettes while keeping every wind pose inside its measured frame`, () => {
    const view = createGardenView(side)
    const point = new Vector3()
    try {
      const bounds = new Box3().setFromObject(view.scene, true).expandByScalar(gardenSwayPadding)
      for (const [width, height, edge] of [[1440, 960, 130], [1920, 1080, 370], [1280, 800, 57.6]]) {
        const rail = gardenLayout(width, height, edge, width - edge)[side]
        view.frame(width, height, rail.frame)
        const old = fitRoomBounds(rail.frame.width, rail.frame.height, bounds)
        const halfHeight = (view.camera.top - view.camera.bottom) / 2 * rail.frame.height / height
        assert.ok(old.halfHeight / halfHeight >= 1.1, 'Silhouette fitting must make the complete plants visibly larger')
        for (let step = 0; step < 10; step++) {
          for (const leaf of view.foliage) {
            leaf.object.rotation.z = leaf.restRotation + Math.sin(step * 0.7 + leaf.phase) * (maximumGardenWind + leaf.amplitude)
          }
          view.scene.updateMatrixWorld(true)
          view.scene.traverseVisible((object) => {
            if (!(object instanceof Mesh)) return
            const positions = object.geometry.getAttribute('position')
            for (let index = 0; index < positions.count; index++) {
              point.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld).project(view.camera)
              const x = (point.x + 1) * width / 2
              const y = (1 - point.y) * height / 2
              assert.ok(x >= rail.frame.x && x <= rail.frame.x + rail.frame.width, `${side} plant must not be cut off horizontally`)
              assert.ok(y >= rail.frame.y && y <= rail.frame.y + rail.frame.height, `${side} plant must not be cut off vertically`)
            }
          })
        }
      }
    } finally { view.dispose() }
  })
}
