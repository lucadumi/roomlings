import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowRight, CheckCheck, Home, Pause, Play, ReceiptText, ShoppingBasket, Wallet } from 'lucide-react'
import { scrollProgress, tourChapters } from './tour.ts'
import type { TourLayout } from './tour.ts'
import { TourFallback } from './TourFallback.tsx'
import { LoadingIcon } from '../Branding.tsx'
import type { TourStatus } from './TourScene.tsx'
import { defaultRoom, roomPath } from '../roomNavigation.ts'
import { roomIds } from '../../shared/rooms.ts'
import type { RoomId } from '../../shared/rooms.ts'
import { RoomChoices, RoomPreview } from './RoomPreview.tsx'

const TourScene = lazy(() => import('./TourScene.tsx'))
const chapters = [
  { icon: Home, title: 'A room you can use.', copy: 'Open chores from the cleaning caddy and supplies from the shelf. The toolbar keeps everything available, and Rooms opens your bathroom.' },
  { icon: ShoppingBasket, title: 'From list to receipt.', copy: 'Add items, claim what you will buy and tick it into your basket. Saving the paid receipt archives the run in Past runs and updates the shared balances.' },
  { icon: ReceiptText, title: 'Bills that repeat.', copy: 'Set up rent, utilities or subscriptions. Change defaults or pause future months without rewriting past payments, then record each paid month in the same ledger.' },
  { icon: Wallet, title: 'A pot for groceries.', copy: 'Set a monthly grocery budget and see what is left for the month you are viewing. Bills and repayments do not spend this pot.' },
  { icon: CheckCheck, title: 'Know who owes what.', copy: 'All paid costs feed the same roommate balances, across rooms and months. Record repayments after paying, undo mistakes and export the complete ledger.' },
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
  const [room, setRoom] = useState<RoomId>(() => roomIds.find((id) => location.hash === `#tour-${id}`) ?? defaultRoom)

  const positionChapter = (index: number, behavior: ScrollBehavior) => {
    const element = track.current
    const card = pin.current
    if (!element || !card) throw new Error('The kitchen tour is not mounted.')
    if (element.dataset.flow === 'true') {
      progress.current = index / (tourChapters.length - 1)
      setActive(index)
    } else {
      const start = window.scrollY + element.getBoundingClientRect().top - parseFloat(getComputedStyle(card).top)
      const travel = element.getBoundingClientRect().height - card.getBoundingClientRect().height
      window.scrollTo({ top: start + travel * index / (tourChapters.length - 1), behavior })
    }
  }

  useEffect(() => {
    const restoreRoom = () => {
      const requested = roomIds.find((id) => location.hash === `#tour-${id}`)
      if (requested) setRoom(requested)
      else if (!location.hash || location.hash === '#tour' || tourChapters.some(({ id }) => location.hash === `#${id}`)) {
        setRoom(defaultRoom)
        if (!location.hash || location.hash === '#tour') {
          progress.current = 0
          setActive(0)
        }
      }
    }
    window.addEventListener('hashchange', restoreRoom)
    return () => window.removeEventListener('hashchange', restoreRoom)
  }, [])

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
    if (room !== 'kitchen') return
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
      if (index >= 0) positionChapter(index, 'instant')
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
  }, [reducedMotion, room])

  const selectChapter = (index: number) => {
    const previous: unknown = history.state
    history.pushState(previous !== null && typeof previous === 'object' ? { ...previous, roomlingsTourScroll: undefined } : null, '', `#${tourChapters[index].id}`)
    positionChapter(index, reducedMotion ? 'instant' : 'smooth')
  }

  const selectRoom = (next: RoomId) => {
    if (next === room) return
    const previous: unknown = history.state
    history.pushState(previous !== null && typeof previous === 'object' ? { ...previous, roomlingsTourScroll: undefined } : null,
      '', next === defaultRoom ? '#tour' : `#tour-${next}`)
    progress.current = 0
    setActive(0)
    setRoom(next)
  }

  const motionControl = <button type="button" className="welcome-motion" onClick={onToggleMotion} aria-label="Reduced motion" aria-pressed={reducedMotion}>
    {reducedMotion ? <Play size={16} /> : <Pause size={16} />}<span>Reduced motion</span>
  </button>

  return <section className="welcome-tour welcome-container" id="tour" aria-labelledby="tour-title"
    data-room={room} data-scene={room === 'kitchen' ? status : 'preview'} data-chapter={room === 'kitchen' ? tourChapters[active].id : undefined}>
    {roomIds.map((id) => <span className="welcome-room-anchor" id={`tour-${id}`} key={id} aria-hidden="true" />)}
    <div className="welcome-section-heading">
      <h2 id="tour-title">Explore the rooms</h2>
      <a className="welcome-text-link" href="#questions">Skip the tour <ArrowDown size={16} /></a>
    </div>
    <RoomChoices value={room} onChange={selectRoom} />
    {room === 'bathroom' && <div className="welcome-bathroom-preview">
      <div className="welcome-tour-card">
        <RoomPreview roomId={room} />
        <div className="welcome-tour-description">
          <div className="welcome-tour-details">
            <div className="welcome-tour-copy" data-active="true">
              <h3>A bathroom everyone shares.</h3>
              <p>Open chores from the sink, mirror, bath or toilet. Rotate the work and add low supplies to the same shopping list your kitchen uses.</p>
            </div>
          </div>
          <a className="welcome-text-link" href={roomPath(room)}>Open bathroom <ArrowRight size={16} /></a>
        </div>
      </div>
      <div className="welcome-tour-controls">{motionControl}</div>
    </div>}
    <div className="welcome-tour-track" ref={track} hidden={room !== 'kitchen'}>
      {tourChapters.map(({ id }, index) => <span className="welcome-tour-stop" id={id} key={id} style={{ top: `calc(var(--welcome-tour-travel) * ${index / (tourChapters.length - 1)})` }} />)}
      <div className="welcome-tour-pin" ref={pin}>
        <div className="welcome-tour-card">
          <div className="welcome-stage" ref={stage} aria-hidden="true">
            <div className="welcome-static"><TourFallback /></div>
            {mounted && <TourBoundary onFailure={() => setStatus('unavailable')}>
              <Suspense fallback={null}><TourScene progress={progress} layout={layout} wake={wake} reducedMotion={reducedMotion || paused || room !== 'kitchen'} onStatus={setStatus} /></Suspense>
            </TourBoundary>}
          </div>
          <div className="welcome-tour-description">
            <div className="welcome-tour-details" id="tour-details">
              {chapters.map(({ title, copy }, index) => <div className="welcome-tour-copy" key={title} aria-hidden={active !== index} data-active={active === index}>
                <h3>{title}</h3><p>{copy}</p>
              </div>)}
            </div>
            <a className="welcome-text-link" href={roomPath()}>Open kitchen <ArrowRight size={16} /></a>
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
          {motionControl}
        </div>
        <div className="welcome-scene-status" role="status">
          {mounted && status === 'loading' && <span className="loading-status"><LoadingIcon reducedMotion={reducedMotion || paused} />Loading the kitchen preview...</span>}
          {status === 'unavailable' && '3D is unavailable. Explore the illustration, or sign in to use the household tools.'}
        </div>
      </div>
    </div>
  </section>
}
