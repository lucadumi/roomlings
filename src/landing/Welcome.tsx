import { Component, lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowRight, Pause, Play, Snowflake } from 'lucide-react'
import { scrollProgress, tourArea, tourChapters } from './tour.ts'
import type { TourLayout } from './tour.ts'
import { TourFallback } from './TourFallback.tsx'
import type { TourStatus } from './TourScene.tsx'
import './welcome.css'

const TourScene = lazy(() => import('./TourScene.tsx'))

function subscribeToMotion(callback: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

class TourBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) {
    console.error('The welcome kitchen could not be displayed:', error)
    this.props.onFailure()
  }
  render() { return this.state.failed ? null : this.props.children }
}

export default function Welcome() {
  const root = useRef<HTMLDivElement>(null)
  const story = useRef<HTMLElement>(null)
  const sections = useRef<Array<HTMLElement | null>>([])
  const stage = useRef<HTMLDivElement>(null)
  const startFrame = useRef<HTMLDivElement>(null)
  const endFrame = useRef<HTMLDivElement>(null)
  const illustration = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLElement>(null)
  const footer = useRef<HTMLElement>(null)
  const progress = useRef(0)
  const layout = useRef<TourLayout | null>(null)
  const wakeScene = useRef<(() => void) | null>(null)
  const systemReduced = useSyncExternalStore(subscribeToMotion, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches, () => false)
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null)
  const reducedMotion = motionOverride ?? systemReduced
  const [active, setActive] = useState(0)
  const [status, setStatus] = useState<TourStatus>('loading')

  useEffect(() => {
    const saved: unknown = history.state
    const scroll = saved !== null && typeof saved === 'object' && 'roomlingsTourScroll' in saved
      && typeof saved.roomlingsTourScroll === 'number' && Number.isFinite(saved.roomlingsTourScroll) && saved.roomlingsTourScroll >= 0
      ? saved.roomlingsTourScroll : null
    const chapter = tourChapters.findIndex(({ id }) => location.hash === `#${id}`)
    // The lazy entry mounts after the browser's initial scroll-restoration attempt.
    if (scroll !== null) window.scrollTo({ top: scroll, behavior: 'instant' })
    else if (chapter >= 0) sections.current[chapter]?.scrollIntoView({ behavior: 'instant' })
    const rememberPosition = () => {
      const previous: unknown = history.state
      history.replaceState({
        ...(previous !== null && typeof previous === 'object' ? previous : {}),
        roomlingsTourScroll: window.scrollY,
      }, '')
    }
    window.addEventListener('beforeunload', rememberPosition)
    return () => window.removeEventListener('beforeunload', rememberPosition)
  }, [])

  useEffect(() => {
    const element = story.current
    const page = root.current
    const viewport = stage.current
    const first = startFrame.current
    const last = endFrame.current
    const topBar = header.current
    const bottomBar = footer.current
    if (!element || !page || !viewport || !first || !last || !topBar || !bottomBar) return
    let frame = 0
    let needsLayout = true
    let previousLayout = ''
    const update = () => {
      frame = 0
      if (needsLayout) {
        const copyHeight = Math.max(...sections.current.map((section) => {
          const copy = section?.querySelector('.welcome-copy')
          if (!copy) throw new Error('A welcome chapter is missing its content.')
          return copy.getBoundingClientRect().height
        }))
        const headerHeight = topBar.getBoundingClientRect().height
        const footerHeight = bottomBar.getBoundingClientRect().height
        page.style.setProperty('--welcome-copy-height', `${copyHeight}px`)
        page.style.setProperty('--welcome-header-space', `${headerHeight}px`)
        const flowing = copyHeight + headerHeight + footerHeight + 48 > viewport.clientHeight
        page.dataset.flow = String(flowing)
        page.style.setProperty('--welcome-footer-space', `${flowing ? 0 : footerHeight}px`)
        needsLayout = false
      }
      const stops = sections.current.map((section) => {
        if (!section) throw new Error('A welcome chapter is missing from the page.')
        return window.scrollY + section.getBoundingClientRect().top
      })
      const next = scrollProgress(window.scrollY, stops)
      progress.current = next
      const viewportBounds = viewport.getBoundingClientRect()
      const area = (frame: HTMLElement) => {
        const bounds = frame.getBoundingClientRect()
        return { x: bounds.left - viewportBounds.left, y: bounds.top - viewportBounds.top, width: bounds.width, height: bounds.height }
      }
      const start = area(first)
      const end = area(last)
      const flowing = page.dataset.flow === 'true'
      const bottom = viewport.clientHeight - (flowing ? 0 : bottomBar.getBoundingClientRect().height)
      const extra = Math.max(0, start.y + start.height - bottom)
      const index = Math.min(stops.length - 1, Math.floor(next * (stops.length - 1)))
      const travelled = Math.max(0, window.scrollY - stops[index])
      const remaining = index + 1 < stops.length ? Math.max(0, stops[index + 1] - window.scrollY) : Infinity
      const shift = Math.min(extra, travelled, remaining)
      start.y -= shift
      end.y -= shift
      const measured = { width: viewport.clientWidth, height: viewport.clientHeight, start, end, top: Math.max(0, topBar.getBoundingClientRect().bottom), bottom }
      const picture = tourArea(0, measured, true)
      if (illustration.current) {
        Object.assign(illustration.current.style, {
          left: `${picture.x}px`, top: `${picture.y}px`, width: `${picture.width}px`, height: `${picture.height}px`,
        })
      }
      const key = JSON.stringify(measured)
      if (key !== previousLayout) {
        previousLayout = key
        layout.current = measured
        wakeScene.current?.()
      }
      setActive((current) => {
        const chapter = Math.round(next * (tourChapters.length - 1))
        return current === chapter ? current : chapter
      })
    }
    const requestUpdate = () => { if (!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(() => { needsLayout = true; requestUpdate() })
    observer.observe(viewport)
    observer.observe(topBar)
    observer.observe(bottomBar)
    for (const section of sections.current) {
      const copy = section?.querySelector('.welcome-copy')
      if (copy) observer.observe(copy)
    }
    update()
    window.addEventListener('scroll', requestUpdate, { passive: true })
    window.addEventListener('resize', requestUpdate)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', requestUpdate)
      window.removeEventListener('resize', requestUpdate)
    }
  }, [reducedMotion])

  return <div className="welcome" ref={root} data-motion={reducedMotion ? 'reduced' : 'full'} data-scene={status} data-chapter={tourChapters[active].id}>
    <a className="welcome-skip" href="#welcome-content">Skip to content</a>
    <header className="welcome-header" ref={header}>
      <a className="brand" href="#hello" aria-label="Roomlings, back to the beginning">
        <span className="brand-mark"><Snowflake size={23} /></span>roomlings<span className="brand-period">.</span>
      </a>
      <div className="welcome-header-actions">
        <button className="welcome-motion" onClick={() => setMotionOverride(!reducedMotion)} aria-label="Reduced motion" aria-pressed={reducedMotion} title={reducedMotion ? 'Enable motion' : 'Reduce motion'}>
          {reducedMotion ? <Play size={14} /> : <Pause size={14} />}
          <span>Motion</span>
        </button>
        <a className="welcome-open" href="/">Open kitchen <ArrowRight size={15} /></a>
      </div>
      <div className="welcome-scene-status" data-loading={status === 'loading'} role="status">
        {status === 'loading' && 'Loading kitchen...'}
        {status === 'unavailable' && '3D is unavailable. Kitchen tools still work.'}
      </div>
    </header>
    <main className="welcome-story" id="welcome-content" ref={story} tabIndex={-1}>
      <div className="welcome-stage" ref={stage} aria-hidden="true">
        <div className="welcome-scene-backdrop" />
        <div className="welcome-framing"><div className="welcome-frame-start" ref={startFrame} /><div className="welcome-frame-end" ref={endFrame} /></div>
        <div className="welcome-static" ref={illustration}><TourFallback /></div>
        <TourBoundary onFailure={() => setStatus('unavailable')}>
          <Suspense fallback={null}><TourScene progress={progress} layout={layout} wake={wakeScene} reducedMotion={reducedMotion} onStatus={setStatus} /></Suspense>
        </TourBoundary>
      </div>
      <section className="welcome-chapter welcome-hello" id="hello" ref={(element) => { sections.current[0] = element }} aria-labelledby="hello-title">
        <div className="welcome-copy">
          <h1 id="hello-title">Split groceries and bills.</h1>
          <p>A shared place for groceries, household bills and repayments. See who paid and what everyone owes.</p>
          <div className="welcome-actions">
            <a className="button primary welcome-enter" href="/">Open kitchen <ArrowRight size={18} /></a>
            <a className="welcome-explore" href="#groceries">See how it works <ArrowDown size={15} /></a>
          </div>
        </div>
      </section>
      <section className="welcome-chapter" id="groceries" ref={(element) => { sections.current[1] = element }} aria-labelledby="groceries-title">
        <div className="welcome-copy">
          <h2 id="groceries-title">Groceries</h2>
          <p>Record what you bought, choose who shares it, and split every cent fairly. Everyone can see the same grocery history.</p>
        </div>
      </section>
      <section className="welcome-chapter" id="receipts" ref={(element) => { sections.current[2] = element }} aria-labelledby="receipts-title">
        <div className="welcome-copy">
          <h2 id="receipts-title">Bills and receipts</h2>
          <p>Create recurring bills for rent, internet and other household costs. Record each payment alongside your groceries, with the payer and shared amounts kept together.</p>
        </div>
      </section>
      <section className="welcome-chapter" id="house-pot" ref={(element) => { sections.current[3] = element }} aria-labelledby="pot-title">
        <div className="welcome-copy">
          <h2 id="pot-title">Monthly budget</h2>
          <p>Set a monthly grocery budget and see what's left. Record repayments to keep everyone's balance up to date.</p>
        </div>
      </section>
      <section className="welcome-chapter welcome-finish" id="come-in" ref={(element) => { sections.current[4] = element }} aria-labelledby="come-in-title">
        <div className="welcome-copy">
          <h2 id="come-in-title">Open your kitchen.</h2>
          <p>Start with a private sample kitchen. When you're ready, create a household or return to the one you've already saved.</p>
          <a className="button primary welcome-enter" href="/">Open kitchen <ArrowRight size={18} /></a>
          <small className="welcome-payment-note">Roomlings never moves money.</small>
        </div>
      </section>
    </main>
    <footer className="welcome-controls" ref={footer}>
      <nav className="welcome-chapters" aria-label="On this page">
        {tourChapters.map((chapter, index) => <a href={`#${chapter.id}`} key={chapter.id} aria-label={chapter.label} aria-current={active === index ? 'step' : undefined}>
          {chapter.short}
        </a>)}
      </nav>
    </footer>
  </div>
}
