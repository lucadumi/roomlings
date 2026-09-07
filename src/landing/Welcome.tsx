import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CheckCheck, Leaf, Plus, ReceiptText, ShoppingBasket, Snowflake, Users } from 'lucide-react'
import { KitchenTour } from './KitchenTour.tsx'
import { TourFallback } from './TourFallback.tsx'
import './welcome.css'

function subscribeToMotion(callback: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

const features = [
  { icon: ShoppingBasket, number: '01', label: 'BEFORE THE SHOP', title: 'One list. Less guesswork.', description: 'Add what home needs, claim what you are picking up, and keep everyone in the loop. No more three cartons of milk.' },
  { icon: ReceiptText, number: '02', label: 'AFTER THE SHOP', title: 'Every little thing, shared.', description: 'Keep groceries and recurring household bills in one receipt book. Choose who shares each cost. We will handle the cents.' },
  { icon: CheckCheck, number: '03', label: 'BACK AT HOME', title: 'Good friends. Clear balances.', description: 'See who paid and who owes what. Pay your roommate your usual way, then record it so everyone is on the same page.' },
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

  return <div className="welcome" data-motion={reducedMotion ? 'reduced' : 'full'} id="welcome-top">
    <a className="welcome-skip" href="#welcome-content">Skip to content</a>
    <header className="welcome-header welcome-container">
      <a className="brand" href="#welcome-top" aria-label="Roomlings, back to the beginning">
        <span className="brand-mark"><Snowflake size={23} /></span>roomlings<span className="brand-period">.</span>
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
          <span className="welcome-eyebrow"><Leaf size={16} />FOR THE PEOPLE YOU LIVE WITH</span>
          <h1 id="welcome-title">Share a home.<br /><em>Not the hassle.</em></h1>
          <p>Groceries, household bills and who owes what, in one shared kitchen. Made for the people you come home to.</p>
          <div className="welcome-actions">
            <a className="button primary welcome-enter" href="/#account=create">Make yourself at home <ArrowRight size={18} /></a>
            <a className="welcome-text-link" href="/kitchen">Explore the kitchen <ArrowUpRight size={16} /></a>
          </div>
          <p className="welcome-small"><Check size={14} />Try a sample kitchen without signing in.</p>
        </div>
        <figure className="welcome-vignette">
          <div className="welcome-vignette-room"><TourFallback /></div>
          <div className="welcome-house-note"><span className="welcome-note-icon"><Users size={19} /></span><span>A place for everyone.<small>A fair share for each.</small></span></div>
          <figcaption>YOUR EVERYDAY, A LITTLE MORE TOGETHER</figcaption>
        </figure>
      </section>

      <div className="welcome-everyday welcome-container" aria-label="What Roomlings brings together">
        <span><ShoppingBasket size={19} />The grocery runs</span>
        <span><ReceiptText size={19} />The monthly bills</span>
        <span><Users size={19} />The people at home</span>
      </div>

      <section className="welcome-features welcome-container" id="how-it-works" aria-labelledby="features-title">
        <div className="welcome-section-heading">
          <div><span className="welcome-eyebrow">LESS KEEPING TRACK. MORE LIVING TOGETHER.</span><h2 id="features-title">A fair share of the everyday.</h2></div>
          <p>The small things add up.<br />Keeping them together makes a difference.</p>
        </div>
        <div className="welcome-feature-grid">
          {features.map(({ icon: Icon, number, label, title, description }) => <article className="welcome-feature" key={number}>
            <div className="welcome-feature-top"><Icon size={25} strokeWidth={1.5} /><span>{number}</span></div>
            <span className="welcome-eyebrow">{label}</span>
            <h3>{title}</h3>
            <p>{description}</p>
          </article>)}
        </div>
      </section>

      <KitchenTour reducedMotion={reducedMotion} paused={paused} onToggleMotion={() => setMotionOverride(!reducedMotion)} />

      <section className="welcome-questions welcome-container" id="questions" aria-labelledby="questions-title">
        <div className="welcome-questions-heading"><span className="welcome-eyebrow">A FEW THINGS YOU MIGHT WONDER</span><h2 id="questions-title">Before you come in.</h2><p>Simple where it should be.<br />Clear where it matters.</p></div>
        <div className="welcome-faq">
          <details><summary>Does Roomlings send money?<Plus size={19} /></summary><p>No. Pay your roommate however you normally do, then record the repayment in Roomlings. Your shared ledger stays up to date, but the app never moves money.</p></details>
          <details><summary>How do we split a cost?<Plus size={19} /></summary><p>Choose the people sharing each grocery run or bill. Roomlings splits the amount equally between them, including any leftover cents. Not everyone has to share every purchase.</p></details>
          <details><summary>Can I keep my existing kitchen?<Plus size={19} /></summary><p>Yes. Your saved kitchen still opens as usual. You can sign in and link that existing access to your account without starting over. If you have a recovery code, <a href="/#recover">recover your original place</a>.</p></details>
          <details><summary>Will it work on my phone?<Plus size={19} /></summary><p>Yes, right in your browser. Your account brings the same kitchen to your phone, tablet or computer. The kitchen tools also work when 3D is unavailable.</p></details>
        </div>
      </section>

      <section className="welcome-invitation welcome-container" id="get-started" aria-labelledby="invitation-title">
        <div><span className="welcome-eyebrow">PULL UP A CHAIR</span><h2 id="invitation-title">There is room for your people.</h2><p>Start a kitchen, invite your roommates, and make the everyday a little easier.</p></div>
        <a className="button primary welcome-enter" href="/#account=create">Get started <ArrowRight size={18} /></a>
      </section>
    </main>
    <footer className="welcome-footer welcome-container">
      <a className="brand" href="#welcome-top" aria-label="Roomlings, back to the beginning"><span className="brand-mark"><Snowflake size={18} /></span>roomlings<span className="brand-period">.</span></a>
      <p>Shared homes. Fair shares.<br /><span>Roomlings records payments. It never moves money.</span></p>
      <a className="welcome-text-link" href="#welcome-top">Back to the top <ArrowDown size={15} className="welcome-up" /></a>
    </footer>
  </div>
}
