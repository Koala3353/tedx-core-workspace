import { useEffect, useState } from 'react'
import { Status } from '../../components/Status'
import { Link, useRouteLoaderData } from 'react-router'
import { PageHeading, Panel } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import type { TasksApi, TaskSummary } from '../tasks/api'
import type { Deliverable, DeliverablesApi, Filters } from '../deliverables/api'
import type { HandoffsApi, HandoffView } from '../handoffs/api'
import { DeliverableFacts, dateLabel } from '../deliverables/DeliverableFacts'
import { HandoffSummary } from '../handoffs/HandoffScreens'
import { WorkReference } from '../work-references/WorkReference'

type Unit = { id: string; name: string }
type Loaded<T> = { key: string; value: T | null; error: boolean }
type Apis = { tasks?: TasksApi; deliverables?: DeliverablesApi; handoffs?: HandoffsApi }

const noFilters: Filters = { phase: '', unit: '', owner: '', blocked: false, overdue: false, mine: false, review: false, page: 1 }
// Bounded fan-out: one first-page request per managed committee.
const maxUnits = 6

/** Load once per key; stale responses are ignored. Passing no loader means the area is not connected. */
function useLoaded<T>(key: string, load: (() => Promise<T>) | null): Loaded<T> | null {
  const [state, setState] = useState<Loaded<T> | null>(null)
  useEffect(() => {
    if (!load) return
    let live = true
    load().then(value => { if (live) setState({ key, value, error: false }) }, () => { if (live) setState({ key, value: null, error: true }) })
    return () => { live = false }
    // The key identifies the request; the loader closure is recreated every render.
  }, [key])
  return state?.key === key ? state : null
}

export function CommitteePage(apis: Apis) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext
  if (isGuest(context)) return <><PageHeading title="My committee" /><EmptyState title="Committee view unavailable" description="Guest accounts are not assigned to a committee. Use your shared work links instead." action={<Link className="button button--secondary" to="/shared">Shared with me</Link>} /></>
  return <CommitteeBody key={context.termId + context.termMembershipId} {...apis} termId={context.termId} />
}

function CommitteeBody({ tasks, deliverables, handoffs, termId }: Apis & { termId: string }) {
  const [reload, setReload] = useState(0)
  const readOptions = tasks?.options
  const units = useLoaded(termId + ':units:' + reload, readOptions ? () => readOptions(termId).then(o => (o?.units ?? []).filter(u => u.canManage).map(({ id, name }) => ({ id, name }))) : null)
  const refresh = <button className="button button--secondary" type="button" onClick={() => setReload(n => n + 1)}>Reload committee work</button>
  const heading = <PageHeading title="My committee" description="Deliverables, tasks and incoming handoffs for the committees you manage this term." />
  if (!readOptions) return <>{heading}<EmptyState title="Committee view unavailable" description="Committee assignments cannot be checked on this workspace connection." action={<Link className="button button--secondary" to="/">Return to overview</Link>} /></>
  if (!units) return <>{heading}<LoadingState title="Checking your committees" /></>
  if (units.error || !units.value) return <>{heading}<ErrorState title="Committees could not be checked" description="Check your access or connection, then try again. No cached records are shown." action={<button className="button" type="button" onClick={() => setReload(n => n + 1)}>Try again</button>} /></>
  if (!units.value.length) return <>{heading}<EmptyState title="No managed committee" description="You are not currently recorded as managing a committee this term. Ask the roster custodian if this looks wrong." action={<Link className="button button--secondary" to="/deliverables?mine=1">Deliverables involving my committee</Link>} /></>
  const managed = units.value
  return <>
    {heading}
    <p className="muted">Managing: {managed.map(u => u.name).join(' · ')}</p>
    <div className="auth-actions">{refresh}</div>
    <div className="committee-page">
      {managed.slice(0, maxUnits).map(unit => <CommitteeDeliverables key={unit.id + reload} api={deliverables} termId={termId} unit={unit} />)}
      {managed.length > maxUnits ? <p className="muted">Showing the first {maxUnits} committees. Use the deliverables committee filter for the others.</p> : null}
      <CommitteeTasks key={'tasks' + reload} api={tasks} termId={termId} />
      <CommitteeHandoffs key={'handoffs' + reload} api={handoffs} termId={termId} units={managed} />
    </div>
  </>
}

function CommitteeDeliverables({ api, termId, unit }: { api?: DeliverablesApi; termId: string; unit: Unit }) {
  const result = useLoaded(termId + unit.id, api ? () => api.list(termId, { ...noFilters, unit: unit.id }) : null)
  const all = <Link className="button button--secondary" to={'/deliverables?unit=' + unit.id}>All {unit.name} deliverables</Link>
  return <Panel title={unit.name + ' deliverables'} className="committee-section">
    {!api ? <EmptyState title="Deliverables unavailable" description="The workspace connection is unavailable." />
      : !result ? <LoadingState title="Loading deliverables" />
      : result.error || !result.value ? <ErrorState title="Deliverables unavailable" description="Check access or connection, then reload committee work." />
      : !result.value.items.length ? <EmptyState title="No deliverables for this committee" description="No permitted deliverables are led by or involve this committee yet." action={all} />
      : <><p role="status">{result.value.total} permitted {result.value.total === 1 ? 'deliverable' : 'deliverables'}{result.value.total > result.value.items.length ? ` · showing ${result.value.items.length}` : ''}</p>
        <div className="deliverable-list">{result.value.items.map((item: Deliverable) => <article className="panel deliverable-row" key={item.id}>
          <h3><Link to={'/deliverables/' + item.id}>{item.title}</Link></h3>
          <WorkReference compact reference={item.reference} id={item.id} kind="deliverable" />
          <p>{item.nextAction}</p><DeliverableFacts item={item} />
        </article>)}</div>{all}</>}
  </Panel>
}

function CommitteeTasks({ api, termId }: { api?: TasksApi; termId: string }) {
  const list = api?.list
  const result = useLoaded(termId + ':tasks', list ? () => list(termId, 1, 'unit') : null)
  const all = <Link className="button button--secondary" to="/tasks?view=unit">All managed committee tasks</Link>
  return <Panel title="Committee tasks" className="committee-section">
    {!list ? <EmptyState title="Tasks unavailable" description="The workspace connection is unavailable." />
      : !result ? <LoadingState title="Loading tasks" />
      : result.error || !result.value ? <ErrorState title="Tasks unavailable" description="Check access or connection, then reload committee work." />
      : !result.value.items.length ? <EmptyState title="No committee tasks" description="No permitted tasks are assigned to the committees you manage." action={all} />
      : <><p role="status">{result.value.total} permitted {result.value.total === 1 ? 'task' : 'tasks'}{result.value.total > result.value.items.length ? ` · showing ${result.value.items.length}` : ''}</p>
        <ul className="committee-list">{result.value.items.map((t: TaskSummary) => <li key={t.id}>
          <h3><Link to={'/tasks/' + t.id}>{t.title}</Link></h3>
          <WorkReference compact reference={t.reference} id={t.id} kind="task" />
          <p>Assignee: {t.assigneeName ?? 'Unassigned'} · Status: <Status state={t.state} /> · Target: {dateLabel(t.dueAt, t.dueOn)}{t.overdue ? ' · Overdue' : ''}</p>
        </li>)}</ul>{all}</>}
  </Panel>
}

function CommitteeHandoffs({ api, termId, units }: { api?: HandoffsApi; termId: string; units: Unit[] }) {
  const result = useLoaded(termId + ':handoffs', api ? () => api.list(termId, 'incoming', null, 1) : null)
  const ids = new Set(units.map(u => u.id))
  const items = result?.value?.items.filter((h: HandoffView) => ids.has(h.receiverUnitId)) ?? []
  const all = <Link className="button button--secondary" to="/working-together/handoffs">All handoffs</Link>
  return <Panel title="Incoming handoffs" className="committee-section">
    {!api ? <EmptyState title="Handoffs unavailable" description="The workspace connection is unavailable." />
      : !result ? <LoadingState title="Loading handoffs" />
      : result.error ? <ErrorState title="Handoffs unavailable" description="Check access or connection, then reload committee work." />
      : !items.length ? <EmptyState title="No incoming handoffs" description="No recent permitted packages are addressed to the committees you manage." action={all} />
      : <><p className="muted">Recent incoming packages addressed to your committees.</p><ul className="committee-list">{items.map(h => <HandoffSummary key={h.id} h={h} />)}</ul>{all}</>}
  </Panel>
}
