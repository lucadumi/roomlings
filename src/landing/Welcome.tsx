import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, Plus } from 'lucide-react'
import { Brand } from '../Branding.tsx'
import { KitchenTour } from './KitchenTour.tsx'
import { HomeIllustration } from './HomeIllustration.tsx'
import './welcome.css'

function subscribeToMotion(callback: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

const features = [
  { number: '01', title: 'Plan the shop.', description: 'Add groceries to one shared list and claim what you will pick up.' },
  { number: '02', title: 'Split the costs.', description: 'Record paid groceries and household bills. Choose who shares each cost.' },
  { number: '03', title: 'Settle up.', description: 'See the balances, pay your roommate, then record the repayment.' },
]

export default function Welcome({ accessNotice, paused = false }: { accessNotice?: ReactNode; paused?: boolean }) {
  const systemReduced = useSyncExternalStore(subscribeToMotion, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches, () => false)
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null)
  const reducedMotion = motionOverride ?? systemReduced

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Roomlings | Share a home. Not the hassle.'
    let cancelled = false
    const saved: unknown = history.state
    const scroll = saved !== null && typeof saved === 'object' && 'roomlingsTourScroll' in saved
      && typeof saved.roomlingsTourScroll === 'number' && Number.isFinite(saved.roomlingsTourScroll) && saved.roomlingsTourScroll >= 0
      ? saved.roomlingsTourScroll : null
    void document.fonts.ready.then(() => {
      if (cancelled) return
      if (scroll !== null) window.scrollTo({ top: scroll, behavior: 'instant' })
      else document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' })
    })
    const rememberPosition = () => {
      const previous: unknown = history.state
      history.replaceState({
        ...(previous !== null && typeof previous === 'object' ? previous : {}),
        roomlingsTourScroll: window.scrollY,
      }, '')
    }
    window.addEventListener('pagehide', rememberPosition)
    window.addEventListener('beforeunload', rememberPosition)
    return () => {
      cancelled = true
      document.title = previousTitle
      window.removeEventListener('pagehide', rememberPosition)
      window.removeEventListener('beforeunload', rememberPosition)
    }
  }, [])

  return <div className="welcome" data-motion={reducedMotion ? 'reduced' : 'full'} data-edition="journal" id="welcome-top">
    <a className="welcome-skip" href="#welcome-content">Skip to content</a>
    <header className="welcome-header welcome-container">
      <a className="brand" href="#welcome-top" aria-label="Roomlings, back to the beginning">
        <Brand variant="featured" decorative />
      </a>
      <nav className="welcome-navigation" aria-label="On this page">
        <a href="#how-it-works">How it works</a>
        <a href="#tour">A look inside</a>
        <a href="#questions">Questions</a>
      </nav>
      <div className="welcome-header-actions">
        <a className="welcome-sign-in" href="/#account">Sign in <ArrowRight size={15} /></a>
        <a className="button primary welcome-enter" href="/#account=create">Get started</a>
      </div>
    </header>
    {accessNotice && <div className="welcome-access-notice welcome-container">{accessNotice}</div>}
    <main id="welcome-content" tabIndex={-1}>
      <section className="welcome-hero welcome-container" aria-labelledby="welcome-title">
        <div className="welcome-hero-copy">
          <h1 id="welcome-title">Share a home.<br /><em>Not the hassle.</em></h1>
          <p>Groceries, household bills and who owes what, in one shared home.</p>
          <div className="welcome-actions">
            <a className="button primary welcome-enter" href="/#account=create">Get started <ArrowRight size={18} /></a>
            <a className="welcome-text-link" href="/kitchen">Explore the kitchen <ArrowUpRight size={16} /></a>
          </div>
          <p className="welcome-small"><Check size={14} />Try a sample kitchen without signing in.</p>
        </div>
        <figure className="welcome-vignette" role="img" aria-label="Illustration of a shared home">
          <HomeIllustration />
        </figure>
      </section>

      <section className="welcome-features welcome-container" id="how-it-works" aria-labelledby="features-title">
        <div className="welcome-section-heading">
          <h2 id="features-title">How it works.</h2>
        </div>
        <div className="welcome-journal">
          {features.map(({ number, title, description }, index) => <article className={`welcome-feature welcome-feature-${number}`} key={number}>
            <span className="welcome-feature-number" aria-hidden="true">{number}</span>
            <div className="welcome-feature-copy"><h3>{title}</h3><p>{description}</p></div>
            <div className="welcome-feature-art" aria-hidden="true">{index === 0 ? <ShoppingNote /> : index === 1 ? <ReceiptNote /> : <EnvelopeNote />}</div>
          </article>)}
        </div>
      </section>

      <KitchenTour reducedMotion={reducedMotion} paused={paused} onToggleMotion={() => setMotionOverride(!reducedMotion)} />

      <section className="welcome-questions welcome-container" id="questions" aria-labelledby="questions-title">
        <div className="welcome-questions-heading"><h2 id="questions-title">Questions</h2></div>
        <div className="welcome-faq">
          <details><summary><span>Does Roomlings send money?</span><Plus size={19} /></summary><p>No. Pay your roommate as usual, then record the repayment. Roomlings never moves money.</p></details>
          <details><summary><span>How do we split a cost?</span><Plus size={19} /></summary><p>Choose who shares the expense. Roomlings splits it equally between those people, including leftover cents.</p></details>
          <details><summary><span>Can I keep my existing kitchen?</span><Plus size={19} /></summary><p>Yes. Link your saved kitchen to your account without starting over, or <a href="/#recover">recover your original place</a> with a recovery code.</p></details>
          <details><summary><span>Will it work on my phone?</span><Plus size={19} /></summary><p>Yes, in your browser. Your account opens the same home on each device. The tools also work without 3D.</p></details>
        </div>
      </section>

      <section className="welcome-invitation welcome-container" id="get-started" aria-labelledby="invitation-title">
        <div><h2 id="invitation-title">Create your household.</h2><p>Sign in and invite your roommates.</p></div>
        <a className="button primary welcome-enter" href="/#account=create">Get started <ArrowRight size={18} /></a>
      </section>
    </main>
    <footer className="welcome-footer welcome-container">
      <a className="brand" href="#welcome-top" aria-label="Roomlings, back to the beginning"><Brand decorative /></a>
      <p>Roomlings records payments. It never moves money.</p>
      <a className="welcome-text-link" href="#welcome-top">Back to the top <ArrowDown size={15} className="welcome-up" /></a>
    </footer>
  </div>
}

function ShoppingNote() {
  return <div className="journal-shopping">
    <div className="journal-list"><strong>Shopping list</strong>
      <span className="journal-list-item"><Check size={14} />Milk</span>
      <span className="journal-list-item"><Check size={14} />Coffee</span>
      <span className="journal-list-item"><span className="journal-checkbox" />Vegetables</span>
    </div>
    <span className="journal-pencil" />
  </div>
}

function ReceiptNote() {
  return <div className="journal-receipt">
    <span className="journal-paper-label">RECEIPT BOOK</span>
    <span>Groceries</span>
    <span>Household bills</span>
    <span>Repayments</span>
  </div>
}

function EnvelopeNote() {
  return <div className="journal-envelope">
    <div className="journal-letter"><span>Repayments</span><CheckCheck size={20} strokeWidth={1.4} /></div>
    <div className="journal-envelope-front" />
    <span className="journal-envelope-seal"><Check size={14} /></span>
  </div>
}
