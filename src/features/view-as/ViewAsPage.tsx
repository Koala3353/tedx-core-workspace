import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useRouteLoaderData } from 'react-router'
import { Eye, Search } from 'lucide-react'
import { AppShell } from '../../app/AppShell'
import { SamplePreviewContent, canViewRealMember, memberNavigation, memberPreviewPath } from '../../app/MemberPreview'
import { PageHeading } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { Status } from '../../components/Status'
import { dueState, formatDayLabel, relativeDue, timeAgo } from '../../lib/format'
import type { WorkspaceContext } from '../auth/gateway'
import type { OwnedTask } from '../tasks/api'
import { buildSections, fromOverview, type TodayItem } from '../today/model'
import { TodaySection } from '../today/TodayList'
import type { DirectoryMember, MemberPreviewResult, PreviewView, ViewAsApi, ViewAsOutcome } from './api'
import '../today/today.css'
import './view-as.css'

type Choice = { kind: 'sample' } | { kind: 'member'; member: DirectoryMember } | null
type Ready<V extends PreviewView> = Extract<MemberPreviewResult<V>, { state: 'ok' }>

const lockedHint = 'Read-only preview'

/**
 * Member preview, route "/member-preview/*". Full admins pick a real member and see that
 * member's Today, Work and notifications, read-only. Everyone else (or a database without the
 * preview functions) gets the sample member.
 */
export function ViewAsPage({ api }: { api?: ViewAsApi }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  const path = useLocation().pathname.toLowerCase().slice(memberPreviewPath.length).replace(/\/$/, '') || '/'
  const live = !!api && !!context && canViewRealMember(context)
  const [choice, setChoice] = useState<Choice>(live ? null : { kind: 'sample' })

  const name = choice?.kind === 'member' ? choice.member.name : choice?.kind === 'sample' ? 'Sample member' : 'Pick a member'
  const unit = choice?.kind === 'member' ? [choice.member.committee, choice.member.position].filter(Boolean).join(' · ') : choice?.kind === 'sample' ? 'Stage Management Core' : undefined

  let content: ReactNode
  if (!choice || !context) {
    content = api && context ? <Picker api={api} termId={context.termId} onPick={setChoice} /> : <LoadingState />
  } else {
    content = <>
      <Banner name={name} sample={choice.kind === 'sample'} onExit={live ? () => setChoice(null) : undefined} />
      {choice.kind === 'sample' || !api ? <SamplePreviewContent path={path} />
        : <MemberContent key={choice.member.membershipId} api={api} termId={context.termId} member={choice.member} path={path} onSample={() => setChoice({ kind: 'sample' })} />}
    </>
  }

  return <AppShell
    context={memberNavigation}
    identity={{ displayName: name, unitName: unit || undefined }}
    preview={false}
    memberPreviewPath={memberPreviewPath}
    headerAction={<Link className="button" replace to="/admin">Return to admin view</Link>}
    content={content}
  />
}

function Banner({ name, sample, onExit }: { name: string; sample: boolean; onExit?: () => void }) {
  return <div className="view-as-banner" role="status">
    <Eye className="icon" size={18} strokeWidth={1.75} aria-hidden="true" />
    <p className="view-as-banner__text">Viewing as <strong>{name}</strong><span aria-hidden="true"> · </span><span className="visually-hidden">, </span>{sample ? 'sample data' : 'read-only'}</p>
    {onExit
      ? <button className="button button--secondary view-as-banner__exit" type="button" onClick={onExit}>Exit</button>
      : <Link className="button button--secondary view-as-banner__exit" replace to="/admin">Exit</Link>}
  </div>
}

/** A button that looks like the member's real action but does nothing here. */
function Locked({ children }: { children: ReactNode }) {
  return <button className="button button--secondary view-as-locked" type="button" aria-disabled="true" title={lockedHint}
    onClick={event => event.preventDefault()}>{children}<span className="visually-hidden"> ({lockedHint.toLowerCase()})</span></button>
}

function Picker({ api, termId, onPick }: { api: ViewAsApi; termId: string; onPick: (choice: Choice) => void }) {
  const [state, setState] = useState<{ key: number; outcome: ViewAsOutcome<DirectoryMember[]> } | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [query, setQuery] = useState('')
  const [committee, setCommittee] = useState('')

  useEffect(() => {
    let live = true
    void api.directory(termId).then(outcome => { if (live) setState({ key: epoch, outcome }) })
    return () => { live = false }
  }, [api, termId, epoch])

  const outcome = state?.key === epoch ? state.outcome : null
  const people = useMemo(() => outcome?.ok ? outcome.value : [], [outcome])
  const committees = useMemo(() => [...new Set(people.map(p => p.committee).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)), [people])
  const needle = query.trim().toLowerCase()
  const filtered = people.filter(p => (!needle || p.name.toLowerCase().includes(needle))
    && (!committee || (committee === '-' ? !p.committee : p.committee === committee)))
  const sample = <button className="button button--secondary" type="button" onClick={() => onPick({ kind: 'sample' })}>Use a sample member</button>

  return <div className="view-as">
    <PageHeading title="View as a member" description="Pick someone to see their Today, Work and notifications. You can look around, but nothing here changes their work." />
    {!outcome ? <LoadingState title="Loading the member list" />
      : !outcome.ok ? <div className="view-as-fallback">
        <p>{outcome.reason === 'not_deployed' ? 'Viewing a real member is not set up yet. You can still look around as a sample member.'
          : outcome.reason === 'denied' ? 'Only full admins can view a real member. You can still look around as a sample member.'
            : 'The member list could not load. Check your connection, then try again.'}</p>
        <div className="view-as-actions">
          {outcome.reason === 'unavailable' ? <button className="button button--secondary" type="button" onClick={() => setEpoch(n => n + 1)}>Try again</button> : null}
          {sample}
        </div>
      </div>
        : <>
          <div className="view-as-filters">
            <div className="view-as-search">
              <Search className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />
              <label htmlFor="view-as-search" className="visually-hidden">Search by name</label>
              <input id="view-as-search" type="search" placeholder="Search by name" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <label className="view-as-filter">Committee
              <select value={committee} onChange={e => setCommittee(e.target.value)}>
                <option value="">All committees</option>
                {committees.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="-">No committee yet</option>
              </select>
            </label>
            {sample}
          </div>
          {!filtered.length
            ? <EmptyState title="No one matches" description="Clear the search or pick another committee."
              action={<button className="button button--secondary" type="button" onClick={() => { setQuery(''); setCommittee('') }}>Clear filters</button>} />
            : <ul className="view-as-people" aria-label="Members">
              {filtered.map(person => <li key={person.membershipId}>
                <button className="view-as-person" type="button" onClick={() => onPick({ kind: 'member', member: person })}>
                  <span className="view-as-person__name">{person.name}{person.isSelf ? <span className="view-as-person__you"> (you)</span> : null}</span>
                  <span className="view-as-person__meta">{[person.committee ?? 'No committee yet', person.position].filter(Boolean).join(' · ')}</span>
                  {!person.signedIn ? <Status state="not_started" label="Not signed in yet" /> : null}
                </button>
              </li>)}
            </ul>}
        </>}
  </div>
}

function usePreview<V extends PreviewView>(api: ViewAsApi, termId: string, membershipId: string, view: V, epoch: number) {
  const key = `${membershipId}:${view}:${epoch}`
  const [state, setState] = useState<{ key: string; outcome: ViewAsOutcome<MemberPreviewResult<V>> } | null>(null)
  useEffect(() => {
    let live = true
    void api.view(termId, membershipId, view).then(outcome => { if (live) setState({ key, outcome }) })
    return () => { live = false }
  }, [api, termId, membershipId, view, key])
  return state?.key === key ? state.outcome : null
}

type Shared = { api: ViewAsApi; termId: string; member: DirectoryMember; onSample: () => void }

function MemberContent({ path, ...shared }: Shared & { path: string }) {
  if (path === '/') return <PreviewToday {...shared} />
  if (path === '/work') return <PreviewWork {...shared} />
  if (path === '/notifications') return <PreviewNotifications {...shared} />
  return <EmptyState title="Not part of this preview" description={`Only Today, Work and Notifications show ${shared.member.name}’s real data.`}
    action={<Link className="button button--secondary" to={memberPreviewPath}>Go to their Today</Link>} />
}

/** Loading, refusal and empty states shared by every preview page. Renders children only with data. */
function Gate<V extends PreviewView>({ outcome, member, onRetry, onSample, children }: {
  outcome: ViewAsOutcome<MemberPreviewResult<V>> | null; member: DirectoryMember; onRetry: () => void; onSample: () => void; children: (ready: Ready<V>) => ReactNode
}) {
  if (!outcome) return <LoadingState title={`Loading ${member.name}’s view`} />
  if (!outcome.ok) {
    if (outcome.reason === 'not_deployed') return <ErrorState title="Viewing a real member is not set up yet" description="The database update for this page is not applied. Use the sample member for now."
      action={<button className="button button--secondary" type="button" onClick={onSample}>Use a sample member</button>} />
    if (outcome.reason === 'denied') return <ErrorState title="Only full admins can view a real member" description="Ask an admin who can manage roles to open this page." />
    return <ErrorState title="This view could not load" description="Check your connection, then try again."
      action={<button className="button button--secondary" type="button" onClick={onRetry}>Try again</button>} />
  }
  const result = outcome.value
  if (result.state === 'not_signed_in_yet') return <EmptyState title={`${member.name} has not signed in yet`}
    description="Their pages fill in after their first sign-in. Pick someone else, or send a sign-in reminder from Team setup."
    action={<Link className="button button--secondary" to="/team/setup">Open Team setup</Link>} />
  if (result.state === 'unavailable') return <EmptyState title={`${member.name} can’t open this page`} description="Their account does not have access to it right now." />
  return <>{children(result as Ready<V>)}</>
}

function PreviewToday({ api, termId, member, onSample }: Shared) {
  const [epoch, setEpoch] = useState(0)
  const outcome = usePreview(api, termId, member.membershipId, 'today', epoch)
  return <div className="today">
    <header className="today-head">
      <div><h1>Today</h1><p className="today-head__summary"><span>{summaryFor(outcome)}</span></p></div>
      <Locked>Customize</Locked>
    </header>
    <div className="today-body" title={lockedHint}>
      <Gate outcome={outcome} member={member} onRetry={() => setEpoch(n => n + 1)} onSample={onSample}>{ready => {
        const sections = buildSections(ready.data.items, [], [])
        return <>
          <TodaySection title="Overdue" items={sections.overdue} illustrative />
          <TodaySection title="Needs their OK" items={sections.needsOk} illustrative />
          <TodaySection title="Incoming" items={sections.incoming} illustrative />
          <TodaySection title="Due this week" items={sections.week} illustrative />
          {sections.count === 0 ? <p className="view-as-note">Nothing needs {member.name} right now.</p> : null}
          <TodaySection title="Later" items={sections.later} illustrative collapsible />
          <TodaySection title="Waiting on others" items={sections.waiting} illustrative collapsible />
          {ready.data.hasMore ? <p className="today-more">Showing their first 50 items.</p> : null}
          <p className="view-as-note">Announcements and calendar dates are not part of this preview.</p>
        </>
      }}</Gate>
    </div>
  </div>
}

function summaryFor(outcome: ViewAsOutcome<MemberPreviewResult<'today'>> | null) {
  const today = formatDayLabel(new Date())
  if (!outcome?.ok || outcome.value.state !== 'ok') return today
  const count = buildSections(outcome.value.data.items, [], []).count
  return count === 0 ? `${today} · nothing needs them` : `${today} · ${count} ${count === 1 ? 'thing needs' : 'things need'} them`
}

const categoryLabels: Record<string, string> = {
  draft: 'Draft', active: 'In progress', needs_revision: 'Needs changes', approved: 'Approved', completed: 'Done', rejected: 'Not approved', cancelled: 'Cancelled',
}

function ownedItem(task: OwnedTask, now: Date): TodayItem {
  const late = task.overdue || dueState(task, now) === 'late'
  return {
    key: 'owned:' + task.id, kind: 'task', title: task.title, who: categoryLabels[task.category] ?? 'Task',
    when: relativeDue(task, now), late, href: `/tasks/${task.id}`, verb: 'Open', sortAt: 0,
  }
}

function PreviewWork({ api, termId, member, onSample }: Shared) {
  const [epoch, setEpoch] = useState(0)
  const today = usePreview(api, termId, member.membershipId, 'today', epoch)
  const work = usePreview(api, termId, member.membershipId, 'work', epoch)
  const retry = () => setEpoch(n => n + 1)
  return <div className="hub view-as">
    <PageHeading title="Work" description={`Tasks, deliverables and asks for ${member.name}.`} />
    <div className="view-as-actions"><Locked>Ask a committee</Locked><Locked>New task</Locked></div>
    <div title={lockedHint}>
      <Gate outcome={today} member={member} onRetry={retry} onSample={onSample}>{ready => {
        const now = new Date()
        const mine = ready.data.items.filter(row => row.lane === 'actionable').map(row => fromOverview(row, now)).sort((a, b) => a.sortAt - b.sortAt)
        const waiting = ready.data.items.filter(row => row.lane === 'waiting').map(row => fromOverview(row, now)).sort((a, b) => a.sortAt - b.sortAt)
        return <>
          <TodaySection title="On them" items={mine} illustrative />
          <TodaySection title="Waiting on others" items={waiting} illustrative collapsible />
          {!mine.length && !waiting.length ? <p className="view-as-note">Nothing assigned to {member.name} right now.</p> : null}
        </>
      }}</Gate>
      {today?.ok && today.value.state === 'ok' ? <Gate outcome={work} member={member} onRetry={retry} onSample={onSample}>{ready => {
        const now = new Date()
        const owned = ready.data.items.map(task => ownedItem(task, now))
        return owned.length
          ? <TodaySection title="Tasks they own" items={owned} illustrative>
            {ready.data.total > owned.length ? <p className="today-more">Showing {owned.length} of {ready.data.total}.</p> : null}
          </TodaySection>
          : <p className="view-as-note">{member.name} owns no tasks yet.</p>
      }}</Gate> : null}
    </div>
  </div>
}

function PreviewNotifications({ api, termId, member, onSample }: Shared) {
  const [epoch, setEpoch] = useState(0)
  const outcome = usePreview(api, termId, member.membershipId, 'notifications', epoch)
  return <div className="view-as">
    <PageHeading title="Notifications" description={outcome?.ok && outcome.value.state === 'ok' ? `${outcome.value.data.unread} unread` : undefined} />
    <Gate outcome={outcome} member={member} onRetry={() => setEpoch(n => n + 1)} onSample={onSample}>{ready => ready.data.items.length
      ? <ul className="view-as-list" title={lockedHint}>
        {ready.data.items.map(item => <li key={item.id} className="view-as-list__row">
          <span className="view-as-list__text">
            <span className="view-as-list__title">{item.label}</span>
            <span className="view-as-list__meta">
              <Status state={item.read ? 'done' : 'pending'} label={item.read ? 'Read' : 'Unread'} />
              <span>{timeAgo(item.at)}</span>
            </span>
          </span>
          {!item.read ? <Locked>Mark as read</Locked> : null}
        </li>)}
      </ul>
      : <EmptyState title="No notifications" description={`${member.name} has nothing here yet.`} />}
    </Gate>
  </div>
}
