import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Archive, ArrowLeft, Check, CircleHelp, Eye, ListChecks, Palette, Pencil, Plus, RotateCcw, ShoppingBasket, Trash2, TriangleAlert, Users, X } from 'lucide-react'
import { billingDate, choreLimit } from '../shared/domain.ts'
import type { Household, ShoppingItemInput } from '../shared/domain.ts'
import { choreAssignee, choreStatus } from '../shared/chores.ts'
import {
  componentAllowedInRoom, componentCatalog, componentCategories, componentFinishes, componentKinds,
  componentChoreMatches, componentFinishSchema, componentIsRetired, componentPositionOffered, componentSupplyLimit, createRoomComponent, getRoomComponents,
  roomComponentLimit, roomComponentsPatchSchema, roomSlots, suggestedComponentSupplies, validateRoomComponents,
} from '../shared/roomComponents.ts'
import type {
  ComponentCategory, ComponentChoreSuggestion, ComponentKind, RoomComponent,
  RoomComponentsPatch, RoomSlotId,
} from '../shared/roomComponents.ts'
import { roomCatalog } from '../shared/rooms.ts'
import type { RoomId } from '../shared/rooms.ts'
import { componentSurfaces, roomZoneLabels, roomZoneUsage } from '../shared/roomZones.ts'
import type { ComponentSurface } from '../shared/roomZones.ts'
import { normalizeShoppingName } from '../shared/shopping.ts'
import { DraftConflict, Form } from './components.tsx'
import { Dropdown } from './Dropdown.tsx'
import { LoadingIcon } from './Branding.tsx'
import { SupplyShortcuts } from './Restock.tsx'
import { dateTitle } from './format.ts'
import { roomPresets } from './roomStyles.ts'
import { ComponentPreview } from './ComponentPreview.tsx'
import { ComponentInfo } from './ComponentInfo.tsx'
import { componentAvailability, componentPlacementReason, groupedRoomComponents, preferredComponentSlot } from './componentAvailability.ts'
import type { ComponentAvailability } from './componentAvailability.ts'
import { componentConfiguration as configuration, sameComponentConfiguration as sameConfiguration } from './componentConfiguration.ts'
import type { ComponentConfiguration } from './componentConfiguration.ts'
import { componentDisplayName } from './componentNames.ts'
import {
  inspectionRoomComponents, previewComponentDrafts, roomDraftPlacementReason, stageRoomComponent,
  stageRoomPlacement, storeRoomComponent, withoutComponentDraft,
} from './roomEditorDraft.ts'
import type { ComponentDraft, ComponentDrafts } from './roomEditorDraft.ts'
import { errorMessage } from './api.ts'
import { Feedback, FeedbackAction } from './Feedback.tsx'
import './roomComponents.css'

type AvailabilityFilter = 'all' | 'available' | 'placed' | 'preview'
type EditorSection = 'installed' | 'catalog' | 'storage'
type PlacementPreview = {
  id: string
  kind: ComponentKind
  component: RoomComponent
  base: RoomComponent | null
  section: EditorSection
  selectedId: string | null
  triggerLabel: string | null
  triggerText: string | null
  readOnlyReason: string | null
  identityReason: string | null
}

function AvailabilityBadge({ status, label }: Pick<ComponentAvailability, 'status' | 'label'>) {
  const Icon = status === 'available' ? Plus : status === 'placed' ? Check : status === 'preview' ? Pencil : TriangleAlert
  return <span className={`room-availability ${status}`} data-availability={status}
    role="img" aria-label={label}><Icon size={12} aria-hidden="true" /></span>
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
  return componentDisplayName(component, components, objectName(component))
}

function previewDescription(component: RoomComponent): string {
  return componentCatalog[component.kind].description
}

function ObjectCardPreview({ component, household }: { component: RoomComponent; household: Household }) {
  return <span className="room-object-picture">
    <ComponentPreview component={component} roomStyle={household.roomStyle} />
  </span>
}

function slotFor(component: Pick<RoomComponent, 'slotId'>) {
  return roomSlots.find((slot) => slot.id === component.slotId)
}

function ObjectCardInfo({ component, label = objectName(component) }: {
  component: RoomComponent
  label?: string
}) {
  const supplies = component.supplies.length
    ? component.supplies.map((supply) => `${supply.quantity} ${supply.name}`).join(', ')
    : 'No supply shortcuts.'
  return <ComponentInfo label={label} description={componentCatalog[component.kind].description} supplies={supplies} />
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
  cancelPlacementRequest?: number
  initialStorageId?: string | null
  onSelect: (id: string | null) => void
  onFocus?: () => void
  onDetailChange?: (open: boolean) => void
  onPreview: (components: readonly RoomComponent[] | null, placement?: RoomComponent | null) => void
  onSubmit: (patch: RoomComponentsPatch) => Promise<boolean>
  onBack: () => void
  onClose: () => void
  onManageAdmins: () => void
  onRoomColors: () => void
}

export function RoomEditor(props: RoomEditorProps) {
  return <RoomEditorDraft key={`${props.household.id}:${props.roomId}`} {...props} />
}

function RoomEditorDraft({ household, roomId, busy, canEdit = true, error, selectedComponentId, cancelPlacementRequest = 0, initialStorageId = null, onSelect, onFocus, onDetailChange, onPreview, onSubmit, onBack, onClose, onManageAdmins, onRoomColors }: RoomEditorProps) {
  const current = useMemo(() => getRoomComponents(household), [household.id, household.roomComponents])
  const [drafts, setDrafts] = useState<ComponentDrafts>({})
  const [placement, setPlacement] = useState<PlacementPreview | null>(null)
  const [section, setSection] = useState<EditorSection>('installed')
  const [surface, setSurface] = useState<ComponentSurface | 'all'>('all')
  const [category, setCategory] = useState<ComponentCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all')
  const [swapChoices, setSwapChoices] = useState<Record<string, RoomComponent> | null>(null)
  const [localError, setLocalError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const editorElement = useRef<HTMLElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const suppliesElement = useRef<HTMLFieldSetElement>(null)
  const catalogElement = useRef<HTMLDivElement>(null)
  const catalogSearch = useRef<HTMLInputElement>(null)
  const placeButton = useRef<HTMLButtonElement>(null)
  const discardButton = useRef<HTMLButtonElement>(null)
  const lastCancelRequest = useRef(cancelPlacementRequest)
  const previousSelection = useRef(selectedComponentId)
  const keepCatalogSelection = useRef(false)
  const handledStorage = useRef<string | null>(null)
  const locked = busy || saving || !canEdit
  const pending = Object.values(drafts)
  const inspection = !!placement?.readOnlyReason
  const currentById = useMemo(() => new Map(current.map((component) => [component.id, component])), [current])
  const preview = useMemo(() => previewComponentDrafts(current, drafts), [current, drafts])
  const conflicts = pending.filter((draft) => {
    const latest = currentById.get(draft.value.id)
    return draft.base ? !latest || latest.version !== draft.base.version : !!latest
  })
  const placementConflict = placement && (placement.base
    ? currentById.get(placement.id)?.version !== placement.base.version : currentById.has(placement.id))
    ? 'This object changed while you were previewing it. Discard this preview and review its latest settings.' : ''
  const placementIssue = placement ? componentPlacementReason(preview, roomId, placement.kind, placement.component.slotId, placement.id) : null
  const swapConflict = Object.values(swapChoices ?? {}).find((chosen) =>
    preview.find((component) => component.id === chosen.id)?.version !== chosen.version)
  const proposedPlacement = useMemo(() => {
    if (!placement) return null
    try {
      return { drafts: stageRoomPlacement(current, drafts, placement.component, Object.keys(swapChoices ?? {})), error: '' }
    } catch (cause) {
      return { drafts: null, error: errorMessage(cause, 'Review this placement before adding it to your draft.') }
    }
  }, [current, drafts, placement, swapChoices])
  const invalidLayout = validateRoomComponents(preview) ?? roomDraftPlacementReason(current, preview)
  const trialIssue = placementConflict || (swapConflict ? `${objectName(swapConflict)} changed. Choose it again to review the latest Storage tradeoff.` : '')
    || (conflicts.length ? 'The room changed. Discard this preview and review your draft before placing the object.' : '')
    || (!inspection && placementIssue ? `This position is now blocked. ${placementIssue}` : '')
    || (!inspection ? proposedPlacement?.error : '')
  const visiblePreview = useMemo(() => !placement || (!inspection && trialIssue) ? preview
    : inspectionRoomComponents(preview, placement.component, Object.keys(swapChoices ?? {})), [preview, placement, inspection, trialIssue, swapChoices])
  const roomObjects = preview.filter((component) => component.roomId === roomId)
  const installed = roomObjects.filter((component) => component.installed)
  const groups = groupedRoomComponents(preview, { roomId, installed: true })
  const stored = roomObjects.filter((component) => !component.installed && currentById.has(component.id))
  const storedGroups = groupedRoomComponents(stored)
  const selected = roomObjects.find((component) => component.id === selectedComponentId)
  const selectedPositions = selected ? roomObjects.filter((component) => component.kind === selected.kind && component.installed === selected.installed) : []
  const positionChoices = selected ? roomSlots.filter((slot) => slot.roomId === roomId && slot.kinds.includes(selected.kind)
    && ((componentAllowedInRoom(selected.kind, roomId) && componentPositionOffered(selected.kind, slot.id)) || slot.id === selected.slotId)) : []
  const zones = roomZoneUsage(preview, roomId)
  const availabilityContext = { surface: surface === 'all' ? undefined : surface, selectedComponentId }
  const matchingCatalog = componentKinds.filter((kind) =>
    componentAllowedInRoom(kind, roomId) && roomSlots.some((slot) => slot.roomId === roomId && slot.kinds.includes(kind)
      && componentPositionOffered(kind, slot.id) && (surface === 'all' || componentSurfaces[slot.id] === surface))
    && (category === 'all' || componentCatalog[kind].category === category)
    && normalizeShoppingName(`${componentCatalog[kind].name} ${componentCatalog[kind].description}`).includes(normalizeShoppingName(search)))
  const availability = new Map(matchingCatalog.map((kind) => [kind, componentAvailability(kind, roomId, preview, current, availabilityContext)]))
  const catalog = matchingCatalog.filter((kind) => availabilityFilter === 'all'
    || (availabilityFilter === 'available' ? (availability.get(kind)?.free ?? 0) > 0 : availability.get(kind)?.status === availabilityFilter))
  const availabilityFilters: { id: AvailabilityFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All objects', count: matchingCatalog.length },
    { id: 'available', label: 'Available', count: [...availability.values()].filter((item) => item.free > 0).length },
    { id: 'placed', label: 'Placed', count: [...availability.values()].filter((item) => item.status === 'placed').length },
  ]
  const previewCount = [...availability.values()].filter((item) => item.status === 'preview').length
  if (previewCount || availabilityFilter === 'preview') availabilityFilters.push({ id: 'preview', label: 'In preview', count: previewCount })

  const catalogZones = new Map<ComponentSurface | 'room', ComponentKind[]>()
  for (const kind of catalog) {
    const available = availability.get(kind)!
    const slot = surface !== 'all' ? available.position : available.instance ? slotFor(available.instance) : available.position
    const zone = surface !== 'all' ? surface : slot ? componentSurfaces[slot.id] ?? 'room' : 'room'
    catalogZones.set(zone, [...(catalogZones.get(zone) ?? []), kind])
  }
  const previewedPlacement = placement?.component ?? null
  useEffect(() => { onPreview(pending.length || placement ? visiblePreview : null, previewedPlacement) }, [onPreview, visiblePreview, pending.length, placement, previewedPlacement])
  useEffect(() => () => onPreview(null), [onPreview])
  useEffect(() => { onDetailChange?.(!placement && section !== 'catalog' && !!selected) }, [onDetailChange, placement, section, selected?.id])
  useEffect(() => () => onDetailChange?.(false), [onDetailChange])
  useEffect(() => {
    if (selectedComponentId && selectedComponentId !== previousSelection.current && !placement) {
      if (!keepCatalogSelection.current) setSection(selected?.installed === false ? 'storage' : 'installed')
    }
    keepCatalogSelection.current = false
    previousSelection.current = selectedComponentId
  }, [selectedComponentId])
  useEffect(() => {
    if (placement) (inspection ? discardButton : placeButton).current?.focus()
    else if (selectedComponentId && section !== 'catalog') nameInput.current?.focus()
  }, [selectedComponentId, section, placement?.id, inspection])
  useEffect(() => {
    if (!placement || selectedComponentId === placement.id) return
    setPlacement(null)
    setSwapChoices(null)
    setNotice('')
  }, [placement, selectedComponentId])

  const select = (id: string | null, nextSection: EditorSection = 'installed') => {
    if (placement && id !== placement.id) { setPlacement(null); setSwapChoices(null); setNotice('') }
    keepCatalogSelection.current = nextSection === 'catalog'
    onDetailChange?.(nextSection !== 'catalog' && id !== null)
    onSelect(id)
    setLocalError('')
    setSection(nextSection)
  }
  const update = (component: RoomComponent, changes: Partial<ComponentConfiguration>) => {
    if (locked) return
    setDrafts((previous) => stageRoomComponent(current, previous, { ...(previous[component.id]?.value ?? component), ...changes }))
    setLocalError('')
    setNotice('')
  }
  const beginPlacement = (component: RoomComponent, reason: string | null = null, identityReason: string | null = null, returnLabel?: string) => {
    if (locked) return
    setPlacement({
      id: component.id, kind: component.kind, component, base: currentById.get(component.id) ?? null,
      section, selectedId: selectedComponentId, triggerLabel: returnLabel ?? document.activeElement?.getAttribute('aria-label') ?? null,
      triggerText: document.activeElement?.textContent?.trim() ?? null,
      readOnlyReason: reason ?? componentPlacementReason(preview, roomId, component.kind, component.slotId, component.id),
      identityReason,
    })
    setSwapChoices(null)
    onSelect(component.id)
    setLocalError('')
    setNotice('')
  }
  const previewPlacement = (kind: ComponentKind, slotId: RoomSlotId, storedId?: string) => {
    if (locked) return
    if (!componentAllowedInRoom(kind, roomId)) {
      setLocalError(componentPlacementReason(preview, roomId, kind, slotId) ?? 'Choose an offered placement.')
      return
    }
    const owned = storedId ? stored.find((component) => component.id === storedId && component.kind === kind)
      : stored.find((component) => component.kind === kind && component.slotId === slotId) ?? stored.find((component) => component.kind === kind)
    if (storedId && !owned) { setLocalError('That stored object changed. Review Storage before bringing it back.'); return }
    const identityReason = !owned && !globalThis.crypto?.randomUUID ? 'Use HTTPS or localhost to safely add a room object. This preview is read-only.' : null
    try {
      let previewId = `preview-${roomId}-${kind}`
      let suffix = 0
      while (identityReason && preview.some((component) => component.id === previewId)) previewId = `preview-${roomId}-${kind}-${++suffix}`
      const component = owned ? { ...owned, slotId, installed: true }
        : createRoomComponent(kind, slotId, identityReason ? previewId : crypto.randomUUID())
      const reason = identityReason ?? (!owned && preview.length >= roomComponentLimit
        ? 'This home has reached its saved-object limit. Bring back an owned object, or discard an unused draft-only trial.' : null)
      beginPlacement(component, reason, identityReason)
    } catch (cause) {
      setLocalError(errorMessage(cause, 'This object could not be previewed. Your draft is unchanged.'))
    }
  }
  const bringBack = (component: RoomComponent) => {
    if (locked) return
    const available = componentAvailability(component.kind, roomId, preview, current, { storedComponentId: component.id })
    const position = preferredComponentSlot(component.kind, available.available, preview, component.id)
      ?? preferredComponentSlot(component.kind, available.positions, preview, component.id)
    if (!position) { setLocalError(available.reason ?? 'No compatible position is offered for this stored object.'); return }
    previewPlacement(component.kind, position.id, component.id)
  }
  const putInStorage = (component: RoomComponent) => {
    if (locked) return
    try {
      setDrafts(storeRoomComponent(current, drafts, component))
      select(null, currentById.has(component.id) ? 'storage' : 'installed')
      setNotice(currentById.has(component.id)
        ? `${objectName(component)} is in Storage in your private draft. Apply for everyone to pause its linked care and restock shortcuts. Dates, settings and history are kept.`
        : `${objectName(component)} was an unsaved trial and has been discarded.`)
    } catch (cause) {
      setLocalError(errorMessage(cause, 'This object could not be put in Storage.'))
    }
  }
  const focusCatalogObject = (component: RoomComponent) => {
    if (locked) return
    if (placement) { setPlacement(null); setSwapChoices(null) }
    keepCatalogSelection.current = true
    onDetailChange?.(false)
    onSelect(component.id)
    onFocus?.()
    setSection('catalog')
    setLocalError('')
    setNotice('')
  }
  const discardPlacement = () => {
    if (!placement) return
    setPlacement(null)
    setSwapChoices(null)
    keepCatalogSelection.current = placement.section === 'catalog'
    onSelect(placement.selectedId)
    setSection(placement.section)
    setLocalError('')
    setNotice(inspection ? '' : 'The placement preview was discarded. Your other draft changes are kept.')
    requestAnimationFrame(() => {
      const original = [...(editorElement.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        .find((button) => placement.triggerLabel ? button.getAttribute('aria-label') === placement.triggerLabel
          : !!placement.triggerText && button.textContent?.trim() === placement.triggerText)
      if (original && !original.disabled) original.focus()
      else if (placement.section === 'storage') {
        const target = editorElement.current?.querySelector<HTMLButtonElement>(`button[data-bring-back="${placement.id}"]:not(:disabled)`)
        if (target) target.focus()
        else (editorElement.current?.querySelector<HTMLButtonElement>('.room-editor-footer button:not(:disabled)') ?? editorElement.current)?.focus()
      }
      else if (placement.section === 'catalog') {
        const target = catalogElement.current?.querySelector<HTMLButtonElement>(`button[data-placement-kind="${placement.kind}"]`)
        if (target && !target.disabled) target.focus()
        else if (catalogSearch.current && !catalogSearch.current.disabled) catalogSearch.current.focus()
        else (editorElement.current?.querySelector<HTMLButtonElement>('.room-editor-footer button:not(:disabled)') ?? editorElement.current)?.focus()
      } else if (nameInput.current && !nameInput.current.disabled) nameInput.current.focus()
      else (editorElement.current?.querySelector<HTMLButtonElement>('.room-editor-footer button:not(:disabled)') ?? editorElement.current)?.focus()
    })
  }
  const acceptPlacement = () => {
    if (locked) return
    if (!placement) { setLocalError('Choose an object to preview before placing it.'); return }
    if (inspection && swapChoices === null) { setLocalError('This is a read-only preview. Choose and confirm a swap before placing it.'); return }
    const issue = trialIssue || placement.identityReason || proposedPlacement?.error
    if (issue) { setLocalError(issue); return }
    if (!proposedPlacement?.drafts) { setLocalError('Review this placement before adding it to the draft.'); return }
    setDrafts(proposedPlacement.drafts)
    const selectedForStorage = Object.values(swapChoices ?? {})
    const storedNames = selectedForStorage.filter((component) => currentById.has(component.id)).map(objectName)
    const discardedNames = selectedForStorage.filter((component) => !currentById.has(component.id)).map(objectName)
    setPlacement(null)
    setSwapChoices(null)
    keepCatalogSelection.current = false
    setSection('installed')
    setLocalError('')
    setNotice(`${objectName(placement.component)} is kept in your private draft.${storedNames.length ? ` In Storage: ${storedNames.join(', ')}.` : ''}${discardedNames.length ? ` Discarded unsaved trials: ${discardedNames.join(', ')}.` : ''} Apply for everyone to share it. Supplies and chores are not added automatically.`)
  }
  const useLatest = (id: string) => {
    setDrafts((previous) => withoutComponentDraft(previous, id))
    if (placement?.id === id) {
      setPlacement(null)
      setSwapChoices(null)
      onSelect(null)
      setSection('catalog')
    }
    if (selectedComponentId === id) setSection(currentById.get(id)?.installed === false ? 'storage' : 'installed')
    setLocalError('')
    setNotice('The latest object settings are now in your preview.')
  }
  const keepDraft = (draft: ComponentDraft, latest: RoomComponent) => {
    const value = changedFields(draft, latest)
    setDrafts((previous) => sameConfiguration(value, latest) ? withoutComponentDraft(previous, value.id) : {
      ...previous, [value.id]: { ...draft, base: latest, value },
    })
    setLocalError('')
    setNotice('Draft kept and roommate changes included. Review before applying.')
  }
  const discard = (leave: () => void) => { onPreview(null); leave() }

  useEffect(() => {
    if (lastCancelRequest.current === cancelPlacementRequest) return
    lastCancelRequest.current = cancelPlacementRequest
    if (placement && !busy && !saving) discardPlacement()
  }, [cancelPlacementRequest, placement, busy, saving])
  useEffect(() => {
    if (!initialStorageId || handledStorage.current === initialStorageId || locked) return
    handledStorage.current = initialStorageId
    const component = preview.find((component) => component.id === initialStorageId && component.roomId === roomId && component.installed)
    if (component) putInStorage(component)
    else setLocalError('That object changed. Review the room before putting it in Storage.')
  }, [initialStorageId, locked, current])

  if (placement) {
    const previewError = localError || trialIssue
    const swapAvailability = componentAvailability(placement.kind, roomId, preview, current, {
      movingComponentId: placement.id, surface: placement.section === 'catalog' && surface !== 'all' ? surface : undefined,
    })
    const targetSurface = componentSurfaces[placement.component.slotId]
    const swapObjects = installed.filter((component) => component.id !== placement.id && slotFor(component)?.removable
      && (component.slotId === placement.component.slotId || (targetSurface && componentSurfaces[component.slotId] === targetSurface)))
    for (const chosen of Object.values(swapChoices ?? {})) {
      if (!swapObjects.some((component) => component.id === chosen.id)) swapObjects.push(preview.find((component) => component.id === chosen.id) ?? chosen)
    }
    const requiredOccupant = installed.find((component) => component.id !== placement.id && component.slotId === placement.component.slotId && !slotFor(component)?.removable)
    return <section className="room-components room-editor" ref={editorElement} tabIndex={-1} aria-label={`Edit ${roomCatalog[roomId].name} objects`}
      aria-busy={busy || saving || undefined} data-placement-preview={placement.id} data-inspection-preview={inspection} data-pending-count={pending.length}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || busy || saving) return
        event.preventDefault()
        event.stopPropagation()
        discardPlacement()
      }}>
      {previewError && <Feedback>{previewError}</Feedback>}{error}
      {inspection && <Feedback tone="info">{placement.readOnlyReason}</Feedback>}
      {swapChoices !== null && <fieldset className="room-swap-editor" disabled={locked} aria-label="Choose objects for Storage">
        <legend>Make room for {objectName(placement.component)}</legend>
        <label className="field">Placement position<Dropdown label="Placement position" value={placement.component.slotId} disabled={locked}
          onValueChange={(value) => {
            const slot = swapAvailability.positions.find((slot) => slot.id === value)
            if (!slot) { setLocalError('Choose a compatible position for this object.'); return }
            setPlacement((previous) => previous ? { ...previous, component: { ...previous.component, slotId: slot.id } } : previous)
            setSwapChoices({})
            setLocalError('')
          }}>
          {swapAvailability.positions.map((slot) => <option key={slot.id} value={slot.id}>{slot.name}</option>)}
        </Dropdown></label>
        <p className="field-hint">Choose the objects to put in Storage. Linked care and restock shortcuts pause; names, settings, dates and history stay. An unsaved trial is discarded instead.</p>
        {requiredOccupant && <Feedback>{objectName(requiredOccupant)} is a required fixture and cannot be put in Storage.</Feedback>}
        <ul className="room-swap-choices">{swapObjects.map((component) => <li key={component.id}>
          <label><input type="checkbox" checked={!!swapChoices[component.id]} disabled={locked}
            aria-label={`${currentById.has(component.id) ? 'Put' : 'Discard'} ${choiceName(component, roomObjects)}${currentById.has(component.id) ? ' in Storage' : ' unsaved trial'}`}
            onChange={(event) => {
              const checked = event.target.checked
              setSwapChoices((previous) => {
                const next = { ...previous }
                if (checked) next[component.id] = component
                else delete next[component.id]
                return next
              })
              setLocalError('')
            }} />
            <span><strong>{choiceName(component, roomObjects)}</strong><small>{positionName(component)}. {currentById.has(component.id) ? 'Put in Storage' : 'Discard unsaved trial'}{componentIsRetired(component.kind) ? '. This retired object cannot be brought back.' : ''}</small></span>
          </label>
        </li>)}</ul>
        {!swapObjects.length && <p className="field-hint">There are no removable objects in this zone. Try another compatible position.</p>}
        {Object.keys(swapChoices).length > 0 && <p className="field-hint">Chosen: {Object.values(swapChoices).map(objectName).join(', ')}. Nothing is staged until you confirm.</p>}
        {proposedPlacement?.error && !previewError && <Feedback>{proposedPlacement.error}</Feedback>}
      </fieldset>}
      <div className="room-placement-actions" role="group" aria-label="Placement preview">
        <button type="button" className="button primary small-button" ref={placeButton}
          disabled={locked || (inspection && swapChoices === null) || !!trialIssue || !!placement.identityReason || !!proposedPlacement?.error}
          onClick={acceptPlacement}><Check size={15} />{Object.keys(swapChoices ?? {}).length ? 'Stage swap' : 'Place object'}</button>
        <button type="button" className="button secondary small-button" ref={discardButton} disabled={busy || saving} onClick={discardPlacement}><X size={15} />Discard preview</button>
      </div>
      {inspection && swapChoices === null && !placement.identityReason && swapAvailability.positions.length > 0
        && <button type="button" className="text-button room-swap-start" disabled={locked || !!placementConflict || !!conflicts.length} onClick={() => {
          setSwapChoices({})
          requestAnimationFrame(() => editorElement.current?.querySelector<HTMLButtonElement>('[role="combobox"]')?.focus())
        }}>Choose a swap or another position</button>}
    </section>
  }

  return <section className="room-components room-editor" ref={editorElement} tabIndex={-1} aria-label={`Edit ${roomCatalog[roomId].name} objects`}
    aria-busy={busy || saving || undefined} data-pending-count={pending.length} data-editor-section={section}>
    <Form onSubmit={() => {
      if (locked) return
      if (placement) { setLocalError('Place or discard the previewed object before applying your draft.'); return }
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
        if (invalid) select(invalid.id, invalid.installed ? 'installed' : 'storage')
        setLocalError(`${invalid ? `${objectName(invalid)}: ` : ''}${issue.message}`)
        return
      }
      setLocalError('')
      setSaving(true)
      void onSubmit(input.data).then((saved) => {
        if (saved) { setDrafts({}); onPreview(null); onClose() }
      }).catch((cause: unknown) => {
        setLocalError(errorMessage(cause, 'Save not confirmed. Your draft is still here.'))
      }).finally(() => setSaving(false))
    }}>
      <div className="room-editor-toolbar">
        <div className="room-editor-navigation">
          <button type="button" className="icon-button control-surface" disabled={busy || saving} onClick={() => discard(onBack)} aria-label="Back to room objects" title="Back to room objects"><ArrowLeft size={17} /></button>
          <nav className="receipt-tabs" aria-label="Room editor sections">
            <button type="button" disabled={locked} aria-pressed={section === 'installed'} onClick={() => select(null)}>In this room <span>{groups.length}</span></button>
            <button type="button" disabled={locked} aria-pressed={section === 'catalog'} onClick={() => select(selectedComponentId, 'catalog')}><Plus size={14} />Add objects</button>
            <button type="button" disabled={locked} aria-label="Storage" aria-description={`${stored.length} stored objects`}
              aria-pressed={section === 'storage'} onClick={() => select(null, 'storage')}><Archive size={14} />Storage <span aria-hidden="true">{stored.length}</span></button>
          </nav>
        </div>
        <div className="room-editor-tools">
          <button type="button" className="icon-button control-surface" disabled={locked} onClick={onRoomColors} aria-label="Room colors" title="Room colors"><Palette size={17} /></button>
          <button type="button" className="icon-button control-surface" disabled={locked} onClick={onManageAdmins} aria-label="Room admins" title="Room admins"><Users size={17} /></button>
        </div>
      </div>
      <fieldset className="room-editor-fields" disabled={locked}>
        <legend className="sr-only">Room object settings</legend>
        <nav className="room-zone-filters" aria-label="Filter object zones">
          <button type="button" className="control-surface" disabled={locked} aria-pressed={surface === 'all'}
            onClick={() => { setSurface('all'); select(selectedComponentId, 'catalog') }}>All zones</button>
          {zones.map((zone) => <button type="button" key={zone.surface} className="control-surface" disabled={locked}
            aria-label={zone.label} aria-pressed={surface === zone.surface} data-zone={zone.surface}
            onClick={() => { setSurface(zone.surface); select(selectedComponentId, 'catalog') }}>
            {zone.label}
          </button>)}
        </nav>
        {conflicts.map((draft) => {
          const latest = currentById.get(draft.value.id)
          return <div key={draft.value.id} className="room-object-conflict" aria-label={`Changed object: ${objectName(draft.value)}`}>
            {latest ? <DraftConflict onLatest={() => useLatest(draft.value.id)} onKeep={() => keepDraft(draft, latest)}>
              {objectName(draft.value)} changed while you were editing. Latest: {latest.name}, {finishName(latest)}, {latest.installed ? 'in the room' : 'in Storage'}.
              {' '}Supplies: {latest.supplies.length ? latest.supplies.map((supply) => `${supply.quantity} ${supply.name}`).join(', ') : 'none'}.
            </DraftConflict> : <Feedback className="shopping-conflict" actions={<FeedbackAction onClick={() => useLatest(draft.value.id)}>Use latest values</FeedbackAction>}>
              {objectName(draft.value)} is unavailable. Discard its draft and choose another object.
            </Feedback>}
          </div>
        })}
        {invalidLayout && <Feedback>{invalidLayout} Review before applying.</Feedback>}
        {section === 'storage' && <p className="field-hint">Stored objects keep their history. Supplies and linked chores resume when you bring them back.</p>}
        {(section === 'installed' || section === 'storage') && <>
          {selected ? <div className="room-object-settings" aria-label={`Settings for ${objectName(selected)}`}>
            <button type="button" className="text-button" disabled={locked} onClick={() => select(null, section)}><ArrowLeft size={14} />{section === 'storage' ? 'All stored objects' : 'All room objects'}</button>
            <h3>{objectName(selected)}</h3>
            {selectedPositions.length > 1 && <div className="room-position-tabs" role="group" aria-label={`${componentCatalog[selected.kind].name} objects`}>
              {selectedPositions.map((component) => <button type="button" key={component.id} className="control-surface" disabled={locked}
                aria-pressed={component.id === selected.id} onClick={() => select(component.id, section)}>{choiceName(component, selectedPositions)}</button>)}
            </div>}
            {selected.installed && positionChoices.length > 1 ? <label className="field">Move object<Dropdown label="Move object" value={selected.slotId} disabled={locked}
              onValueChange={(value) => {
                const destination = positionChoices.find((slot) => slot.id === value)
                if (!destination) { setLocalError('Choose a compatible position for this object.'); return }
                if (destination.id === selected.slotId) return
                const reason = componentPlacementReason(preview, roomId, selected.kind, destination.id, selected.id)
                if (reason) { beginPlacement({ ...selected, slotId: destination.id }, reason, null, 'Move object'); return }
                update(selected, { slotId: destination.id })
              }}>
              {positionChoices.map((slot) => {
                const reason = slot.id === selected.slotId ? null : componentPlacementReason(preview, roomId, selected.kind, slot.id, selected.id)
                return <option key={slot.id} value={slot.id}>
                  {slot.name}{slot.id === selected.slotId ? ' (current)' : reason ? ' (make room first)' : ''}
                </option>
              })}
            </Dropdown></label> : null}
            {componentIsRetired(selected.kind)
              ? <p className="field-hint">This object is no longer offered in Add objects. Its current placement, settings and history are kept. It cannot be moved or brought back from Storage. You can still edit it{selected.installed ? ' or put it in Storage' : ''}.</p>
              : !componentAllowedInRoom(selected.kind, roomId) && <p className="field-hint">This saved object can stay here. New placements belong in {componentCatalog[selected.kind].placementRooms?.map((id) => roomCatalog[id].name).join(' or ')}.</p>}
            {selected.kind === 'spice-rack' && !componentPositionOffered(selected.kind, selected.slotId)
              && <p className="field-hint">This saved position can stay. New spice racks and moves use the wall positions.</p>}
            {selected.installed && componentAllowedInRoom(selected.kind, roomId) && positionChoices.some((slot) => slot.id !== selected.slotId)
              && <button type="button" className="text-button" disabled={locked} onClick={() => {
                const available = componentAvailability(selected.kind, roomId, preview, current)
                const destination = preferredComponentSlot(selected.kind, available.available, preview)
                  ?? preferredComponentSlot(selected.kind, available.positions.filter((slot) => slot.id !== selected.slotId), preview)
                if (!destination) { setLocalError('There are no offered positions for another object.'); return }
                previewPlacement(selected.kind, destination.id)
              }}><Plus size={14} />Add another</button>}
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
            {selected.installed ? slotFor(selected)?.removable
              ? <button type="button" className="text-button room-store-object" disabled={locked} onClick={() => putInStorage(selected)}>
                {currentById.has(selected.id) ? <Archive size={14} /> : <X size={14} />}{currentById.has(selected.id) ? 'Put in storage' : 'Discard trial object'}
              </button>
              : <p className="field-hint">This fitted object stays in the room. Its name, finish and supply shortcuts can still be changed.</p>
              : <div className="room-storage-note">
                <p>{currentById.get(selected.id)?.installed ? 'In Storage in your private draft. Apply for everyone to share this change.' : 'In Storage. Restock shortcuts and linked care are paused.'} Dates, names, settings and history are kept.</p>
                {componentAllowedInRoom(selected.kind, roomId)
                  ? <button type="button" className="button secondary small-button" disabled={locked}
                    data-bring-back={selected.id} aria-label={`Bring back ${choiceName(selected, stored)}`} onClick={() => bringBack(selected)}><RotateCcw size={14} />Bring back</button>
                  : <p className="field-hint">{componentPlacementReason(preview, roomId, selected.kind, selected.slotId, selected.id)}</p>}
              </div>}
          </div> : null}
          {!selected && section === 'installed' && <ul className="room-object-list" aria-label="Objects in your room preview">
            {groups.map((group) => {
              const component = group.items[0]
              const label = group.items.length > 1 ? componentCatalog[group.kind].name : objectName(component)
              const isPreview = group.items.some((item) => !currentById.get(item.id)?.installed)
              return <li key={group.kind} className="room-object-card">
              <button type="button" className="room-object-choice room-object-tile control-surface" disabled={locked} aria-pressed={component.id === selectedComponentId}
                aria-description={`${isPreview ? 'In preview' : 'Placed'}. ${previewDescription(component)}`}
                aria-label={`Edit ${label}`} onClick={() => select(component.id)}>
                <ObjectCardPreview component={component} household={household} />
                <span className="room-object-copy"><span className="room-object-title"><strong>{label}</strong>
                  <AvailabilityBadge status={isPreview ? 'preview' : 'placed'} label={isPreview ? 'In preview' : 'Placed'} /></span>
                  {group.items.length > 1 && <small>{group.items.length} objects</small>}
                  {group.items.some((item) => drafts[item.id]) && <span className="room-object-tag">Edited</span>}
                </span>
              </button>
              <ObjectCardInfo component={component} label={label} />
            </li>})}
          </ul>}
          {!selected && section === 'storage' && <>
            {!stored.length && <Feedback tone="info">Storage is empty. Put a removable object in storage to keep it for later.</Feedback>}
            {storedGroups.map((group) => <section className="room-storage-group" key={group.kind} aria-label={`${componentCatalog[group.kind].name} in Storage`}>
              <h3>{componentCatalog[group.kind].name} <small>({group.items.length})</small></h3>
              <ul className="room-object-list">{group.items.map((component) => {
                const label = choiceName(component, group.items)
                const offered = componentAllowedInRoom(component.kind, roomId)
                const reason = offered ? componentAvailability(component.kind, roomId, preview, current, { storedComponentId: component.id }).reason
                  : componentPlacementReason(preview, roomId, component.kind, component.slotId, component.id)
                return <li key={component.id} className="room-object-card room-storage-card" data-stored-component={component.id}>
                  <button type="button" className="room-object-choice room-object-tile control-surface" disabled={locked}
                    aria-label={`Edit stored ${label}`} onClick={() => select(component.id, 'storage')}>
                    <ObjectCardPreview component={component} household={household} />
                    <span className="room-object-copy"><strong>{label}</strong><small>{modelName(component)}; {finishName(component)}</small>
                      <small>{currentById.get(component.id)?.installed ? 'In Storage in this draft' : 'In Storage'}</small></span>
                  </button>
                  <ObjectCardInfo component={component} label={label} />
                  {offered ? <button type="button" className="button secondary small-button" disabled={locked}
                    data-bring-back={component.id} aria-label={`Bring back ${label}`} onClick={() => bringBack(component)}><RotateCcw size={14} />Bring back</button>
                    : <p className="field-hint">{reason}</p>}
                </li>
              })}</ul>
            </section>)}
          </>}
          {section === 'installed' && pending.some((draft) => !draft.value.installed) && <div className="room-storage-note">
            <h3>In Storage in this draft</h3>
            <p>{pending.filter((draft) => !draft.value.installed).map((draft) => choiceName(draft.value, roomObjects)).join(', ')}. Linked care and restock shortcuts will pause; dates and history stay.</p>
            <button type="button" className="text-button" disabled={locked} onClick={() => select(null, 'storage')}>Open Storage</button>
          </div>}
        </>}
        {section === 'catalog' && <div className="room-catalog" ref={catalogElement}>
          <div className="room-catalog-filters"><label className="field">Find an object<input ref={catalogSearch} type="search" maxLength={80} value={search} disabled={locked} onChange={(event) => setSearch(event.target.value)} /></label>
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
          {!catalog.length && <Feedback tone="info">No matching objects. Try another name or filter.</Feedback>}
          {[...catalogZones].map(([zone, kinds]) => <section className="room-catalog-zone" key={zone}
            aria-label={`${zone === 'room' ? 'Room essentials' : roomZoneLabels[zone]} objects`}>
            <h3>{zone === 'room' ? 'Room essentials' : roomZoneLabels[zone]}</h3>
            <div className="room-catalog-grid">{kinds.map((kind) => {
            const definition = componentCatalog[kind]
            const status = availability.get(kind)!
            const focusTarget = status.stored ? undefined : status.instance
            const position = status.position
            const previewSlot = focusTarget ? slotFor(focusTarget) : position
            if (!previewSlot) throw new Error(`The ${definition.name} has no registered preview position.`)
            const previewObject = focusTarget ?? (status.stored ? { ...status.stored, slotId: previewSlot.id }
              : createRoomComponent(kind, previewSlot.id, `preview-${roomId}-${kind}`))
            const inspectionReason = focusTarget ? null : !status.stored && !globalThis.crypto?.randomUUID
              ? 'Use HTTPS or localhost to safely add a room object. This preview is read-only.' : status.reason
            const placementNote = focusTarget ? `${definition.name} is already placed at ${positionName(focusTarget)}. Preview focuses that object without leaving Add objects.`
              : inspectionReason ?? `${definition.name} can be previewed at ${previewSlot.name}.`
            const previewAction = () => {
              if (focusTarget) focusCatalogObject(focusTarget)
              else if (position) previewPlacement(kind, position.id, status.stored?.id)
            }
            const previewLabel = `Preview ${definition.name}`
            return <article className="room-catalog-card" key={kind} aria-label={definition.name} data-availability={status.status} data-free-positions={status.free}>
              <button type="button" className="room-catalog-preview" data-placement-kind={kind} disabled={locked}
                aria-description={`${status.label}. ${placementNote}`}
                aria-label={`${previewLabel} in the room`} onClick={previewAction}>
                <ObjectCardPreview component={previewObject} household={household} />
              </button>
              <ObjectCardInfo component={previewObject} label={definition.name} />
              <div className="room-catalog-card-content"><div className="room-catalog-card-title"><h3>{definition.name}</h3>
                <AvailabilityBadge {...status} /></div>
              <button type="button" className="button secondary small-button" data-placement-kind={kind} disabled={locked}
                aria-description={`${status.label}. ${placementNote}`}
                aria-label={previewLabel} onClick={previewAction}>
                <Eye size={14} />Preview
              </button>
              </div>
            </article>
          })}</div></section>)}
        </div>}
      </fieldset>
      {notice && <Feedback tone="info" className="room-editor-notice">{notice}</Feedback>}
      {localError && <Feedback>{localError}</Feedback>}{error}
      <div className="room-editor-footer">
        <p className="field-hint" role="status">{pending.length ? `${pending.length} ${pending.length === 1 ? 'object has' : 'objects have'} unapplied changes.` : 'No unapplied changes.'}</p>
        <div className="button-row room-editor-actions">
          <button type="button" className="button secondary" disabled={busy || saving} onClick={() => discard(onClose)}>Cancel</button>
          <button className="button primary" disabled={locked || !!placement || !pending.length || !!conflicts.length || !!invalidLayout}>
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
  onStore: (id: string) => void
  onRestock: (item: ShoppingItemInput) => void
  onShopping: () => void
  onCreateChore: (component: RoomComponent, suggestion?: ComponentChoreSuggestion) => void
  onOpenChores: (component: RoomComponent) => void
  onState: (component: RoomComponent, state: string | null) => void
  onUse: (component: RoomComponent) => void
  onHelp: () => void
}

export function RoomObjectsPanel({
  household, roomId, selectedComponentId, busy, canEdit, onSelect, onEdit, onStore, onRestock, onShopping, onCreateChore, onOpenChores, onState, onUse, onHelp,
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
      <header className="room-object-heading"><h3>{selected.name}</h3>{canEdit && <div className="room-object-actions">
        <button type="button" className="text-button" disabled={busy} onClick={() => onEdit(selected.id)}><Pencil size={14} />Edit this object</button>
        {slotFor(selected)?.removable && <button type="button" className="text-button room-store-object" disabled={busy}
          onClick={() => onStore(selected.id)}><Archive size={14} />Put in storage</button>}
      </div>}</header>
      {selectedPositions.length > 1 && <div className="room-position-tabs" role="group" aria-label={`${description.name} objects`}>
        {selectedPositions.map((component) => <button type="button" key={component.id} className="control-surface" disabled={busy}
          aria-pressed={component.id === selected.id} onClick={() => onSelect(component.id)}>{choiceName(component, selectedPositions)}</button>)}
      </div>}
      {(description.variants.length > 1 || selected.finish !== 'room') && <dl className="room-object-appearance">
        {description.variants.length > 1 && <div><dt>Model</dt><dd>{modelName(selected)}</dd></div>}
        {selected.finish !== 'room' && <div><dt>Color</dt><dd>{finishName(selected)}</dd></div>}
      </dl>}
      {shortcut && <button type="button" className="button secondary full" disabled={busy} onClick={() => onUse(selected)}>{shortcut}</button>}
      {!!description.states.length && <section className="room-object-section" aria-label={`${selected.name} manual state`}>
        <h4>Manual state</h4>
        <label className="field">Manual state<Dropdown label="Manual state" value={selected.state ?? ''} disabled={busy} onValueChange={(value) => {
          if ((value === '' || description.states.some((state) => state.id === value)) && (value || null) !== selected.state) onState(selected, value || null)
        }}>
          <option value="">Not set</option>{description.states.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}
        </Dropdown></label>
        <p className="field-hint">Manual status only. No appliance control, chore completion or payment.</p>
        {selected.stateChangedAt && <p className="field-hint">Last set by {household.members.find((member) => member.id === selected.stateChangedBy)?.name ?? 'a former roommate'} on {dateTitle(billingDate(household.billingTimeZone, new Date(selected.stateChangedAt)), today)}.</p>}
      </section>}
      <section className="room-object-section" aria-label={`Supplies for ${selected.name}`}>
        <h4>Supply shortcuts</h4>
        {selected.supplies.length ? <>
          <p className="field-hint">Shared shopping shortcuts, not stock tracking.</p>
          <SupplyShortcuts household={household} components={[selected]} busy={busy} onAdd={onRestock} />
          {selected.kind !== 'shopping-bag' && <button type="button" className="text-button" disabled={busy} onClick={onShopping}><ShoppingBasket size={14} />Open shopping list</button>}
        </> : <p className="field-hint">No supplies set. {canEdit ? 'Add them in Edit this object.' : 'An admin can add them.'}</p>}
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
        })}</ul> : <p className="field-hint">No chores yet. Add one or choose a routine.</p>}
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
      {selectedComponentId && <Feedback tone="info">This object is in Storage or unavailable. Shopping entries and chore history are kept.</Feedback>}
      <div className="room-object-heading room-objects-tools">
        <button type="button" className="icon-button control-surface room-objects-help" disabled={busy} onClick={onHelp} aria-label="How to play" title="How to play"><CircleHelp size={17} /></button>
        {canEdit && <button type="button" className="button secondary small-button" disabled={busy} onClick={() => onEdit(null)}><Pencil size={14} />Edit room</button>}
      </div>
      <ul className="room-object-list" aria-label="Installed room objects">{groups.map((group) => {
        const component = group.items[0]
        const label = group.items.length > 1 ? componentCatalog[group.kind].name : component.name
        const status = group.items.length === 1 ? statusLabel(component) : ''
        return <li key={group.kind} className="room-object-card">
        <button type="button" className="room-object-choice room-object-tile control-surface" disabled={busy} aria-description={`Placed. ${previewDescription(component)}`}
          aria-label={`Open ${label} details`} onClick={() => onSelect(component.id)}>
          <ObjectCardPreview component={component} household={household} />
          <span className="room-object-copy"><span className="room-object-title"><strong>{label}</strong><AvailabilityBadge status="placed" label="Placed" /></span>
            {group.items.length > 1 && <small>{group.items.length} objects</small>}{status && <small>{status}</small>}</span>
        </button>
        <ObjectCardInfo component={component} label={label} />
      </li>})}</ul>
    </>}
  </section>
}
