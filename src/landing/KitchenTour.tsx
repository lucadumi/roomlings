import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, Pause, Play } from 'lucide-react'
import { scrollProgress } from './tour.ts'
import type { TourLayout } from './tour.ts'
import { TourFallback } from './TourFallback.tsx'
import type { TourStatus } from './TourScene.tsx'
import { defaultRoom } from '../roomNavigation.ts'
import { roomCatalog, roomIds } from '../../shared/rooms.ts'
import type { RoomId } from '../../shared/rooms.ts'
import { RoomChoices, RoomPreview } from './RoomPreview.tsx'
import { ExploreLoading, PreviewBoundary } from './PreviewStatus.tsx'
import { roomTourChapters } from './roomTourChapters.ts'

const TourScene = lazy(() => import('./TourScene.tsx'))
const BathroomTourScene = lazy(() => import('./BathroomTourScene.tsx'))

function roomFromHash(hash: string): RoomId | undefined {
  return roomIds.find((id) => hash === `#tour-${id}` || roomTourChapters[id].some((chapter) => hash === `#${chapter.id}`))
    ?? (!hash || hash === '#tour' ? defaultRoom : undefined)
}

export function KitchenTour({ reducedMotion, paused, onToggleMotion }: { reducedMotion: boolean; paused: boolean; onToggleMotion: () => void }) {
  const track = useRef<HTMLDivElement>(null)
  const pin = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const progress = useRef(0)
  const layout = useRef<TourLayout | null>(null)
  const wake = useRef<(() => void) | null>(null)
  const [active, setActive] = useState(0)
  const [status, setStatus] = useState<TourStatus>('loading')
  const [mounted, setMounted] = useState(false)
  const [room, setRoom] = useState<RoomId>(() => roomFromHash(location.hash) ?? defaultRoom)
  const currentRoom = useRef(room)
  const generation = useRef(0)
  const chapters = roomTourChapters[room]
  const sceneGeneration = generation.current

  const changeRoom = useCallback((next: RoomId) => {
    if (next === currentRoom.current) return
    currentRoom.current = next
    generation.current++
    progress.current = 0
    layout.current = null
    wake.current = null
    setActive(0)
    setStatus('loading')
    setMounted(false)
    setRoom(next)
  }, [])
  const reportStatus = (next: TourStatus) => {
    if (generation.current === sceneGeneration) setStatus(next)
  }

  const positionChapter = (index: number, behavior: ScrollBehavior) => {
    const element = track.current
    const card = pin.current
    const title = heading.current
    if (!element || !card || !title) throw new Error('The room exploration is not mounted.')
    if (element.dataset.flow === 'true') {
      progress.current = index / (chapters.length - 1)
      setActive(index)
      if (!reducedMotion) wake.current?.()
    } else {
      const start = window.scrollY + title.getBoundingClientRect().top
      const travel = element.getBoundingClientRect().height - card.getBoundingClientRect().height
      window.scrollTo({ top: start + travel * index / (chapters.length - 1), behavior })
    }
  }

  useEffect(() => {
    const restoreRoom = () => {
      const requested = roomFromHash(location.hash)
      if (requested) changeRoom(requested)
      if (!location.hash || location.hash === '#tour') {
        progress.current = 0
        setActive(0)
        if (!reducedMotion) wake.current?.()
      }
    }
    window.addEventListener('hashchange', restoreRoom)
    return () => window.removeEventListener('hashchange', restoreRoom)
  }, [changeRoom, reducedMotion])

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const observedGeneration = generation.current
    const observer = new IntersectionObserver((entries) => {
      if (generation.current === observedGeneration && entries.some((entry) => entry.isIntersecting)) {
        setMounted(true)
        observer.disconnect()
      }
    }, { rootMargin: '280px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [room])

  useEffect(() => {
    const element = track.current
    const card = pin.current
    const viewport = stage.current
    const title = heading.current
    if (!element || !card || !viewport || !title) return
    let frame = 0
    let previousLayout = ''
    const observedGeneration = generation.current
    const update = () => {
      frame = 0
      if (generation.current !== observedGeneration || !viewport.clientWidth || !viewport.clientHeight) return
      const previousProgress = progress.current
      const cardHeight = card.getBoundingClientRect().height
      const height = `${cardHeight}px`
      if (element.style.getPropertyValue('--welcome-tour-height') !== height) element.style.setProperty('--welcome-tour-height', height)
      const offset = `${title.getBoundingClientRect().top - element.getBoundingClientRect().top}px`
      if (element.style.getPropertyValue('--welcome-tour-start-offset') !== offset) element.style.setProperty('--welcome-tour-start-offset', offset)
      const flowing = reducedMotion || cardHeight + 48 > window.innerHeight
      element.dataset.flow = String(flowing)
      if (!flowing) {
        const start = window.scrollY + title.getBoundingClientRect().top
        const travel = element.getBoundingClientRect().height - cardHeight
        if (travel > 0) progress.current = scrollProgress(window.scrollY, [start, start + travel])
      }
      if (progress.current !== previousProgress && !reducedMotion) wake.current?.()
      const area = { x: 0, y: 0, width: viewport.clientWidth, height: viewport.clientHeight }
      const measured = { width: area.width, height: area.height, start: area, end: area, top: 0, bottom: area.height }
      const key = JSON.stringify(measured)
      if (key !== previousLayout) {
        previousLayout = key
        layout.current = measured
        wake.current?.()
      }
      setActive(Math.round(progress.current * (chapters.length - 1)))
    }
    const requestUpdate = () => { if (!frame) frame = requestAnimationFrame(update) }
    const onHash = () => {
      const index = chapters.findIndex(({ id }) => location.hash === `#${id}`)
      if (index >= 0) positionChapter(index, 'instant')
      else if (location.hash === '#tour' || location.hash === `#tour-${room}`) positionChapter(0, 'instant')
      requestUpdate()
    }
    const observer = new ResizeObserver(requestUpdate)
    observer.observe(viewport)
    observer.observe(card)
    observer.observe(title)
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
    if (!chapters[index]) throw new Error('That room exploration chapter is not available.')
    const previous: unknown = history.state
    history.pushState(previous !== null && typeof previous === 'object' ? { ...previous, roomlingsTourScroll: undefined } : null, '', `#${chapters[index].id}`)
    positionChapter(index, reducedMotion ? 'instant' : 'smooth')
  }

  const selectRoom = (next: RoomId) => {
    if (next === room) return
    const previous: unknown = history.state
    history.pushState(previous !== null && typeof previous === 'object' ? { ...previous, roomlingsTourScroll: undefined } : null,
      '', next === defaultRoom ? '#tour' : `#tour-${next}`)
    changeRoom(next)
  }

  const motionControl = <button type="button" className="welcome-motion" onClick={onToggleMotion} aria-label="Reduced motion" aria-pressed={reducedMotion}>
    {reducedMotion ? <Play size={16} /> : <Pause size={16} />}<span>Reduced motion</span>
  </button>

  return <section className="welcome-tour welcome-container" id="tour" aria-labelledby="tour-title"
    data-room={room} data-scene={status} data-chapter={chapters[active].id}>
    {roomIds.map((id) => <span className="welcome-room-anchor" id={`tour-${id}`} key={id} aria-hidden="true" />)}
    <div className="welcome-section-heading">
      <h2 id="tour-title" ref={heading}>Explore the rooms</h2>
      <a className="welcome-text-link" href="#questions">Skip the tour <ArrowDown size={16} /></a>
    </div>
    <RoomChoices value={room} onChange={selectRoom} />
    <div className="welcome-tour-track" ref={track}>
      {chapters.map(({ id }, index) => <span className="welcome-tour-stop" id={id} key={id} style={{ top: `calc(var(--welcome-tour-start-offset, 0px) + var(--welcome-tour-travel) * ${index / (chapters.length - 1)})` }} />)}
      <div className="welcome-tour-pin" ref={pin}>
        <div className="welcome-tour-card">
          <div className="welcome-stage-shell">
            <div className="welcome-stage" ref={stage} aria-hidden="true">
              <div className="welcome-static">{room === 'kitchen' ? <TourFallback /> : <RoomPreview roomId="bathroom" />}</div>
              {mounted && <PreviewBoundary key={room} onFailure={() => reportStatus('unavailable')}>
                <Suspense fallback={null}>{room === 'kitchen'
                  ? <TourScene progress={progress} layout={layout} wake={wake} reducedMotion={reducedMotion || paused} onStatus={reportStatus}
                    onSelectChapter={!paused ? selectChapter : undefined} />
                  : <BathroomTourScene progress={progress} wake={wake} reducedMotion={reducedMotion || paused} onStatus={reportStatus}
                    onSelectChapter={!paused ? selectChapter : undefined} />
                }</Suspense>
              </PreviewBoundary>}
            </div>
            {mounted && status === 'loading' && <ExploreLoading label={`Loading the ${room}...`} reducedMotion={reducedMotion || paused} />}
          </div>
          <div className="welcome-tour-description">
            <div className="welcome-tour-details" id="tour-details">
              {chapters.map(({ title, copy }, index) => <div className="welcome-tour-copy" key={title} aria-hidden={active !== index} data-active={active === index}>
                <h3>{title}</h3><p>{copy}</p>
              </div>)}
            </div>
            <p className="welcome-tour-hint"><ArrowDown size={14} />Scroll, tap an object or use the controls.</p>
          </div>
        </div>
        <div className="welcome-tour-controls">
          <nav className="welcome-chapters" aria-label={`${roomCatalog[room].name} tour`}>
            {chapters.map(({ id, label, short, icon: Icon }, index) => {
              return <button type="button" key={id} aria-label={label} aria-pressed={active === index} aria-controls="tour-details" onClick={() => selectChapter(index)}><Icon size={17} /><span>{short}</span></button>
            })}
          </nav>
          {motionControl}
        </div>
        {status === 'unavailable' && <div className="welcome-scene-status" role="status">
          3D is unavailable. Use the controls to explore each part of the room.
        </div>}
      </div>
    </div>
  </section>
}
