import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { roomStyleSchema } from '../shared/domain.ts'
import type { RoomStyle } from '../shared/domain.ts'
import { Form } from './components.tsx'
import { roomPresets } from './roomStyles.ts'
import './roomStyles.css'

export function RoomStyleForm({ current, busy, error, onSubmit, onClose }: {
  current: RoomStyle
  busy: boolean
  error: ReactNode
  onSubmit: (style: RoomStyle) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState(current)
  const [openedStyle] = useState(current)
  const id = useId()
  return <Form onSubmit={() => onSubmit(selected)}>
    <fieldset className="room-style-fieldset" disabled={busy}>
      <legend>Choose a shared look</legend>
      <div className="room-style-options">
        {roomStyleSchema.options.map((style) => {
          const preset = roomPresets[style]
          return <label className="room-style-option" key={style}>
            <input type="radio" name={`${id}-room-style`} value={style} checked={selected === style} disabled={busy}
              tabIndex={!busy && selected === style ? 0 : -1} aria-label={preset.name} aria-describedby={`${id}-${style}`}
              onChange={() => setSelected(style)} />
            <span className="room-style-heading"><strong>{preset.name}</strong>{current === style && <small>Current</small>}</span>
            <span className="room-style-swatches" aria-hidden="true">
              <span style={{ backgroundColor: preset.colors.wall }} />
              <span style={{ backgroundImage: `repeating-conic-gradient(${preset.colors.floor} 0% 25%, ${preset.colors.floorAlternate} 0% 50%)` }} />
              <span style={{ backgroundColor: preset.colors.fridgeDoor }} />
            </span>
            <span className="room-style-description" id={`${id}-${style}`}>{preset.description}</span>
          </label>
        })}
      </div>
    </fieldset>
    <p className="field-hint" role="status">Current shared look: {roomPresets[current].name}.
      {current !== openedStyle && ' The room changed while this picker was open. Review your selection before applying.'}
      {' '}Your selection is not shared until you apply it.
    </p>
    {error}
    <div className="button-row room-style-actions">
      <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="button primary" disabled={busy || selected === current}>
        {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}
        {busy ? 'Saving...' : 'Apply for everyone'}
      </button>
    </div>
  </Form>
}
