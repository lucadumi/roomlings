import icon3d from './assets/brand/roomlings-icon-3d.png'
import iconFlat from './assets/brand/roomlings-icon-flat.svg'
import iconLight from './assets/brand/roomlings-icon-light.svg'
import wordmark from './assets/brand/roomlings-wordmark.svg'
import loader from './assets/brand/roomlings-loader.svg'
import loaderLight from './assets/brand/roomlings-loader-light.svg'
import './branding.css'

export function Brand({ variant = 'compact', decorative = false }: {
  variant?: 'compact' | 'featured'
  decorative?: boolean
}) {
  return <span className="roomlings-brand" data-variant={variant}
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Roomlings'} aria-hidden={decorative || undefined}>
    {variant === 'featured' ? <picture className="roomlings-brand-icon">
      <source media="(max-width: 640px)" srcSet={iconFlat} />
      <img src={icon3d} width={512} height={512} alt="" draggable={false} />
    </picture> : <img className="roomlings-brand-icon" src={iconFlat} width={128} height={128} alt="" draggable={false} />}
    <img className="roomlings-wordmark" src={wordmark} width={9540} height={2030} alt="" draggable={false} />
  </span>
}

const loaderAssets = {
  color: { animated: loader, still: iconFlat },
  light: { animated: loaderLight, still: iconLight },
}

export function LoadingIcon({ size = 24, tone = 'color', reducedMotion = false }: {
  size?: number
  tone?: keyof typeof loaderAssets
  reducedMotion?: boolean
}) {
  return <img className="roomlings-loader" src={loaderAssets[tone][reducedMotion ? 'still' : 'animated']}
    width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}

export function SceneLoading({ label = 'Putting the kettle on...' }: { label?: string }) {
  return <div className="scene-loading" role="status"><LoadingIcon size={64} /><span>{label}</span></div>
}
