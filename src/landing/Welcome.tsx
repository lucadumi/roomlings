import { Component, lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowRight, Check, Leaf, Pause, Play, Snowflake } from 'lucide-react'
import { scrollProgress, tourChapters } from './tour.ts'
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
  const story = useRef<HTMLElement>(null)
  const sections = useRef<Array<HTMLElement | null>>([])
  const progress = useRef(0)
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
    if (!element) return
    let frame = 0
    const update = () => {
      frame = 0
      const stops = sections.current.map((section) => {
        if (!section) throw new Error('A welcome chapter is missing from the page.')
        return window.scrollY + section.getBoundingClientRect().top
      })
      const next = scrollProgress(window.scrollY, stops)
      progress.current = next
      element.style.setProperty('--tour-end', reducedMotion ? '0' : String(Math.max(0, (next - 0.78) / 0.22)))
      setActive((current) => {
        const chapter = Math.round(next * (tourChapters.length - 1))
        return current === chapter ? current : chapter
      })
    }
    const requestUpdate = () => { if (!frame) frame = requestAnimationFrame(update) }
    const observer = new ResizeObserver(requestUpdate)
    observer.observe(element)
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

  return <div className="welcome" data-motion={reducedMotion ? 'reduced' : 'full'} data-scene={status} data-chapter={tourChapters[active].id}>
    <a className="welcome-skip" href="#welcome-content">Skip to the story</a>
    <header className="welcome-header">
      <a className="brand" href="#hello" aria-label="Roomlings, back to the beginning">
        <span className="brand-mark"><Snowflake size={23} /></span>roomlings<span className="brand-period">.</span>
      </a>
      <span className="welcome-header-note">A home is better shared.</span>
      <div className="welcome-header-actions">
        <button className="welcome-motion" onClick={() => setMotionOverride(!reducedMotion)} aria-label="Reduced motion" aria-pressed={reducedMotion} title={reducedMotion ? 'Enable motion' : 'Reduce motion'}>
          {reducedMotion ? <Play size={14} /> : <Pause size={14} />}
          <span>{reducedMotion ? 'Motion off' : 'Less motion'}</span>
        </button>
        <a className="welcome-open" href="/">Open kitchen <ArrowRight size={15} /></a>
      </div>
    </header>
    <main className="welcome-story" id="welcome-content" ref={story} tabIndex={-1}>
      <div className="welcome-stage" aria-hidden="true">
        <div className="welcome-scene-backdrop" />
        <div className="welcome-static"><TourFallback /></div>
        <TourBoundary onFailure={() => setStatus('unavailable')}>
          <Suspense fallback={null}><TourScene progress={progress} reducedMotion={reducedMotion} onStatus={setStatus} /></Suspense>
        </TourBoundary>
        <div className="welcome-scrim" />
        <div className="welcome-scrim welcome-scrim-end" />
      </div>
      <section className="welcome-chapter welcome-hello" id="hello" ref={(element) => { sections.current[0] = element }} aria-labelledby="hello-title">
        <div className="welcome-copy">
          <span className="welcome-eyebrow"><span className="welcome-live-dot" /> A LITTLE HOME TO SHARE</span>
          <h1 id="hello-title">Good company.<br />A little less<br /> <em>admin.</em></h1>
          <p>A shared kitchen for the people you live with. Groceries, bills and fair shares, all under one little roof.</p>
          <a className="welcome-explore" href="#groceries"><span><ArrowDown size={18} /></span>Take a look around</a>
          <span className="welcome-side-note"><Leaf size={14} /> Small things. Happier housemates.</span>
        </div>
        <span className="welcome-scene-caption">Your shared life, with a little more life.</span>
      </section>
      <section className="welcome-chapter" id="groceries" ref={(element) => { sections.current[1] = element }} aria-labelledby="groceries-title">
        <div className="welcome-copy">
          <span className="welcome-eyebrow"><span className="welcome-chapter-number">01</span> THE GROCERY RUN</span>
          <h2 id="groceries-title">You bring<br />the good stuff.<br /><em>We split it fairly.</em></h2>
          <p>Milk for the fridge. Bread for the table. Add what you picked up, choose who shares it, and give every cent a home.</p>
          <span className="welcome-detail"><Check size={15} /> Different tastes. A fair share for everyone.</span>
        </div>
      </section>
      <section className="welcome-chapter" id="receipts" ref={(element) => { sections.current[2] = element }} aria-labelledby="receipts-title">
        <div className="welcome-copy">
          <span className="welcome-eyebrow"><span className="welcome-chapter-number">02</span> THE SHARED LEDGER</span>
          <h2 id="receipts-title">Every little thing.<br /><em>One shared tab.</em></h2>
          <p>The grocery run, the rent, the internet bill. One place to see who paid, who shares it, and what is still owed.</p>
          <span className="welcome-detail"><Check size={15} /> Monthly bills, without starting from scratch.</span>
        </div>
      </section>
      <section className="welcome-chapter" id="house-pot" ref={(element) => { sections.current[3] = element }} aria-labelledby="pot-title">
        <div className="welcome-copy">
          <span className="welcome-eyebrow"><span className="welcome-chapter-number">03</span> THE HOUSE POT</span>
          <h2 id="pot-title">A little pot.<br />A lot less<br /><em>guesswork.</em></h2>
          <p>Give the groceries a monthly budget and see what is left. When it is time to settle up, record a repayment and get back to living.</p>
          <span className="welcome-detail welcome-honest-note">Roomlings keeps the record. It never moves your money.</span>
        </div>
      </section>
      <section className="welcome-chapter welcome-finish" id="come-in" ref={(element) => { sections.current[4] = element }} aria-labelledby="come-in-title">
        <div className="welcome-copy">
          <span className="welcome-eyebrow"><span className="welcome-live-dot" /> THERE IS ROOM FOR YOU</span>
          <h2 id="come-in-title">Make yourself<br /><em>at home.</em></h2>
          <p>Less keeping score.<br />More living together.</p>
          <a className="welcome-enter" href="/">Step into the kitchen <ArrowRight size={19} /></a>
          <span className="welcome-start-note">Start with a private sample kitchen.<br />Make it yours when you are ready.</span>
        </div>
        <a className="welcome-again" href="#hello">One more look <ArrowDown size={13} /></a>
      </section>
    </main>
    <footer className="welcome-controls">
      <span className="welcome-scroll-hint"><ArrowDown size={15} />{active === tourChapters.length - 1 ? 'You are right at home.' : 'A little further feels like home.'}</span>
      <nav className="welcome-chapters" aria-label="Kitchen tour chapters">
        {tourChapters.map((chapter, index) => <a href={`#${chapter.id}`} key={chapter.id} aria-label={chapter.label} aria-current={active === index ? 'step' : undefined}>
          <span className="welcome-nav-number">{String(index + 1).padStart(2, '0')}</span><span className="welcome-nav-label">{chapter.short}</span>
        </a>)}
      </nav>
      <span className="welcome-tour-label">THE ROOMLINGS TOUR<span>{String(active + 1).padStart(2, '0')} / 05</span></span>
    </footer>
    <div className="welcome-scene-status" role="status">
      {status === 'loading' && 'Opening the little kitchen...'}
      {status === 'unavailable' && '3D is unavailable in this browser. Enjoy the illustrated tour, or open the kitchen.'}
    </div>
  </div>
}
