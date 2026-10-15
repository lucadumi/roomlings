import { Component, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { LoadingIcon } from './Branding.tsx'
import { appFailureKind, hasUnconfirmedWrites, reportAppFailure } from './appFailure.ts'

type State = { failed: false } | { failed: true; unconfirmed: boolean }

export class AppBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }
  static getDerivedStateFromError(): State { return { failed: true, unconfirmed: hasUnconfirmedWrites() } }
  componentDidCatch(error: unknown) { reportAppFailure(appFailureKind(error), error) }
  render() {
    return this.state.failed ? <AppRecovery unconfirmed={this.state.unconfirmed} /> : this.props.children
  }
}

function AppRecovery({ unconfirmed }: { unconfirmed: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <main className="app-recovery">
    <section className="app-recovery-card" role="alert" aria-labelledby="app-recovery-title">
      <LoadingIcon size={56} />
      <h1 id="app-recovery-title" ref={heading} tabIndex={-1}>Roomlings couldn't open.</h1>
      {unconfirmed && <p>Your last change may not have saved. Check it after reloading.</p>}
      <button type="button" className="button primary" onClick={() => location.reload()}>Reload</button>
    </section>
  </main>
}
