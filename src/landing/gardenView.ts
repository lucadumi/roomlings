import { ACESFilmicToneMapping, Mesh, OrthographicCamera, PCFShadowMap, Scene, SRGBColorSpace, Vector3 } from 'three'
import type { WebGLRenderer } from 'three'
import { baseCameraOffset, cameraProjection } from '../camera.ts'
import type { FramingArea } from '../camera.ts'
import { createRoomLights } from '../lighting.ts'
import { buildGardenModel } from './gardenModel.ts'
import type { GardenSide } from './gardenModel.ts'
import { maximumGardenWind } from './gardenWind.ts'

function measureGardenSilhouette(model: ReturnType<typeof buildGardenModel>) {
  const backward = new Vector3(...baseCameraOffset).normalize()
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), backward).normalize()
  const up = new Vector3().crossVectors(backward, right)
  const minimum = new Vector3(Infinity, Infinity, Infinity)
  const maximum = new Vector3(-Infinity, -Infinity, -Infinity)
  const point = new Vector3()
  const projected = new Vector3()
  // Fit real silhouettes, including their wind extremes, rather than the empty corners of a 3D box.
  for (const direction of [-1, 0, 1]) {
    for (const leaf of model.foliage) leaf.object.rotation.z = leaf.restRotation + direction * (leaf.amplitude + maximumGardenWind)
    model.root.updateMatrixWorld(true)
    model.root.traverseVisible((object) => {
      if (!(object instanceof Mesh)) return
      const positions = object.geometry.getAttribute('position')
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld)
        projected.set(point.dot(right), point.dot(up), point.dot(backward))
        minimum.min(projected)
        maximum.max(projected)
      }
    })
  }
  for (const leaf of model.foliage) leaf.object.rotation.z = leaf.restRotation
  model.root.updateMatrixWorld(true)
  if (![...minimum.toArray(), ...maximum.toArray()].every(Number.isFinite) || minimum.x >= maximum.x || minimum.y >= maximum.y) {
    throw new Error('The garden needs visible geometry to frame.')
  }
  const middle = minimum.clone().add(maximum).multiplyScalar(0.5)
  return {
    center: right.multiplyScalar(middle.x).add(up.multiplyScalar(middle.y)).add(backward.multiplyScalar(middle.z)),
    halfWidth: (maximum.x - minimum.x) / 2 + 0.06,
    halfHeight: (maximum.y - minimum.y) / 2 + 0.06,
  }
}

export function configureGardenRenderer(renderer: WebGLRenderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.setClearColor(0x000000, 0)
}

export function createGardenView(side: GardenSide) {
  const model = buildGardenModel(side)
  const silhouette = measureGardenSilhouette(model)
  const scene = new Scene()
  const camera = new OrthographicCamera(-3, 3, 5, -5, 0.1, 100)
  const lights = createRoomLights()
  lights.sunlight.shadow.mapSize.setScalar(512)
  scene.add(model.root, lights.group)
  let disposed = false
  return {
    scene, camera, foliage: model.foliage, sunlight: lights.sunlight,
    frame(width: number, height: number, area: FramingArea) {
      const halfHeight = Math.max(silhouette.halfHeight, silhouette.halfWidth * area.height / area.width) * 1.02
      camera.position.copy(silhouette.center).add(new Vector3(...baseCameraOffset))
      camera.lookAt(silhouette.center)
      Object.assign(camera, cameraProjection(width, height, area, halfHeight, 1))
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld(true)
    },
    dispose() {
      if (disposed) return
      disposed = true
      model.dispose()
      lights.sunlight.shadow.dispose()
      scene.clear()
    },
  }
}
