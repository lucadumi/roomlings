import { useState } from 'react'
import type { ReactNode } from 'react'
import { Archive, ArrowDown, ArrowUp, Check, History, ListChecks, Pencil, Plus, RotateCcw, Users } from 'lucide-react'
import { billingDate, choreEditInputSchema, choreInputSchema, choreLimit } from '../shared/domain.ts'
import type { Chore, ChoreCompletion, Household } from '../shared/domain.ts'
import { canUndoChore, choreAssignee, choreStatus } from '../shared/chores.ts'
import { choreAreaSchema, choreLocationLabel, roomCatalog, roomIds, roomIdSchema } from '../shared/rooms.ts'
import type { ChoreArea, RoomId } from '../shared/rooms.ts'
import { Avatar, DraftConflict, Form } from './components.tsx'
import { LoadingIcon } from './Branding.tsx'
import { Dropdown } from './Dropdown.tsx'
import { dateTitle } from './format.ts'
import './chores.css'

export type ChoreView = 'active' | 'history' | 'archived'
export type ChoreFilter = { room: RoomId | 'all' | 'home'; area: ChoreArea | null }

function repeats(days: number | null): string {
  if (days === null) return 'One-off'
  if (days === 1) return 'Daily'
  if (days === 7) return 'Weekly'
  return days % 7 === 0 ? `Every ${days / 7} weeks` : `Every ${days} days`
}

function inRoom(item: { roomId: RoomId | null; area: ChoreArea | null }, filter: ChoreFilter): boolean {
  return (filter.room === 'all' || (filter.room === 'home' ? item.roomId === null : item.roomId === filter.room))
    && (filter.area === null || item.area === filter.area)
}

export function ChoresPanel({
  household, memberId, filter, onFilter, view, onView, mine, onMine, busy, onAdd, onEdit, onComplete, onArchive, onUndo, onRestock,
}: {
  household: Household; memberId: string; filter: ChoreFilter; onFilter: (filter: ChoreFilter) => void
  view: ChoreView; onView: (view: ChoreView) => void; mine: boolean; onMine: (mine: boolean) => void; busy: boolean
  onAdd: () => void; onEdit: (chore: Chore) => void; onComplete: (chore: Chore) => void
  onArchive: (chore: Chore) => void; onUndo: (completion: ChoreCompletion) => void
  onRestock: () => void
}) {
  const [historyCount, setHistoryCount] = useState(20)
  const [filterError, setFilterError] = useState('')
  const today = billingDate(household.billingTimeZone)
  const tasks = new Map(household.chores.items.map((chore) => [chore.id, chore]))
  const filtered = household.chores.items.filter((chore) => inRoom(chore, filter))
  const active = filtered.filter((chore) => !chore.archived && chore.dueDate !== null)
  const mineOrEveryone = (chore: Chore) => !mine || choreAssignee(chore, household.members)?.id === memberId
  const scheduled = active.filter(mineOrEveryone)
  const items = (view === 'archived' ? filtered.filter((chore) => chore.archived).filter(mineOrEveryone) : scheduled)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.title.localeCompare(b.title))
  const history = household.chores.history.filter((completion) => inRoom(completion, filter))
    .filter((completion) => !mine || completion.completedBy === memberId || completion.assignedTo === memberId)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id))
  const due = scheduled.filter((chore) => chore.dueDate !== null && chore.dueDate <= today).length
  const room = filter.room === 'all' || filter.room === 'home' ? null : roomCatalog[filter.room]
  const memberName = (id: string) => household.members.find((member) => member.id === id)?.name ?? 'Former roommate'

  return <section className="chores-panel" aria-label="Household chores" aria-busy={busy || undefined}>
    <nav className="receipt-tabs" aria-label="Chore sections">
      <button type="button" disabled={busy} aria-pressed={view === 'active'} onClick={() => onView('active')}>Chores</button>
      <button type="button" disabled={busy} aria-pressed={view === 'history'} onClick={() => onView('history')}>History</button>
      <button type="button" disabled={busy} aria-pressed={view === 'archived'} onClick={() => onView('archived')}>Archived</button>
    </nav>
    <div className="chore-filters">
      <label className="field">Chore room<Dropdown label="Chore room" value={filter.room} disabled={busy} onValueChange={(value) => {
        if (value === 'all' || value === 'home') onFilter({ room: value, area: null })
        else {
          const parsed = roomIdSchema.safeParse(value)
          if (!parsed.success) { setFilterError('Choose a room from this home.'); return }
          onFilter({ room: parsed.data, area: null })
        }
        setFilterError('')
      }}>
        <option value="all">All rooms</option><option value="home">Whole home</option>
        {roomIds.map((id) => <option key={id} value={id}>{roomCatalog[id].name}</option>)}
      </Dropdown></label>
      {room && <label className="field">Chore area<Dropdown label="Chore area" value={filter.area ?? ''} disabled={busy} onValueChange={(value) => {
        if (!value) onFilter({ ...filter, area: null })
        else {
          const parsed = choreAreaSchema.safeParse(value)
          if (!parsed.success || !room.areas.some((area) => area.id === parsed.data)) { setFilterError('Choose an area in this room.'); return }
          onFilter({ ...filter, area: parsed.data })
        }
        setFilterError('')
      }}>
        <option value="">All areas</option>{room.areas.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}
      </Dropdown></label>}
    </div>
    <label className="chore-mine"><input type="checkbox" checked={mine} disabled={busy} onChange={(event) => onMine(event.target.checked)} />{view === 'history' ? 'My turns and completions' : 'My turn only'}</label>
    <button className="text-button chore-supplies" disabled={busy} onClick={onRestock}>Restock room supplies</button>
    {filterError && <p className="form-error" role="alert">{filterError}</p>}
    {busy && <p className="inline loading-status" role="status"><LoadingIcon size={20} />Saving chores...</p>}
    {view !== 'history' && <div className="chore-toolbar">
      <span>{view === 'active' ? `${due} due / ${scheduled.length} scheduled` : `${items.length} archived`}</span>
      <button className="button primary small-button" disabled={busy || household.chores.items.length >= choreLimit} onClick={onAdd}><Plus size={15} />Add chore</button>
    </div>}
    {view !== 'history' && !items.length && <div className="empty-state"><ListChecks size={32} /><h3>{view === 'archived' ? 'No archived chores.' : mine ? 'No chores assigned to you.' : 'No chores here yet.'}</h3><p>{view === 'archived' ? 'Archived chores keep their completion history.' : 'Add a task or choose another room.'}</p></div>}
    {view !== 'history' && <div className="chore-list">{items.map((chore) => {
      const assignee = choreAssignee(chore, household.members)
      const status = choreStatus(chore, today)
      return <article className="chore-card" key={chore.id} aria-label={chore.title}>
        <header><h3>{chore.title}</h3><span className={`chore-status ${status}`}>{status === 'due' ? 'Due today' : status === 'overdue' ? 'Overdue' : status === 'completed' ? 'Completed' : status === 'archived' ? 'Archived' : 'Upcoming'}</span></header>
        <p className="chore-location">{choreLocationLabel(chore.roomId, chore.area)}</p>
        <p className="chore-schedule">{chore.dueDate ? dateTitle(chore.dueDate, today) : 'One-off completed'}<span>{repeats(chore.repeatDays)}</span></p>
        {chore.notes && <p className="chore-notes">{chore.notes}</p>}
        <div className="chore-assignee">{assignee ? <><Avatar member={assignee} small /><span>{assignee.id === memberId ? 'Your turn' : `${assignee.name}'s turn`}</span></> : <><Users size={17} /><span>Unassigned. Choose an active roommate.</span></>}
          {chore.rotation.length > 1 && <small>Rotating</small>}
        </div>
        <div className="chore-actions">
          {chore.archived ? <button className="button secondary small-button" disabled={busy} onClick={() => onArchive(chore)}><RotateCcw size={14} />Restore chore</button>
            : <>
              <button className="button primary small-button" disabled={busy || chore.dueDate === null} onClick={() => onComplete(chore)}><Check size={15} />Mark done</button>
              <button className="icon-button" disabled={busy} aria-label={`Edit ${chore.title}`} onClick={() => onEdit(chore)}><Pencil size={16} /></button>
              <button className="icon-button" disabled={busy} aria-label={`Archive ${chore.title}`} onClick={() => onArchive(chore)}><Archive size={16} /></button>
            </>}
        </div>
      </article>
    })}</div>}
    {view === 'history' && <>
      {!history.length && <div className="empty-state"><History size={32} /><h3>No completions yet.</h3><p>Completed chores will be recorded here.</p></div>}
      {history.slice(0, historyCount).map((completion) => {
        const chore = tasks.get(completion.choreId)
        return <article className="chore-card chore-completion" key={completion.id} aria-label={`Completion: ${completion.title}`}>
          <header><h3>{completion.title}</h3><span className={`chore-status ${completion.undoneAt ? 'undone' : 'completed'}`}>{completion.undoneAt ? 'Undone' : 'Done'}</span></header>
          <p className="chore-location">{choreLocationLabel(completion.roomId, completion.area)}</p>
          <p>{memberName(completion.completedBy)} completed it on {dateTitle(billingDate(household.billingTimeZone, new Date(completion.completedAt)), today)}.</p>
          <p className="field-hint">Scheduled for {dateTitle(completion.dueDate, today)}{completion.assignedTo ? `; assigned to ${memberName(completion.assignedTo)}.` : '; no assigned roommate.'}</p>
          {completion.undoneAt && <p className="field-hint">Undone by {completion.undoneBy ? memberName(completion.undoneBy) : 'a roommate'}.</p>}
          {canUndoChore(chore, completion) && <button className="text-button" disabled={busy} onClick={() => onUndo(completion)}><RotateCcw size={14} />Undo completion</button>}
          {chore && !chore.archived && chore.dueDate === null && !completion.undoneAt && chore.occurrence === completion.occurrence + 1
            && <button className="text-button" disabled={busy} onClick={() => onEdit(chore)}>Schedule again</button>}
        </article>
      })}
      {historyCount < history.length && <button className="button secondary full" onClick={() => setHistoryCount((count) => count + 20)}>Show more completions</button>}
    </>}
    {household.chores.items.length >= choreLimit && <p className="field-hint">This home has reached its {choreLimit}-chore limit.</p>}
  </section>
}

export function ChoreForm({ household, memberId, chore, initialRoom, initialArea = null, busy, error, onSubmit }: {
  household: Household; memberId: string; chore?: Chore; initialRoom: RoomId | null; initialArea?: ChoreArea | null
  busy: boolean; error: ReactNode; onSubmit: (body: Record<string, unknown>) => void
}) {
  const [title, setTitle] = useState(chore?.title ?? '')
  const [notes, setNotes] = useState(chore?.notes ?? '')
  const [roomId, setRoomId] = useState<RoomId | null>(chore ? chore.roomId : initialRoom)
  const [area, setArea] = useState<ChoreArea | null>(chore ? chore.area : initialArea)
  const [dueDate, setDueDate] = useState(chore?.dueDate ?? billingDate(household.billingTimeZone))
  const repeatPreset = (days: number | null) => days === null ? '' : [1, 7, 14].includes(days) ? String(days) : 'custom'
  const [repeat, setRepeat] = useState(repeatPreset(chore?.repeatDays ?? null))
  const [customDays, setCustomDays] = useState(String(chore?.repeatDays ?? 3))
  const [rotation, setRotation] = useState(chore?.rotation ?? [memberId])
  const [nextMember, setNextMember] = useState(chore ? chore.rotation[chore.turn] : memberId)
  const [baseVersion, setBaseVersion] = useState(chore?.version ?? 0)
  const [localError, setLocalError] = useState('')
  const latest = chore ? household.chores.items.find((item) => item.id === chore.id) : undefined
  const blocked = !!chore && (!latest || latest.archived)
  const changed = !!latest && latest.version !== baseVersion
  const members = household.members.filter((member) => !member.inactive || rotation.includes(member.id))

  const restoreValues = (latest: Chore) => {
    setTitle(latest.title); setNotes(latest.notes); setRoomId(latest.roomId); setArea(latest.area)
    setDueDate(latest.dueDate ?? billingDate(household.billingTimeZone))
    setRepeat(repeatPreset(latest.repeatDays)); setCustomDays(String(latest.repeatDays ?? 3))
    setRotation(latest.rotation); setNextMember(latest.rotation[latest.turn])
    setBaseVersion(latest.version); setLocalError('')
  }
  const move = (index: number, direction: number) => {
    const next = [...rotation]
    ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
    setRotation(next)
  }
  return <Form onSubmit={() => {
    if (blocked || changed) { setLocalError('Review the current chore before saving.'); return }
    if (rotation.some((id) => !household.members.some((member) => member.id === id && !member.inactive))) {
      setLocalError('Remove former roommates from the assignment before saving.')
      return
    }
    const body = { title, notes, roomId, area, dueDate, repeatDays: repeat === '' ? null : Number(repeat === 'custom' ? customDays : repeat), rotation, turn: rotation.indexOf(nextMember) }
    const parsed = chore ? choreEditInputSchema.safeParse({ ...body, choreVersion: baseVersion }) : choreInputSchema.safeParse(body)
    if (!parsed.success) { setLocalError(parsed.error.issues[0].message); return }
    setLocalError('')
    onSubmit(parsed.data)
  }}>
    <label className="field">Chore name<input required maxLength={80} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Clean the sink" /></label>
    <div className="field-row">
      <label className="field">Room<Dropdown label="Room" value={roomId ?? ''} disabled={busy} onValueChange={(value) => {
        const parsed = value ? roomIdSchema.safeParse(value) : null
        if (parsed && !parsed.success) { setLocalError('Choose an available room.'); return }
        setRoomId(parsed?.data ?? null); setArea(null); setLocalError('')
      }}><option value="">Whole home</option>{roomIds.map((id) => <option key={id} value={id}>{roomCatalog[id].name}</option>)}</Dropdown></label>
      {roomId && <label className="field">Area<Dropdown label="Area" value={area ?? ''} disabled={busy} onValueChange={(value) => {
        const parsed = value ? choreAreaSchema.safeParse(value) : null
        if (parsed && !parsed.success) { setLocalError('Choose an area in this room.'); return }
        setArea(parsed?.data ?? null); setLocalError('')
      }}><option value="">Whole room</option>{roomCatalog[roomId].areas.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Dropdown></label>}
    </div>
    <label className="field">Notes<textarea rows={2} maxLength={240} value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} /></label>
    <div className="field-row">
      <label className="field">Due date<input type="date" min="1900-01-01" required value={dueDate} disabled={busy} onChange={(event) => setDueDate(event.target.value)} /></label>
      <label className="field">Repeat<Dropdown label="Repeat" value={repeat} disabled={busy} onValueChange={setRepeat}>
        <option value="">One-off</option><option value="1">Daily</option><option value="7">Weekly</option><option value="14">Every 2 weeks</option><option value="custom">Custom interval</option>
      </Dropdown></label>
    </div>
    {repeat === 'custom' && <label className="field">Repeat every (days)<input type="number" min={1} max={365} required value={customDays} disabled={busy} onChange={(event) => setCustomDays(event.target.value)} /></label>}
    <fieldset className="split-fieldset"><legend>Who takes turns?</legend>
      <div className="participant-options">{members.map((member) => <label key={member.id} className={`participant-option${rotation.includes(member.id) ? ' chosen' : ''}`}>
        <input type="checkbox" checked={rotation.includes(member.id)} disabled={busy || (!!member.inactive && !rotation.includes(member.id))} onChange={(event) => {
          const next = event.target.checked ? [...rotation, member.id] : rotation.filter((id) => id !== member.id)
          setRotation(next)
          if (!next.includes(nextMember)) setNextMember(next[0] ?? '')
        }} /><Avatar member={member} small /><span>{member.name}{member.inactive ? ' (former roommate)' : ''}</span>
      </label>)}</div>
    </fieldset>
    {rotation.length > 1 && <ol className="chore-rotation" aria-label="Rotation order">{rotation.map((id, index) => <li key={id}>
      <span>{household.members.find((member) => member.id === id)?.name ?? 'Former roommate'}</span>
      <button className="icon-button" type="button" aria-label={`Move ${household.members.find((member) => member.id === id)?.name ?? 'roommate'} earlier`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
      <button className="icon-button" type="button" aria-label={`Move ${household.members.find((member) => member.id === id)?.name ?? 'roommate'} later`} disabled={busy || index === rotation.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
    </li>)}</ol>}
    <label className="field">Next turn<Dropdown label="Next turn" required value={nextMember} disabled={busy || !rotation.length} onValueChange={setNextMember}>
      {!rotation.length && <option value="">Choose a roommate</option>}
      {rotation.map((id) => <option key={id} value={id}>{household.members.find((member) => member.id === id)?.name ?? 'Former roommate'}</option>)}
    </Dropdown></label>
    <p className="field-hint">One person keeps the assignment. Multiple people rotate in the order above after each completion. Dates use {household.billingTimeZone}.</p>
    {blocked && <p className="form-error" role="alert">This chore is unavailable or archived. Close the form and review the chore list.</p>}
    {!blocked && changed && latest && <DraftConflict onLatest={() => restoreValues(latest)}
      onKeep={() => { setBaseVersion(latest.version); setLocalError('') }}
    >This chore changed. Review the latest schedule before saving your draft.</DraftConflict>}
    {localError && <p className="form-error" role="alert">{localError}</p>}{error}
    <button className="button primary full" disabled={busy || blocked || changed}>{busy ? <LoadingIcon size={17} tone="light" /> : <Check size={17} />}{chore ? 'Save chore' : 'Create chore'}</button>
  </Form>
}
