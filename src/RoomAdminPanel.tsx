import { useEffect, useId, useRef, useState } from 'react'
import type { DelegatedRoomRole, RoomAccess } from '../shared/roomAccess.ts'
import './access.css'

const roleLabels = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export function RoomAdminPanel({ access, busy, onChange }: {
  access: RoomAccess
  busy: boolean
  onChange: (memberId: string, role: DelegatedRoomRole) => void
}) {
  const [confirmation, setConfirmation] = useState<{ memberId: string; name: string; role: DelegatedRoomRole } | null>(null)
  const headingId = useId()
  const confirmationId = useId()
  const descriptionId = useId()
  const section = useRef<HTMLElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const canManage = access.role !== 'member'

  useEffect(() => { setConfirmation(null) }, [access.householdId, access.memberId, access.version, access.role])
  useEffect(() => {
    if (busy) return
    if (confirmation) cancel.current?.focus()
    else if (returnFocus.current) {
      if (returnFocus.current.isConnected) returnFocus.current.focus({ preventScroll: true })
      else section.current?.focus({ preventScroll: true })
      returnFocus.current = null
    }
  }, [confirmation, busy])

  return <section className="access-section" aria-labelledby={headingId} aria-busy={busy || undefined} ref={section} tabIndex={-1}>
    <h3 id={headingId}>Room admins</h3>
    <p className="field-hint">Owners and admins can add, remove and configure room components, and grant or remove admin rights. Everyone can use the shared shopping list, chores and daily room controls. Invitations, member removal and ownership transfers stay with the owner.</p>
    <ul className="device-list">{access.members.map((member) => <li className="device-row" key={member.memberId}>
      <div><strong>{member.name}{member.memberId === access.memberId ? ' (you)' : ''}</strong>
        <small>{member.active ? roleLabels[member.role] : 'Former roommate'}</small></div>
      {canManage && member.active && member.role !== 'owner' && <button
        type="button" className="text-button" disabled={busy || confirmation !== null}
        aria-label={member.role === 'admin' ? `Remove admin rights from ${member.name}` : `Make ${member.name} an admin`}
        onClick={(event) => {
          returnFocus.current = event.currentTarget
          setConfirmation({ memberId: member.memberId, name: member.name, role: member.role === 'admin' ? 'member' : 'admin' })
        }}
      >{member.role === 'admin' ? 'Remove admin rights' : 'Make admin'}</button>}
    </li>)}</ul>
    {!canManage && <p className="field-hint">Ask the owner or an admin if you need room editing access.</p>}
    {confirmation && <div className="access-section" role="group" aria-labelledby={confirmationId} aria-describedby={descriptionId}>
      <h4 id={confirmationId}>{confirmation.role === 'admin' ? `Make ${confirmation.name} an admin?` : `Remove admin rights from ${confirmation.name}?`}</h4>
      <p className="field-hint" id={descriptionId}>{confirmation.role === 'admin'
        ? `${confirmation.name} will be able to change room components and grant or revoke other admins. They will not gain the owner's invitation, removal or ownership powers.`
        : `${confirmation.name} will keep shared shopping, chores, ledger and daily room access, but will no longer be able to configure room components or manage admins.`}</p>
      <div className="button-row">
        <button type="button" className="text-button" ref={cancel} disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button>
        <button type="button" className="button" disabled={busy} onClick={() => {
          onChange(confirmation.memberId, confirmation.role)
          setConfirmation(null)
        }}>{confirmation.role === 'admin' ? 'Confirm admin access' : 'Confirm removal of admin rights'}</button>
      </div>
    </div>}
  </section>
}
