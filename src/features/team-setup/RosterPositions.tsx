import { useState } from 'react'
import {PersonPicker, personOptions} from '../../components/list'
import { Link } from 'react-router'
import { Panel } from '../../components/Page'
import { ChangePosition } from './PositionPicker'
import { useRosterManager, useTeamSetup, useTeamSetupApi } from './TeamSetupPage'
import type { TeamSetupApi } from './api'
import './team-setup.css'

/**
 * "Positions" panel for Admin > Roles & access: pick anyone on the roster, including people who
 * haven't signed in yet, and give or change their position. Hidden for people who can't manage
 * the roster and before the database update is applied.
 */
export function RosterPositionsPanel({ api: apiProp }: { api?: TeamSetupApi }) {
  const manager = useRosterManager()
  const api = useTeamSetupApi(apiProp)
  const { load, refresh } = useTeamSetup(manager ? api : undefined, manager?.termId)
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  if (!manager || !api || load.state === 'failed') return null
  if (load.state === 'loading') return <Panel title="Positions"><p className="ts-muted" role="status">Loading the roster…</p></Panel>
  const { people, openPositions } = load.data
  const person = people.find(p => p.membershipId === selected) ?? null
  return <Panel title="Positions">
    <p className="ts-muted">Pick anyone on the roster, even if they haven't signed in yet. People don't need a position to sign in. A position only sets their role on the roster.</p>
    <div className="ts-form">
      <div className="form-field">
        <label htmlFor="access-position-person">Person</label>
        <PersonPicker id="access-position-person" value={selected} onChange={value => { setSelected(value); setNotice('') }}
          options={personOptions(people.map(p => ({ id: p.membershipId, name: p.name, committee: p.committee, position: p.position, email: p.email, extra: p.signedIn ? null : 'not signed in yet' })))} />
      </div>
      {person ? <ChangePosition key={person.membershipId + (person.positionCode ?? '')} api={api} termId={manager.termId} person={person}
        positions={openPositions} onChanged={message => { setNotice(message); refresh() }} /> : null}
    </div>
    {notice ? <p className="ts-notice" role="status">{notice}</p> : null}
    <p className="ts-muted">To add someone new, use <Link to="/team/setup">Team setup</Link>.</p>
  </Panel>
}
