import { Link } from 'react-router'
import { PageHeading, Panel } from '../components/Page'
import type { WorkspaceContext } from '../features/auth/gateway'
import type { OverviewRow } from '../features/overview/api'
import { buildSections } from '../features/today/model'
import { TodaySection } from '../features/today/TodayList'
import { CountdownChip } from '../components/Countdown'
import { formatDayLabel } from '../lib/format'
import { getVisibleNavigation, tabs, type NavigationContext } from './navigation'
import '../features/today/today.css'

// The member preview page itself lives in src/features/view-as (loaded on first visit).
// This module keeps the small pieces the router, the shell and the dev preview need up front.

export const memberPreviewPath = '/member-preview'
export const isMemberPreviewPath = (path: string) => {
  const lower = path.toLowerCase()
  return lower === memberPreviewPath || lower.startsWith(memberPreviewPath + '/')
}
export function canPreviewAsMember(context: WorkspaceContext) {
  return 'memberId' in context && context.capabilities.includes('admin.configure')
}
/** Viewing a real member's data needs full admin: both admin.configure and roles.manage. */
export function canViewRealMember(context: WorkspaceContext) {
  return canPreviewAsMember(context) && context.capabilities.includes('roles.manage')
}

export const memberNavigation: NavigationContext = { audience: 'core', capabilities: [] }

// Fixed sample rows, dated relative to today so the preview always reads naturally.
function sampleRows(): OverviewRow[] {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
  const base = { owner: 'Sample member', person: 'Sample member', lane: 'actionable' as const, dueAt: null, overdue: false, state: 'in_progress' }
  return [
    { ...base, id: '307b8bad-6ac9-46ad-aca7-76ef4ea0b006', source: 'task', title: 'Confirm the stage rehearsal checklist', action: 'Check the list with your committee head', committee: 'Stage Management', dueOn: day(2) },
    { ...base, id: '307b8bad-6ac9-46ad-aca7-76ef4ea0b007', source: 'task', title: 'Upload your profile photo', action: 'Upload a photo', committee: 'Documentation', dueOn: day(-1), overdue: true },
    { ...base, id: '307b8bad-6ac9-46ad-aca7-76ef4ea0b008', source: 'deliverable', title: 'Rehearsal cue sheet', action: 'Draft the cue sheet', committee: 'Programs & Activities', dueOn: day(12), lane: 'waiting' },
  ]
}

const examples: Record<string, { title: string; detail: string }> = {
  deliverables: { title: 'Stage rehearsal plan', detail: 'Stage Management · In progress' },
  working: { title: 'Rehearsal cue sheet handoff', detail: 'Stage Management → Programs & Activities' },
  requests: { title: 'Ask Logistics for a room', detail: 'See what the service needs before you start.' },
  calendar: { title: 'Stage rehearsal', detail: 'Thursday, 3 PM' },
  resources: { title: 'New member guide', detail: 'Start with your committee’s checklist and contact.' },
  people: { title: 'Stage Management', detail: 'Sample member · Core' },
  publicity: { title: 'Publicity sign-off', detail: 'No publicity items in this example.' },
  search: { title: 'Find', detail: 'Tasks, deliverables and requests appear here when they match.' },
  notifications: { title: 'Task assigned', detail: 'Confirm the stage rehearsal checklist.' },
  account: { title: 'Sample member', detail: 'Stage Management Core' },
}

/** Today with fixed sample rows. Used by the member preview and the development shell preview. */
export function SampleToday() {
  const sections = buildSections(sampleRows(), [], [])
  return <div className="today">
    <header className="today-head"><div><h1>Today</h1><p className="today-head__summary"><span>{formatDayLabel(new Date())} · {sections.count} things need you</span><CountdownChip className="today-head__countdown" /></p></div></header>
    <div data-tour="today-list">
      <TodaySection title="Overdue" items={sections.overdue} illustrative tourFirstVerb />
      <TodaySection title="Due this week" items={sections.week} illustrative />
      <TodaySection title="Waiting on others" items={sections.waiting} illustrative collapsible />
    </div>
  </div>
}

/** The sample member's page for a preview sub-path ("/" is Today). */
export function SamplePreviewContent({ path }: { path: string }) {
  if (path === '/') return <SampleToday />
  const active = getVisibleNavigation(memberNavigation).find(item => item.href === path)
  const tab = tabs.find(item => item.href === path)
  const example = active ? examples[active.id] : undefined
  return <>
    <PageHeading title={active?.label ?? tab?.label ?? 'Preview page unavailable'} description={active?.description ?? tab?.description} />
    {example && <Panel title={example.title}><p>{example.detail}</p></Panel>}
    {!active && !tab && <Link className="button button--secondary" to={memberPreviewPath}>Back to the preview</Link>}
  </>
}
