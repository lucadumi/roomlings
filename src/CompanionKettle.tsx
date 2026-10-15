import { useEffect, useRef, useState } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { ACESFilmicToneMapping, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three'
import { companionBlinkLength, createCompanionKettle, untilCompanionBlink } from './companionModel.ts'
import './companion.css'

type Controls = { greet: () => void }

// A corner companion with its own tiny view. It draws only to blink, hop or steam, never continuously.
export function CompanionKettle({ active, paused, onOpen }: { active: boolean; paused: boolean; onOpen: () => void }) {
  const host = useRef<HTMLSpanElement>(null)
  const controls = useRef<Controls | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const element = host.current
    if (!element) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch (error) {
      console.warn('The kettle companion could not start:', error instanceof Error ? error.message : error)
      setUnavailable(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.setAttribute('aria-hidden', 'true')
    element.appendChild(renderer.domElement)

    const scene = new Scene()
    scene.add(new HemisphereLight('#fffaf1', '#b0d0bd', 2.1))
    const sun = new DirectionalLight('#fff4e0', 1.6)
    sun.position.set(1.5, 2.5, 2.2)
    scene.add(sun)
    const kettle = createCompanionKettle()
    scene.add(kettle.root)
    const camera = new PerspectiveCamera(26, 1, 0.1, 20)
    camera.position.set(0, 0.55, 1.75)
    camera.lookAt(0.07, 0.33, 0)

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let blinkTimer = 0
    let disposed = false
    let lost = false
    const draw = () => {
      frame = 0
      if (disposed || lost) return
      const now = performance.now()
      const animating = kettle.update(now, reducedMotion.matches)
      renderer.render(scene, camera)
      renderer.domElement.dataset.renderReady = 'true'
      if (animating && !document.hidden) frame = requestAnimationFrame(draw)
      else scheduleBlink()
    }
    const request = () => { if (!frame && !disposed && !lost) frame = requestAnimationFrame(draw) }
    // Two quick frames close and reopen the eyes; nothing draws between blinks.
    const scheduleBlink = () => {
      window.clearTimeout(blinkTimer)
      if (disposed || lost || reducedMotion.matches) return
      const wait = untilCompanionBlink(performance.now())
      blinkTimer = window.setTimeout(() => {
        if (document.hidden || pausedRef.current) { scheduleBlink(); return }
        request()
        blinkTimer = window.setTimeout(request, companionBlinkLength + 20)
      }, wait + 10)
    }
    const resize = () => {
      const { width, height } = element.getBoundingClientRect()
      if (!width || !height) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      request()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    const onLost = (event: Event) => {
      event.preventDefault()
      lost = true
      setUnavailable(true)
    }
    renderer.domElement.addEventListener('webglcontextlost', onLost)
    reducedMotion.addEventListener('change', request)
    document.addEventListener('visibilitychange', request)
    controls.current = { greet: () => { kettle.greet(performance.now()); request() } }
    resize()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      window.clearTimeout(blinkTimer)
      observer.disconnect()
      reducedMotion.removeEventListener('change', request)
      document.removeEventListener('visibilitychange', request)
      renderer.domElement.removeEventListener('webglcontextlost', onLost)
      controls.current = null
      kettle.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  return <button type="button" className="companion-kettle control-surface" data-unavailable={unavailable}
    aria-label="Ask the kettle a question" title="Ask the kettle" aria-pressed={active}
    onClick={() => { controls.current?.greet(); onOpen() }}>
    <span className="companion-kettle-view" ref={host} hidden={unavailable} />
    {unavailable && <MessageCircleQuestion size="1.375rem" aria-hidden="true" />}
    <span className="companion-kettle-label">Ask</span>
  </button>
}
