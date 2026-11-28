import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useRouteLoaderData } from 'react-router'
import { Eye } from 'lucide-react'
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
import { MemberCombobox, memberOption, sampleOption, sampleOptionId, type PreviewOption } from './MemberCombobox'
import '../today/today.css'
import './view-as.css'

type Ready<V extends PreviewView> = Extract<MemberPreviewResult<V>, { state: 'ok' }>

const lockedHint = 'Read-only preview'
/** Query parameter that names the previewed member, so a preview link is shareable and survives reload. */
const memberParam = 'member'

/**
 * Member preview, route "/member-preview/*". Starts as the sample member. Full admins can switch
 * to any real member from the roster without leaving the page and see that member's Today, Work
 * and notifications, read-only. The choice lives in ?member=<membership id>.
 */
export function ViewAsPage({ api }: { api?: ViewAsApi }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  const location = useLocation()
  const navigate = useNavigate()
  const path = location.pathname.toLowerCase().slice(memberPreviewPath.length).replace(/\/$/, '') || '/'
  const live = !!api && !!context && canViewRealMember(context)
  const termId = context?.termId
  const urlMember = new URLSearchParams(location.search).get(memberParam)

  // The shell's nav links drop the query string. When the sub-page changes and the member
  // disappears from the URL, carry the last member over (and put it back in the URL below).
  // Removing it on the same page (picking the sample member) is an explicit choice and sticks.
  const [remembered, setRemembered] = useState<{ path: string; memberId: string | null }>({ path, memberId: urlMember })
  const carried = !urlMember && remembered.memberId && remembered.path !== path ? remembered.memberId : null
  if (!carried && (remembered.path !== path || remembered.memberId !== urlMember)) setRemembered({ path, memberId: urlMember })
  useEffect(() => {
    if (carried) void navigate({ pathname: location.pathname, search: `?${memberParam}=${encodeURIComponent(carried)}`, hash: location.hash }, { replace: true })
  }, [carried, navigate, location.pathname, location.hash])

  const [directory, setDirectory] = useState<{ key: string; outcome: ViewAsOutcome<DirectoryMember[]> } | null>(null)
  const [epoch, setEpoch] = useState(0)
  const directoryKey = `${termId}:${epoch}`
  useEffect(() => {
    if (!live || !api || !termId) return
    let active = true
    void api.directory(termId).then(outcome => { if (active) setDirectory({ key: directoryKey, outcome }) })
    return () => { active = false }
  }, [live, api, termId, directoryKey])
  const roster = live && directory?.key === directoryKey ? directory.outcome : null

  const options = useMemo(() => [sampleOption, ...(roster?.ok ? roster.value.map(memberOption) : [])], [roster])
  const requestedId = urlMember ?? carried
  const wanted = live ? requestedId : null
  const member = wanted && roster?.ok ? roster.value.find(person => person.membershipId === wanted) : undefined
  const loadingMember = !!wanted && !roster
  const notFound = !!wanted && !!roster?.ok && !member

  function select(option: PreviewOption) {
    const search = option.id === sampleOptionId ? '' : `?${memberParam}=${encodeURIComponent(option.id)}`
    void navigate({ pathname: location.pathname, search })
  }
  const toSample = () => select(sampleOption)

  const name = member ? member.name : loadingMember ? 'Loading member' : sampleOption.label
  const unit = member ? [member.committee, member.position].filter(Boolean).join(' · ') : loadingMember ? '' : 'Stage Management Core'

  let hint: ReactNode
  if (!context) hint = null
  else if (!canViewRealMember(context)) hint = <>Only admins who can also manage roles can preview a real member, so the sample member is the only choice here.{requestedId ? ' The member in this link is not shown.' : null}</>
  else if (!api) hint = 'Real members are not available in this build. Showing the sample member.'
  else if (!roster) hint = 'Loading the member list.'
  else if (!roster.ok) hint = roster.reason === 'not_deployed' ? 'Previewing a real member is not set up yet, so only the sample member is available.'
    : roster.reason === 'denied' ? 'Only admins who can also manage roles can preview a real member, so only the sample member is available.'
      : 'The member list could not load. Check your connection, then try again.'
  else if (notFound) hint = 'That link does not match anyone on this term’s roster. Showing the sample member.'
  else if (member) hint = 'Read-only. Nothing you do here changes their work. Navigation shows what a member sees; Today, Work and Notifications show their real data.'
  else hint = 'Sample data. Pick a member to see their real Today, Work and notifications.'
  const retry = live && roster && !roster.ok && roster.reason === 'unavailable'

  let content: ReactNode
  if (!context) content = <LoadingState />
  else content = <>
    <section className="view-as-banner" aria-label="Member preview">
      <Eye className="icon" size={18} strokeWidth={1.75} aria-hidden="true" />
      <div className="view-as-banner__body">
        <MemberCombobox label="Previewing as" options={options} selectedId={member?.membershipId ?? sampleOptionId} onSelect={select} />
        {hint ? <p className="view-as-banner__hint">{hint}</p> : null}
        {retry ? <button className="button button--secondary view-as-banner__retry" type="button" onClick={() => setEpoch(n => n + 1)}>Try again</button> : null}
      </div>
      <Link className="button button--secondary view-as-banner__exit" replace to="/admin">Exit preview</Link>
      <p className="visually-hidden" role="status">{loadingMember ? '' : `Viewing as ${name}, ${member ? 'read-only' : 'sample data'}`}</p>
    </section>
    {loadingMember ? <LoadingState title="Loading the member list" />
      : member && api ? <MemberContent key={member.membershipId} api={api} termId={context.termId} member={member} path={path} onSample={toSample} />
        : <SamplePreviewContent path={path} />}
  </>

  return <AppShell
    context={memberNavigation}
    identity={{ displayName: name, unitName: unit || undefined }}
    preview={false}
    memberPreviewPath={memberPreviewPath}
    headerAction={<Link className="button" replace to="/admin">Return to admin view</Link>}
    content={content}
  />
}

/** A button that looks like the member's real action but does nothing here. */
function Locked({ children }: { children: ReactNode }) {
  return <button className="button button--secondary view-as-locked" type="button" aria-disabled="true" title={lockedHint}
    onClick={event => event.preventDefault()}>{children}<span className="visually-hidden"> ({lockedHint.toLowerCase()})</span></button>
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
    if (outcome.reason === 'not_deployed') return <ErrorState title="Viewing a real member is not set up yet" description="This needs a workspace update that hasn't been applied yet. Ask the workspace maintainer, and use the sample member for now."
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
