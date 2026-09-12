import iconFlat from './assets/brand/roomlings-icon-flat.svg'
import iconLight from './assets/brand/roomlings-icon-light.svg'
import wordmark from './assets/brand/roomlings-wordmark.svg'
import { brandDimensions } from './assets/brand/dimensions.ts'
import './branding.css'

export function Brand({ variant = 'compact', decorative = false }: {
  variant?: 'compact' | 'featured'
  decorative?: boolean
}) {
  return <span className="roomlings-brand" data-variant={variant}
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Roomlings'} aria-hidden={decorative || undefined}>
    <img className="roomlings-brand-icon" src={iconFlat}
      width={brandDimensions.icon.width} height={brandDimensions.icon.height} alt="" draggable={false} />
    <img className="roomlings-wordmark" src={wordmark}
      width={brandDimensions.wordmark.width} height={brandDimensions.wordmark.height} alt="" draggable={false} />
  </span>
}

const loaderAssets = {
  color: iconFlat,
  light: iconLight,
}

// Both motion preferences use the approved static mark.
export function LoadingIcon({ size = 24, tone = 'color' }: {
  size?: number
  tone?: keyof typeof loaderAssets
  reducedMotion?: boolean
}) {
  return <img className="roomlings-loader" src={loaderAssets[tone]}
    width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}

export function SceneLoading({ label = 'Putting the kettle on...' }: { label?: string }) {
  return <div className="scene-loading" role="status"><LoadingIcon size={64} /><span>{label}</span></div>
}
