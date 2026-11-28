import { useState } from 'react'
import { Panel } from '../../../components/Page'
import { EmptyResults, GroupedList, ListToolbar, useListFilter, type SearchOption } from '../../../components/list'
import { accessDate, actionName, namedScope } from './presentation'
import type { AccessData, Action, Assignment } from './api'

/** Committees a person holds a committee-wide role in, read from the assignments already on the page. */
function committeesOf(data: AccessData, membershipId: string) {
  const ids = new Set(data.assignments?.filter(a => a.membershipId === membershipId && a.scope === 'unit' && a.state === 'active').map(a => a.unitId) ?? [])
  return data.units.filter(u => ids.has(u.id))
}

/** People to pick from, grouped by the committee they have a role in (or "No committee role"). */
export function targetOptions(data: AccessData, identity?: string): SearchOption[] {
  return data.targets.map(t => ({ t, units: committeesOf(data, t.id) }))
    .sort((a, b) => (a.units[0] ? 0 : 1) - (b.units[0] ? 0 : 1) || (a.units[0]?.name ?? '').localeCompare(b.units[0]?.name ?? '') || a.t.name.localeCompare(b.t.name))
    .map(({ t, units }) => ({
      value: t.id,
      label: t.name + (t.id === identity ? ' (you)' : ''),
      meta: [units.map(u => u.name).join(', '), data.assignments?.filter(a => a.membershipId === t.id).map(a => data.roles.find(r => r.id === a.roleId)?.name).filter(Boolean).join(', ')].filter(Boolean).join(' · ') || undefined,
      group: units[0]?.name ?? 'No committee role',
    }))
}

export function assignmentOptions(data: AccessData, named: (id: string) => string): SearchOption[] {
  return (data.assignments ?? []).map(a => ({
    value: a.id,
    label: named(a.membershipId) + ' · ' + (data.roles.find(r => r.id === a.roleId)?.name ?? 'Role'),
    meta: (namedScope(data, a.scope, a.unitId, a.workId) ?? 'Unknown') + ' · ends ' + accessDate(a.to),
    group: a.scope === 'unit' ? data.units.find(u => u.id === a.unitId)?.name ?? 'Other' : a.scope === 'term' ? 'Whole term' : 'Single records',
  })).sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label))
}

export const recordOptions = (data: AccessData): SearchOption[] => [...data.records].sort((a, b) => a.name.localeCompare(b.name)).map(w => ({ value: w.id, label: w.name }))

export function AssignmentsPanel({ data, named }: { data: AccessData; named: (id: string) => string }) {
  const role = (a: Assignment) => data.roles.find(r => r.id === a.roleId)?.name ?? 'Role'
  const groupOf = (a: Assignment) => a.scope === 'unit'
    ? { key: a.unitId ?? 'unit', label: data.units.find(u => u.id === a.unitId)?.name ?? 'Committee unavailable' }
    : a.scope === 'term' ? { key: 'term', label: 'Whole term', order: -1 } : { key: a.scope, label: a.scope === 'work' ? 'Single records' : 'Own records', order: 1 }
  const list = useListFilter(data.assignments ?? [], {
    storageKey: 'access-assignments',
    text: a => [named(a.membershipId), role(a), namedScope(data, a.scope, a.unitId, a.workId)],
    filters: [
      { key: 'role', label: 'Role', get: role },
      { key: 'where', label: 'Where', get: a => groupOf(a).label, first: ['Whole term'] },
      { key: 'state', label: 'State', get: a => a.state !== 'active' ? a.state : a.effective ? 'active' : 'not active yet' },
    ],
  })
  return <Panel title="Who has which role">
    <ListToolbar filter={list} label="Search role assignments" placeholder="Search a name, role or committee" noun={['assignment', 'assignments']} />
    {!list.results.length ? list.active ? <EmptyResults query={list.query} noun="assignments" onClear={list.clear} /> : <p>No one has a role yet.</p>
      : <GroupedList items={[...list.results].sort((a, b) => named(a.membershipId).localeCompare(named(b.membershipId)))} groupOf={groupOf} listClassName="access-list" forceOpen={list.active} storageKey="access-assignments"
        renderItem={a => <li key={a.id}><strong>{named(a.membershipId)}</strong> · {role(a)}{a.effective ? '' : ' · not active yet'}{a.state !== 'active' ? ' · ' + a.state : ''} · ends {accessDate(a.to)}{a.custodian ? ' · workspace owner' : ''}</li>} />}
  </Panel>
}

const PAGE = 30
export function AccessHistoryPanel({ data }: { data: AccessData }) {
  const [limit, setLimit] = useState(PAGE)
  const history = data.history ?? []
  const list = useListFilter(history, {
    text: h => [actionName(h.action as Action), h.reason, accessDate(h.at)],
    filters: [{ key: 'action', label: 'Change', get: h => actionName(h.action as Action) }],
  })
  return <Panel title="Changes you've made">
    {history.length > 8 ? <ListToolbar filter={list} label="Search your access changes" placeholder="Search reasons or change type" noun={['change', 'changes']} sticky={false} /> : null}
    {!list.results.length ? list.active ? <EmptyResults query={list.query} noun="changes" onClear={list.clear} /> : <p>No changes yet.</p> : <>
      <ul className="access-list">{list.results.slice(0, limit).map(h => <li key={h.version}>{actionName(h.action as Action)} · {accessDate(h.at)} · {h.reason}</li>)}</ul>
      {list.results.length > limit ? <button type="button" className="button button--secondary" onClick={() => setLimit(n => n + PAGE)}>Show {Math.min(PAGE, list.results.length - limit)} more</button> : null}
    </>}
  </Panel>
}
