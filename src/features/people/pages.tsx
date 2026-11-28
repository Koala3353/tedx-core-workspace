import { useEffect, useState } from 'react'
import { Link, useRouteLoaderData, useSearchParams } from 'react-router'
import type { WorkspaceContext } from '../auth/gateway'
import { PageHeading, Panel } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { EmptyResults, GroupedList, ListToolbar, useListFilter } from '../../components/list'
import type { PeopleGateway, Person } from './gateway'
import { ContactLinks } from './ContactLinks'

export function DirectoryPage({ api }: { api: PeopleGateway }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext; const [params]=useSearchParams()
  return <PeoplePage key={context.termId} api={api} termId={context.termId} focusId={params.get('contact')??undefined} />
}

export function PeoplePage({ api, termId,focusId }: { api: PeopleGateway; termId: string;focusId?:string }) {
  const [data, setData] = useState<Awaited<ReturnType<PeopleGateway['read']>> | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void api.read(termId).then(result => { if (active) setData(result) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [api, termId, attempt])
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  const selfIds = [context && 'memberId' in context ? context.memberId : null, context && 'termMembershipId' in context ? (context as { termMembershipId?: string }).termMembershipId : null].filter((id): id is string => !!id)
  return <>
    <PageHeading title="People" description="Who to ask for what, and everyone on the core team." />
    {error ? <ErrorState title="Couldn't load People" description="Check your connection and try again." action={<button className="button button--secondary" onClick={() => { setError(false); setData(null); setAttempt(attempt + 1) }}>Try again</button>} /> : !data ? <LoadingState /> : <>
      {focusId?<p><Link to="/people">Show everyone</Link></p>:null}<Panel title="Who to ask">
        {data.processes.length ? <ul className="guest-list">{data.processes.map(process => <li key={process.id} id={`process-${process.id}`}>
          <h3>{process.name}</h3>
          {process.primary.length || process.backup.length ? <p>{process.primary.length ? 'Contact: ' + process.primary.map(p => p.name).join(', ') : 'Contact: not assigned yet'}{process.backup.length ? ' · Backup: ' + process.backup.map(p => p.name).join(', ') : ''}</p> : <p className="muted">No contact yet. Ask your committee head.</p>}
        </li>)}</ul> : <p className="muted">No contacts yet. Ask your committee head.</p>}
      </Panel>
      <Panel title="Member directory">
        <Directory people={data.people.filter(person => !focusId || person.id === focusId)} selfIds={selfIds} />
      </Panel>
    </>}
  </>
}

/**
 * Everyone on the core team, searchable (accent-insensitive) by name, committee or role and grouped by
 * committee. Your own committee is listed first so the people you work with most are at the top.
 */
function Directory({ people, selfIds }: { people: Person[]; selfIds: string[] }) {
  const mine = people.find(person => selfIds.includes(person.id))?.units[0]
  const list = useListFilter(people, {
    storageKey: 'people-directory',
    text: person => [person.name, ...person.units, ...person.roles, person.course, person.skills],
    filters: [{ key: 'committee', label: 'Committee', get: person => person.units, noneLabel: 'No committee', first: mine ? [mine] : [] }],
  })
  if (!people.length) return <EmptyState title="No people found" description="No one is in the directory for this term yet." />
  const sorted = [...list.results].sort((a, b) => a.name.localeCompare(b.name))
  return <>
    <ListToolbar filter={list} label="Search people" placeholder="Search name, committee or role" noun={['person', 'people']} />
    {!sorted.length ? <EmptyResults query={list.query} noun="people" onClear={list.clear} />
      : <GroupedList items={sorted} listClassName="guest-list" forceOpen={list.active} storageKey="people-directory"
        groupOf={person => person.units[0] ? { key: person.units[0], label: person.units[0] + (person.units[0] === mine ? ' (your committee)' : ''), order: person.units[0] === mine ? -2 : 0 } : person.roles.length ? { key: 'leadership', label: 'Leadership and other roles', order: -1 } : { key: 'none', label: 'No committee yet', order: 1 }}
        renderItem={person => <li key={person.id}>
          <h3>{person.name}</h3>
          <p>{[person.roles.join(' · ') || 'No role yet', person.units.length > 1 ? 'Also ' + person.units.slice(1).join(', ') : null].filter(Boolean).join(' · ')}</p>
          <ContactLinks name={person.name} messenger={person.messenger} telegram={person.telegram} />
          {person.contact ? <p><a href={`mailto:${person.contact}`}>{person.contact}</a></p> : null}
          {person.course || person.year ? <p className="muted">{[person.course, person.year].filter(Boolean).join(' · ')}</p> : null}
        </li>} />}
  </>
}
