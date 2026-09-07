import { Component, lazy, Suspense, useLayoutEffect, useRef } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { ArrowRight, CircleHelp, Coins, Home, Palette, Plus, ReceiptText, Settings2, Snowflake, Users, Wallet } from 'lucide-react'
import { money } from '../shared/domain.ts'
import type { Category, Household } from '../shared/domain.ts'
import { Avatar } from './components.tsx'
import { Brand, SceneLoading } from './Branding.tsx'
import type { KitchenAction } from './room.ts'
import type { FocusRequest } from './camera.ts'

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
  receiptCount: number
  monthControls: ReactNode
  monthLabel: string
  stockEvent: { id: string; category: Category } | null
  focusRequest: FocusRequest
  syncState: 'saved' | 'offline'
  inert: boolean
  panelOpen: boolean
  activeTool: KitchenAction | null
  onAction: (action: KitchenAction) => void
  onCreate: () => void
  onInvite: () => void
  onSettings: () => void
  onRoomStyle: () => void
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
  household, memberId, counts, selected, remaining, yourBalance, transferCount, expenseCount, receiptCount,
  monthControls, monthLabel, stockEvent, focusRequest, syncState, inert, panelOpen, activeTool, onAction, onCreate, onInvite, onSettings, onRoomStyle, onHelp, onSelect,
}: Props) {
  const home = useRef<HTMLElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const bar = dock.current
    const app = home.current?.closest<HTMLElement>('.game-app')
    if (!bar || !app) return
    // The bottom sheet and the room must reserve the same actual dock height.
    const measure = () => {
      const style = getComputedStyle(bar)
      const height = bar.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom)
      app.style.setProperty('--game-dock-space', `${height}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      app.style.removeProperty('--game-dock-space')
    }
  }, [])
  const viewer = household.members.find((member) => member.id === memberId)!
  const activeMembers = household.members.filter((member) => !member.inactive)
  return <main className="game-home" id="main" ref={home} data-panel-open={panelOpen} inert={inert} aria-hidden={inert || undefined}>
    <header className="game-hud">
      <div className="game-identity">
        <div className="brand"><Brand /></div>
        <i className="hud-divider" />
        <button className="game-house control-surface" onClick={() => onAction('roommates')} aria-pressed={activeTool === 'roommates'}><Home size={17} /><span>{household.name}</span><span className={`connection-dot ${syncState}`} aria-label={syncState === 'saved' ? 'Kitchen saved' : 'Kitchen offline'} /></button>
      </div>
      <div className="game-month" hidden={panelOpen}>{monthControls}</div>
      <div className="game-resources">
        <button className={`fund-trigger${remaining < 0 ? ' low-fund' : ''}`} onClick={() => onAction('budget')} aria-label="View the house pot" aria-pressed={activeTool === 'budget'}>
          <span className="coin-stamp"><Coins size={23} /></span>
          <span><small>HOUSE POT</small><strong>{money(Math.abs(remaining), household.currency)} <span>{remaining < 0 ? 'over' : 'left'}</span></strong></span>
        </button>
        <button className="player-button" onClick={() => onAction('roommates')} aria-label={`The roommates, playing as ${viewer.name}`} aria-pressed={activeTool === 'roommates'}><Avatar member={viewer} /></button>
      </div>
    </header>
    <h1 className="sr-only">{household.name}: your shared kitchen</h1>
    <SceneBoundary>
      <Suspense fallback={<SceneLoading />}>
        <KitchenWorld key={household.id} roomStyle={household.roomStyle} paused={inert || panelOpen} panelOpen={panelOpen} focusRequest={focusRequest} counts={counts} selected={selected} fundFraction={remaining / household.budget} memberCount={activeMembers.length} expenseCount={receiptCount} stockEvent={stockEvent} onSelect={onSelect} onAction={onAction} />
      </Suspense>
    </SceneBoundary>
    <div className="room-caption">
      <span className="room-label"><Snowflake size={15} /><strong>The kitchen</strong><span>{expenseCount} grocery {expenseCount === 1 ? 'run' : 'runs'}</span></span>
      <div className="party-members"><button onClick={() => onAction('roommates')} aria-label="Meet your roommates" aria-pressed={activeTool === 'roommates'}>{activeMembers.slice(0, 4).map((member) => <Avatar member={member} key={member.id} small />)}</button><button className="party-invite" onClick={onInvite} aria-label="Invite a roommate" aria-haspopup="dialog"><Plus size={16} /></button></div>
    </div>
    {household.demo && <div className="game-demo"><span>Sample kitchen</span><button className="control-surface" onClick={onCreate} aria-haspopup="dialog">Make it yours <ArrowRight size={13} /></button></div>}
    <div className="house-tools"><button className="icon-button control-surface" onClick={onRoomStyle} aria-label="Room style" title="Room style" aria-haspopup="dialog"><Palette size={19} /></button><button className="icon-button control-surface" onClick={onHelp} aria-label="How to play" aria-haspopup="dialog"><CircleHelp size={19} /></button><button className="icon-button control-surface" onClick={onSettings} aria-label="House rules" aria-haspopup="dialog"><Settings2 size={19} /></button></div>
    <div className="game-bottom" ref={dock}>
      <button className="game-balance control-surface" onClick={() => onAction('settle')} aria-label="Your household balance" aria-pressed={activeTool === 'settle'}><span className="balance-caption">YOUR SHARE</span><strong>{money(Math.abs(yourBalance), household.currency)}</strong><span>{yourBalance > 0 ? 'coming back' : yourBalance < 0 ? 'to settle' : 'all square'}</span></button>
      <nav className="game-dock" aria-label="Kitchen tools">
        <button className="dock-tool" onClick={() => onAction('ledger')} aria-label="Grocery runs" aria-pressed={activeTool === 'ledger'}><ReceiptText size={21} /><span>Receipts</span></button>
        <button className="dock-tool" onClick={() => onAction('budget')} aria-label="Monthly budget" aria-pressed={activeTool === 'budget'}><Coins size={21} /><span>House pot</span></button>
        <button className="stock-button" onClick={() => onAction('stock')} aria-label="Shopping bag, plan and record groceries" aria-pressed={activeTool === 'stock'}><span><Plus size={23} /></span><span>Shopping bag<small>Plan and record groceries</small></span></button>
        <button className="dock-tool" onClick={() => onAction('settle')} aria-label="Settle up" aria-pressed={activeTool === 'settle'}><Wallet size={21} /><span>Settle up</span>{transferCount > 0 && <i className="tool-count">{transferCount}</i>}</button>
        <button className="dock-tool" onClick={() => onAction('roommates')} aria-label="The roommates" aria-pressed={activeTool === 'roommates'}><Users size={21} /><span>People</span></button>
      </nav>
      <span className={`room-sync ${syncState}`}><span className={`connection-dot ${syncState}`} />{syncState === 'saved' ? 'All fresh & saved' : 'Offline'}<small>{monthLabel}</small></span>
    </div>
  </main>
}
