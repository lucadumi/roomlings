import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, Plus } from 'lucide-react'
import { Brand } from '../Branding.tsx'
import { KitchenTour } from './KitchenTour.tsx'
import { HomeIllustration } from './HomeIllustration.tsx'
import { roomPath, samplePath } from '../roomNavigation.ts'
import './welcome.css'

function subscribeToMotion(callback: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

const features = [
  { number: '01', title: 'Rooms & chores.', description: 'Assign chores, rotate turns and restock your kitchen and bathroom.' },
  { number: '02', title: 'Shopping & bills.', description: 'Claim items, save paid receipts and split recurring household bills.' },
  { number: '03', title: 'Balances & access.', description: 'Record repayments and return on any device with your account.' },
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
      if (location.hash === '#home-sign-in' || location.hash === '#home-start') {
        document.getElementById(location.hash.slice(1))?.focus({ preventScroll: true })
      }
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
        <a href="#how-it-works">Your home</a>
        <a href="#tour">Kitchen tour</a>
        <a href="#questions">Questions</a>
      </nav>
      <div className="welcome-header-actions">
        <a className="welcome-sign-in" id="home-sign-in" href={roomPath()}>Sign in <ArrowRight size={15} /></a>
        <a className="button primary welcome-enter" href={`${roomPath()}#account=create`}>Get started</a>
      </div>
    </header>
    {accessNotice && <div className="welcome-access-notice welcome-container">{accessNotice}</div>}
    <main id="welcome-content" tabIndex={-1}>
      <section className="welcome-hero welcome-container" aria-labelledby="welcome-title">
        <div className="welcome-hero-copy">
          <h1 id="welcome-title">Share a home.<br /><em>Not the hassle.</em></h1>
          <p>Step into your kitchen and bathroom. Tap the objects to share chores, plan shopping and keep household costs fair.</p>
          <div className="welcome-actions">
            <a className="button primary welcome-enter" id="home-start" href={`${roomPath()}#account=create`}>Get started <ArrowRight size={18} /></a>
            <a className="welcome-text-link" href={samplePath()}>Try the sample <ArrowUpRight size={16} /></a>
          </div>
          <p className="welcome-small"><Check size={14} />Try a private sample. Your real household stays untouched.</p>
        </div>
        <figure className="welcome-vignette" role="img" aria-label="Illustration of a shared home">
          <HomeIllustration />
        </figure>
      </section>

      <section className="welcome-features welcome-container" id="how-it-works" aria-labelledby="features-title">
        <div className="welcome-section-heading">
          <h2 id="features-title">Your home, shared.</h2>
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
          <details><summary><span>Does Roomlings send money?</span><Plus size={19} /></summary><p>No. Roomlings never moves money. Choose who shares a paid receipt or bill, and it splits the cost equally in exact cents. Pay roommates outside the app, then record or correct repayments here. Shopping plans and unpaid bills create no debt.</p></details>
          <details><summary><span>What do the rooms share?</span><Plus size={19} /></summary><p>The kitchen and bathroom belong to one household, with the same shopping list, people and financial ledger. Chores can cover a room or the whole home, with one-off tasks, recurring schedules and rotating turns. The fridge shows purchases, not how much food is left.</p></details>
          <details><summary><span>How do roommates join and return?</span><Plus size={19} /></summary><p>Each roommate signs in to their own account with an email code and accepts an invitation from the household owner. Single-use account recovery codes provide another way back in. You can also link an older kitchen without replacing its history, or <a href="/#recover">recover browser-only access</a> with its separate private kitchen code. These are different kinds of recovery code.</p></details>
          <details><summary><span>Can I use it without 3D?</span><Plus size={19} /></summary><p>Yes. Every household tool is also available from the toolbar, on desktop and phone browsers. Your account opens the same home on each device, including your saved chores, shopping, bills and repayments. No separate app is needed.</p></details>
        </div>
      </section>

      <section className="welcome-invitation welcome-container" id="get-started" aria-labelledby="invitation-title">
        <div><h2 id="invitation-title">Make room for your people.</h2><p>Create a household, invite your roommates and give everyone their own way back in.</p></div>
        <a className="button primary welcome-enter" href={`${roomPath()}#account=create`}>Get started <ArrowRight size={18} /></a>
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
    <div className="journal-list"><strong>Room supplies</strong>
      <span className="journal-list-item"><Check size={14} />Dish soap</span>
      <span className="journal-list-item"><Check size={14} />Toilet paper</span>
      <span className="journal-list-item"><span className="journal-checkbox" />Sponges</span>
    </div>
    <span className="journal-pencil" />
  </div>
}

function ReceiptNote() {
  return <div className="journal-receipt">
    <span className="journal-paper-label">SHARED LEDGER</span>
    <span>Grocery receipts</span>
    <span>Monthly bills</span>
    <span>Ledger export</span>
  </div>
}

function EnvelopeNote() {
  return <div className="journal-envelope">
    <div className="journal-letter"><span>Your share</span><CheckCheck size={20} strokeWidth={1.4} /></div>
    <div className="journal-envelope-front" />
    <span className="journal-envelope-seal"><Check size={14} /></span>
  </div>
}
