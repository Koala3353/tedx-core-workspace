import { useEffect, useState } from 'react'
import { Status } from '../../components/Status'
import { Link, useRouteLoaderData } from 'react-router'
import { PageHeading, Panel } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import type { TasksApi, TaskSummary } from '../tasks/api'
import type { Deliverable, DeliverablesApi, Filters } from '../deliverables/api'
import type { HandoffsApi, HandoffView } from '../handoffs/api'
import { DeliverableFacts } from '../deliverables/DeliverableFacts'
import { HandoffSummary } from '../handoffs/HandoffScreens'
import { WorkReference } from '../work-references/WorkReference'
import { useAutoRefresh } from '../shared/useAutoRefresh'
import { formatDay, formatDue } from '../shared/dates'
import { refreshKey, settled } from '../shared/settled'
import { useListEnter } from '../../components/useListEnter'
import { QuickLinks } from '../committee-links'
import type { CommitteeLinksApi } from '../committee-links/api'

type Unit = { id: string; name: string }
type Loaded<T> = { key: string; value: T | null; error: boolean }
type Apis = { tasks?: TasksApi; deliverables?: DeliverablesApi; handoffs?: HandoffsApi; links?: CommitteeLinksApi }

const noFilters: Filters = { phase: '', unit: '', owner: '', blocked: false, overdue: false, mine: false, review: false, page: 1 }
// Bounded fan-out: one first-page request per managed committee.
const maxUnits = 6

function dueText(t: TaskSummary): string {
  const due = t.dueAt ?? t.dueOn
  if (!due) return 'No due date'
  const label = formatDue(due)
  return !t.overdue && label.startsWith('Overdue') ? 'Due ' + formatDay(due) : label
}

/**
 * Load once per scope and refresh epoch; stale responses are ignored. Passing no loader means the
 * area is not connected. A refresh of the same scope keeps the last result on screen (no skeleton flash).
 */
function useLoaded<T>(scope: string, epoch: number, load: (() => Promise<T>) | null): Loaded<T> | null {
  const key = refreshKey(scope, epoch)
  const [state, setState] = useState<Loaded<T> | null>(null)
  useEffect(() => {
    if (!load) return
    let live = true
    load().then(value => { if (live) setState({ key, value, error: false }) }, () => { if (live) setState({ key, value: null, error: true }) })
    return () => { live = false }
    // The key identifies the request; the loader closure is recreated every render.
  }, [key])
  return settled(state, key)
}

const retry = (onRetry: () => void) => <button className="button button--secondary" type="button" onClick={onRetry}>Try again</button>

export function CommitteePage(apis: Apis) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext
  if (isGuest(context)) return <><PageHeading title="My committee" /><EmptyState title="No committee for guests" description="Guests aren't part of a committee. Use the links that were shared with you." action={<Link className="button button--secondary" to="/shared">Shared with me</Link>} /></>
  return <CommitteeBody key={context.termId + context.termMembershipId} {...apis} termId={context.termId} />
}

function CommitteeBody({ tasks, deliverables, handoffs, links, termId }: Apis & { termId: string }) {
  const [reload, setReload] = useState(0)
  useAutoRefresh(() => setReload(n => n + 1))
  const readOptions = tasks?.options
  const again = () => setReload(n => n + 1)
  const units = useLoaded(termId + ':units', reload, readOptions ? () => readOptions(termId).then(o => (o?.units ?? []).filter(u => u.canManage).map(({ id, name }) => ({ id, name }))) : null)
  const heading = <PageHeading title="My committee" description="Deliverables, tasks and incoming handoffs for the committees you manage this term." />
  if (!readOptions) return <>{heading}<EmptyState title="Couldn't load your committee" description="The connection isn't available right now. Try again later." action={<Link className="button button--secondary" to="/">Back to Overview</Link>} /></>
  if (!units) return <>{heading}<LoadingState title="Loading your committees" /></>
  if (units.error || !units.value) return <>{heading}<ErrorState title="Couldn't load your committees" description="Check your connection, then try again." action={<button className="button button--secondary" type="button" onClick={() => setReload(n => n + 1)}>Try again</button>} /></>
  if (!units.value.length) return <>{heading}<EmptyState title="You don't head a committee" description="This page is for committee heads. If you head one this term, ask an admin to update the roster." action={<Link className="button button--secondary" to="/deliverables?mine=1">Deliverables involving my committee</Link>} /></>
  const managed = units.value
  return <>
    {heading}
    <p className="muted">Managing: {managed.map(u => u.name).join(' · ')}</p>
    <div className="committee-page">
      {links ? managed.slice(0, maxUnits).map(unit => <QuickLinks key={'links' + unit.id} compact api={links} termId={termId} unitId={unit.id} unitName={unit.name} />) : null}
      {managed.slice(0, maxUnits).map(unit => <CommitteeDeliverables key={unit.id} epoch={reload} onRetry={again} api={deliverables} termId={termId} unit={unit} />)}
      {managed.length > maxUnits ? <p className="muted">Showing the first {maxUnits} committees. Use the deliverables committee filter for the others.</p> : null}
      <CommitteeTasks epoch={reload} onRetry={again} api={tasks} termId={termId} />
      <CommitteeHandoffs epoch={reload} onRetry={again} api={handoffs} termId={termId} units={managed} />
    </div>
  </>
}

type Section = { epoch: number; onRetry: () => void }

function CommitteeDeliverables({ api, termId, unit, epoch, onRetry }: Section & { api?: DeliverablesApi; termId: string; unit: Unit }) {
  const result = useLoaded(termId + unit.id, epoch, api ? () => api.list(termId, { ...noFilters, unit: unit.id }) : null)
  const all = <Link className="button button--secondary" to={'/deliverables?unit=' + unit.id}>All {unit.name} deliverables</Link>
  return <Panel title={unit.name + ' deliverables'} className="committee-section">
    {!api ? <EmptyState title="Deliverables unavailable" description="The connection isn't available right now. Try again later." />
      : !result ? <LoadingState title="Loading deliverables" />
      : result.error || !result.value ? <ErrorState title="Couldn't load deliverables" description="Check your connection, then try again." action={retry(onRetry)} />
      : !result.value.items.length ? <EmptyState title="No deliverables yet" description="Nothing led by or involving this committee yet." action={all} />
      : <><p role="status">{result.value.total} {result.value.total === 1 ? 'deliverable' : 'deliverables'}{result.value.total > result.value.items.length ? ` · showing ${result.value.items.length}` : ''}</p>
        <div className="deliverable-list">{result.value.items.map((item: Deliverable) => <article className="panel deliverable-row" key={item.id}>
          <h3><Link to={'/deliverables/' + item.id}>{item.title}</Link></h3>
          <WorkReference compact reference={item.reference} id={item.id} kind="deliverable" />
          <p>{item.nextAction}</p><DeliverableFacts item={item} />
        </article>)}</div>{all}</>}
  </Panel>
}

function CommitteeTasks({ api, termId, epoch, onRetry }: Section & { api?: TasksApi; termId: string }) {
  const list = api?.list
  const result = useLoaded(termId + ':tasks', epoch, list ? () => list(termId, 1, 'unit') : null)
  const all = <Link className="button button--secondary" to="/tasks?view=unit">All committee tasks</Link>
  const enter = useListEnter(!!result?.value?.items.length)
  return <Panel title="Committee tasks" className="committee-section">
    {!list ? <EmptyState title="Tasks unavailable" description="The connection isn't available right now. Try again later." />
      : !result ? <LoadingState title="Loading tasks" />
      : result.error || !result.value ? <ErrorState title="Couldn't load tasks" description="Check your connection, then try again." action={retry(onRetry)} />
      : !result.value.items.length ? <EmptyState title="No committee tasks yet" description="Tasks for your committees show up here." action={all} />
      : <><p role="status">{result.value.total} {result.value.total === 1 ? 'task' : 'tasks'}{result.value.total > result.value.items.length ? ` · showing ${result.value.items.length}` : ''}</p>
        <ul className={'committee-list ' + enter}>{result.value.items.map((t: TaskSummary) => <li key={t.id}>
          <h3><Link to={'/tasks/' + t.id}>{t.title}</Link></h3>
          <WorkReference compact reference={t.reference} id={t.id} kind="task" />
          <p>Assignee: {t.assigneeName ?? 'Unassigned'} · Status: <Status state={t.state} /> · {dueText(t)}</p>
        </li>)}</ul>{all}</>}
  </Panel>
}

function CommitteeHandoffs({ api, termId, units, epoch, onRetry }: Section & { api?: HandoffsApi; termId: string; units: Unit[] }) {
  const result = useLoaded(termId + ':handoffs', epoch, api ? () => api.list(termId, 'incoming', null, 1) : null)
  const ids = new Set(units.map(u => u.id))
  const items = result?.value?.items.filter((h: HandoffView) => ids.has(h.receiverUnitId)) ?? []
  const all = <Link className="button button--secondary" to="/working-together/handoffs">All handoffs</Link>
  return <Panel title="Incoming handoffs" className="committee-section">
    {!api ? <EmptyState title="Handoffs unavailable" description="The connection isn't available right now. Try again later." />
      : !result ? <LoadingState title="Loading handoffs" />
      : result.error ? <ErrorState title="Couldn't load handoffs" description="Check your connection, then try again." action={retry(onRetry)} />
      : !items.length ? <EmptyState title="No incoming handoffs" description="Nothing has been handed to your committees recently." action={all} />
      : <><p className="muted">Recent handoffs to your committees.</p><ul className="committee-list">{items.map(h => <HandoffSummary key={h.id} h={h} />)}</ul>{all}</>}
  </Panel>
}
