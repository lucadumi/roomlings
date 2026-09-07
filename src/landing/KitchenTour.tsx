import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowRight, CheckCheck, Home, Pause, Play, ReceiptText, ShoppingBasket, Wallet } from 'lucide-react'
import { scrollProgress, tourChapters } from './tour.ts'
import type { TourLayout } from './tour.ts'
import { TourFallback } from './TourFallback.tsx'
import type { TourStatus } from './TourScene.tsx'

const TourScene = lazy(() => import('./TourScene.tsx'))
const chapters = [
  { icon: Home, title: 'The kitchen', copy: 'Open the shopping list, receipts and budget through objects in the room.' },
  { icon: ShoppingBasket, title: 'Groceries', copy: 'Claim items from the shopping list. Record a paid run to add it to the ledger and stock the fridge.' },
  { icon: ReceiptText, title: 'Bills and receipts', copy: 'Keep grocery receipts and recurring household bills together, with the payer and shares recorded.' },
  { icon: Wallet, title: 'Monthly budget', copy: 'The house pot shows the grocery budget left this month. Bills are tracked separately from this pot.' },
  { icon: CheckCheck, title: 'Repayments', copy: 'Pay your roommate, then record the repayment to update the shared balances.' },
]

class TourBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) {
    console.error('The welcome kitchen could not be displayed:', error)
    this.props.onFailure()
  }
  render() { return this.state.failed ? null : this.props.children }
}

export function KitchenTour({ reducedMotion, paused, onToggleMotion }: { reducedMotion: boolean; paused: boolean; onToggleMotion: () => void }) {
  const track = useRef<HTMLDivElement>(null)
  const pin = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const progress = useRef(0)
  const layout = useRef<TourLayout | null>(null)
  const wake = useRef<(() => void) | null>(null)
  const [active, setActive] = useState(0)
  const [status, setStatus] = useState<TourStatus>('loading')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setMounted(true)
        observer.disconnect()
      }
    }, { rootMargin: '280px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = track.current
    const card = pin.current
    const viewport = stage.current
    if (!element || !card || !viewport) return
    let frame = 0
    let previousLayout = ''
    const update = () => {
      frame = 0
      if (!viewport.clientWidth || !viewport.clientHeight) return
      const cardHeight = card.getBoundingClientRect().height
      const height = `${cardHeight}px`
      if (element.style.getPropertyValue('--welcome-tour-height') !== height) element.style.setProperty('--welcome-tour-height', height)
      const flowing = reducedMotion || cardHeight + 48 > window.innerHeight
      element.dataset.flow = String(flowing)
      if (!flowing) {
        const inset = parseFloat(getComputedStyle(card).top)
        const start = window.scrollY + element.getBoundingClientRect().top - inset
        const travel = element.getBoundingClientRect().height - cardHeight
        if (travel > 0) progress.current = scrollProgress(window.scrollY, [start, start + travel])
      }
      const area = { x: 0, y: 0, width: viewport.clientWidth, height: viewport.clientHeight }
      const measured = { width: area.width, height: area.height, start: area, end: area, top: 0, bottom: area.height }
      const key = JSON.stringify(measured)
      if (key !== previousLayout) {
        previousLayout = key
        layout.current = measured
        wake.current?.()
      }
      setActive(Math.round(progress.current * (tourChapters.length - 1)))
    }
    const requestUpdate = () => { if (!frame) frame = requestAnimationFrame(update) }
    const onHash = () => {
      const index = tourChapters.findIndex(({ id }) => location.hash === `#${id}`)
      if (index >= 0 && element.dataset.flow === 'true') {
        progress.current = index / (tourChapters.length - 1)
        setActive(index)
      }
      requestUpdate()
    }
    const observer = new ResizeObserver(requestUpdate)
    observer.observe(viewport)
    observer.observe(card)
    update()
    onHash()
    window.addEventListener('scroll', requestUpdate, { passive: true })
    window.addEventListener('resize', requestUpdate)
    window.addEventListener('hashchange', onHash)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', requestUpdate)
      window.removeEventListener('resize', requestUpdate)
      window.removeEventListener('hashchange', onHash)
    }
  }, [reducedMotion])

  const selectChapter = (index: number) => {
    const element = track.current
    const card = pin.current
    if (!element || !card) throw new Error('The kitchen tour is not mounted.')
    const previous: unknown = history.state
    history.pushState(previous !== null && typeof previous === 'object' ? { ...previous, roomlingsTourScroll: undefined } : null, '', `#${tourChapters[index].id}`)
    if (element.dataset.flow === 'true') {
      progress.current = index / (tourChapters.length - 1)
      setActive(index)
    } else {
      const start = window.scrollY + element.getBoundingClientRect().top - parseFloat(getComputedStyle(card).top)
      const travel = element.getBoundingClientRect().height - card.getBoundingClientRect().height
      window.scrollTo({ top: start + travel * index / (tourChapters.length - 1), behavior: reducedMotion ? 'instant' : 'smooth' })
    }
  }

  return <section className="welcome-tour welcome-container" id="tour" aria-labelledby="tour-title" data-scene={status} data-chapter={tourChapters[active].id}>
    <div className="welcome-section-heading">
      <h2 id="tour-title">Inside the kitchen</h2>
      <a className="welcome-text-link" href="#questions">Skip the tour <ArrowDown size={16} /></a>
    </div>
    <div className="welcome-tour-track" ref={track}>
      {tourChapters.map(({ id }, index) => <span className="welcome-tour-stop" id={id} key={id} style={{ top: `calc(var(--welcome-tour-travel) * ${index / (tourChapters.length - 1)})` }} />)}
      <div className="welcome-tour-pin" ref={pin}>
        <div className="welcome-tour-card">
          <div className="welcome-stage" ref={stage} aria-hidden="true">
            <div className="welcome-static"><TourFallback /></div>
            {mounted && <TourBoundary onFailure={() => setStatus('unavailable')}>
              <Suspense fallback={null}><TourScene progress={progress} layout={layout} wake={wake} reducedMotion={reducedMotion || paused} onStatus={setStatus} /></Suspense>
            </TourBoundary>}
          </div>
          <div className="welcome-tour-description">
            <div className="welcome-tour-details" id="tour-details">
              {chapters.map(({ title, copy }, index) => <div className="welcome-tour-copy" key={title} aria-hidden={active !== index} data-active={active === index}>
                <h3>{title}</h3><p>{copy}</p>
              </div>)}
            </div>
            <a className="welcome-text-link" href="/kitchen">Explore the kitchen <ArrowRight size={16} /></a>
            <p className="welcome-tour-hint"><ArrowDown size={14} />Scroll or choose an object.</p>
          </div>
        </div>
        <div className="welcome-tour-controls">
          <nav className="welcome-chapters" aria-label="Kitchen tour">
            {tourChapters.map(({ id, label, short }, index) => {
              const Icon = chapters[index].icon
              return <button type="button" key={id} aria-label={label} aria-pressed={active === index} aria-controls="tour-details" onClick={() => selectChapter(index)}><Icon size={17} /><span>{short}</span></button>
            })}
          </nav>
          <button type="button" className="welcome-motion" onClick={onToggleMotion} aria-label="Reduced motion" aria-pressed={reducedMotion}>
            {reducedMotion ? <Play size={16} /> : <Pause size={16} />}<span>Reduced motion</span>
          </button>
        </div>
        <div className="welcome-scene-status" role="status">
          {mounted && status === 'loading' && 'Loading the kitchen preview...'}
          {status === 'unavailable' && '3D is unavailable. You can still explore the illustration and use every kitchen tool.'}
        </div>
      </div>
    </div>
  </section>
}
