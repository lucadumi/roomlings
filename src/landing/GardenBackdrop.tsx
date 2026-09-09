import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { gardenLayout } from './gardenLayout.ts'
import type { GardenLayout } from './gardenLayout.ts'
import { gardenContentMask } from './gardenMask.ts'
import type { GardenStatus } from './GardenScene.tsx'
import { PreviewBoundary } from './PreviewStatus.tsx'
import leftGarden from '../assets/garden/left.png'
import rightGarden from '../assets/garden/right.png'
import './garden.css'

const GardenScene = lazy(() => import('./GardenScene.tsx'))

export function GardenBackdrop({ contentRef, reducedMotion, paused }: {
  contentRef: RefObject<HTMLElement | null>
  reducedMotion: boolean
  paused: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<GardenLayout | null>(null)
  const [mounted, setMounted] = useState(false)
  const [status, setStatus] = useState<'static' | GardenStatus>('static')
  const unavailable = useCallback(() => setStatus('unavailable'), [])
  const reportStatus = useCallback((next: GardenStatus) => setStatus(next), [])

  useEffect(() => {
    const element = host.current
    const content = contentRef.current
    const welcome = element?.parentElement
    if (!element || !content || !welcome) return
    const observed = new Set<Element>()
    const positionMask = () => {
      element.style.maskPosition = `0px ${-window.scrollY}px`
      element.dataset.maskScroll = String(window.scrollY)
    }
    const measure = () => {
      const area = element.getBoundingClientRect()
      const clear = content.getBoundingClientRect()
      if (!area.width || !area.height) return
      const next = gardenLayout(area.width, area.height, clear.left - area.left, clear.right - area.left)
      setLayout((previous) => previous && previous.width === next.width && previous.height === next.height
        && previous.left.width === next.left.width && previous.right.width === next.right.width ? previous : next)
      if (!next.left.visible && !next.right.visible) {
        element.style.maskImage = 'none'
        element.dataset.maskedRegions = '0'
        return
      }
      const regions = [...welcome.querySelectorAll(
        '.welcome-header, .welcome-hero-copy, .welcome-feature-copy, .welcome-section-heading h2, .welcome-section-heading a, .welcome-preview-options, .welcome-tour-pin, .welcome-questions-heading, .welcome-faq, .welcome-invitation, .welcome-footer, .welcome-access-notice',
      )]
      const protectedAreas = regions.flatMap((region) => {
        if (!observed.has(region)) { observer.observe(region); observed.add(region) }
        const rect = region.getBoundingClientRect()
        return rect.width && rect.height ? [{ x: rect.left - area.left, y: rect.top + window.scrollY, width: rect.width, height: rect.height }] : []
      })
      const pageHeight = Math.max(document.documentElement.scrollHeight, area.height)
      const image = gardenContentMask(area.width, pageHeight, protectedAreas)
      element.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(image)}")`
      element.style.maskSize = `${area.width}px ${pageHeight}px`
      element.dataset.maskedRegions = String(protectedAreas.length)
      positionMask()
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(content)
    observer.observe(welcome)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', positionMask, { passive: true })
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', positionMask)
    }
  }, [contentRef])

  useEffect(() => {
    if (mounted || !layout?.animate || reducedMotion || paused || status === 'unavailable') return
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(() => setMounted(true), { timeout: 1200 })
      return () => window.cancelIdleCallback(idle)
    }
    const timer = window.setTimeout(() => setMounted(true), 180)
    return () => window.clearTimeout(timer)
  }, [mounted, layout?.animate, reducedMotion, paused, status])

  return <div className="welcome-garden" ref={host} aria-hidden="true" data-scene={status}>
    {(['left', 'right'] as const).map((side) => {
      const rail = layout?.[side]
      return <div key={side} className={`welcome-garden-rail welcome-garden-${side}`}
        style={rail ? { left: rail.x, width: rail.width } : undefined}>
        <img className="welcome-garden-still" src={side === 'left' ? leftGarden : rightGarden}
          alt="" width={360} height={600} draggable={false} decoding="async" hidden={!rail?.visible}
          style={rail ? { left: rail.frame.x - rail.x, top: rail.frame.y, width: rail.frame.width, height: rail.frame.height } : undefined} />
      </div>
    })}
    {mounted && layout && status !== 'unavailable' && <PreviewBoundary onFailure={unavailable}>
      <Suspense fallback={null}>
        <GardenScene layout={layout} reducedMotion={reducedMotion} paused={paused} onStatus={reportStatus} />
      </Suspense>
    </PreviewBoundary>}
  </div>
}
