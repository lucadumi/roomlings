import { Component, lazy, Suspense } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { ArrowRight, Coins, Home, LoaderCircle, Plus, ReceiptText, Snowflake, Sparkles, Users, Wallet } from 'lucide-react'
import { money } from '../shared/domain.ts'
import type { Category, Household } from '../shared/domain.ts'
import { Avatar } from './components.tsx'
import type { KitchenAction } from './room.ts'

const KitchenWorld = lazy(() => import('./KitchenWorld.tsx'))

type Props = {
  household: Household
  memberId: string
  counts: Record<Category, number>
  selected: Category | 'all'
  remaining: number
  yourBalance: number
  transferCount: number
  expenseCount: number
  monthControls: ReactNode
  monthLabel: string
  stockEvent: { id: string; category: Category } | null
  syncState: 'saved' | 'offline'
  inert: boolean
  onAction: (action: KitchenAction) => void
  onCreate: () => void
  onInvite: () => void
  onSettings: () => void
  onHelp: () => void
  onSelect: (category: Category) => void
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error('The kitchen scene could not be displayed:', error.message)
  }
  render() {
    if (this.state.failed) return <div className="scene-loading scene-error" role="alert"><Snowflake size={36} /><strong>The 3D kitchen could not open.</strong><p>Your ledger is safe. All grocery, budget, and roommate tools below still work.</p></div>
    return this.props.children
  }
}

export function GameHome({
  household, memberId, counts, selected, remaining, yourBalance, transferCount, expenseCount,
  monthControls, monthLabel, stockEvent, syncState, inert, onAction, onCreate, onInvite, onSettings, onHelp, onSelect,
}: Props) {
  const viewer = household.members.find((member) => member.id === memberId)!
  return <main className="game-home" id="main" inert={inert} aria-hidden={inert || undefined}>
    <header className="game-hud">
      <div className="game-identity">
        <div className="brand"><span className="brand-mark"><Snowflake size={23} /></span>roomlings<span className="brand-period">.</span></div>
        <i className="hud-divider" />
        <button className="game-house" onClick={() => onAction('roommates')}><Home size={17} /><span>{household.name}</span></button>
      </div>
      <div className="game-month">{monthControls}</div>
      <div className="game-resources">
        <button className={`fund-trigger${remaining < 0 ? ' low-fund' : ''}`} onClick={() => onAction('budget')}>
          <span className="coin-stamp"><Coins size={23} /></span>
          <span><small>THE HOUSE POT</small><strong>{money(Math.abs(remaining), household.currency)} <span>{remaining < 0 ? 'over budget' : 'left'}</span></strong></span>
        </button>
        <button className="player-button" onClick={() => onAction('roommates')} aria-label={`The roommates, playing as ${viewer.name}`}><Avatar member={viewer} /><span className={`player-status ${syncState}`} /></button>
      </div>
    </header>

    <div className="game-intro">
      <div className="eyebrow"><span className="live-dot" />YOUR LITTLE CO-OP KITCHEN</div>
      <h1>Make yourself<br /><em>at home.</em></h1>
      <p>Good food. Fair shares.<br />A little world you look after together.</p>
      <button className="game-help-link" onClick={onHelp}><Sparkles size={14} />A little help getting settled <ArrowRight size={13} /></button>
    </div>

    <div className="game-party">
      <span className="eyebrow">BETTER TOGETHER</span>
      <div className="party-members"><button onClick={() => onAction('roommates')} aria-label="Meet your roommates">{household.members.slice(0, 5).map((member) => <Avatar member={member} key={member.id} small />)}</button><button className="party-invite" onClick={onInvite} aria-label="Invite a roommate"><Plus size={15} /></button></div>
      <span>{household.members.length} {household.members.length === 1 ? 'seat' : 'seats'} at the table</span>
    </div>

    <SceneBoundary>
      <Suspense fallback={<div className="scene-loading"><LoaderCircle size={28} className="spin" /><span>Putting the kettle on...</span></div>}>
        <KitchenWorld key={household.id} counts={counts} selected={selected} fundFraction={remaining / household.budget} memberCount={household.members.length} expenseCount={expenseCount} stockEvent={stockEvent} onSelect={onSelect} onAction={onAction} />
      </Suspense>
    </SceneBoundary>

    <div className="game-world-status">
      <span className="eyebrow">{monthLabel.toUpperCase()}</span>
      <strong>{expenseCount} grocery {expenseCount === 1 ? 'run' : 'runs'},<br /><em>one shared home.</em></strong>
      <span className={`sync-status ${syncState}`}><span />{syncState === 'saved' ? 'Kitchen saved & in sync' : 'Offline. Reconnect to save.'}</span>
    </div>

    {household.demo && <div className="game-demo"><span><Sparkles size={13} />A demo kitchen to play in.</span><button onClick={onCreate}>Make it yours <ArrowRight size={13} /></button></div>}

    <div className="game-bottom">
      <button className="game-balance" onClick={() => onAction('settle')}><Wallet size={16} /><span>{yourBalance > 0 ? <>{money(yourBalance, household.currency)} coming back to you</> : yourBalance < 0 ? <>{money(-yourBalance, household.currency)} to settle up</> : 'All square. Lovely.'}</span></button>
      <nav className="game-dock" aria-label="Kitchen tools">
        <button className="dock-tool" onClick={() => onAction('ledger')} aria-label="Grocery runs"><ReceiptText size={21} /><span>Receipts</span></button>
        <button className="dock-tool" onClick={() => onAction('budget')} aria-label="Monthly budget"><Coins size={21} /><span>House pot</span></button>
        <button className="stock-button" onClick={() => onAction('stock')} aria-label="Stock the fridge, add a grocery run"><span><Plus size={23} /></span><span>Stock the fridge<small>Bring something to the table</small></span></button>
        <button className="dock-tool" onClick={() => onAction('settle')} aria-label="Settle up"><Wallet size={21} /><span>Settle up</span>{transferCount > 0 && <i className="tool-count">{transferCount}</i>}</button>
        <button className="dock-tool" onClick={() => onAction('roommates')} aria-label="The roommates"><Users size={21} /><span>Roommates</span></button>
      </nav>
      <button className="house-rules-button" onClick={onSettings}>A few house rules <ArrowRight size={13} /></button>
    </div>
  </main>
}
