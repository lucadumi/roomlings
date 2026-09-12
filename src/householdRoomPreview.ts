import {
  ACESFilmicToneMapping, Group, Mesh, OrthographicCamera, PCFShadowMap, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three'
import type { BufferGeometry } from 'three'
import type { Category, RoomStyle } from '../shared/domain.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import { roomIds } from '../shared/rooms.ts'
import type { RoomId } from '../shared/rooms.ts'
import { roomModels } from './roomModels.ts'
import { batchStaticMeshes } from './batchStaticMeshes.ts'
import { baseCameraOffset, fitRoomBounds } from './camera.ts'
import { createContactShadowTexture, createRoomLights } from './lighting.ts'
import { createRoomComponentScene } from './roomComponentScene.ts'
import { applyRoomReflections, createRoomReflections } from './roomEnvironment.ts'
import type { RoomReflections } from './roomEnvironment.ts'

export type RoomPreviewLedger = {
  counts?: Record<Category, number>
  memberCount?: number
  expenseCount?: number
  fundFraction?: number
}

export function createConfiguredRoomPreview(
  roomId: RoomId, style: RoomStyle, components?: readonly RoomComponent[], ledger: RoomPreviewLedger = {},
) {
  const scene = new Scene()
  const room = new Group()
  scene.add(room)
  const model = roomModels[roomId](room, style)
  const kitchen = 'scenery' in model ? model : null
  const componentModel = 'scenery' in model ? model.scenery : model
  const shadowTexture = createContactShadowTexture()
  if (kitchen) {
    kitchen.doors.forEach((door) => { door.rotation.y = 0 })
    kitchen.interiorLight.intensity = 0
    kitchen.foods.forEach((food) => { food.group.visible = !!ledger.counts?.[food.category] && food.index < Math.min((ledger.counts?.[food.category] ?? 0) + 1, 3) })
    kitchen.scenery.coins.forEach((coin, index) => { coin.visible = index < Math.ceil(Math.min(1, Math.max(0, ledger.fundFraction ?? 0)) * 12) })
    kitchen.scenery.portraits.forEach((portrait, index) => { portrait.visible = index < (ledger.memberCount ?? 0) })
    kitchen.scenery.receipts.forEach((receipt, index) => { receipt.visible = index < (ledger.expenseCount ?? 0) })
    kitchen.scenery.receiptLines.visible = (ledger.expenseCount ?? 0) > 0
    kitchen.scenery.receiptLines.position.y = 0.043 + Math.min(ledger.expenseCount ?? 0, 10) * 0.012
    kitchen.scenery.steam.forEach((puff) => { puff.visible = false })
    const time = new Date()
    kitchen.scenery.hourHand.rotation.z = -((time.getHours() % 12 + time.getMinutes() / 60) / 12) * Math.PI * 2
    kitchen.scenery.minuteHand.rotation.z = -(time.getMinutes() / 60) * Math.PI * 2
  }
  const componentScene = createRoomComponentScene(room, roomId, {
    bindings: componentModel.componentBindings, fixtures: componentModel.componentFixtures, styleMaterials: model.styleMaterials, shadowTexture,
  })
  componentScene.update(components, style)
  batchStaticMeshes(room, 'preserved' in componentModel ? componentModel.preserved : new Set())
  const lights = createRoomLights(componentScene.bounds)
  scene.add(lights.group)
  let disposed = false
  return {
    scene, room, componentScene,
    dispose() {
      if (disposed) return
      disposed = true
      componentScene.dispose()
      const geometries = new Set<BufferGeometry>()
      room.traverse((object) => { if (object instanceof Mesh) geometries.add(object.geometry) })
      geometries.forEach((geometry) => geometry.dispose())
      model.materials.forEach((material) => material.dispose())
      shadowTexture.dispose()
      lights.sunlight.shadow.dispose()
      scene.clear()
    },
  }
}

export async function renderHouseholdRoomPreviews(options: {
  components?: readonly RoomComponent[]
  roomStyle: RoomStyle
  roomStyles?: Partial<Record<RoomId, RoomStyle>>
  ledger?: RoomPreviewLedger
  sizes: Record<RoomId, { width: number; height: number }>
}): Promise<Record<RoomId, string>> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' })
  const images = {} as Record<RoomId, string>
  let reflections: RoomReflections | undefined
  try {
    reflections = createRoomReflections(renderer)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.setClearColor(0x000000, 0)
    for (const roomId of roomIds) {
      const { width, height } = options.sizes[roomId]
      const model = createConfiguredRoomPreview(roomId, options.roomStyles?.[roomId] ?? options.roomStyle, options.components, options.ledger)
      try {
        applyRoomReflections(model.scene, reflections)
        const framing = fitRoomBounds(width, height, model.componentScene.bounds)
        const camera = new OrthographicCamera(-framing.halfHeight * width / height, framing.halfHeight * width / height,
          framing.halfHeight, -framing.halfHeight, 0.1, 100)
        const center = new Vector3(...framing.center)
        camera.position.copy(center).add(new Vector3(...baseCameraOffset))
        camera.lookAt(center)
        camera.updateMatrixWorld(true)
        renderer.setSize(width, height, false)
        renderer.compile(model.scene, camera)
        // Let the live room and its UI settle between offscreen image renders.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        renderer.render(model.scene, camera)
        images[roomId] = renderer.domElement.toDataURL('image/png')
      } finally {
        model.dispose()
      }
    }
    return images
  } finally {
    reflections?.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
