import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Brand } from '../Branding.tsx'
import { legalPages } from '../roomNavigation.ts'
import type { LegalPage } from '../roomNavigation.ts'
import './welcome.css'
import { contactEmail, legalUpdated, operator } from './legal.ts'
import './legal.css'

const authority = 'https://autoriteitpersoonsgegevens.nl/en'

const Email = () => <a href={`mailto:${contactEmail}`}>{contactEmail}</a>

type Section = { id: string; title: string; body: ReactNode }
type Document = { title: string; dated: boolean; lead: ReactNode; sections: Section[] }

const privacy: Document = {
  title: 'Privacy',
  dated: true,
  lead: <>
    <p className="legal-lead">Roomlings helps housemates share chores, shopping, bills and repayments. It records money; it never moves it.
      This page explains what we keep, why, and for how long.</p>
    <p>Roomlings is run by {operator} in the Netherlands, who is responsible for your data. Write to <Email /> with any question or request.</p>
  </>,
  sections: [
    { id: 'what-we-keep', title: 'What we keep', body: <ul>
      <li><strong>Your account:</strong> your email address, the name you choose and the names you give your devices.</li>
      <li><strong>Your household:</strong> what you and your roommates enter, such as names, chores, shopping items, expenses, bills, repayments and room layouts. Everyone in a household can see its shared records.</li>
      <li><strong>Sign-in:</strong> a session identifier in a secure cookie, or in the iPhone and iPad keychain. Recovery codes are stored only as one-way hashes.</li>
      <li><strong>Alerts, if you turn them on:</strong> an encrypted push address for your device or browser, and your alert preferences.</li>
      <li><strong>Daily return counts:</strong> whether each member opened the app, opened an alert, or shared or accepted an invitation on a given day. Never what you bought, paid or wrote.</li>
      <li><strong>Network address:</strong> held briefly in server memory to slow down repeated requests. It is not saved with your account.</li>
    </ul> },
    { id: 'what-we-dont-do', title: "What we don't do", body: <p>No advertising, no selling or renting data and no third-party tracking scripts. Fonts and images come from our own server. Roomlings never connects to a bank or handles payments.</p> },
    { id: 'why-we-use-it', title: 'Why we use it', body: <ul>
      <li><strong>To provide Roomlings:</strong> your account, your household and the alerts you ask for.</li>
      <li><strong>Legitimate interests:</strong> keeping accounts secure, preventing abuse and knowing whether households keep using Roomlings.</li>
      <li><strong>Your consent:</strong> push alerts. Turn them off at any time in the app or your device settings.</li>
    </ul> },
    { id: 'who-helps-us', title: 'Who helps us', body: <>
      <p>These providers process data only to run Roomlings for us:</p>
      <ul>
        <li><strong>Supabase:</strong> verifies sign-in codes and hosts the database.</li>
        <li><strong>Our email provider:</strong> delivers sign-in codes.</li>
        <li><strong>Our hosting provider:</strong> runs the Roomlings server.</li>
        <li><strong>Apple and your browser's push service:</strong> deliver alerts, which only carry generic text.</li>
      </ul>
      <p>Some of them may process data outside the European Economic Area. Where they do, they rely on safeguards such as the EU Standard Contractual Clauses.</p>
    </> },
    { id: 'how-long', title: 'How long we keep it', body: <>
      <ul>
        <li>Sign-ins end after 7 days without use, and after 30 days at most.</li>
        <li>Daily return counts are deleted 30 days after the day they cover.</li>
        <li>Push addresses are removed when you sign out, or after 30 days without being refreshed.</li>
        <li>Your account and household records stay while your account is active.</li>
      </ul>
      <p>Deleting your account removes your email address, sign-in and access. Expenses and repayments you recorded stay with the household under your former roommate name, because everyone's balances depend on them. Export the ledger first if you need a copy.</p>
    </> },
    { id: 'your-browser', title: 'Your browser', body: <p>Roomlings uses one sign-in cookie, which it needs to work, and keeps saved kitchens and display preferences in your browser's storage. None of this is used for tracking.</p> },
    { id: 'your-rights', title: 'Your rights', body: <p>You can ask to see, correct, export or delete your data, and to restrict or object to how we use it. Delete your account yourself in the app under <strong>Account and membership</strong>, or write to <Email />.
      You can also complain to the Dutch data protection authority, the <a href={authority} rel="noreferrer">Autoriteit Persoonsgegevens</a>.</p> },
    { id: 'age', title: 'Age', body: <p>Roomlings is for people aged 16 and over.</p> },
    { id: 'changes', title: 'Changes', body: <p>We will update the date at the top of this page when it changes, and email account holders before significant changes take effect.</p> },
  ],
}

const terms: Document = {
  title: 'Terms',
  dated: true,
  lead: <p className="legal-lead">These terms apply when you use Roomlings, run by {operator} in the Netherlands. Using Roomlings means you accept them.</p>,
  sections: [
    { id: 'what-roomlings-is', title: 'What Roomlings is', body: <p>Roomlings helps a household keep track of shared chores, shopping, bills and repayments. It records amounts, but does not hold, send or receive money. It is not a bank, payment service or financial advice. Balances are only as accurate as the entries behind them.</p> },
    { id: 'who-can-use-it', title: 'Who can use it', body: <p>You must be 16 or older. Use your own account and keep sign-in and recovery codes private.</p> },
    { id: 'your-household', title: 'Your household', body: <ul>
      <li>Everything entered in a household is visible to its members. Only invite people who agreed to join.</li>
      <li>You are responsible for what you enter. Debts between roommates are settled between you, not by Roomlings.</li>
      <li>You keep the rights to what you add. You allow us to store it and show it to your household so Roomlings can work.</li>
    </ul> },
    { id: 'fair-use', title: 'Fair use', body: <p>Don't use Roomlings to break the law, harass anyone, reach households you don't belong to, or overload or disrupt the service.</p> },
    { id: 'availability', title: 'Availability', body: <p>We work to keep Roomlings running and your records safe, but cannot promise uninterrupted service. Keep your own copy of records that matter, using <strong>Export ledger</strong>.</p> },
    { id: 'ending', title: 'Ending', body: <p>You can delete your account at any time. We may suspend accounts that break these terms. Our <a href="/privacy">privacy page</a> explains what happens to your data.</p> },
    { id: 'liability', title: 'Liability', body: <p>As far as the law allows, we are not liable for indirect losses, for amounts recorded incorrectly or for debts between roommates. This does not limit liability for intent or gross negligence, or any rights you have under mandatory consumer law.</p> },
    { id: 'law', title: 'Law', body: <p>Dutch law applies. Disputes go to the competent court in the Netherlands, without affecting your right as a consumer to use the courts where you live.</p> },
    { id: 'changes', title: 'Changes', body: <p>We will update the date at the top of this page when these terms change, and email account holders before significant changes take effect.</p> },
  ],
}

const contact: Document = {
  title: 'Contact',
  dated: false,
  lead: <p className="legal-lead">Roomlings is run by {operator} in the Netherlands. Write to <Email /> and you will get a reply from a person.</p>,
  sections: [
    { id: 'reasons', title: 'Good reasons to write', body: <ul>
      <li>Help with signing in, recovery codes or a household.</li>
      <li>Privacy requests, such as seeing, exporting or deleting your data.</li>
      <li>Security problems. Please share details privately, not in public.</li>
      <li>Ideas and feedback.</li>
    </ul> },
    { id: 'your-account', title: 'Your account', body: <p>Delete your account yourself in the app under <strong>Account and membership</strong>. Our <a href="/privacy">privacy page</a> explains what that removes.</p> },
  ],
}

const documents: Record<LegalPage, Document> = { privacy, terms, contact }

// The index marks the last section whose heading has scrolled past the top of the view. At the
// bottom of the page, short final sections cannot reach the top, so a linked section stays marked
// while its heading is visible, and otherwise the last section is.
function useCurrentSection(ids: string[]) {
  const [current, setCurrent] = useState(ids[0])
  useEffect(() => {
    const update = () => {
      const top = (id: string) => document.getElementById(id)?.getBoundingClientRect().top ?? Infinity
      const passed = ids.filter((id) => top(id) <= innerHeight * 0.25)
      const linked = decodeURIComponent(location.hash.slice(1))
      const end = innerHeight + scrollY >= document.documentElement.scrollHeight - 2
      const linkedVisible = ids.includes(linked) && top(linked) >= 0 && top(linked) < innerHeight
      setCurrent(end ? linkedVisible ? linked : ids.at(-1)! : passed.at(-1) ?? ids[0])
    }
    update()
    addEventListener('scroll', update, { passive: true })
    addEventListener('resize', update)
    addEventListener('hashchange', update)
    return () => {
      removeEventListener('scroll', update)
      removeEventListener('resize', update)
      removeEventListener('hashchange', update)
    }
  }, [ids])
  return current
}

export default function Legal({ page }: { page: LegalPage }) {
  const { title, dated, lead, sections } = documents[page]
  const ids = useMemo(() => sections.map((section) => section.id), [sections])
  const current = useCurrentSection(ids)
  const index = useRef<HTMLOListElement>(null)
  // On phones the index is a sideways strip, so keep the marked section within it.
  useEffect(() => {
    const list = index.current
    const link = list?.querySelector('[aria-current="location"]')
    if (!list || !link || list.scrollWidth <= list.clientWidth) return
    const box = link.getBoundingClientRect()
    const frame = list.getBoundingClientRect()
    if (box.left < frame.left) list.scrollLeft -= frame.left - box.left + 16
    else if (box.right > frame.right) list.scrollLeft += box.right - frame.right + 16
  }, [current])
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${title} · Roomlings`
    // The page loads after the browser's own fragment scroll, so a section link scrolls here.
    const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
    if (target) target.scrollIntoView({ behavior: 'instant' })
    else window.scrollTo({ top: 0, behavior: 'instant' })
    return () => { document.title = previousTitle }
  }, [title])

  return <div className="welcome legal" data-edition="journal">
    <a className="welcome-skip" href="#legal-content">Skip to content</a>
    <header className="welcome-header welcome-container">
      <a className="brand" href="/" aria-label="Roomlings home"><Brand variant="featured" decorative /></a>
      <a className="welcome-sign-in" href="/"><ArrowLeft size="0.9375rem" /> Back to home</a>
    </header>
    <main className="legal-content welcome-container" id="legal-content" tabIndex={-1}>
      <div className="legal-title">
        <h1 id="legal-title">{title}</h1>
        {dated && <p className="legal-updated">Last updated {legalUpdated}</p>}
      </div>
      <nav className="legal-index" aria-label="On this page">
        <ol ref={index}>
          {sections.map((section) => <li key={section.id}>
            <a href={`#${section.id}`} aria-current={section.id === current ? 'location' : undefined}>{section.title}</a>
          </li>)}
        </ol>
      </nav>
      <article aria-labelledby="legal-title">
        {lead}
        {sections.map((section) => <section key={section.id} aria-labelledby={section.id}>
          <h2 id={section.id}>{section.title}</h2>
          {section.body}
        </section>)}
      </article>
    </main>
    <footer className="welcome-footer welcome-container">
      <nav className="welcome-footer-links" aria-label="Footer">
        {legalPages.map((link) => <a className="welcome-text-link" key={link.id} href={link.path}
          aria-current={link.id === page ? 'page' : undefined}>{link.label}</a>)}
      </nav>
      <p>&copy; {new Date().getFullYear()} Roomlings</p>
    </footer>
  </div>
}
