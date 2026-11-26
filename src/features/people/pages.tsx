import { useEffect, useState } from 'react'
import { Link, useRouteLoaderData, useSearchParams } from 'react-router'
import type { WorkspaceContext } from '../auth/gateway'
import { PageHeading, Panel } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { TextField } from '../../components/TextField'
import type { PeopleGateway } from './gateway'
import { ContactLinks } from './ContactLinks'

export function DirectoryPage({ api }: { api: PeopleGateway }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext; const [params]=useSearchParams()
  return <PeoplePage key={context.termId} api={api} termId={context.termId} focusId={params.get('contact')??undefined} />
}

export function PeoplePage({ api, termId,focusId }: { api: PeopleGateway; termId: string;focusId?:string }) {
  const [data, setData] = useState<Awaited<ReturnType<PeopleGateway['read']>> | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  useEffect(() => {
    let active = true
    void api.read(termId).then(result => { if (active) setData(result) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [api, termId, attempt])
  const query = search.trim().toLocaleLowerCase()
  const people = data?.people.filter(person => (!focusId||person.id===focusId)&&[person.name, ...person.units, ...person.roles].some(text => text.toLocaleLowerCase().includes(query))) ?? []
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
        <TextField id="people-search" label="Search people" hint="Search by name, committee or role." type="search" value={search} onChange={event => setSearch(event.target.value)} />
        <p role="status">{people.length} {people.length === 1 ? 'person' : 'people'} found</p>
        {people.length ? <ul className="guest-list">{people.map(person => <li key={person.id}>
          <h3>{person.name}</h3><p>{person.units.join(' · ') || 'No committee yet'}</p>
          <p>{person.roles.join(' · ') || 'No role yet'}</p>
          <ContactLinks name={person.name} messenger={person.messenger} telegram={person.telegram} />
          {person.contact ? <p><a href={`mailto:${person.contact}`}>{person.contact}</a></p> : null}
          {person.course || person.year ? <p className="muted">{[person.course, person.year].filter(Boolean).join(' · ')}</p> : null}
        </li>)}</ul> : <EmptyState title="No people found" description="Try another name, committee or role." />}
      </Panel>
    </>}
  </>
}
