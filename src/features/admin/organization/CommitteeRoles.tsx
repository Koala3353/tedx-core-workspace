import { formatDateTime } from '../../shared/dates'
import { useState, type FormEvent } from 'react'
import { Panel } from '../../../components/Page'
import { PendingButton } from '../../../components/PendingButton'
import { toast } from '../../../components/Toast'
import { useRevealOnMount } from '../../../components/useReveal'
import { TextField } from '../../../components/TextField'
import { useFinDecision } from '../../finance/DecisionMemory'
import { EmptyResults, GroupedList, ListToolbar, PersonPicker, SearchSelect, useListFilter } from '../../../components/list'
import { memberOptions } from './OrganizationLists'
import type { OrganizationApi, OrganizationData } from './api'
import type { Position, Seat, SeatChange } from './positions'

type Selection = { seat: Seat | null; remove: boolean }
const manilaInput = (date: string) => new Date(Date.parse(date) + 8 * 3_600_000).toISOString().slice(0, 16)
const manilaDisplay = { format: (date: Date) => formatDateTime(date) }
const roleLabel = (role: Position) => role.name + (role.administrator ? ' · Admin access' : '') + (!role.available ? ' · Archived' : '')

export function CommitteeRoles({ api, data, term, identity, refresh }: {
  api: OrganizationApi; data: OrganizationData; term: string; identity: string; refresh: () => void
}) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const roster = data.positionRoster
  const positions = roster?.positions ?? []
  const roleOf = (seat: Seat) => positions.find(position => position.id === seat.roleId)
  const unitOf = (role?: Position) => data.units.find(unit => unit.id === role?.unitId)
  const memberOf = (seat: Seat) => data.members.find(person => person.id === seat.membershipId)
  const list = useListFilter(roster?.seats ?? [], {
    storageKey: 'admin-roles',
    text: seat => [memberOf(seat)?.name, memberOf(seat)?.email, roleOf(seat)?.name, unitOf(roleOf(seat))?.name, unitOf(roleOf(seat))?.code],
    filters: [
      { key: 'committee', label: 'Committee', get: seat => unitOf(roleOf(seat))?.code ?? (roleOf(seat) ? 'Leadership' : null), first: ['Leadership'] },
      { key: 'tier', label: 'Level', get: seat => roleOf(seat)?.tier, options: [{ value: 'leadership', label: 'Leadership' }, { value: 'head', label: 'Head' }, { value: 'core', label: 'Core' }] },
      { key: 'admin', label: 'Access', get: seat => roleOf(seat)?.administrator ? 'admin' : 'regular', options: [{ value: 'admin', label: 'Admin access' }, { value: 'regular', label: 'Regular' }] },
      { key: 'state', label: 'State', get: seat => seat.state },
    ],
  })
  if (!api.saveSeat || roster === undefined) return null
  if (!roster) return <Panel title="Committee roles"><p role="status">Couldn't load roles. Refresh the page to try again.</p></Panel>
  if (!roster.positions.length) return null

  const canEdit = data.canPublish && !selection
  const save = api.saveSeat
  // The editor opens where it was asked for: under the row being changed, or under "Assign a role".
  const editorFor = (seatId: string | null) => selection && data.canPublish && (selection.seat?.id ?? null) === seatId
    ? <RoleEditor key={(selection.seat?.id ?? 'new') + (selection.remove ? ':remove' : '')} save={save}
      data={data} positions={positions} selection={selection} term={term} identity={identity} initialRole=""
      close={() => setSelection(null)} saved={() => { setSelection(null); refresh() }} />
    : null
  const hasMembers = data.members.some(member => member.state === 'active' && ['active', 'invited'].includes(member.accountState))
  const tierRank = { leadership: 0, head: 1, core: 2 }
  const sorted = list.results
    .filter(seat => memberOf(seat) && roleOf(seat))
    .sort((a, b) => tierRank[roleOf(a)!.tier] - tierRank[roleOf(b)!.tier] || memberOf(a)!.name.localeCompare(memberOf(b)!.name))
  const row = (seat: Seat) => {
    const member = memberOf(seat)!
    const role = roleOf(seat)!
    return <li key={seat.id} className={'organization-row' + (selection?.seat?.id === seat.id ? ' is-editing' : '')}>
      <div className="organization-row__main">
        <h3 className="organization-row__title">{member.name}</h3>
        <p className="organization-row__meta">{role.name}{role.administrator ? <span className="organization-tag">Admin access</span> : null}{seat.state !== 'active' ? <span className="organization-tag">{seat.state}</span> : null}</p>
        <p className="organization-row__sub">{manilaDisplay.format(new Date(seat.from))} to {manilaDisplay.format(new Date(seat.to))}</p>
      </div>
      {seat.managed ? <div className="organization-row__actions">
        <button className="button button--secondary" disabled={!canEdit} aria-label={'Edit role for ' + member.name} onClick={() => setSelection({ seat, remove: false })}>Edit</button>
        <button className="button button--quiet" disabled={!canEdit} aria-label={'Remove role from ' + member.name} onClick={() => setSelection({ seat, remove: true })}>Remove</button>
      </div> : <p className="organization-row__sub">Another admin has to change this admin's role.</p>}
      {editorFor(seat.id)}
    </li>
  }

  return <Panel title="Committee and leadership roles">
    <p>Assign people from the approved roster. Heads manage their own committee. VP HRTD, PMs and WebDev Heads also receive workspace administration.</p>
    <div className="auth-actions">
      <button className="button" disabled={!canEdit || !hasMembers} onClick={() => setSelection({ seat: null, remove: false })}>Assign a role</button>
    </div>
    {!hasMembers && <p>Add the person to the roster below first, then give them a role.</p>}
    {editorFor(null)}
    <ListToolbar filter={list} label="Search roles" placeholder="Search name, role or committee" noun={['assignment', 'assignments']} />
    {!sorted.length ? list.active ? <EmptyResults query={list.query} noun="assignments" onClear={list.clear} /> : <p>No one has a role yet.</p>
      : <GroupedList items={sorted} renderItem={row} forceOpen={list.active} storageKey="admin-roles"
        groupOf={seat => { const unit = unitOf(roleOf(seat)); return unit ? { key: unit.id, label: unit.name } : { key: 'leadership', label: 'Leadership', order: -1 } }} />}
  </Panel>
}

function RoleEditor({ save, data, positions, selection, term, identity, initialRole, close, saved }: {
  save: NonNullable<OrganizationApi['saveSeat']>; data: OrganizationData; positions: Position[]; selection: Selection
  term: string; identity: string; initialRole: string; close: () => void; saved: () => void
}) {
  const { seat, remove } = selection
  const [reviewed, setReviewed] = useState(false)
  const root = useRevealOnMount<HTMLFormElement>()
  const command = useFinDecision<SeatChange, { id: string; version: number }>(
    { run: save }, term + ':seat:' + (seat?.id ?? 'new') + ':' + (remove ? 'remove' : 'edit'),
    { member: seat?.membershipId ?? '', role: seat?.roleId ?? initialRole, from: seat ? manilaInput(seat.from) : '',
      to: seat ? manilaInput(seat.to) : '', reason: '' },
  )
  const f = command.fields
  const unitName = (position: Position) => data.units.find(unit => unit.id === position.unitId)?.name
  const members = data.members.filter(member => member.id === seat?.membershipId
    || member.state === 'active' && ['active', 'invited'].includes(member.accountState))
  const member = members.find(person => person.id === f.member)
  const role = positions.find(position => position.id === f.role)
  const instant = (value: string, original?: string) => original && value === manilaInput(original) ? original : value + ':00+08:00'
  const from = instant(f.from, seat?.from)
  const to = instant(f.to, seat?.to)
  const canSave = remove || (member && role?.available && (!role.administrator || member.memberId !== identity)
    && Date.parse(from) < Date.parse(to))

  function change(fields: Record<string, string>) {
    command.change({ ...f, ...fields })
    setReviewed(false)
  }

  function chooseMember(id: string) {
    const next = members.find(person => person.id === id)
    const start = next ? new Date(Math.max(Math.ceil(Date.now() / 60_000) * 60_000, Date.parse(next.joinedAt))) : null
    change({ member: id, from: start ? manilaInput(start.toISOString()) : '', to: next ? manilaInput(next.endsAt) : '' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (command.pending) {
      if (await command.run()) { toast(remove ? 'Role removed' : 'Assignment saved'); saved() }
      return
    }
    if (!reviewed || !canSave || !f.reason.trim()) return
    if (await command.run({ term, seat, membershipId: f.member, roleId: f.role, from, to, reason: f.reason.trim(), remove })) { toast(remove ? 'Role removed' : 'Assignment saved'); saved() }
  }

  return <form ref={root} className="organization-editor organization-inline-editor reveal-enter" onSubmit={event => void submit(event)}>
    <h3>{remove ? 'Remove assignment' : seat ? 'Edit assignment' : 'Assign a committee or leadership role'}</h3>
    <fieldset disabled={command.locked} className="organization-editor">
      {remove ? <p>Remove {role?.name} from {member?.name}. Their other roles stay in place.</p> : <>
        <div className="form-field"><label htmlFor="seat-member">Member</label>
          <PersonPicker id="seat-member" required value={f.member} disabled={!!seat} onChange={chooseMember} options={memberOptions(data, members)} /></div>
        <div className="form-field"><label htmlFor="seat-role">Role</label>
          <SearchSelect id="seat-role" required value={f.role} onChange={role => change({ role })} placeholder="Type a role or committee"
            options={[...positions].sort((a, b) => Number(a.unitId !== null) - Number(b.unitId !== null) || (unitName(a) ?? '').localeCompare(unitName(b) ?? '')).map(position => ({
              value: position.id, label: roleLabel(position), group: unitName(position) ?? 'Leadership', keywords: data.units.find(u => u.id === position.unitId)?.code,
              disabled: !position.available || position.administrator && member?.memberId === identity,
            }))} /></div>
        <TextField id="seat-from" label="Starts · Manila time" type="datetime-local" required value={f.from} onChange={event => change({ from: event.target.value })} />
        <TextField id="seat-to" label="Ends · Manila time" type="datetime-local" required value={f.to} onChange={event => change({ to: event.target.value })} />
        {role?.administrator && <p>This role grants access to workspace Administration and role assignment.</p>}
      </>}
      <TextField id="seat-reason" label="Why are you changing this?" required maxLength={1000} value={f.reason} onChange={event => change({ reason: event.target.value })} />
      <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed this assignment change.</label>
    </fieldset>
    {command.error && <p role="alert">{command.error}</p>}
    <div className="auth-actions">
      <PendingButton className="button" type="submit" pending={command.busy} pendingLabel={remove ? 'Removing…' : 'Saving…'} disabled={!command.pending && (!reviewed || !canSave || !f.reason.trim())}>
        {command.pending ? 'Try again' : remove ? 'Remove assignment' : 'Save assignment'}
      </PendingButton>
      <button className="button button--secondary" type="button" disabled={command.locked} onClick={close}>Cancel</button>
    </div>
  </form>
}
