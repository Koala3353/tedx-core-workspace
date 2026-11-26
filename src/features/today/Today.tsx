import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useRouteLoaderData } from 'react-router'
import { RefreshCw, SlidersHorizontal, SquarePen } from 'lucide-react'
import { useShellServices } from '../../app/shellServices'
import { CountdownChip } from '../../components/Countdown'
import { ErrorState } from '../../components/FeedbackState'
import { SkeletonRows } from '../../components/BrandLoader'
import { Menu, type MenuEntry } from '../../components/Menu'
import { formatDayLabel } from '../../lib/format'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import type { OverviewResult } from '../overview/api'
import type { Announcement } from '../announcements/api'
import type { CalendarEvent } from '../calendar/api'
import { TaskEditor } from '../tasks/TaskEditor'
import { InstallBanner } from '../install/InstallBanner'
import { replayTour } from '../tutorial/events'
import { onPageReturn } from '../../lib/pageReturn'
import { buildSections, comingUpWindow, type TodayItem } from './model'
import { TodaySection } from './TodayList'
import './today.css'

type Loaded = { overview: OverviewResult | null; overviewError: boolean; announcements: Announcement[]; events: CalendarEvent[] }

/** Today: everything that needs you now, one verb per row. Route "/". */
export function TodayPage() {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  if (!context || isGuest(context)) return null
  return <TodayBody key={context.termId + context.termMembershipId} context={context} />
}

function TodayBody({ context }: { context: Extract<WorkspaceContext, { memberId: string }> }) {
  const { gateway } = useShellServices()
  const navigate = useNavigate()
  const termId = context.termId
  const [data, setData] = useState<Loaded | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [adding, setAdding] = useState(false)
  const ackKeys = useRef(new Map<string, string>())
  const overview = gateway?.overview, announcements = gateway?.announcements, calendar = gateway?.calendar

  useEffect(() => {
    let live = true
    const range = comingUpWindow()
    // Announcements and dates are optional extras: their failure never hides your work.
    void Promise.all([
      overview ? overview.read(termId).then(value => ({ value, error: false }), () => ({ value: null, error: true })) : Promise.resolve({ value: null, error: true }),
      announcements ? announcements.list(termId, 1).then(page => page.items, () => [] as Announcement[]) : Promise.resolve([] as Announcement[]),
      calendar ? calendar.read(termId, range.from, range.to, null, 1).then(result => result.items, () => [] as CalendarEvent[]) : Promise.resolve([] as CalendarEvent[]),
    ]).then(([overviewResult, announcementItems, events]) => {
      if (live) setData({ overview: overviewResult.value, overviewError: overviewResult.error, announcements: announcementItems, events })
    })
    return () => { live = false }
  }, [overview, announcements, calendar, termId, epoch])

  // Refresh in place when the person comes back to the tab; the current list stays visible.
  // Focus and visibility both fire on a return; onPageReturn turns them into one refresh.
  useEffect(() => onPageReturn(() => setEpoch(n => n + 1)), [])

  const acknowledge = useCallback(async (item: TodayItem): Promise<string | null> => {
    const a = item.announcement
    if (!a || !announcements) return 'Open the announcement to acknowledge it.'
    const key = ackKeys.current.get(a.id) ?? crypto.randomUUID()
    ackKeys.current.set(a.id, key)
    const result = await announcements.run({ action: 'ack', term: termId, id: a.id, materialRevisionId: a.materialRevisionId, version: a.version }, key)
    if (result.ok) { ackKeys.current.delete(a.id); return null }
    if (!result.error.retryable) ackKeys.current.delete(a.id)
    return result.error.kind === 'stale_version' ? 'This announcement changed. Open it to read the latest version.' : result.error.message
  }, [announcements, termId])

  const sections = data?.overview ? buildSections(data.overview.items, data.announcements, data.events) : null
  const manager = context.capabilities.some(capability => ['admin.configure', 'committee.manage'].includes(capability))
  const customize: MenuEntry[] = [
    ...(gateway?.tasks?.execute ? [{ kind: 'action' as const, label: 'Add a personal task', icon: <SquarePen size={16} strokeWidth={1.75} />, onSelect: () => setAdding(true) }] : []),
    { kind: 'action', label: 'Refresh', icon: <RefreshCw size={16} strokeWidth={1.75} />, onSelect: () => setEpoch(n => n + 1) },
    { kind: 'separator' },
    { kind: 'link', label: 'All announcements', to: '/announcements' },
    { kind: 'link', label: 'Classic overview', to: '/overview', hint: 'Layouts, shortcuts and phase' },
    ...(manager ? [{ kind: 'link' as const, label: 'Publish a team layout', to: '/admin/layouts' }] : []),
    { kind: 'action', label: 'Replay the tour', onSelect: replayTour },
  ]

  const today = formatDayLabel(new Date())
  const summary = !sections ? today
    : sections.count === 0 ? `${today} · nothing needs you`
      : `${today} · ${sections.count} ${sections.count === 1 ? 'thing needs' : 'things need'} you`

  return <div className="today">
    <header className="today-head">
      <div>
        <h1>Today</h1>
        <p className="today-head__summary"><span>{summary}</span><CountdownChip className="today-head__countdown" /></p>
      </div>
      <Menu label="Customize Today" align="end" triggerClassName="button button--secondary today-customize"
        trigger={<><SlidersHorizontal className="icon" size={16} strokeWidth={1.75} aria-hidden="true" /><span>Customize</span></>} entries={customize} />
    </header>

    <InstallBanner />

    {adding && gateway?.tasks?.execute ? <section className="today-add panel-reveal" aria-label="Add a personal task">
      <div className="today-add__head"><h2>Add a personal task</h2><button className="button button--secondary" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
      <TaskEditor personal termId={termId} api={gateway.tasks} onSaved={id => void navigate('/tasks/' + id)} />
    </section> : null}

    <div data-tour="today-list" className="today-body">
      {!data ? <div role="status" aria-live="polite"><span className="visually-hidden">Loading what needs you</span><SkeletonRows rows={4} /></div>
        : data.overviewError || !sections ? <ErrorState title="Today could not load" description="Check your connection, then try again." action={<button className="button button--secondary" type="button" onClick={() => setEpoch(n => n + 1)}>Try again</button>} />
          : <>
            <TodaySection title="Overdue" items={sections.overdue} onAcknowledge={acknowledge} tourFirstVerb />
            <TodaySection title="Needs your OK" items={sections.needsOk} onAcknowledge={acknowledge} tourFirstVerb={!sections.overdue.length} />
            <TodaySection title="Incoming" items={sections.incoming} tourFirstVerb={!sections.overdue.length && !sections.needsOk.length} />
            <TodaySection title="Due this week" items={sections.week} tourFirstVerb={!sections.overdue.length && !sections.needsOk.length && !sections.incoming.length} />
            {sections.count === 0 ? <AllCaughtUp next={sections.nextDeadline} /> : null}
            <TodaySection title="Coming up" items={sections.comingUp} />
            <TodaySection title="Later" items={sections.later} collapsible />
            <TodaySection title="Waiting on others" items={sections.waiting} collapsible />
            {data.overview?.hasMore ? <p className="today-more">Showing your first 50 items. <Link to="/work">See everything in Work</Link>.</p> : null}
          </>}
    </div>
  </div>
}

function AllCaughtUp({ next }: { next: TodayItem | null }) {
  return <section className="today-clear" aria-label="All caught up">
    <p className="today-clear__title">You’re all caught up.</p>
    {next ? <p className="today-clear__next">Next deadline: <Link to={next.href}>{next.title}</Link>{next.when ? ` · ${next.when}` : ''}</p>
      : <p className="today-clear__next">New work, approvals and announcements will show up here. Need something from another committee? <Link to="/requests">Ask a committee</Link>.</p>}
  </section>
}
