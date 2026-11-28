import { useEffect, useState, type ReactNode } from 'react'
import { Link, useRouteLoaderData, useSearchParams } from 'react-router'
import { ChevronRight, SquarePlus } from 'lucide-react'
import { Countdown } from '../../components/Countdown'
import { useListEnter } from '../../components/useListEnter'
import { SkeletonRows } from '../../components/BrandLoader'
import { isGuest, type WorkspaceContext } from '../../features/auth/gateway'
import type { OverviewRow } from '../../features/overview/api'
import type { CalendarEvent } from '../../features/calendar/api'
import { fromEvent, fromOverview, comingUpWindow } from '../../features/today/model'
import { TodaySection } from '../../features/today/TodayList'
import { openPalette } from '../../features/palette/Palette'
import { navIcon } from '../navIcons'
import { useShellServices } from '../shellServices'
import { MyCommitteeLinks } from '../../features/committee-links'
import { filledSlots, type HubSlotName } from './slots'
import '../../features/today/today.css'
import './hubs.css'
import { EmptyState } from '../../components/FeedbackState'
import { AllDone } from '../../components/illustrations'

type HubLink = { id: string; to: string; label: string; description: string; icon?: string; tour?: string; capability?: string }

function useMember() {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  return context && !isGuest(context) ? context : null
}

function HubHeading({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <header className="hub-head">
    <div><h1>{title}</h1><p>{description}</p></div>
    {actions ? <div className="hub-head__actions">{actions}</div> : null}
  </header>
}

/** A list of destinations: icon, name, one line on what it is for. Rows, not cards. */
function HubLinks({ title, links, capabilities }: { title?: string; links: HubLink[]; capabilities: readonly string[] }) {
  const shown = links.filter(link => !link.capability || capabilities.includes(link.capability))
  // Hubs are visited many times a day: stagger only on the first visit this session.
  const enter = useListEnter(shown.length > 0, 'hub:' + (title ?? '') + shown.map(link => link.id).join(','))
  if (!shown.length) return null
  return <section className="hub-group" aria-label={title}>
    {title ? <h2 className="hub-group__title">{title}</h2> : null}
    <ul className={`hub-links ${enter}`.trim()}>{shown.map(link => {
      const Icon = navIcon(link.icon ?? link.id)
      return <li key={link.id + link.to}><Link className="hub-link" to={link.to} data-tour={link.tour}>
        <Icon className="icon hub-link__icon" size={18} strokeWidth={1.5} aria-hidden="true" />
        <span className="hub-link__text"><span className="hub-link__label">{link.label}</span><span className="hub-link__description">{link.description}</span></span>
        <ChevronRight className="icon hub-link__chevron" size={16} strokeWidth={1.75} aria-hidden="true" />
      </Link></li>
    })}</ul>
  </section>
}

function Slots({ names, capabilities }: { names: HubSlotName[]; capabilities: readonly string[] }) {
  const slots = filledSlots(names, capabilities)
  if (!slots.length) return null
  return <>
    <HubLinks links={slots.filter(slot => slot.href && !slot.element).map(slot => ({ id: slot.key, to: slot.href!, label: slot.label, description: slot.description, icon: slot.icon ?? slot.name }))} capabilities={capabilities} />
    {slots.filter(slot => slot.element).map(slot => <section key={slot.key} className="hub-slot" data-slot={slot.name} aria-label={slot.label}>{slot.element}</section>)}
  </>
}

const scopes = [
  { id: 'mine', label: 'Mine' },
  { id: 'committee', label: 'My committee' },
  { id: 'between', label: 'Between committees' },
  { id: 'all', label: 'Everything' },
] as const
type Scope = typeof scopes[number]['id']

/** Work: everything owed, by scope. Route "/work?scope=mine|committee|between|all". */
export function WorkHub() {
  const member = useMember()
  const [params, setParams] = useSearchParams()
  const raw = params.get('scope')
  const scope: Scope = scopes.some(s => s.id === raw) ? raw as Scope : 'mine'
  const caps = member?.capabilities ?? []
  return <div className="hub">
    <HubHeading title="Work" description="Tasks, deliverables and asks between committees."
      actions={<>
        <Link className="button button--secondary" to="/requests" data-tour="work-ask">Ask a committee</Link>
        <button className="button" type="button" onClick={() => openPalette('', 'add')}><SquarePlus className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />New task</button>
      </>} />
    <nav className="scope-tabs" aria-label="Whose work">
      {scopes.map(s => <button key={s.id} type="button" className={`scope-tab${scope === s.id ? ' is-active' : ''}`} aria-pressed={scope === s.id}
        onClick={() => { const next = new URLSearchParams(params); if (s.id === 'mine') next.delete('scope'); else next.set('scope', s.id); setParams(next, { replace: true }) }}>{s.label}</button>)}
    </nav>
    {scope === 'mine' ? <>
      {member ? <MyWork termId={member.termId} /> : null}
      <HubLinks title="Your lists" capabilities={caps} links={[
        { id: 'tasks', to: '/tasks', label: 'My tasks', description: 'Everything assigned to you' },
        { id: 'requests', to: '/requests/mine', label: 'My requests', description: 'What you asked other committees for, and where it stands' },
        { id: 'tasks', to: '/tasks?view=overdue', label: 'My overdue work', description: 'Anything past its date', icon: 'notifications' },
        { id: 'tasks', to: '/tasks?view=watching', label: 'Shared with me', description: 'Tasks you collaborate on' },
        { id: 'tasks', to: '/tasks?view=created', label: 'Tasks I created', description: 'Work you handed out' },
      ]} />
    </> : null}
    {scope === 'committee' ? <HubLinks capabilities={caps} links={[
      { id: 'committee', to: '/committee', label: 'My committee', description: 'What your members owe and what others asked of you', capability: 'committee.manage' },
      { id: 'tasks', to: '/tasks?view=unit', label: 'Committee tasks', description: 'Tasks in the committees you lead', capability: 'committee.manage' },
      { id: 'deliverables', to: '/deliverables?mine=1', label: 'Committee deliverables', description: 'Event outputs your committee is part of' },
      { id: 'department', to: '/reviews', label: 'Inbox', description: 'Requests and reviews sent to your committee', capability: 'department.review' },
      { id: 'committees', to: '/team/committees', label: 'Committees', description: 'What each committee does and who leads it', icon: 'team.committeePages' },
    ]} /> : null}
    {scope === 'between' ? <HubLinks capabilities={caps} links={[
      { id: 'requests', to: '/requests', label: 'Ask a committee', description: 'Request a room, budget, a poster or a hand from another team' },
      { id: 'working', to: '/working-together', label: 'Working together', description: 'Deals between committees: who gives what, by when' },
      { id: 'working', to: '/working-together/handoffs', label: 'Handoffs', description: 'Work passed between committees, incoming and outgoing', icon: 'requests' },
      { id: 'timeline', to: '/working-together/timeline', label: 'Timeline', description: 'Committee work laid out over the weeks' },
    ]} /> : null}
    {scope === 'all' ? <HubLinks capabilities={caps} links={[
      { id: 'deliverables', to: '/deliverables', label: 'All deliverables', description: 'Every event output and who owns it' },
      { id: 'deliverables', to: '/deliverables?blocked=1', label: 'Blocked deliverables', description: 'Outputs waiting on something', icon: 'department' },
      { id: 'timeline', to: '/working-together/timeline', label: 'Timeline', description: 'All committee work laid out over the weeks' },
      { id: 'department', to: '/reviews', label: 'Inbox', description: 'Requests and reviews sent to your committee', capability: 'department.review' },
      { id: 'search', to: '/search', label: 'Find', description: 'Search work, guides and people by name or reference' },
    ]} /> : null}
  </div>
}

function MyWork({ termId }: { termId: string }) {
  const { gateway } = useShellServices()
  const overview = gateway?.overview
  const [rows, setRows] = useState<{ termId: string; items: OverviewRow[] | null } | null>(null)
  useEffect(() => {
    if (!overview) return
    let live = true
    void overview.read(termId).then(result => { if (live) setRows({ termId, items: result.items }) }, () => { if (live) setRows({ termId, items: null }) })
    return () => { live = false }
  }, [overview, termId])
  if (!overview) return null
  if (!rows) return <div role="status"><span className="visually-hidden">Loading your work</span><SkeletonRows rows={3} /></div>
  if (!rows.items) return <p className="hub-note">Your items could not load. The lists below still work.</p>
  const now = new Date()
  const mine = rows.items.filter(row => row.lane === 'actionable').map(row => fromOverview(row, now)).sort((a, b) => a.sortAt - b.sortAt)
  const waiting = rows.items.filter(row => row.lane === 'waiting').map(row => fromOverview(row, now)).sort((a, b) => a.sortAt - b.sortAt)
  return <div className="hub-work">
    <TodaySection title="On you" items={mine} />
    <TodaySection title="Waiting on others" items={waiting} collapsible />
    {!mine.length && !waiting.length ? <EmptyState level={3} illustration={<AllDone size={96} />} title="Nothing on you right now"
      description="Tasks and deliverables assigned to you show up here. Need help from another committee? Ask a committee." /> : null}
  </div>
}

/** Event: the show at a glance. Route "/event". */
export function EventHub() {
  const member = useMember()
  const { gateway } = useShellServices()
  const caps = member?.capabilities ?? []
  return <div className="hub">
    <HubHeading title="Event" description="Dates, publicity, equipment and guests for the event." />
    <div className="hub-countdown"><Countdown variant="overview" /></div>
    {member ? <ComingUp termId={member.termId} /> : null}
    <Slots names={['event.warRoom', 'event.runOfShow', 'event.contestBoard', 'event.tedifyBoard']} capabilities={caps} />
    <HubLinks title="Plan the event" capabilities={caps} links={[
      { id: 'calendar', to: '/calendar', label: 'Calendar', description: 'Meetings, deadlines and event dates' },
      { id: 'timeline', to: '/working-together/timeline', label: 'Timeline', description: 'Committee work laid out over the weeks' },
      { id: 'publicity', to: '/publicity', label: 'Publicity sign-off', description: 'Final publicity and where its sign-off stands' },
      { id: 'speakers', to: '/event/speakers', label: 'Speakers', description: 'Every speaker’s checklist, rehearsal and contact' },
      ...(gateway?.inventory ? [{ id: 'inventory', to: '/inventory', label: 'Inventory', description: 'Equipment and borrowed items' }] : []),
      // The QR page has item labels (needs inventory) and the crew code (PMs and admins); with neither it is empty.
      ...(gateway?.inventory || caps.includes('admin.configure') || caps.includes('roles.manage') ? [{ id: 'qr', to: '/event/qr', label: 'Event QR codes', description: 'Item labels and the crew check-in code to print' }] : []),
      { id: 'guests', to: '/guests', label: 'Guests & speakers', description: 'Invitations for speakers and partners you sponsor', capability: 'roles.manage' },
    ]} />
  </div>
}

function ComingUp({ termId }: { termId: string }) {
  const { gateway } = useShellServices()
  const calendar = gateway?.calendar
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  useEffect(() => {
    if (!calendar) return
    let live = true
    const range = comingUpWindow()
    void calendar.read(termId, range.from, range.to, null, 1).then(result => { if (live) setEvents(result.items) }, () => { if (live) setEvents([]) })
    return () => { live = false }
  }, [calendar, termId])
  if (!calendar || !events) return null
  const now = Date.now()
  const upcoming = events
    .filter(event => event.state !== 'cancelled')
    .map(event => fromEvent(event, new Date(now)))
    .filter(item => Number.isFinite(item.sortAt) && item.sortAt >= now - 86_400_000)
    .sort((a, b) => a.sortAt - b.sortAt)
    .slice(0, 4)
  return upcoming.length ? <TodaySection title="Coming up" items={upcoming} />
    : <section className="today-section" aria-label="Coming up"><h2 className="today-section__title">Coming up</h2>
      <p className="hub-note">Nothing on the calendar for the next three weeks. <Link to="/calendar">Open the calendar</Link></p></section>
}

/** Team: people, committees and where to start. Route "/team". */
/** The member's committee quick links, at the top of Team. Renders nothing outside a committee. */
function TeamLinks({ termId }: { termId: string }) {
  const { gateway } = useShellServices()
  return <MyCommitteeLinks api={gateway?.committeePages} termId={termId} />
}

export function TeamHub() {
  const member = useMember()
  const caps = member?.capabilities ?? []
  return <div className="hub">
    <HubHeading title="Team" description="People, committees and where to start." />
    {member ? <TeamLinks termId={member.termId} /> : null}
    <Slots names={['team.whoToAsk', 'team.setup', 'team.committeePages']} capabilities={caps} />
    <HubLinks capabilities={caps} links={[
      { id: 'people', to: '/people', label: 'People', description: 'Find anyone on the core team and who is on point for what', tour: 'team-people' },
      { id: 'committee', to: '/committee', label: 'My committee', description: 'What your members owe and what other committees asked of you', capability: 'committee.manage', tour: 'team-committee' },
      { id: 'resources', to: '/resources', label: 'Start here', description: 'Guides, templates and how things work here' },
      { id: 'announcements', to: '/announcements', label: 'Announcements', description: 'Messages from the PMs and committees' },
    ]} />
  </div>
}

/** Desk: role tools, by job. Route "/desk". */
export function DeskHub() {
  const member = useMember()
  const caps = member?.capabilities ?? []
  return <div className="hub">
    <HubHeading title="Desk" description="Tools for your role. Everyday work stays in Today and Work." />
    <HubLinks title="Review" capabilities={caps} links={[
      { id: 'finance', to: '/finance', label: 'Budget', description: 'Budget requests waiting for your review', capability: 'finance.review' },
      { id: 'signoff', to: '/publicity', label: 'Publicity sign-off', description: 'Review final publicity before it goes out', capability: 'mcd.review' },
      { id: 'department', to: '/reviews', label: 'Inbox', description: 'Requests and reviews sent to your committee', capability: 'department.review' },
      { id: 'feedback', to: '/prism', label: 'Check-ins', description: 'PRISM check-ins assigned to you', capability: 'feedback.review' },
      { id: 'mentoring', to: '/mentoring', label: 'Mentoring', description: 'Goals and check-ins with your mentees', capability: 'mentoring.view' },
    ]} />
    <HubLinks title="Run the workspace" capabilities={caps} links={[
      { id: 'reports', to: '/reports', label: 'Reports', description: 'Progress and exports for your area', capability: 'reports.view' },
      { id: 'admin', to: '/admin', label: 'Admin', description: 'Roster, roles, services, phases, layouts and privacy', capability: 'admin.configure', tour: 'desk-admin' },
      { id: 'access', to: '/admin/access', label: 'Roles & access', description: 'Give someone a role or change what a role can do', capability: 'roles.manage', icon: 'admin' },
      ...(caps.includes('admin.configure') && caps.includes('roles.manage') ? [{ id: 'data', to: '/admin/data', label: 'Data', description: 'Read-only spreadsheet view of people, positions and work', icon: 'resources' }] : []),
      { id: 'imports', to: '/admin/imports', label: 'Imports', description: 'Bring in tasks or people from a spreadsheet', capability: 'roles.manage', icon: 'resources' },
      { id: 'announcements', to: '/admin/announcements', label: 'Publish announcements', description: 'Write and send an announcement', capability: 'admin.configure' },
      { id: 'guests', to: '/guests', label: 'Guests & speakers', description: 'Invitations you sponsor', capability: 'roles.manage' },
    ]} />
    <Slots names={['desk.tools']} capabilities={caps} />
  </div>
}
