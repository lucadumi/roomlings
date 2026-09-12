import { PMREMGenerator } from 'three'
import type { Scene, Texture, WebGLRenderer } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

export type RoomReflections = { texture: Texture; dispose: () => void }

export function roomReflectionIntensity(eveningMix = 0): number {
  if (!Number.isFinite(eveningMix) || eveningMix < 0 || eveningMix > 1) {
    throw new Error('Room reflections need a daylight-to-evening mix between zero and one.')
  }
  return 0.22 + (0.05 - 0.22) * eveningMix
}

export function createRoomReflections(renderer: WebGLRenderer): RoomReflections {
  const environment = new RoomEnvironment()
  const generator = new PMREMGenerator(renderer)
  try {
    const target = generator.fromScene(environment, 0.035, 0.1, 100, { size: 128 })
    target.texture.name = 'Shared room surface reflections'
    let disposed = false
    return {
      texture: target.texture,
      dispose() {
        if (disposed) return
        disposed = true
        target.dispose()
      },
    }
  } finally {
    environment.dispose()
    generator.dispose()
  }
}

export function applyRoomReflections(scene: Scene, reflections: RoomReflections, eveningMix = 0): void {
  scene.environment = reflections.texture
  scene.environmentIntensity = roomReflectionIntensity(eveningMix)
}
