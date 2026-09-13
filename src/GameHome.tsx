import { Component, Suspense, useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Boxes, CircleHelp, Coins, Grid2X2, Home, ListChecks, Palette, Plus, ReceiptText, Settings2, Snowflake, Users, Wallet } from 'lucide-react'
import { money } from '../shared/domain.ts'
import type { Category, Household } from '../shared/domain.ts'
import { Avatar } from './components.tsx'
import { Brand, SceneLoading } from './Branding.tsx'
import type { KitchenAction } from './room.ts'
import type { FocusRequest } from './camera.ts'
import { roomCatalog } from '../shared/rooms.ts'
import type { ChoreArea, RoomId } from '../shared/rooms.ts'
import { roomViews } from './roomViews.ts'
import { getRoomComponents } from '../shared/roomComponents.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'

type Props = {
  roomId: RoomId
  onRooms: (anchor: HTMLButtonElement) => void
  roomsOpen: boolean
  busy: boolean
  dueChores: Partial<Record<ChoreArea, number>>
  dueChoreCount: number
  onOpenChores: (area: ChoreArea | null) => void
  onRestock: () => void
  household: Household
  memberId: string
  counts: Record<Category, number>
  selected: Category | 'all'
  remaining: number
  yourBalance: number
  transferCount: number
  receiptCount: number
  monthControls: ReactNode
  monthLabel: string
  stockEvent: { id: string; category: Category } | null
  focusRequest: FocusRequest
  syncState: 'saved' | 'offline'
  inert: boolean
  deferColdStart?: boolean
  panelOpen: boolean
  overviewFocus?: boolean
  panelSide?: 'left' | 'right'
  activeTool: KitchenAction | 'chores' | 'objects' | 'room-edit' | null
  components?: readonly RoomComponent[]
  editMode: boolean
  wholeRoomView: boolean
  selectedComponentId: string | null
  placementPreviewId?: string | null
  onComponentSelect: (id: string) => void
  onObjects: () => void
  canEditRooms: boolean
  onRoomStyle: () => void
  onHelp: () => void
  onSettings: () => void
  onAction: (action: KitchenAction) => void
  onInvite: () => void
  onSelect: (category: Category) => void
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error('The kitchen scene could not be displayed:', error.message)
  }
  render() {
    if (this.state.failed) return <div className="scene-loading scene-error" role="alert"><Snowflake size="2.25rem" /><strong>3D view unavailable.</strong><p>All household tools still work.</p></div>
    return this.props.children
  }
}

export function GameHome({
  roomId, onRooms, roomsOpen, busy, dueChores, dueChoreCount, onOpenChores, onRestock, household, memberId, counts, selected, remaining, yourBalance, transferCount, receiptCount,
  monthControls, monthLabel, stockEvent, focusRequest, syncState, inert, deferColdStart = false, panelOpen, activeTool, onAction, onInvite, onSelect,
  components, editMode, wholeRoomView, selectedComponentId, placementPreviewId = null, onComponentSelect, onObjects, canEditRooms, onRoomStyle, onHelp, onSettings,
  panelSide = 'right',
  overviewFocus = false,
}: Props) {
  const World = roomViews[roomId]
  const home = useRef<HTMLElement>(null)
  const header = useRef<HTMLElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLElement>(null)
  const houseButton = useRef<HTMLButtonElement>(null)
  const restoreHouseFocus = useRef(false)
  const subscribeCompactHeader = useCallback((notify: () => void) => {
    const media = window.matchMedia('(max-width: 1024px)')
    const changed = () => {
      restoreHouseFocus.current = document.activeElement === houseButton.current
      notify()
    }
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  const compactHeader = useSyncExternalStore(subscribeCompactHeader, () => window.matchMedia('(max-width: 1024px)').matches, () => false)
  useLayoutEffect(() => {
    if (restoreHouseFocus.current) {
      houseButton.current?.focus({ preventScroll: true })
      restoreHouseFocus.current = false
    }
  }, [compactHeader])
  useLayoutEffect(() => {
    const rail = home.current?.querySelector<HTMLElement>('.world-camera-controls')
    if (rail) rail.scrollTop = 0
  }, [panelOpen, roomId, activeTool])
  useLayoutEffect(() => {
    const bar = dock.current
    const hud = header.current
    const tools = toolbar.current
    const root = home.current
    const app = root?.closest<HTMLElement>('.game-app')
    if (!bar || !hud || !tools || !root || !app) return
    // Viewport units can settle after resize, and the dock can outgrow its wrapper.
    const measure = () => {
      const top = Math.min(bar.getBoundingClientRect().top, tools.getBoundingClientRect().top)
      const space = root.getBoundingClientRect().bottom - top + parseFloat(getComputedStyle(bar).marginTop)
      app.style.setProperty('--game-dock-space', `${space}px`)
      app.style.setProperty('--game-header-space', `${hud.getBoundingClientRect().height}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    observer.observe(tools)
    observer.observe(hud)
    observer.observe(root)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      app.style.removeProperty('--game-dock-space')
      app.style.removeProperty('--game-header-space')
    }
  }, [])
  const viewer = household.members.find((member) => member.id === memberId)!
  const activeMembers = household.members.filter((member) => !member.inactive)
  const householdButton = <button key="household" ref={houseButton} className={`game-house control-surface${compactHeader ? ' icon-button' : ''}`} onClick={() => onAction('roommates')} aria-label={household.name} title={household.name}
    aria-description={syncState === 'offline' ? 'Kitchen offline' : editMode ? 'Room preview not yet shared' : 'Kitchen saved'}
    aria-pressed={activeTool === 'roommates'}><Home size="1.0625rem" /><span>{household.name}</span><span className={`connection-dot ${syncState}`} aria-hidden="true" /></button>
  return <main className="game-home" id="main" ref={home} data-panel-open={panelOpen && !overviewFocus} data-panel-side={panelSide} data-edit-mode={editMode} inert={inert} aria-hidden={inert || undefined}>
    <header className="game-hud" ref={header}>
      <div className="game-identity">
        <a className="brand" href="/" aria-label="Roomlings home"><Brand decorative /></a>
        <i className="hud-divider" />
        {!compactHeader && householdButton}
      </div>
      <div className="game-month" hidden={panelOpen}>{monthControls}</div>
      <div className="game-resources">
        <button className={`fund-trigger${remaining < 0 ? ' low-fund' : ''}`} onClick={() => onAction('budget')} aria-label="View the house pot" aria-pressed={activeTool === 'budget'}>
          <span className="coin-stamp"><Coins size="1.4375rem" /></span>
          <span><small>HOUSE POT</small><strong>{money(Math.abs(remaining), household.currency)} <span>{remaining < 0 ? 'over' : 'left'}</span></strong></span>
        </button>
        <button className="player-button" onClick={() => onAction('roommates')} aria-label={`The roommates, playing as ${viewer.name}`} aria-pressed={activeTool === 'roommates'}><Avatar member={viewer} /></button>
      </div>
    </header>
    <h1 className="sr-only">{household.name}: {roomCatalog[roomId].label}</h1>
    <SceneBoundary key={`${roomId}:${household.id}`}>
      <Suspense fallback={<SceneLoading label={`Opening ${roomCatalog[roomId].label.toLowerCase()}...`} />}>
        <World key={`${roomId}:${household.id}`} roomStyle={household.roomStyle} paused={inert || busy || roomsOpen || (panelOpen && !editMode)} panelOpen={panelOpen && !overviewFocus} overviewFocus={overviewFocus} focusRequest={focusRequest} counts={counts} selected={selected} fundFraction={remaining / household.budget} memberCount={activeMembers.length} expenseCount={receiptCount} stockEvent={stockEvent} onSelect={onSelect} onAction={onAction} onOpenChores={onOpenChores} onRestock={onRestock} dueChores={dueChores}
          components={components ?? getRoomComponents(household)} editMode={editMode} wholeRoomView={wholeRoomView && !overviewFocus} selectedComponentId={selectedComponentId} deferColdStart={deferColdStart}
          placementPreviewId={placementPreviewId} onComponentSelect={onComponentSelect} />
      </Suspense>
    </SceneBoundary>
    <div className="room-caption">
      <button key="rooms" className={`${compactHeader ? 'icon-button control-surface' : 'room-label'} room-picker-trigger`} aria-label={`Rooms: ${roomCatalog[roomId].name}`} title={`${roomCatalog[roomId].name}: choose a room`} aria-haspopup="menu" aria-expanded={roomsOpen}
        aria-controls={roomsOpen ? 'room-selection-menu' : undefined} disabled={busy || inert} onClick={(event) => onRooms(event.currentTarget)}
        onKeyDown={(event) => {
          if (!roomsOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            onRooms(event.currentTarget)
          }
        }}>
        <Grid2X2 size="0.9375rem" /><strong>Rooms</strong><small>{roomCatalog[roomId].name}</small>
      </button>
      {compactHeader && householdButton}
      <div key="roommates" className="party-members"><button onClick={() => onAction('roommates')} aria-label="Meet your roommates" aria-pressed={activeTool === 'roommates'}>{activeMembers.slice(0, 4).map((member) => <Avatar member={member} key={member.id} small />)}</button><button className="party-invite" onClick={onInvite} aria-label="Invite a roommate" aria-haspopup="dialog"><Plus size="1rem" /></button></div>
    </div>
    <div className="house-tools">
      <button className="icon-button control-surface room-page-tool" disabled={busy} onClick={onObjects} aria-label="Room objects" title="Room objects" aria-pressed={activeTool === 'objects' || editMode}><Boxes size="1.1875rem" /></button>
      {canEditRooms && <button className="icon-button control-surface" disabled={busy} onClick={onRoomStyle} aria-label="Room style" title="Room colors" aria-haspopup="dialog"><Palette size="1.1875rem" /></button>}
      <button className="icon-button control-surface" disabled={busy} onClick={onHelp} aria-label="How to play" aria-haspopup="dialog"><CircleHelp size="1.1875rem" /></button>
      <button className="icon-button control-surface" disabled={busy} onClick={onSettings} aria-label="House rules" aria-haspopup="dialog"><Settings2 size="1.1875rem" /></button>
    </div>
    <div className="game-bottom" ref={dock}>
      <button className="game-balance control-surface" onClick={() => onAction('settle')} aria-label="Your household balance" aria-pressed={activeTool === 'settle'}><span className="balance-caption">YOUR SHARE</span><strong>{money(Math.abs(yourBalance), household.currency)}</strong><span>{yourBalance > 0 ? 'coming back' : yourBalance < 0 ? 'to settle' : 'all square'}</span></button>
      <nav className="game-dock" aria-label="Household tools" ref={toolbar}>
        <button className="dock-tool" data-tool="ledger" onClick={() => onAction('ledger')} aria-label="Grocery runs" title="Receipts" aria-pressed={activeTool === 'ledger'}><ReceiptText size="1.3125rem" /><span>Receipts</span></button>
        <button className="dock-tool" data-tool="budget" onClick={() => onAction('budget')} aria-label="Monthly budget" title="House pot" aria-pressed={activeTool === 'budget'}><Coins size="1.3125rem" /><span>House pot</span></button>
        <button className="stock-button" onClick={() => onAction('stock')} aria-label="Shopping bag, plan and record groceries" title="Shopping bag" aria-pressed={activeTool === 'stock'}><span><Plus size="1.4375rem" /></span><span>Shopping bag<small>Plan and record groceries</small></span></button>
        <button className="dock-tool" data-tool="chores" onClick={() => onOpenChores(null)} aria-label="Chores" title="Chores" aria-pressed={activeTool === 'chores'}><ListChecks size="1.3125rem" /><span>Chores</span>{dueChoreCount > 0 && <i className="tool-count">{dueChoreCount}</i>}</button>
        <button className="dock-tool" data-tool="settle" onClick={() => onAction('settle')} aria-label="Settle up" title="Settle up" aria-pressed={activeTool === 'settle'}><Wallet size="1.3125rem" /><span>Settle up</span>{transferCount > 0 && <i className="tool-count">{transferCount}</i>}</button>
        <button className="dock-tool" data-tool="roommates" onClick={() => onAction('roommates')} aria-label="The roommates" title="People" aria-pressed={activeTool === 'roommates'}><Users size="1.3125rem" /><span>People</span></button>
      </nav>
      <span className={`room-sync ${syncState}`}><span className={`connection-dot ${syncState}`} />{syncState === 'offline' ? 'Offline' : editMode ? 'Private room preview' : 'All fresh & saved'}<small>{monthLabel}</small></span>
    </div>
  </main>
}
