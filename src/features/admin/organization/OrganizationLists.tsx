import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Panel } from '../../../components/Page'
import { EmptyResults, GroupedList, ListToolbar, useListFilter, type ListGroup, type SearchOption } from '../../../components/list'
import { formatDateTime, formatRange } from '../../shared/dates'
import type { Action, Deployment, OrganizationData, RosterMember, WorkOption } from './api'
import { BulkBar, BulkEditor, type BulkChange, type BulkContext } from './BulkPlacements'

type Open = (action: Action, id: string | null) => ReactNode
type Editing = (action: Action[], id: string) => string
type Select = (selection: { action: Action; id: string | null }) => void
type ViewProps = { v: OrganizationData; open: Open; editing: Editing; select: Select }

const live = (from: string, to: string) => Date.parse(from) <= Date.now() && Date.parse(to) > Date.now()
const LEADERSHIP: ListGroup = { key: 'leadership', label: 'Leadership', order: -1 }
const NO_COMMITTEE: ListGroup = { key: 'none', label: 'No committee', order: 1 }

export type PersonFacts = { committees: { id: string; name: string; code: string }[]; positions: string[]; head: boolean; group: ListGroup }

/**
 * Who sits where, worked out from data the page already has: current placements give the committee,
 * role seats give the position. Someone with a leadership seat and no committee groups under Leadership.
 */
export function directory(v: OrganizationData): Map<string, PersonFacts> {
  const facts = new Map<string, PersonFacts>()
  const positions = new Map(v.positionRoster?.positions.map(p => [p.id, p]) ?? [])
  for (const m of v.members) {
    const placements = v.deployments.filter(d => d.memberId === m.id && d.state === 'active' && live(d.from, d.to))
      .sort((a, b) => Number(b.type === 'head') - Number(a.type === 'head'))
    const committees = [...new Map(placements.map(d => v.units.find(u => u.id === d.unitId)).filter(u => !!u).map(u => [u!.id, { id: u!.id, name: u!.name, code: u!.code }])).values()]
    const seats = v.positionRoster?.seats.filter(s => s.membershipId === m.id && s.state === 'active').map(s => positions.get(s.roleId)).filter(p => !!p) ?? []
    const leadership = seats.some(p => p!.tier === 'leadership')
    const first = committees[0]
    facts.set(m.id, {
      committees,
      positions: seats.map(p => p!.name),
      head: placements.some(d => d.type === 'head') || seats.some(p => p!.tier === 'head'),
      group: leadership && !first ? LEADERSHIP : first ? { key: first.id, label: first.name } : NO_COMMITTEE,
    })
  }
  return facts
}

/** Person options for pickers on this page: grouped by committee, with committee and position shown. */
export function memberOptions(v: OrganizationData, members: RosterMember[], valueOf: (m: RosterMember) => string = m => m.id): SearchOption[] {
  const facts = directory(v)
  return members.map(m => ({ m, f: facts.get(m.id) }))
    .sort((a, b) => (a.f?.group.order ?? 0) - (b.f?.group.order ?? 0) || (a.f?.group.label ?? '').localeCompare(b.f?.group.label ?? '') || a.m.name.localeCompare(b.m.name))
    .map(({ m, f }) => ({
      value: valueOf(m),
      label: m.name,
      meta: [f?.committees.map(c => c.code).join(', '), f?.positions.join(', '), m.accountState !== 'active' ? 'account ' + m.accountState : null].filter(Boolean).join(' · ') || undefined,
      group: f?.group.label,
      keywords: [m.email, ...(f?.committees.map(c => c.name) ?? [])].join(' '),
    }))
}

const memberStatus = (m: RosterMember) => m.state !== 'active' ? m.state : m.accountState !== 'active' ? 'account ' + m.accountState : !live(m.joinedAt, m.endsAt) ? 'outside term dates' : 'active'
const statusOrder = [{ value: 'active', label: 'Active' }, { value: 'account invited', label: 'Invited' }, { value: 'suspended', label: 'Suspended' }, { value: 'outside term dates', label: 'Outside dates' }]

export function RosterView({ v, open, editing, select }: ViewProps) {
  const facts = useMemo(() => directory(v), [v])
  const [grouped, setGrouped] = useState(true)
  const list = useListFilter(v.members, {
    storageKey: 'admin-roster',
    text: m => [m.name, m.email, ...(facts.get(m.id)?.committees.flatMap(c => [c.name, c.code]) ?? []), ...(facts.get(m.id)?.positions ?? [])],
    filters: [
      { key: 'committee', label: 'Committee', get: m => { const f = facts.get(m.id); return f?.committees.length ? f.committees.map(c => c.code) : f?.group.key === 'leadership' ? 'Leadership' : null }, noneLabel: 'None', first: ['Leadership'] },
      { key: 'status', label: 'Status', get: memberStatus, options: statusOrder },
    ],
  })
  const row = (m: RosterMember) => {
    const f = facts.get(m.id)
    return <li key={m.id} className={'organization-row' + editing(['roster_edit'], m.id)}>
      <div className="organization-row__main">
        <h3 className="organization-row__title">{m.name}</h3>
        <p className="organization-row__meta">{[f?.positions.join(', '), f?.committees.map(c => c.code).join(', ')].filter(Boolean).join(' · ') || 'No position yet'}{memberStatus(m) !== 'active' ? <span className="organization-tag">{memberStatus(m)}</span> : null}</p>
        <p className="organization-row__sub">{m.email} · {formatRange(m.joinedAt, m.endsAt)}</p>
      </div>
      <button className="button button--secondary" disabled={!v.canPublish} onClick={() => select({ action: 'roster_edit', id: m.id })} aria-label={'Edit ' + m.name}>Edit</button>
      {open('roster_edit', m.id)}
    </li>
  }
  return <Panel id="roster" title="Roster">
    <p className="muted">Use their exact student.ateneo.edu address. Adding someone doesn't email them.</p>
    <button className="button button--secondary" disabled={!v.canPublish} onClick={() => select({ action: 'roster_add', id: null })}>Add person</button>
    {open('roster_add', null)}
    <ListToolbar filter={list} label="Search the roster" placeholder="Search name, email, committee or position" noun={['person', 'people']}
      group={{ on: grouped, onChange: setGrouped, label: 'Group by committee' }} />
    {!list.results.length ? <EmptyResults query={list.query} noun="people" onClear={list.clear} />
      : grouped ? <GroupedList items={[...list.results].sort((a, b) => Number(!!facts.get(b.id)?.head) - Number(!!facts.get(a.id)?.head) || a.name.localeCompare(b.name))} groupOf={m => facts.get(m.id)?.group ?? NO_COMMITTEE} renderItem={row} forceOpen={list.active} storageKey="admin-roster" />
        : <ul className="organization-list">{[...list.results].sort((a, b) => a.name.localeCompare(b.name)).map(row)}</ul>}
  </Panel>
}

const typeLabel = (t: string) => t.replaceAll('_', ' ')
const typeOrder = ['head', 'member', 'associate', 'primary_contact', 'backup_contact'].map(t => ({ value: t, label: typeLabel(t)[0].toUpperCase() + typeLabel(t).slice(1) }))

/** A placement can be changed in bulk while it is active and not over yet, and isn't run by a role seat. */
const bulkable = (v: OrganizationData, d: Deployment) => d.state === 'active' && Date.parse(d.to) > Date.now() && !v.positionRoster?.seats.some(seat => seat.deploymentId === d.id)

export function PlacementsView({ v, open, editing, select, bulk }: ViewProps & { bulk?: BulkContext }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [change, setChange] = useState<BulkChange | null>(null)
  const selecting = !!bulk && v.canPublish
  // Drop selections that disappeared or stopped qualifying after a refresh.
  const chosen = useMemo(() => v.deployments.filter(d => picked.has(d.id) && bulkable(v, d)), [v, picked])
  const toggle = (id: string, on: boolean) => { setPicked(p => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n }) }
  const clear = () => { setPicked(new Set()); setChange(null) }
  const member = (d: Deployment) => v.members.find(m => m.id === d.memberId)
  const unit = (d: Deployment) => v.units.find(u => u.id === d.unitId)
  const list = useListFilter(v.deployments, {
    storageKey: 'admin-placements',
    text: d => [member(d)?.name, member(d)?.email, unit(d)?.name, unit(d)?.code, typeLabel(d.type)],
    filters: [
      { key: 'committee', label: 'Committee', get: d => unit(d)?.code },
      { key: 'type', label: 'As', get: d => d.type, options: typeOrder },
      { key: 'state', label: 'State', get: d => d.state !== 'active' ? d.state : live(d.from, d.to) ? 'current' : Date.parse(d.from) > Date.now() ? 'upcoming' : 'ended',
        options: [{ value: 'current', label: 'Current' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'ended', label: 'Ended' }, { value: 'revoked', label: 'Revoked' }] },
    ],
  })
  const row = (d: Deployment) => {
    const name = member(d)?.name ?? 'Member unavailable'
    const managed = v.positionRoster?.seats.some(seat => seat.deploymentId === d.id)
    const canPick = selecting && bulkable(v, d)
    return <li key={d.id} className={'organization-row' + (selecting ? ' organization-row--select' : '') + editing(['deployment_save'], d.id)}>
      {selecting ? <label className="organization-select">{canPick ? <input type="checkbox" checked={picked.has(d.id)} onChange={e => toggle(d.id, e.target.checked)} aria-label={'Select ' + name + ', ' + typeLabel(d.type) + ' in ' + (unit(d)?.code ?? 'committee')} /> : null}</label> : null}
      <div className="organization-row__main">
        <h3 className="organization-row__title">{name}</h3>
        <p className="organization-row__meta">{typeLabel(d.type)}{d.state !== 'active' ? <span className="organization-tag">{d.state}</span> : null}</p>
        <p className="organization-row__sub">{formatRange(d.from, d.to)}{managed ? ' · Change this under Roles' : ''}</p>
      </div>
      {managed ? null : <button className="button button--secondary" disabled={!v.canPublish} aria-label={'Edit placement for ' + name} onClick={() => select({ action: 'deployment_save', id: d.id })}>Edit</button>}
      {open('deployment_save', d.id)}
    </li>
  }
  return <Panel title="Committee placements">
    <p className="muted">Who is in which committee, and as what, between two dates. You can't remove or shorten a placement while the person still owns open work.</p>
    <button className="button button--secondary" disabled={!v.canPublish} onClick={() => select({ action: 'deployment_save', id: null })}>Add placement</button>
    {open('deployment_save', null)}
    <ListToolbar filter={list} label="Search placements" placeholder="Search name, email or committee" noun={['placement', 'placements']} />
    {selecting && change && chosen.length ? <BulkEditor key={JSON.stringify(change)} v={v} ctx={bulk!} selected={chosen} change={change} close={() => setChange(null)} done={clear} leaveOut={id => toggle(id, false)} /> : null}
    {selecting && !chosen.length ? <p className="muted">Tick placements to move people, change their level or end placements together.</p> : null}
    {!list.results.length ? <EmptyResults query={list.query} noun="placements" onClear={list.clear} />
      : <GroupedList items={[...list.results].sort((a, b) => Number(b.type === 'head') - Number(a.type === 'head') || (member(a)?.name ?? '').localeCompare(member(b)?.name ?? ''))}
        groupOf={d => { const u = unit(d); return u ? { key: u.id, label: u.name } : NO_COMMITTEE }} renderItem={row} forceOpen={list.active} storageKey="admin-placements" />}
    {/* After the list so it can stick to the bottom of the screen while rows are being ticked. */}
    {selecting && chosen.length && !change ? <BulkBar v={v} count={chosen.length} people={new Set(chosen.map(d => d.memberId)).size} onApply={setChange} onClear={clear}
      allSelected={list.results.filter(d => bulkable(v, d)).every(d => picked.has(d.id))}
      onSelectAll={() => { setPicked(p => new Set([...p, ...list.results.filter(d => bulkable(v, d)).map(d => d.id)])) }} /> : null}
  </Panel>
}

export function WorkView({ v, open, editing, select }: ViewProps) {
  const unitName = (id: string | null) => v.units.find(u => u.id === id)?.name ?? 'no committee'
  const owner = (w: WorkOption) => v.members.find(m => m.memberId === w.ownerId)?.name
  const list = useListFilter(v.work, {
    storageKey: 'admin-work',
    text: w => [w.title, unitName(w.unitId), unitName(w.originUnitId), owner(w)],
    filters: [
      { key: 'committee', label: 'Committee', get: w => v.units.find(u => u.id === w.unitId)?.code, noneLabel: 'None' },
      { key: 'moved', label: 'Moved', get: w => w.unitId === w.originUnitId ? 'original' : 'moved', options: [{ value: 'original', label: 'Still with original' }, { value: 'moved', label: 'Moved before' }] },
    ],
  })
  const row = (w: WorkOption) => <li key={w.id} className={'organization-row' + editing(['work_reassign'], w.id)}>
    <div className="organization-row__main">
      <h3 className="organization-row__title"><Link to={'/deliverables/' + w.id}>{w.title}</Link></h3>
      <p className="organization-row__meta">{owner(w) ? 'Owner ' + owner(w) : 'Owner not on the roster'}{w.unitId !== w.originUnitId ? ' · Originally ' + unitName(w.originUnitId) : ''}</p>
    </div>
    <button className="button button--secondary" disabled={!v.canPublish} aria-label={'Move ' + w.title} onClick={() => select({ action: 'work_reassign', id: w.id })}>Move</button>
    {open('work_reassign', w.id)}
  </li>
  return <Panel title="Move deliverables to another committee">
    <p className="muted">Only regular deliverables can be moved here. Open Budget or Publicity cases block archiving or merging a committee until they're resolved.</p>
    <ListToolbar filter={list} label="Search deliverables" placeholder="Search title, owner or committee" noun={['deliverable', 'deliverables']} />
    {!list.results.length ? <EmptyResults query={list.query} noun="deliverables" onClear={list.clear} />
      : <GroupedList items={[...list.results].sort((a, b) => a.title.localeCompare(b.title))} groupOf={w => w.unitId ? { key: w.unitId, label: unitName(w.unitId) } : NO_COMMITTEE}
        renderItem={row} forceOpen={list.active} storageKey="admin-work" />}
  </Panel>
}

const PAGE = 40
export function HistoryView({ v }: { v: OrganizationData }) {
  const [limit, setLimit] = useState(PAGE)
  const actionLabel = (a: string) => { const t = a.replaceAll('_', ' '); return t[0].toUpperCase() + t.slice(1) }
  const list = useListFilter(v.history, {
    text: h => [h.action.replaceAll('_', ' '), h.reason, formatDateTime(h.at)],
    filters: [{ key: 'action', label: 'Change', get: h => h.action, options: [...new Set(v.history.map(h => h.action))].sort().map(a => ({ value: a, label: actionLabel(a) })) }],
  })
  const shown = list.results.slice(0, limit)
  return <Panel title="Change history">
    <ListToolbar filter={list} label="Search change history" placeholder="Search reasons or change type" noun={['change', 'changes']} sticky={false} />
    {!list.results.length ? <EmptyResults query={list.query} noun="changes" onClear={list.clear} /> : <>
      <ul className="organization-list organization-history">{shown.map(h => <li key={h.version}>
        <span className="organization-history__action">{actionLabel(h.action)}</span>
        <time className="organization-row__sub" dateTime={h.at}>{formatDateTime(h.at)}</time>
        <span>{h.reason}</span>
      </li>)}</ul>
      {list.results.length > limit ? <button type="button" className="button button--secondary" onClick={() => setLimit(n => n + PAGE)}>Show {Math.min(PAGE, list.results.length - limit)} more</button> : null}
    </>}
  </Panel>
}
