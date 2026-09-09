import { useEffect, useRef, useState } from 'react'
import type { RoomStyle } from '../shared/domain.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import { LoadingIcon } from './Branding.tsx'

export function ComponentPreview({ component, roomStyle }: { component: RoomComponent; roomStyle: RoomStyle }) {
  const host = useRef<HTMLSpanElement>(null)
  const model = useRef(component)
  model.current = component
  const key = [component.kind, component.slotId, component.variant, component.finish, component.state ?? '', roomStyle].join(':')
  const [preview, setPreview] = useState<{ key: string; image?: string; error?: string } | null>(null)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const currentComponent = model.current
    let cancelled = false
    let started = false
    const load = () => {
      if (started) return
      started = true
      void import('./componentThumbnail.ts').then(({ renderComponentThumbnail }) => renderComponentThumbnail(currentComponent, roomStyle))
        .then((image) => { if (!cancelled) setPreview({ key, image }) })
        .catch((error: unknown) => {
          if (cancelled) return
          const message = error instanceof Error ? error.message : 'This object preview could not be drawn.'
          console.error('Object preview failed:', message)
          setPreview({ key, error: message })
        })
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); load() }
    }, { rootMargin: '160px' })
    observer.observe(element)
    return () => { cancelled = true; observer.disconnect() }
  }, [key, roomStyle])
  const current = preview?.key === key ? preview : null
  return <span className="component-preview" ref={host} data-preview-kind={component.kind} data-preview-ready={!!current?.image}
    data-preview-renderer={current?.image ? current.image.startsWith('data:image/png') ? 'webgl' : 'svg' : undefined}>
    {current?.image ? <img src={current.image} alt="" width={320} height={240} draggable={false} />
      : current?.error ? <span className="component-preview-error" title={current.error}>Preview unavailable</span>
        : <span className="component-preview-loading" aria-hidden="true"><LoadingIcon size={23} /></span>}
  </span>
}
