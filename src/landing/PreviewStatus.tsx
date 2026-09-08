import { Component } from 'react'
import type { ReactNode } from 'react'
import { LoadingIcon } from '../Branding.tsx'

export class PreviewBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) {
    console.error('The room preview could not be displayed:', error)
    this.props.onFailure()
  }
  render() { return this.state.failed ? null : this.props.children }
}

export function ExploreLoading({ label, reducedMotion }: { label: string; reducedMotion: boolean }) {
  return <div className="welcome-explore-loading" role="status">
    <LoadingIcon size={48} reducedMotion={reducedMotion} />
    <span>{label}</span>
  </div>
}
