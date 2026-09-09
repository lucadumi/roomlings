import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, Check, CircleHelp, ListChecks, Palette, Pencil, Plus, RotateCcw, ShoppingBasket, Trash2, TriangleAlert, Users } from 'lucide-react'
import { billingDate, choreLimit } from '../shared/domain.ts'
import type { Household, ShoppingItemInput } from '../shared/domain.ts'
import { choreAssignee, choreStatus } from '../shared/chores.ts'
import {
  availableComponentSlots, componentCatalog, componentCategories, componentFinishes, componentKinds,
  componentChoreMatches, componentFinishSchema, componentPositionSupported, componentSupplyLimit, createRoomComponent, getRoomComponents,
  roomComponentLimit, roomComponentsPatchSchema, roomSlots, suggestedComponentSupplies, validateRoomComponents,
} from '../shared/roomComponents.ts'
import type {
  ComponentCategory, ComponentChoreSuggestion, ComponentKind, RoomComponent,
  RoomComponentChange, RoomComponentsPatch, RoomSlotId,
} from '../shared/roomComponents.ts'
import { roomCatalog } from '../shared/rooms.ts'
import type { RoomId } from '../shared/rooms.ts'
import { normalizeShoppingName } from '../shared/shopping.ts'
import { DraftConflict, Form } from './components.tsx'
import { Dropdown } from './Dropdown.tsx'
import { LoadingIcon } from './Branding.tsx'
import { SupplyShortcuts } from './Restock.tsx'
import { dateTitle } from './format.ts'
import { roomPresets } from './roomStyles.ts'
import { ComponentPreview } from './ComponentPreview.tsx'
import { componentAvailability, groupedRoomComponents } from './componentAvailability.ts'
import type { ComponentAvailability } from './componentAvailability.ts'
import './roomComponents.css'

type ComponentConfiguration = Omit<RoomComponentChange, 'componentVersion' | 'linkedChores'>
type ComponentDraft = { base: RoomComponent | null; value: RoomComponent; linkedChores?: 'keep' | 'archive' }
type ComponentDrafts = Record<string, ComponentDraft>
type AvailabilityFilter = 'all' | 'available' | 'placed' | 'preview'

function AvailabilityBadge({ status, label }: Pick<ComponentAvailability, 'status' | 'label'>) {
  const Icon = status === 'available' ? Plus : status === 'placed' ? Check : status === 'preview' ? Pencil : TriangleAlert
  return <span className={`room-availability ${status}`} data-availability={status}><Icon size={12} aria-hidden="true" />{label}</span>
}

function configuration(component: RoomComponent): ComponentConfiguration {
  const { id, kind, roomId, slotId, name, variant, finish, supplies, installed } = component
  return { id, kind, roomId, slotId, name, variant, finish, supplies, installed }
}

function sameConfiguration(left: RoomComponent, right: RoomComponent): boolean {
  return JSON.stringify(configuration(left)) === JSON.stringify(configuration(right))
}

function withoutDraft(drafts: ComponentDrafts, id: string): ComponentDrafts {
  const next = { ...drafts }
  delete next[id]
  return next
}

function objectName(component: RoomComponent): string {
  return component.name.trim() || componentCatalog[component.kind].name
}

function modelName(component: RoomComponent): string {
  return componentCatalog[component.kind].variants.find((variant) => variant.id === component.variant)?.name ?? component.variant
}

function finishName(component: RoomComponent): string {
  return componentFinishes[component.finish].name
}

function positionName(component: RoomComponent): string {
  return roomSlots.find((slot) => slot.id === component.slotId)?.name ?? 'Designed room position'
}

function isComponentCategory(value: string): value is ComponentCategory {
  return Object.hasOwn(componentCategories, value)
}

function choiceName(component: RoomComponent, components: readonly RoomComponent[]): string {
  const name = objectName(component)
  return components.filter((other) => objectName(other) === name).length > 1 ? `${name} at ${positionName(component)}` : name
}

function previewDescription(component: RoomComponent): string {
  const definition = componentCatalog[component.kind]
  const supplies = component.supplies.map((supply) => supply.name).join(', ')
  return `${definition.description} ${supplies ? `Supplies: ${supplies}.` : 'No supply shortcuts configured.'}`
}

function ObjectCardPreview({ component, household, note }: { component: RoomComponent; household: Household; note?: string }) {
  const definition = componentCatalog[component.kind]
  return <span className="room-object-picture">
    <ComponentPreview component={component} roomStyle={household.roomStyle} />
    <span className="room-object-hover-details" aria-hidden="true">
      <span className="room-object-description">{definition.description}</span>
      <span className="room-object-supply-summary">{component.supplies.length
        ? `Supplies: ${component.supplies.map((supply) => supply.name).join(', ')}`
        : 'No supply shortcuts configured.'}</span>
      <span className="room-object-model-summary">{note ?? `${modelName(component)}${definition.chores.length ? ` / ${definition.chores.length} care routines` : ''}`}</span>
    </span>
  </span>
}

function changedFields(draft: ComponentDraft, latest: RoomComponent): RoomComponent {
  const changed = (key: 'name' | 'variant' | 'finish' | 'supplies' | 'installed' | 'slotId') =>
    !draft.base || JSON.stringify(draft.value[key]) !== JSON.stringify(draft.base[key])
  return {
    ...latest,
    name: changed('name') ? draft.value.name : latest.name,
    variant: changed('variant') ? draft.value.variant : latest.variant,
    finish: changed('finish') ? draft.value.finish : latest.finish,
    supplies: changed('supplies') ? draft.value.supplies : latest.supplies,
    installed: changed('installed') ? draft.value.installed : latest.installed,
    slotId: changed('slotId') ? draft.value.slotId : latest.slotId,
  }
}

export type RoomEditorProps = {
  household: Household
  roomId: RoomId
  busy: boolean
  canEdit?: boolean
  error: ReactNode
  selectedComponentId: string | null
  onSelect: (id: string | null) => void
  onPreview: (components: readonly RoomComponent[] | null) => void
  onSubmit: (patch: RoomComponentsPatch) => Promise<boolean>
  onClose: () => void
  onManageAdmins: () => void
  onRoomColors: () => void
}

export function RoomEditor(props: RoomEditorProps) {
  return <RoomEditorDraft key={`${props.household.id}:${props.roomId}`} {...props} />
}

function RoomEditorDraft({ household, roomId, busy, canEdit = true, error, selectedComponentId, onSelect, onPreview, onSubmit, onClose, onManageAdmins, onRoomColors }: RoomEditorProps) {
  const current = useMemo(() => getRoomComponents(household), [household.id, household.roomComponents])
  const [drafts, setDrafts] = useState<ComponentDrafts>({})
  const [section, setSection] = useState<'installed' | 'catalog'>('installed')
  const [category, setCategory] = useState<ComponentCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all')
  const [removing, setRemoving] = useState<string | null>(null)
  const [removalChoice, setRemovalChoice] = useState<'' | 'keep' | 'archive'>('')
  const [localError, setLocalError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const suppliesElement = useRef<HTMLFieldSetElement>(null)
  const locked = busy || saving || !canEdit
  const pending = Object.values(drafts)
  const currentById = new Map(current.map((component) => [component.id, component]))
  const preview = useMemo(() => [
    ...current.map((component) => {
      const draft = drafts[component.id]
      return draft ? {
        ...draft.value, version: component.version,
        state: component.state, stateChangedAt: component.stateChangedAt, stateChangedBy: component.stateChangedBy,
      } : component
    }),
    ...Object.values(drafts).filter((draft) => !current.some((component) => component.id === draft.value.id)).map((draft) => draft.value),
  ], [current, drafts])
  const roomObjects = preview.filter((component) => component.roomId === roomId)
  const installed = roomObjects.filter((component) => component.installed)
  const groups = groupedRoomComponents(installed)
  const selected = roomObjects.find((component) => component.id === selectedComponentId)
  const selectedPositions = selected ? installed.filter((component) => component.kind === selected.kind) : []
  const positionChoices = selected ? roomSlots.filter((slot) => slot.roomId === roomId && slot.kinds.includes(selected.kind)) : []
  const conflicts = pending.filter((draft) => {
    const latest = currentById.get(draft.value.id)
    return draft.base ? !latest || latest.version !== draft.base.version : !!latest
  })
  const invalidLayout = validateRoomComponents(preview)
  const removal = removing ? preview.find((component) => component.id === removing) : undefined
  const linkedToRemoval = removal ? household.chores.items.filter((chore) => !chore.archived && componentChoreMatches(chore, removal)) : []
  const matchingCatalog = componentKinds.filter((kind) =>
    roomSlots.some((slot) => slot.roomId === roomId && slot.kinds.includes(kind))
    && (category === 'all' || componentCatalog[kind].category === category)
    && normalizeShoppingName(`${componentCatalog[kind].name} ${componentCatalog[kind].description}`).includes(normalizeShoppingName(search)))
  const availability = new Map(matchingCatalog.map((kind) => [kind, componentAvailability(kind, roomId, preview, current)]))
  const catalog = matchingCatalog.filter((kind) => availabilityFilter === 'all'
    || (availabilityFilter === 'available' ? (availability.get(kind)?.free ?? 0) > 0 : availability.get(kind)?.status === availabilityFilter))
  const availabilityFilters: { id: AvailabilityFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All objects', count: matchingCatalog.length },
    { id: 'available', label: 'Available', count: [...availability.values()].filter((item) => item.free > 0).length },
    { id: 'placed', label: 'Placed', count: [...availability.values()].filter((item) => item.status === 'placed').length },
  ]
  const previewCount = [...availability.values()].filter((item) => item.status === 'preview').length
  if (previewCount || availabilityFilter === 'preview') availabilityFilters.push({ id: 'preview', label: 'In preview', count: previewCount })

  useEffect(() => { onPreview(pending.length ? preview : null) }, [onPreview, preview, pending.length])
  useEffect(() => () => onPreview(null), [onPreview])
  useEffect(() => {
    if (selectedComponentId) {
      setSection('installed')
      setRemoving(null)
    }
  }, [selectedComponentId])
  useEffect(() => {
    if (selectedComponentId && section === 'installed') nameInput.current?.focus()
  }, [selectedComponentId, section])

  const select = (id: string | null) => {
    onSelect(id)
    setRemoving(null)
    setLocalError('')
    setSection('installed')
  }
  const update = (component: RoomComponent, changes: Partial<ComponentConfiguration>, linkedChores?: 'keep' | 'archive') => {
    setDrafts((previous) => {
      const existing = previous[component.id]
      const base = existing ? existing.base : currentById.get(component.id) ?? null
      const value = { ...(existing?.value ?? component), ...changes }
      if (base && sameConfiguration(base, value)) return withoutDraft(previous, component.id)
      return { ...previous, [component.id]: { base, value, linkedChores: linkedChores ?? existing?.linkedChores } }
    })
    setLocalError('')
    setNotice('')
  }
  const add = (kind: ComponentKind, slotId: RoomSlotId) => {
    if (!availableComponentSlots(preview, roomId, kind).some((slot) => slot.id === slotId)) {
      setLocalError('That position is occupied. Remove its current object first.')
      return
    }
    const archived = preview.find((component) => component.slotId === slotId && component.kind === kind && !component.installed)
    if (archived) {
      update(archived, { installed: true })
      select(archived.id)
      setNotice(`${objectName(archived)} is restored in your preview. Its saved settings are kept; archived chores stay archived.`)
      return
    }
    if (preview.length >= roomComponentLimit) { setLocalError('This home has reached its saved-object limit. Restore a saved object instead.'); return }
    if (!globalThis.crypto?.randomUUID) { setLocalError('Use HTTPS or localhost to safely add a room object.'); return }
    const component = createRoomComponent(kind, slotId, crypto.randomUUID())
    setDrafts((previous) => ({ ...previous, [component.id]: { base: null, value: component } }))
    select(component.id)
    setNotice(`${component.name} was added to your preview. Supplies and chores are not added automatically.`)
  }
  const keepDraft = (draft: ComponentDraft, latest: RoomComponent) => {
    const value = changedFields(draft, latest)
    setDrafts((previous) => sameConfiguration(value, latest) ? withoutDraft(previous, value.id) : {
      ...previous, [value.id]: { ...draft, base: latest, value },
    })
    setLocalError('')
    setNotice('Your edited fields are kept. Other changes from your roommates are included. Review the preview before applying.')
  }
  const discard = () => { onPreview(null); onClose() }

  return <section className="room-components room-editor" aria-label={`Edit ${roomCatalog[roomId].name} objects`} aria-busy={busy || saving || undefined}>
    <Form onSubmit={() => {
      if (locked) return
      if (removing) { setLocalError('Finish reviewing the object removal before applying.'); return }
      if (conflicts.length) { setLocalError('Review the changed objects before applying your draft.'); return }
      if (invalidLayout) { setLocalError(invalidLayout); return }
      const input = roomComponentsPatchSchema.safeParse({
        roomId, changes: pending.map((draft) => ({
          ...configuration(draft.value), componentVersion: draft.base?.version ?? null,
          ...(!draft.value.installed && draft.linkedChores ? { linkedChores: draft.linkedChores } : {}),
        })),
      })
      if (!input.success) {
        const issue = input.error.issues[0]
        const invalid = typeof issue.path[1] === 'number' ? pending[issue.path[1]]?.value : undefined
        if (invalid) select(invalid.id)
        setLocalError(`${invalid ? `${objectName(invalid)}: ` : ''}${issue.message}`)
        return
      }
      setLocalError('')
      setSaving(true)
      void onSubmit(input.data).then((saved) => {
        if (saved) { setDrafts({}); onPreview(null); onClose() }
      }).catch((cause: unknown) => {
        setLocalError(cause instanceof Error ? cause.message : 'The room could not be saved. Your draft is still here.')
      }).finally(() => setSaving(false))
    }}>
      <fieldset className="room-editor-fields" disabled={locked}>
        <legend className="sr-only">Room object settings</legend>
        <div className="room-editor-toolbar"><nav className="receipt-tabs" aria-label="Room editor sections">
          <button type="button" disabled={locked} aria-pressed={section === 'installed'} onClick={() => setSection('installed')}>In this room <span>{groups.length}</span></button>
          <button type="button" disabled={locked} aria-pressed={section === 'catalog'} onClick={() => { onSelect(null); setSection('catalog'); setRemoving(null) }}><Plus size={14} />Add objects</button>
        </nav>
          <div className="room-editor-tools">
            <button type="button" className="icon-button control-surface" disabled={locked} onClick={onRoomColors} aria-label="Room colors" title="Room colors"><Palette size={17} /></button>
            <button type="button" className="icon-button control-surface" disabled={locked} onClick={onManageAdmins} aria-label="Room admins" title="Room admins"><Users size={17} /></button>
          </div>
        </div>
        {conflicts.map((draft) => {
          const latest = currentById.get(draft.value.id)
          return <div key={draft.value.id} className="room-object-conflict" aria-label={`Changed object: ${objectName(draft.value)}`}>
            {latest ? <DraftConflict onLatest={() => {
              setDrafts((previous) => withoutDraft(previous, draft.value.id)); setLocalError(''); setNotice('The latest object settings are now in your preview.')
            }} onKeep={() => keepDraft(draft, latest)}>
              {objectName(draft.value)} changed while you were editing. Latest: {latest.name}, {positionName(latest)}, {finishName(latest)}, {latest.installed ? 'in the room' : 'removed'}.
              {' '}Supplies: {latest.supplies.length ? latest.supplies.map((supply) => `${supply.quantity} ${supply.name}`).join(', ') : 'none'}.
              {' '}Keep your draft to retain the fields you edited and include your roommates' other changes.
            </DraftConflict> : <div className="shopping-conflict">
              <p role="alert">{objectName(draft.value)} is no longer available. Remove this draft and choose an object from the current catalog.</p>
              <button type="button" className="text-button" onClick={() => setDrafts((previous) => withoutDraft(previous, draft.value.id))}>Use latest values</button>
            </div>}
          </div>
        })}
        {invalidLayout && <p className="form-error" role="alert">{invalidLayout} Review the objects below before applying.</p>}
        {section === 'installed' && <>
          {selected ? <div className="room-object-settings" aria-label={`Settings for ${objectName(selected)}`}>
            <button type="button" className="text-button" disabled={locked} onClick={() => select(null)}><ArrowLeft size={14} />All room objects</button>
            <h3>{objectName(selected)}</h3>
            {selectedPositions.length > 1 && <div className="room-position-tabs" role="group" aria-label={`${componentCatalog[selected.kind].name} positions`}>
              {selectedPositions.map((component) => <button type="button" key={component.id} className="control-surface" disabled={locked}
                aria-pressed={component.id === selected.id} onClick={() => select(component.id)}>{positionName(component)}</button>)}
            </div>}
            {selected.installed && positionChoices.length > 1 ? <label className="field">Position<Dropdown label="Position" value={selected.slotId} disabled={locked}
              onValueChange={(value) => {
                const destination = positionChoices.find((slot) => slot.id === value)
                if (!destination || !componentPositionSupported(destination.id, preview)
                  || preview.some((component) => component.installed && component.slotId === destination.id && component.id !== selected.id)) {
                  setLocalError('Choose an available position for this object.')
                  return
                }
                update(selected, { slotId: destination.id })
              }}>
              {positionChoices.map((slot) => {
                const occupied = preview.some((component) => component.installed && component.slotId === slot.id && component.id !== selected.id)
                const supported = componentPositionSupported(slot.id, preview)
                return <option key={slot.id} value={slot.id} disabled={occupied || !supported}>{slot.name}{occupied ? ' (occupied)' : !supported ? ' (unavailable)' : ''}</option>
              })}
            </Dropdown></label> : <p className="field-hint">{positionName(selected)}</p>}
            {selected.installed && availableComponentSlots(preview, roomId, selected.kind).length > 0
              && <button type="button" className="text-button" disabled={locked} onClick={() => {
                const destination = availableComponentSlots(preview, roomId, selected.kind)[0]
                if (!destination) { setLocalError('There are no free positions for this object.'); return }
                add(selected.kind, destination.id)
              }}><Plus size={14} />Add at another position</button>}
            <label className="field">Object name<input ref={nameInput} required maxLength={50} value={selected.name} disabled={locked} onChange={(event) => update(selected, { name: event.target.value })} /></label>
            {componentCatalog[selected.kind].variants.length > 1
              ? <label className="field">Model<Dropdown label="Model" value={selected.variant} disabled={locked} onValueChange={(variant) => {
                if (!componentCatalog[selected.kind].variants.some((model) => model.id === variant)) { setLocalError('Choose a model made for this object.'); return }
                update(selected, { variant })
              }}>
                {componentCatalog[selected.kind].variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
              </Dropdown></label>
              : null}
            <label className="field">Finish<Dropdown label="Finish" value={selected.finish} disabled={locked} onValueChange={(finish) => {
              const parsed = componentFinishSchema.safeParse(finish)
              if (!parsed.success) { setLocalError('Choose an available object finish.'); return }
              update(selected, { finish: parsed.data })
            }}>
              {Object.entries(componentFinishes).map(([finish, value]) => <option key={finish} value={finish}>{value.name}</option>)}
            </Dropdown></label>
            {selected.finish !== 'room' && <p className="room-finish-preview"><span aria-hidden="true" style={{ backgroundColor: componentFinishes[selected.finish].color ?? roomPresets[household.roomStyle].colors.cabinetPanel }} />{finishName(selected)}</p>}
            <fieldset className="room-supply-editor" ref={suppliesElement} disabled={locked}>
              <legend>Supply shortcuts</legend>
              <p className="field-hint">These names and quantities become shortcuts to the shared shopping list. No stock is tracked, and saving this room does not order or add anything.</p>
              {selected.supplies.map((supply, index) => <div className="room-supply-fields" key={supply.id} data-supply-id={supply.id}>
                <div className="field-row">
                  <label className="field">Supply name {index + 1}<input required maxLength={50} value={supply.name} disabled={locked} onChange={(event) => update(selected, {
                    supplies: selected.supplies.map((item) => item.id === supply.id ? { ...item, name: event.target.value } : item),
                  })} /></label>
                  <label className="field">Supply quantity {index + 1}<input required maxLength={40} value={supply.quantity} disabled={locked} onChange={(event) => update(selected, {
                    supplies: selected.supplies.map((item) => item.id === supply.id ? { ...item, quantity: event.target.value } : item),
                  })} /></label>
                </div>
                <button type="button" className="text-button" disabled={locked} aria-label={`Remove supply ${index + 1}`} onClick={() => update(selected, { supplies: selected.supplies.filter((item) => item.id !== supply.id) })}><Trash2 size={14} />Remove shortcut</button>
              </div>)}
              {!selected.supplies.length && <p className="field-hint">No supply shortcuts for this object.</p>}
              <div className="room-object-actions">
                <button type="button" className="button secondary small-button" disabled={locked || selected.supplies.length >= componentSupplyLimit} onClick={() => {
                  if (!globalThis.crypto?.randomUUID) { setLocalError('Use HTTPS or localhost to safely add a supply shortcut.'); return }
                  const id = crypto.randomUUID()
                  update(selected, { supplies: [...selected.supplies, { id, name: '', quantity: '1' }] })
                  requestAnimationFrame(() => suppliesElement.current?.querySelector<HTMLInputElement>(`[data-supply-id="${id}"] input`)?.focus())
                }}><Plus size={14} />Add supply shortcut</button>
                <button type="button" className="text-button" disabled={locked || JSON.stringify(selected.supplies) === JSON.stringify(suggestedComponentSupplies(selected))}
                  onClick={() => update(selected, { supplies: suggestedComponentSupplies(selected) })}><RotateCcw size={14} />Use suggested supplies</button>
              </div>
              {selected.supplies.length >= componentSupplyLimit && <p className="field-hint">An object can have up to {componentSupplyLimit} supply shortcuts.</p>}
            </fieldset>
            {selected.installed ? roomSlots.find((slot) => slot.id === selected.slotId)?.removable
              ? <button type="button" className="text-button room-remove-object" disabled={locked} onClick={() => { setRemoving(selected.id); setRemovalChoice('') }}><Trash2 size={14} />Remove object</button>
              : <p className="field-hint">This fitted object stays in the room. Its name, finish and supply shortcuts can still be changed.</p>
              : <div className="room-draft-removal">
                <p>Removed in your preview. The shared room will not change until you apply.</p>
                <button type="button" className="button secondary small-button" disabled={locked || preview.some((component) => component.installed && component.slotId === selected.slotId)}
                  onClick={() => update(selected, { installed: true })}><RotateCcw size={14} />Undo removal</button>
                {preview.some((component) => component.installed && component.slotId === selected.slotId) && <p className="field-hint">Remove the replacement from this position before restoring this object.</p>}
              </div>}
            {removal?.id === selected.id && <div className="room-removal-confirmation" role="group" aria-label={`Remove ${objectName(removal)}`}>
              <h4>Remove {objectName(removal)} from the room?</h4>
              <p>This only changes your preview until Apply. Existing shopping entries and completion history are kept.</p>
              {linkedToRemoval.length ? <>
                <p>{linkedToRemoval.length} linked {linkedToRemoval.length === 1 ? 'chore needs' : 'chores need'} a choice:</p>
                <ul>{linkedToRemoval.map((chore) => <li key={chore.id}>{chore.title}</li>)}</ul>
                <label className="field">Linked chores<Dropdown label="Linked chores" value={removalChoice} disabled={locked} onValueChange={(value) => {
                  if (value === 'keep' || value === 'archive') setRemovalChoice(value)
                  else setLocalError('Choose how to handle the linked chores.')
                }}>
                  <option value="" disabled>Choose what happens to these chores</option>
                  <option value="keep">Keep as room chores</option>
                  <option value="archive">Archive linked chores</option>
                </Dropdown></label>
              </> : <p>No active chores are linked. Any chores linked before you apply will stay as room chores.</p>}
              <div className="room-object-actions">
                <button type="button" className="button secondary small-button" disabled={locked} onClick={() => setRemoving(null)}>Keep object</button>
                <button type="button" className="button secondary small-button" disabled={locked || (linkedToRemoval.length > 0 && !removalChoice)} onClick={() => {
                  if (drafts[removal.id]?.base === null) {
                    setDrafts((previous) => withoutDraft(previous, removal.id))
                    select(null)
                  } else update(removal, { installed: false }, removalChoice || 'keep')
                  setRemoving(null)
                  setNotice(`${objectName(removal)} was removed from your preview.`)
                }}><Trash2 size={14} />Remove from preview</button>
              </div>
            </div>}
          </div> : null}
          {!selected && <ul className="room-object-list" aria-label="Objects in your room preview">
            {groups.map((group) => {
              const component = group.items[0]
              const label = group.items.length > 1 ? componentCatalog[group.kind].name : objectName(component)
              const isPreview = group.items.some((item) => !currentById.get(item.id)?.installed)
              return <li key={group.kind}>
              <button type="button" className="room-object-choice room-object-tile control-surface" disabled={locked} aria-pressed={component.id === selectedComponentId}
                aria-description={`${currentById.get(component.id)?.installed ? 'Placed' : 'In preview'}. ${previewDescription(component)}`}
                aria-label={`Edit ${label}`} onClick={() => select(component.id)}>
                <ObjectCardPreview component={component} household={household} note={group.items.map(positionName).join(', ')} />
                <span className="room-object-copy"><span className="room-object-title"><strong>{label}</strong>
                  <AvailabilityBadge status={isPreview ? 'preview' : 'placed'} label={isPreview ? 'In preview' : 'Placed'} /></span>
                  <small>{group.items.length > 1 ? `${group.items.length} positions` : positionName(component)}</small>
                  {group.items.some((item) => drafts[item.id]) && <span className="room-object-tag">Edited</span>}
                </span>
              </button>
            </li>})}
          </ul>}
          {!!pending.filter((draft) => !draft.value.installed).length && <div className="room-removed-list">
            <h3>Removed in this draft</h3>
            {pending.filter((draft) => !draft.value.installed).map((draft) => <div className="room-draft-removal" key={draft.value.id}>
              <p>{choiceName(draft.value, roomObjects)}: {draft.linkedChores === 'archive' ? 'linked chores will be archived' : 'linked chores will stay as room chores'}.</p>
              <button type="button" className="text-button" disabled={locked} onClick={() => select(draft.value.id)}>Review removal of {choiceName(draft.value, roomObjects)}</button>
            </div>)}
          </div>}
        </>}
        {section === 'catalog' && <div className="room-catalog">
          <div className="room-catalog-filters"><label className="field">Find an object<input type="search" maxLength={80} value={search} disabled={locked} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field">Object category<Dropdown label="Object category" value={category} disabled={locked} onValueChange={(value) => {
            if (value === 'all' || isComponentCategory(value)) { setCategory(value); setLocalError('') }
            else setLocalError('Choose an available object category.')
          }}>
            <option value="all">All objects</option>
            {Object.entries(componentCategories).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </Dropdown></label></div>
          <nav className="room-availability-filters" aria-label="Filter object availability">
            {availabilityFilters.map((filter) => <button type="button" key={filter.id} className="control-surface" disabled={locked}
              aria-pressed={availabilityFilter === filter.id} onClick={() => setAvailabilityFilter(filter.id)}>{filter.label}<span>{filter.count}</span></button>)}
          </nav>
          {!catalog.length && <p className="field-hint" role="status">No objects match these filters. Try All objects, another name or another category.</p>}
          <div className="room-catalog-grid">{catalog.map((kind) => {
            const definition = componentCatalog[kind]
            const available = availableComponentSlots(preview, roomId, kind)
            const position = available[0]
            const archived = position ? preview.find((component) => component.kind === kind && component.slotId === position.id && !component.installed) : undefined
            const occupants = preview.filter((component) => component.installed && component.roomId === roomId
              && roomSlots.some((slot) => slot.id === component.slotId && slot.kinds.includes(kind)))
            const previewSlot = position ?? roomSlots.find((slot) => slot.roomId === roomId && slot.kinds.includes(kind))
            if (!previewSlot) throw new Error(`The ${definition.name} has no registered preview position.`)
            const previewObject = archived ?? occupants.find((component) => component.kind === kind)
              ?? createRoomComponent(kind, previewSlot.id, `preview-${roomId}-${kind}`)
            const status = componentAvailability(kind, roomId, preview, current)
            const placementNote = position ? `Position: ${position.name}` : occupants.length ? occupants.map((component) =>
              `${positionName(component)} is occupied by ${objectName(component)}.${component.kind !== kind ? ' Remove it first to replace it.' : ''}`).join(' ')
            : previewSlot.requires?.message ?? 'No compatible position is available.'
            return <article className="room-catalog-card" key={kind} aria-label={definition.name} data-availability={status.status} data-free-positions={status.free}>
              <ObjectCardPreview component={previewObject} household={household} note={placementNote} />
              <div className="room-catalog-card-content"><div className="room-catalog-card-title"><h3>{definition.name}</h3>
                <AvailabilityBadge {...status} /></div>
              {available.length > 0 && <span className="room-position-count">{available.length} {available.length === 1 ? 'position available' : 'positions available'}</span>}
              {groupedRoomComponents(occupants).map((group) => {
                const component = group.items[0]
                const label = group.items.length > 1 ? componentCatalog[group.kind].name : objectName(component)
                return <div className="room-position-occupied" key={group.kind}>
                <button type="button" className="text-button" disabled={locked} aria-label={`Review ${label}`}
                  aria-description={`${status.label}. ${placementNote}. ${previewDescription(previewObject)}`}
                  onClick={() => select(component.id)}>Review {label}</button>
              </div>})}
              {position ? <button type="button" className="button secondary small-button" disabled={locked || (!archived && preview.length >= roomComponentLimit)}
                aria-description={`${status.label}. ${placementNote}. ${previewDescription(previewObject)}`}
                aria-label={`${archived ? 'Restore' : 'Add'} ${definition.name}`} onClick={() => add(kind, position.id)}>
                {archived ? <RotateCcw size={14} /> : <Plus size={14} />}{archived ? 'Restore' : 'Add'}
              </button> : <p className="field-hint">No free designed position for this object.</p>}
              {position && !archived && preview.length >= roomComponentLimit && <p className="field-hint">The saved-object limit has been reached. Restore an existing object instead.</p>}
              </div>
            </article>
          })}</div>
        </div>}
      </fieldset>
      {notice && <p className="field-hint" role="status">{notice}</p>}
      {localError && <p className="form-error" role="alert">{localError}</p>}{error}
      <div className="room-editor-footer">
        <p className="field-hint" role="status">{pending.length ? `${pending.length} ${pending.length === 1 ? 'object has' : 'objects have'} unapplied changes.` : 'No unapplied changes.'}</p>
        <div className="button-row room-editor-actions">
          <button type="button" className="button secondary" disabled={busy || saving} onClick={discard}>Cancel</button>
          <button className="button primary" disabled={locked || !pending.length || !!conflicts.length || !!invalidLayout || !!removing}>
            {busy || saving ? <LoadingIcon size={17} tone="light" /> : <Check size={17} />}{busy || saving ? 'Saving...' : 'Apply for everyone'}
          </button>
        </div>
      </div>
    </Form>
  </section>
}

const shortcutLabels: Partial<Record<ComponentKind, string>> = {
  'receipt-book': 'Open grocery runs',
  'house-pot': 'Open house pot',
  'shopping-bag': 'Open shopping list',
  noticeboard: 'Open roommates',
  'settlement-envelope': 'Open repayments',
  'cleaning-caddy': 'Open room chores',
  'supply-shelf': 'Restock room supplies',
}

export type RoomObjectsPanelProps = {
  household: Household
  roomId: RoomId
  selectedComponentId: string | null
  busy: boolean
  canEdit: boolean
  onSelect: (id: string | null) => void
  onEdit: (id: string | null) => void
  onRestock: (item: ShoppingItemInput) => void
  onShopping: () => void
  onCreateChore: (component: RoomComponent, suggestion?: ComponentChoreSuggestion) => void
  onOpenChores: (component: RoomComponent) => void
  onState: (component: RoomComponent, state: string | null) => void
  onUse: (component: RoomComponent) => void
  onHelp: () => void
}

export function RoomObjectsPanel({
  household, roomId, selectedComponentId, busy, canEdit, onSelect, onEdit, onRestock, onShopping, onCreateChore, onOpenChores, onState, onUse, onHelp,
}: RoomObjectsPanelProps) {
  const components = getRoomComponents(household).filter((component) => component.installed && component.roomId === roomId)
  const groups = groupedRoomComponents(components)
  const selected = components.find((component) => component.id === selectedComponentId)
  const selectedPositions = selected ? components.filter((component) => component.kind === selected.kind) : []
  const today = billingDate(household.billingTimeZone)
  const linkedChores = (component: RoomComponent) => household.chores.items.filter((chore) => !chore.archived && componentChoreMatches(chore, component))
  const chores = selected ? linkedChores(selected).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title)) : []
  const description = selected ? componentCatalog[selected.kind] : null
  const shortcut = selected ? shortcutLabels[selected.kind] : undefined
  const statusLabel = (component: RoomComponent) => {
    const state = componentCatalog[component.kind].states.find((state) => state.id === component.state)
    if (state) return `Manual state: ${state.name}`
    if (component.kind === 'shopping-bag') return `${household.shopping.items.length} on the shared shopping list`
    if (component.kind === 'noticeboard') return `${household.members.filter((member) => !member.inactive).length} roommates`
    const chores = linkedChores(component).filter((chore) => chore.dueDate !== null)
    const due = chores.filter((chore) => chore.dueDate! <= today).length
    return chores.length ? `${due} due / ${chores.length} scheduled chores` : ''
  }

  return <section className="room-components room-objects-panel" aria-label={`${roomCatalog[roomId].name} objects`} aria-busy={busy || undefined}>
    {selected && description ? <>
      <button type="button" className="text-button" disabled={busy} onClick={() => onSelect(null)}><ArrowLeft size={14} />All room objects</button>
      <header className="room-object-heading"><h3>{selected.name}</h3>{canEdit && <button type="button" className="text-button" disabled={busy} onClick={() => onEdit(selected.id)}><Pencil size={14} />Edit this object</button>}</header>
      {selectedPositions.length > 1 && <div className="room-position-tabs" role="group" aria-label={`${description.name} positions`}>
        {selectedPositions.map((component) => <button type="button" key={component.id} className="control-surface" disabled={busy}
          aria-pressed={component.id === selected.id} onClick={() => onSelect(component.id)}>{positionName(component)}</button>)}
      </div>}
      <dl className="room-object-appearance">
        <div><dt>Position</dt><dd>{positionName(selected)}</dd></div>
        {description.variants.length > 1 && <div><dt>Model</dt><dd>{modelName(selected)}</dd></div>}
        {selected.finish !== 'room' && <div><dt>Color</dt><dd>{finishName(selected)}</dd></div>}
      </dl>
      {shortcut && <button type="button" className="button secondary full" disabled={busy} onClick={() => onUse(selected)}>{shortcut}</button>}
      {!!description.states.length && <section className="room-object-section" aria-label={`${selected.name} manual state`}>
        <h4>Manual state</h4>
        <label className="field">Manual state<Dropdown label="Manual state" value={selected.state ?? ''} disabled={busy} onValueChange={(value) => {
          if ((value === '' || description.states.some((state) => state.id === value)) && (value || null) !== selected.state) onState(selected, value || null)
        }}>
          <option value="">Not set</option>{description.states.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}
        </Dropdown></label>
        <p className="field-hint">Set by a roommate, not detected by an appliance. Changing this does not complete a chore or record a payment.</p>
        {selected.stateChangedAt && <p className="field-hint">Last set by {household.members.find((member) => member.id === selected.stateChangedBy)?.name ?? 'a former roommate'} on {dateTitle(billingDate(household.billingTimeZone, new Date(selected.stateChangedAt)), today)}.</p>}
      </section>}
      <section className="room-object-section" aria-label={`Supplies for ${selected.name}`}>
        <h4>Supply shortcuts</h4>
        {selected.supplies.length ? <>
          <p className="field-hint">Add only what you need. These shortcuts use the shared shopping list, without tracking stock.</p>
          <SupplyShortcuts household={household} components={[selected]} busy={busy} onAdd={onRestock} />
          {selected.kind !== 'shopping-bag' && <button type="button" className="text-button" disabled={busy} onClick={onShopping}><ShoppingBasket size={14} />Open shopping list</button>}
        </> : <p className="field-hint">No supply shortcuts are configured for this object. {canEdit ? 'Add them in Edit this object when you need them.' : 'An admin can add them in Edit room.'}</p>}
      </section>
      <section className="room-object-section" aria-label={`Chores for ${selected.name}`}>
        <h4>Chores</h4>
        {chores.length ? <ul className="room-linked-chores">{chores.map((chore) => {
          const status = choreStatus(chore, today)
          const assignee = choreAssignee(chore, household.members)
          return <li key={chore.id}>
            <strong>{chore.title}</strong>
            <span className={`chore-status ${status}`}>{status === 'due' ? 'Due today' : status === 'overdue' ? 'Overdue' : status === 'completed' ? 'Completed' : 'Upcoming'}</span>
            <small>{chore.dueDate ? dateTitle(chore.dueDate, today) : 'One-off completed'}{assignee ? `; ${assignee.name}'s turn` : '; unassigned'}</small>
          </li>
        })}</ul> : <p className="field-hint">No chores are linked yet. Add one below or use a suggested routine.</p>}
        <div className="room-object-actions">
          {!!chores.length && <button type="button" className="button secondary small-button" disabled={busy} onClick={() => onOpenChores(selected)}><ListChecks size={14} />Open object chores</button>}
          <button type="button" className="button secondary small-button" disabled={busy || household.chores.items.length >= choreLimit} onClick={() => onCreateChore(selected)}><Plus size={14} />Add chore</button>
        </div>
        {!!description.chores.filter((suggestion) => !chores.some((chore) => normalizeShoppingName(chore.title) === normalizeShoppingName(suggestion.title))).length && <div className="room-chore-suggestions">
          <h5>Suggested routines</h5>
          {description.chores.filter((suggestion) => !chores.some((chore) => normalizeShoppingName(chore.title) === normalizeShoppingName(suggestion.title))).map((suggestion) =>
            <button type="button" className="text-button" key={suggestion.title} disabled={busy || household.chores.items.length >= choreLimit}
              aria-label={`Add ${suggestion.title}`} onClick={() => onCreateChore(selected, suggestion)}><Plus size={14} />{suggestion.title}</button>)}
        </div>}
        {household.chores.items.length >= choreLimit && <p className="field-hint">This home has reached its {choreLimit}-chore limit.</p>}
      </section>
    </> : <>
      {selectedComponentId && <p className="field-hint" role="status">This object is no longer in the room. Existing shopping entries and chore history are kept.</p>}
      <div className="room-object-heading room-objects-tools">
        {canEdit && <button type="button" className="button secondary small-button" disabled={busy} onClick={() => onEdit(null)}><Palette size={14} />Edit room</button>}
        <button type="button" className="icon-button control-surface" disabled={busy} onClick={onHelp} aria-label="How to play" title="How to play"><CircleHelp size={17} /></button>
      </div>
      <ul className="room-object-list" aria-label="Installed room objects">{groups.map((group) => {
        const component = group.items[0]
        const label = group.items.length > 1 ? componentCatalog[group.kind].name : component.name
        const status = group.items.length === 1 ? statusLabel(component) : ''
        return <li key={group.kind}>
        <button type="button" className="room-object-choice room-object-tile control-surface" disabled={busy} aria-description={`Placed. ${previewDescription(component)}`}
          aria-label={`Open ${label} details`} onClick={() => onSelect(component.id)}>
          <ObjectCardPreview component={component} household={household} note={group.items.map(positionName).join(', ')} />
          <span className="room-object-copy"><span className="room-object-title"><strong>{label}</strong><AvailabilityBadge status="placed" label="Placed" /></span>
            <small>{group.items.length > 1 ? `${group.items.length} positions` : positionName(component)}</small>{status && <small>{status}</small>}</span>
        </button>
      </li>})}</ul>
    </>}
  </section>
}
