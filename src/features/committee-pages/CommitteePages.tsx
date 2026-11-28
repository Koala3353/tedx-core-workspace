import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams, useRouteLoaderData } from 'react-router'
import { ArrowLeft, ArrowRight, CalendarDays, Mail, Send } from 'lucide-react'
import { PageHeading, Panel } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { Status } from '../../components/Status'
import { PendingButton } from '../../components/PendingButton'
import { useListEnter } from '../../components/useListEnter'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import type { Resource } from '../resources/api'
import { formatDay, formatDue, formatTime } from '../shared/dates'
import { health, healthLabel, healthTone, progress } from '../war-room/model'
import { findUnit, leadContacts, roleLabel, type Board, type BoardAsk, type BoardDeliverable, type BoardUnit } from './board'
import { committeeContent, contentForCode, type CommitteeContent } from './content'
import { useBoard } from './useBoard'
import type { CommitteePagesApi } from './api'
import { MyCommitteeLinks, QuickLinks } from '../committee-links'
import './committee-pages.css'

function useMember(): WorkspaceContext | null {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  return context && !isGuest(context) ? context : null
}

const guestState = (title: string) => <><PageHeading title={title} /><EmptyState title="Not available for guests" description="Committee pages are for core members." action={<Link className="button button--secondary" to="/shared">Shared with me</Link>} /></>

function BoardGate({ state, title, children }: { state: ReturnType<typeof useBoard>; title: ReactNode; children: (board: Board) => ReactNode }) {
  if (state.board) return <>{children(state.board)}</>
  if (state.unavailable) return <>{title}<EmptyState title="Committee pages aren't switched on yet" description="They appear once the latest workspace update is installed. Meanwhile, check People." action={<Link className="button button--secondary" to="/people">People</Link>} /></>
  if (state.error) return <>{title}<ErrorState title="This page didn't load" description={state.error} action={<PendingButton className="button button--secondary" pending={state.loading} pendingLabel="Trying again…" onClick={state.reload}>Try again</PendingButton>} /></>
  return <>{title}<LoadingState title="Loading committees" rows={4} /></>
}

/** Teams described in the Primer that live inside this committee because they have no committee of their own. */
function innerTeams(content: CommitteeContent | null, units: readonly BoardUnit[]) {
  if (!content) return { inside: [], linked: [] as { content: CommitteeContent; unit: BoardUnit }[] }
  const children = committeeContent.filter(c => c.parent === content.key)
  return {
    inside: children.filter(c => !findUnit(units, c.codes)),
    linked: children.flatMap(c => { const unit = findUnit(units, c.codes); return unit ? [{ content: c, unit }] : [] }),
  }
}

const pagePath = (unit: BoardUnit) => '/team/committees/' + encodeURIComponent(unit.code)

// ── Index ────────────────────────────────────────────────────────────────

export function CommitteeIndexPage({ api }: { api?: CommitteePagesApi }) {
  const member = useMember()
  if (!member) return guestState('Committees')
  return <CommitteeIndexBody key={member.termId} api={api} termId={member.termId} />
}

function CommitteeIndexBody({ api, termId }: { api?: CommitteePagesApi; termId: string }) {
  const state = useBoard(api?.board, termId)
  const enter = useListEnter(!!state.board?.units.length)
  const heading = <PageHeading title="Committees" description="What each committee does, who leads it and what it's working on now." />
  return <BoardGate state={state} title={heading}>{board => {
    const units = [...board.units].sort((a, b) => Number(b.delivery) - Number(a.delivery) || a.name.localeCompare(b.name))
    if (!units.length) return <>{heading}<EmptyState title="No committees yet" description="Committees appear here once the roster is set up." /></>
    return <>
      {heading}
      <MyCommitteeLinks api={api} termId={termId} />
      <ul className={'committee-index ' + enter}>{units.map(unit => {
        const content = contentForCode(unit.code)
        const mine = board.deliverables.filter(d => d.unitId === unit.id && d.state !== 'cancelled')
        const risky = mine.filter(d => ['at_risk', 'behind'].includes(health(d, board.today))).length
        const heads = leadContacts(unit)
        const { inside } = innerTeams(content, board.units)
        return <li key={unit.id} className="committee-card">
          <h2><Link to={pagePath(unit)}>{unit.name}</Link> <span className="muted">({unit.code})</span></h2>
          <p>{content?.description ?? 'No description yet.'}</p>
          {inside.length ? <p className="muted">Teams: {inside.map(c => c.name).join(', ')}</p> : null}
          <p className="committee-card__facts">
            <span>{heads.length ? (heads[0].role === 'head' ? 'Led by ' : 'Contact: ') + heads.map(h => h.name).join(', ') : 'No head listed yet'}</span>
            <span>{mine.length} {mine.length === 1 ? 'deliverable' : 'deliverables'}{risky ? ` · ${risky} at risk` : ''}</span>
          </p>
        </li>
      })}</ul>
    </>
  }}</BoardGate>
}

// ── One committee ────────────────────────────────────────────────────────

export function CommitteePage({ api }: { api?: CommitteePagesApi }) {
  const member = useMember()
  const { code = '' } = useParams()
  if (!member) return guestState('Committee')
  return <CommitteeBody key={member.termId + code} api={api} termId={member.termId} code={code} />
}

function CommitteeBody({ api, termId, code }: { api?: CommitteePagesApi; termId: string; code: string }) {
  const state = useBoard(api?.board, termId)
  const back = <Link className="committee-page__back" to="/team/committees"><ArrowLeft className="icon" size={16} aria-hidden="true" />All committees</Link>
  return <BoardGate state={state} title={<>{back}<PageHeading title="Committee" /></>}>{board => {
    const unit = findUnit(board.units, [code])
    if (!unit) return <>{back}<PageHeading title="Committee not found" /><EmptyState title={`No committee called “${code}” this term`} description="It may have been renamed. Pick one from the list." action={<Link className="button button--secondary" to="/team/committees">All committees</Link>} /></>
    return <>{back}<CommitteeOnePager api={api} termId={termId} board={board} unit={unit} /></>
  }}</BoardGate>
}

function CommitteeOnePager({ api, termId, board, unit }: { api?: CommitteePagesApi; termId: string; board: Board; unit: BoardUnit }) {
  const content = contentForCode(unit.code)
  const { inside, linked } = innerTeams(content, board.units)
  const parent = content?.parent ? committeeContent.find(c => c.key === content.parent) ?? null : null
  const parentUnit = parent ? findUnit(board.units, parent.codes) : null
  const service = unit.services[0] ?? null
  const heads = leadContacts(unit)
  const ask = service
    ? <Link className="button" to={'/requests/services/' + service.id + '/new'}><Send className="icon" size={16} aria-hidden="true" />Ask us</Link>
    : heads[0]?.contact ? <a className="button" href={'mailto:' + heads[0].contact}><Mail className="icon" size={16} aria-hidden="true" />Ask us</a> : null
  const deliverables = board.deliverables.filter(d => d.unitId === unit.id && d.state !== 'cancelled')
  const supporting = board.deliverables.filter(d => d.unitId !== unit.id && d.supportingUnitIds.includes(unit.id) && d.state !== 'cancelled')
  const incoming = board.asks.filter(a => a.toUnitId === unit.id)
  const outgoing = board.asks.filter(a => a.fromUnitId === unit.id && a.toUnitId !== unit.id)
  const unitName = (id: string | null) => board.units.find(u => u.id === id)?.name ?? 'another committee'

  return <article className="committee-page">
    <header className="committee-page__header">
      <h1>{unit.name} <span className="muted">({unit.code})</span></h1>
      <p className="committee-page__lede">{content?.description ?? 'No description yet. Heads can add one in the committee content file.'}</p>
      {parentUnit && parentUnit.id !== unit.id ? <p className="muted">Part of <Link to={pagePath(parentUnit)}>{parentUnit.name}</Link>.</p> : null}
      {ask ? <div className="committee-page__ask">{ask}<span className="muted">{service ? service.label : 'Opens an email to the head'}</span></div> : null}
    </header>

    <QuickLinks key={unit.id} api={api} termId={termId} unitId={unit.id} unitName={unit.name} />

    {content ? <div className="committee-page__primer">
      <section aria-labelledby="committee-delivers">
        <h2 id="committee-delivers">What we deliver</h2>
        <ul className="committee-page__bullets">{content.deliverables.map(d => <li key={d}>{d}</li>)}</ul>
        {inside.map(team => <div key={team.key} className="committee-page__team">
          <h3>{team.name}</h3><p>{team.description}</p>
          <p className="muted">{team.deliverables.join(' · ')}</p>
        </div>)}
        {linked.length ? <p className="muted">Also with us: {linked.map((l, i) => <span key={l.unit.id}>{i ? ', ' : ''}<Link to={pagePath(l.unit)}>{l.unit.name}</Link></span>)}</p> : null}
      </section>
      <section aria-labelledby="committee-skills">
        <h2 id="committee-skills">Skills that help</h2>
        <ul className="committee-page__skills">{content.skills.map(s => <li key={s}>{s}</li>)}</ul>
      </section>
    </div> : null}

    <Panel title="People">
      {!unit.people.length ? <p className="muted">No one is listed for {unit.name} yet, or the directory is hidden for you.</p>
        : <ul className="committee-page__people">{unit.people.map(p => <li key={p.id}>
          <span className="committee-page__person">{p.name}</span>
          <span className="muted">{roleLabel[p.role]}</span>
          {p.contact && p.role !== 'member' ? <a href={'mailto:' + p.contact}>{p.contact}</a> : null}
        </li>)}</ul>}
    </Panel>

    <Panel title="Deliverables">
      {!deliverables.length ? <p className="muted">{unit.name} doesn't lead any deliverables yet.</p>
        : <ul className="committee-page__list">{deliverables.map(d => <DeliverableRow key={d.id} d={d} today={board.today} />)}</ul>}
      {supporting.length ? <><h3>Helping with</h3><ul className="committee-page__list">{supporting.map(d => <DeliverableRow key={d.id} d={d} today={board.today} />)}</ul></> : null}
      <Link className="button button--secondary" to={'/deliverables?unit=' + unit.id}>All {unit.name} deliverables<ArrowRight className="icon" size={16} aria-hidden="true" /></Link>
    </Panel>

    <Panel title="Open asks">
      <div className="committee-page__asks">
        <AskList title="Asked of us" empty="Nothing waiting on us." asks={incoming} other={a => 'From ' + unitName(a.fromUnitId)} />
        <AskList title="We asked" empty="We're not waiting on anyone." asks={outgoing} other={a => 'To ' + unitName(a.toUnitId)} />
      </div>
    </Panel>

    <Upcoming api={api} termId={termId} unit={unit} today={board.today} />
    <Pinned api={api} termId={termId} unit={unit} />
  </article>
}

function DeliverableRow({ d, today }: { d: BoardDeliverable; today: string }) {
  const h = health(d, today)
  const value = Math.round(progress(d) * 100)
  const steps = d.state === 'accepted' ? 'Accepted' : d.state === 'submitted' ? 'Submitted for review' : d.tasksTotal ? `${d.tasksDone} of ${d.tasksTotal} steps done` : 'No checklist yet'
  return <li>
    <h3><Link to={'/deliverables/' + d.id}>{d.title}</Link></h3>
    <p><Status state={h} label={healthLabel[h]} tone={healthTone[h]} /> · {d.dueAt ?? d.dueOn ? formatDue(d.dueAt ?? d.dueOn) : 'No due date'} · {d.ownerName}</p>
    <div className="committee-page__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={`Checklist for ${d.title}`} aria-valuetext={steps}><span style={{ inlineSize: value + '%' }} /></div>
    <p className="muted">{steps}{d.waiting ? ' · waiting on another committee' : ''}</p>
  </li>
}

function AskList({ title, empty, asks, other }: { title: string; empty: string; asks: BoardAsk[]; other: (a: BoardAsk) => string }) {
  return <section>
    <h3>{title}</h3>
    {!asks.length ? <p className="muted">{empty}</p> : <ul className="committee-page__list">{asks.map(a => <li key={a.kind + a.id}>
      <Link to={a.href}>{a.title}</Link>
      <p className="muted">{other(a)} · {a.kind === 'handoff' ? 'Handoff' : 'Agreement'} · <Status state={a.state} label={askState(a)} />{a.dueOn ? ' · ' + formatDue(a.dueOn) : ''}</p>
    </li>)}</ul>}
  </section>
}

function askState(a: BoardAsk): string {
  if (a.state === 'proposed') return 'Waiting for a reply'
  if (a.state === 'countered') return 'New terms offered'
  if (a.state === 'changes_requested') return 'Changes asked'
  if (a.state === 'accepted') return 'Agreed, in progress'
  return a.state.replaceAll('_', ' ')
}

function useLoad<T>(load: (() => Promise<T>) | null, key: string): { value: T | null; failed: boolean } | null {
  const [state, setState] = useState<{ key: string; value: T | null; failed: boolean } | null>(null)
  useEffect(() => {
    if (!load) return
    let live = true
    load().then(value => { if (live) setState({ key, value, failed: false }) }, () => { if (live) setState({ key, value: null, failed: true }) })
    return () => { live = false }
    // The key identifies the request; the loader closure is recreated each render.
  }, [key])
  return state?.key === key ? state : null
}

function Upcoming({ api, termId, unit, today }: { api?: CommitteePagesApi; termId: string; unit: BoardUnit; today: string }) {
  const result = useLoad(api ? () => api.upcoming(termId, unit.id, today) : null, termId + unit.id + today)
  return <Panel title="Coming up">
    {!api ? <p className="muted">The calendar isn't connected.</p>
      : !result ? <LoadingState title="Loading the calendar" rows={2} />
      : result.failed || !result.value ? <p className="muted">The calendar didn't load. <Link to="/calendar">Open the calendar</Link></p>
      : !result.value.length ? <p className="muted">Nothing on the calendar for the next 60 days.</p>
      : <ul className="committee-page__list">{result.value.map(e => <li key={e.key}>
        <CalendarDays className="icon" size={16} aria-hidden="true" /> <strong>{formatDay(e.startsAt ?? e.startOn)}{!e.allDay && e.startsAt ? ', ' + formatTime(e.startsAt) : ''}</strong> · {e.href ? <Link to={e.href}>{e.title}</Link> : e.title}
        {e.location ? <span className="muted"> · {e.location}</span> : null}
      </li>)}</ul>}
    <Link className="button button--secondary" to="/calendar">Calendar<ArrowRight className="icon" size={16} aria-hidden="true" /></Link>
  </Panel>
}

function Pinned({ api, termId, unit }: { api?: CommitteePagesApi; termId: string; unit: BoardUnit }) {
  const result = useLoad<Resource[]>(api ? () => api.pinned(termId, unit.id) : null, termId + unit.id)
  if (!api || !result || result.failed || !result.value?.length) return null
  return <Panel title="Pinned guides">
    <ul className="committee-page__list">{result.value.map(r => <li key={r.id}>
      <Link to={'/resources?resource=' + r.id}>{r.label}</Link>{r.essential ? <span className="muted"> · Start here</span> : null}
    </li>)}</ul>
  </Panel>
}

