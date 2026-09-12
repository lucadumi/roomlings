import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DependencyList, EffectCallback } from 'react'

type FrameScheduler = {
  request: (callback: FrameRequestCallback) => number
  cancel: (frame: number) => void
}

const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (frame) => cancelAnimationFrame(frame),
}

export function deferredSceneSetup(
  setup: EffectCallback, reportError: (cause: unknown) => void, frames: FrameScheduler = browserFrames,
) {
  let pending: number | null = null
  let started = false
  let disposed = false
  let deferred = true
  let cleanup: ReturnType<EffectCallback>
  const cancelPending = () => {
    if (pending !== null) frames.cancel(pending)
    pending = null
  }
  return {
    setDeferred(value: boolean) {
      deferred = value
      if (disposed || started) return
      if (deferred) { cancelPending(); return }
      if (pending !== null) return
      pending = frames.request(() => {
        pending = null
        if (disposed || deferred) return
        started = true
        try { cleanup = setup() } catch (cause) { reportError(cause) }
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelPending()
      if (typeof cleanup === 'function') cleanup()
    },
  }
}

export function useDeferredSceneEffect(setup: EffectCallback, dependencies: DependencyList, deferColdStart = false): void {
  const current = useRef<ReturnType<typeof deferredSceneSetup> | null>(null)
  const deferred = useRef(deferColdStart)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  deferred.current = deferColdStart
  useEffect(() => {
    const scene = deferredSceneSetup(setup, (cause) => setFailure({ cause }))
    current.current = scene
    scene.setDeferred(deferred.current)
    return () => {
      scene.dispose()
      if (current.current === scene) current.current = null
    }
  }, dependencies)
  useLayoutEffect(() => { current.current?.setDeferred(deferColdStart) }, [deferColdStart])
  // Re-throw deferred setup errors during rendering so the existing scene boundary handles them.
  if (failure) throw failure.cause
}
