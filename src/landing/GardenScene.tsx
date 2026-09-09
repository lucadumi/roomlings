import { useEffect, useRef } from 'react'
import { WebGLRenderer } from 'three'
import { configureGardenRenderer, createGardenView } from './gardenView.ts'
import type { GardenLayout } from './gardenLayout.ts'
import { advanceGardenWind, gardenScrollGust } from './gardenWind.ts'
import type { GardenWind } from './gardenWind.ts'

export type GardenStatus = 'ready' | 'unavailable'

export default function GardenScene({ layout, reducedMotion, paused, onStatus }: {
  layout: GardenLayout
  reducedMotion: boolean
  paused: boolean
  onStatus: (status: GardenStatus) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const wake = useRef<(() => void) | null>(null)
  const state = useRef({ layout, reducedMotion, paused, onStatus })
  state.current = { layout, reducedMotion, paused, onStatus }

  useEffect(() => {
    const element = host.current
    if (!element) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch (error) {
      console.warn('The garden could not start WebGL. Its still illustration remains available:', error)
      state.current.onStatus('unavailable')
      return
    }
    configureGardenRenderer(renderer)
    renderer.autoClear = false
    renderer.domElement.setAttribute('aria-hidden', 'true')
    element.appendChild(renderer.domElement)
    const views = { left: createGardenView('left'), right: createGardenView('right') }
    let frame = 0
    let timer = 0
    let disposed = false
    let available = true
    let onScreen = false
    let ready = false
    let previousTime = performance.now()
    let ambientTime = 0
    let lastShadow = -Infinity
    let currentLayout: GardenLayout | null = null
    const shadowReady = { left: false, right: false }
    let wind: GardenWind = { gust: 0, lean: 0 }
    let lastScroll = window.scrollY
    let lastScrollTime = performance.now()

    const cancel = () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      frame = 0
      timer = 0
      element.dataset.rendering = 'paused'
    }
    const schedule = (delay = 0) => {
      if (disposed || !available || !onScreen || document.hidden || frame || timer) return
      if (delay) timer = window.setTimeout(() => { timer = 0; schedule() }, delay)
      else frame = requestAnimationFrame(render)
    }
    const render = (now: number) => {
      frame = 0
      if (disposed || !available || !onScreen || document.hidden) return
      const { layout: measured, reducedMotion: reduced, paused: suspended } = state.current
      const animated = measured.animate && !reduced && !suspended
      const seconds = Math.min(Math.max(0, (now - previousTime) / 1000), 0.1)
      const previousLean = wind.lean
      if (animated) {
        ambientTime += seconds
        wind = advanceGardenWind(wind, seconds)
      }
      previousTime = now
      if (measured !== currentLayout) {
        renderer.setSize(measured.width, measured.height)
        for (const side of ['left', 'right'] as const) views[side].frame(measured.width, measured.height, measured[side].frame)
        currentLayout = measured
      }
      renderer.setScissorTest(false)
      renderer.clear()
      const updateShadows = !ready || animated && (Math.abs(wind.lean - previousLean) > 0.0005 || now - lastShadow >= 250)
      for (const side of ['left', 'right'] as const) {
        const view = views[side]
        const rail = measured[side]
        if (!rail.visible) continue
        if (animated) {
          for (const leaf of view.foliage) {
            leaf.object.rotation.z = leaf.restRotation + Math.sin(ambientTime / 2.5 + leaf.phase) * leaf.amplitude
              + wind.lean * (0.8 + Math.sin(leaf.phase) * 0.2)
          }
        }
        view.sunlight.shadow.needsUpdate = updateShadows || !shadowReady[side]
        renderer.render(view.scene, view.camera)
        shadowReady[side] = true
      }
      if (updateShadows) lastShadow = now
      element.dataset.rendering = animated ? 'active' : 'paused'
      element.dataset.wind = wind.lean.toFixed(4)
      if (!ready) {
        ready = true
        state.current.onStatus('ready')
      }
      if (animated) schedule(1000 / 30)
    }
    const update = () => {
      cancel()
      previousTime = performance.now()
      schedule()
    }
    const visibilityChanged = () => {
      if (document.hidden) cancel()
      else update()
    }
    const scrolled = () => {
      const now = performance.now()
      const distance = window.scrollY - lastScroll
      const milliseconds = now - lastScrollTime
      lastScroll = window.scrollY
      lastScrollTime = now
      const current = state.current
      if (!distance || current.reducedMotion || current.paused || !current.layout.animate || document.hidden || !onScreen) return
      wind.gust = gardenScrollGust(distance, milliseconds, current.layout.height)
      schedule()
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      available = false
      cancel()
      console.warn('The garden lost its WebGL context. Its still illustration remains available.')
      state.current.onStatus('unavailable')
    }
    const visibility = new IntersectionObserver((entries) => {
      if (disposed) return
      onScreen = entries.some((entry) => entry.isIntersecting)
      if (onScreen) update()
      else cancel()
    })
    visibility.observe(element)
    wake.current = update
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('scroll', scrolled, { passive: true })
    renderer.domElement.addEventListener('webglcontextlost', contextLost)
    return () => {
      disposed = true
      wake.current = null
      cancel()
      visibility.disconnect()
      document.removeEventListener('visibilitychange', visibilityChanged)
      window.removeEventListener('scroll', scrolled)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      views.left.dispose()
      views.right.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  useEffect(() => { wake.current?.() }, [layout, reducedMotion, paused])
  return <div className="welcome-garden-canvas" ref={host} data-rendering="paused" />
}
