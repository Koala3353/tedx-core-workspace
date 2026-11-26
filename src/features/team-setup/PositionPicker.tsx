import { useRef, useState, type FormEvent } from 'react'
import type { Position, PositionFailure, TeamPerson, TeamSetupApi } from './api'
import { positionGroups, positionLabel } from './model'

const failureText: Record<PositionFailure, string> = {
  not_deployed: "Changing positions isn't switched on yet. The database update is pending.",
  denied: "Your role can't change positions.",
  not_allowed: 'Only a full admin can give or take away leadership, head or admin positions.',
  blocked: 'They still have open work in their current committee. Move or finish that work first, then try again.',
  conflict: 'They already hold that position. Refresh and try again.',
  not_on_roster: 'This person is no longer on the roster for this term.',
  invalid: 'That position could not be used. Refresh and try again.',
  unavailable: "Couldn't reach the workspace. Check your connection and try again.",
}

/** A grouped position picker (Leadership, Heads, Core) listing every position, held or not. */
export function PositionSelect({ id, positions, value, onChange, describedBy, emptyLabel = 'No position' }: {
  id: string; positions: Position[]; value: string; onChange: (code: string) => void; describedBy?: string; emptyLabel?: string
}) {
  return <select id={id} value={value} aria-describedby={describedBy} onChange={event => onChange(event.target.value)}>
    <option value="">{emptyLabel}</option>
    {positionGroups(positions).map(group => <optgroup key={group.tier} label={group.label}>
      {group.items.map(p => <option key={p.roleCode} value={p.roleCode} disabled={!p.allowed && p.roleCode !== value}>{positionLabel(p, true)}</option>)}
    </optgroup>)}
  </select>
}

/**
 * Give, change or clear one person's position. Works for people who haven't signed in yet:
 * the position is saved now and takes effect when they first sign in.
 */
export function ChangePosition({ api, termId, person, positions, onChanged }: {
  api: TeamSetupApi; termId: string; person: TeamPerson; positions: Position[]; onChanged: (message: string) => void
}) {
  const [code, setCode] = useState(person.positionCode ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<{ key: string; id: string } | null>(null)
  const current = person.positionCode ?? ''
  const chosen = positions.find(p => p.roleCode === code)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || code === current) return
    const key = person.membershipId + ':' + code
    // The same choice keeps the same request id, so a retry after a dropped connection is safe.
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
    setBusy(true); setError('')
    const outcome = await api.setPosition(termId, person.membershipId, code || null, request.current.id)
    setBusy(false)
    if (!outcome.ok) { setError(failureText[outcome.reason]); return }
    request.current = null
    onChanged(code ? `${person.name} is now ${chosen?.roleName ?? 'in that position'}.` : `${person.name} no longer has a position.`)
  }

  const hintId = `ts-change-position-hint-${person.membershipId}`
  return <form className="ts-form" onSubmit={submit}>
    <div className="form-field">
      <label htmlFor={`ts-change-position-${person.membershipId}`}>Position</label>
      <p className="field-hint" id={hintId}>
        {person.signedIn ? 'Leadership and head positions can have more than one person.'
          : "They haven't signed in yet. You can still set their position now. It applies when they first sign in."}
      </p>
      <PositionSelect id={`ts-change-position-${person.membershipId}`} positions={positions} value={code} onChange={value => { setCode(value); setError('') }} describedBy={hintId} />
    </div>
    {chosen?.administrator ? <p className="ts-muted">This position also opens Admin for them.</p> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <div className="ts-sheet-actions">
      <button type="submit" className="button button--secondary" disabled={busy || code === current}>{busy ? 'Saving…' : code ? 'Save position' : 'Clear position'}</button>
    </div>
  </form>
}
