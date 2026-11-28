export type NavigationAudience = 'setup' | 'core' | 'guest'

export type NavigationCapability =
  | 'committee.manage'
  | 'department.review'
  | 'finance.review'
  | 'mcd.review'
  | 'feedback.review'
  | 'mentoring.view'
  | 'reports.view'
  | 'admin.configure'
  | 'roles.manage'

export type NavigationContext = {
  audience: NavigationAudience
  capabilities: readonly NavigationCapability[]
  /** Ids of optional areas whose workspace connection is available (see optionalConnections). */
  connected?: readonly string[]
}

/** The five places in the workspace. Desk only appears for people with a desk capability. */
export type TabId = 'today' | 'work' | 'event' | 'team' | 'desk'

export type NavigationItem = {
  id: string
  label: string
  href: string
  description: string
  /** Kept for published site wording, which sorts only within a group. */
  group: 'workspace' | 'role' | 'account'
  audiences: readonly NavigationAudience[]
  capability?: NavigationCapability
  /** Tab this page belongs to. Pages without a tab (Account) live in the header menu. */
  tab?: TabId
  /** True for the tab's own landing page. */
  hub?: boolean
}

export type Tab = { id: TabId; label: string; href: string; description: string }

export const tabs: readonly Tab[] = [
  { id: 'today', label: 'Today', href: '/', description: 'What needs you now' },
  { id: 'work', label: 'Work', href: '/work', description: 'Tasks, deliverables and asks between committees' },
  { id: 'event', label: 'Event', href: '/event', description: 'Dates, publicity, inventory and guests for the event' },
  { id: 'team', label: 'Team', href: '/team', description: 'People, committees and where to start' },
  { id: 'desk', label: 'Desk', href: '/desk', description: 'Budget, sign-off, check-ins, reports and admin' },
]

/** Any one of these shows the Desk tab. */
export const deskCapabilities: readonly NavigationCapability[] = ['finance.review', 'mcd.review', 'feedback.review', 'department.review', 'reports.view', 'admin.configure', 'roles.manage', 'mentoring.view']

export const setupNavigation: NavigationContext = { audience: 'setup', capabilities: [] }

const member = ['setup', 'core'] as const
const core = ['core'] as const

// Order inside a tab is the order of the sidebar sub-items. Ids are stable: published
// site wording and saved layouts refer to them.
export const navigationItems: readonly NavigationItem[] = [
  // Today
  { id: 'overview', label: 'Today', href: '/', description: 'What needs you now', group: 'workspace', audiences: member, tab: 'today', hub: true },
  { id: 'notifications', label: 'Notifications', href: '/notifications', description: 'Updates and reminder settings', group: 'account', audiences: ['setup', 'core', 'guest'], tab: 'today' },
  { id: 'announcements', label: 'Announcements', href: '/announcements', description: 'Messages from the PMs and committees', group: 'workspace', audiences: member, tab: 'today' },
  // Work
  { id: 'work', label: 'Work', href: '/work', description: "Yours, your committee's and everyone's", group: 'workspace', audiences: member, tab: 'work', hub: true },
  { id: 'tasks', label: 'Tasks', href: '/tasks', description: 'Your tasks and deadlines', group: 'workspace', audiences: ['setup', 'core', 'guest'], tab: 'work' },
  { id: 'deliverables', label: 'Deliverables', href: '/deliverables', description: 'Event outputs and who owns them', group: 'workspace', audiences: member, tab: 'work' },
  { id: 'working', label: 'Working together', href: '/working-together', description: 'Deals and handoffs between committees', group: 'workspace', audiences: member, tab: 'work' },
  { id: 'requests', label: 'Ask a committee', href: '/requests', description: 'Request help from another committee', group: 'workspace', audiences: member, tab: 'work' },
  { id: 'department', label: 'Inbox', href: '/reviews', description: 'Requests and reviews sent to your committee', group: 'role', audiences: core, capability: 'department.review', tab: 'work' },
  { id: 'search', label: 'Find', href: '/search', description: 'Find work, guides and people', group: 'account', audiences: core, tab: 'work' },
  // Event
  { id: 'event', label: 'Event', href: '/event', description: 'The event at a glance', group: 'workspace', audiences: member, tab: 'event', hub: true },
  { id: 'calendar', label: 'Calendar', href: '/calendar', description: 'Meetings, deadlines and event dates', group: 'workspace', audiences: ['setup', 'core', 'guest'], tab: 'event' },
  { id: 'timeline', label: 'Timeline', href: '/working-together/timeline', description: 'Committee work laid out over time', group: 'workspace', audiences: member, tab: 'event' },
  { id: 'publicity', label: 'Publicity sign-off', href: '/publicity', description: 'Final publicity and its sign-off', group: 'role', audiences: core, capability: 'committee.manage', tab: 'event' },
  { id: 'inventory', label: 'Inventory', href: '/inventory', description: 'Equipment and borrowed items', group: 'workspace', audiences: core, tab: 'event' },
  { id: 'guests', label: 'Guests & speakers', href: '/guests', description: 'Guest invitations you sponsor', group: 'role', audiences: core, capability: 'roles.manage', tab: 'event' },
  // Team
  { id: 'team', label: 'Team', href: '/team', description: 'People, committees and where to start', group: 'workspace', audiences: member, tab: 'team', hub: true },
  { id: 'people', label: 'People', href: '/people', description: 'Committee contacts and the member directory', group: 'workspace', audiences: member, tab: 'team' },
  { id: 'committee', label: 'My committee', href: '/committee', description: 'Work for the committee you lead', group: 'role', audiences: core, capability: 'committee.manage', tab: 'team' },
  { id: 'resources', label: 'Start here', href: '/resources', description: 'Guides, templates and who to ask', group: 'workspace', audiences: ['setup', 'core', 'guest'], tab: 'team' },
  // Desk
  { id: 'desk', label: 'Desk', href: '/desk', description: 'Your role tools', group: 'role', audiences: core, tab: 'desk', hub: true },
  { id: 'finance', label: 'Budget', href: '/finance', description: 'Budget requests to review', group: 'role', audiences: core, capability: 'finance.review', tab: 'desk' },
  { id: 'signoff', label: 'Publicity sign-off', href: '/publicity', description: 'Review final publicity', group: 'role', audiences: core, capability: 'mcd.review', tab: 'desk' },
  { id: 'feedback', label: 'Check-ins', href: '/prism', description: 'PRISM check-ins assigned to you', group: 'role', audiences: core, capability: 'feedback.review', tab: 'desk' },
  { id: 'mentoring', label: 'Mentoring', href: '/mentoring', description: 'Goals and check-ins with your mentees', group: 'role', audiences: core, capability: 'mentoring.view', tab: 'desk' },
  { id: 'reports', label: 'Reports', href: '/reports', description: 'Reports for your area', group: 'role', audiences: core, capability: 'reports.view', tab: 'desk' },
  { id: 'admin', label: 'Admin', href: '/admin', description: 'Workspace setup for administrators', group: 'role', audiences: core, capability: 'admin.configure', tab: 'desk' },
  // Guests: a speaker's two places, then anything else shared with them.
  { id: 'my-part', label: 'My part', href: '/my-part', description: 'What we need from you, and when', group: 'workspace', audiences: ['guest'] },
  { id: 'event-info', label: 'Event info', href: '/my-part/info', description: 'Where and when, and who to contact', group: 'workspace', audiences: ['guest'] },
  { id: 'shared', label: 'Shared with me', href: '/shared', description: 'Work shared with your guest account', group: 'workspace', audiences: ['guest'] },
  // Header menu
  { id: 'account', label: 'Settings', href: '/account', description: 'Profile, theme, alerts and the app', group: 'account', audiences: ['setup', 'core', 'guest'] },
]

// Areas that only exist when their optional workspace connection is configured
// (ProtectedShell passes the ids whose gateway API is present).
const optionalConnections = ['mentoring', 'inventory']

// Presentation only. Database/route authorization must be enforced separately.
export function getVisibleNavigation(context: NavigationContext): NavigationItem[] {
  return navigationItems.filter((item) => item.audiences.includes(context.audience)
    && (!optionalConnections.includes(item.id) || !!context.connected?.includes(item.id))
    && (!item.capability || context.capabilities.includes(item.capability)))
}

export function hasDesk(context: NavigationContext): boolean {
  return context.audience === 'core' && context.capabilities.some(capability => deskCapabilities.includes(capability))
}

/** Tabs shown to this person. Guests do not use tabs (see getGuestNavigation). */
export function getVisibleTabs(context: NavigationContext): Tab[] {
  if (context.audience === 'guest') return []
  return tabs.filter(tab => tab.id !== 'desk' || hasDesk(context))
}

/** Sub-pages under a tab, without the tab's own landing page. */
export function getTabItems(context: NavigationContext, tab: TabId, visible = getVisibleNavigation(context)): NavigationItem[] {
  const seen = new Set<string>()
  return visible.filter(item => {
    if (item.tab !== tab || item.hub || seen.has(item.href)) return false
    seen.add(item.href)
    return true
  })
}

/** Guests keep a short flat list: their part, event info, then shared work and tasks. */
export function getGuestNavigation(context: NavigationContext): NavigationItem[] {
  const ids = ['my-part', 'event-info', 'shared', 'tasks']
  const visible = getVisibleNavigation(context)
  return ids.flatMap(id => visible.filter(item => item.id === id))
}

const tabPrefixes: [RegExp, TabId][] = [
  [/^\/(?:notifications|announcements|overview)(?:\/|$)/, 'today'],
  [/^\/working-together\/timeline(?:\/|$)/, 'event'],
  [/^\/(?:work|tasks|deliverables|working-together|requests|reviews|department|search)(?:\/|$)/, 'work'],
  [/^\/(?:event|calendar|publicity|inventory|guests)(?:\/|$)/, 'event'],
  [/^\/(?:team|people|committee|resources)(?:\/|$)/, 'team'],
  [/^\/(?:desk|finance|prism|feedback|mentoring|reports|admin|archive|handover)(?:\/|$)/, 'desk'],
]

/** Which tab a path belongs to; null for Account, privacy and other header pages. */
export function tabForPath(path: string): TabId | null {
  if (path === '/' || path === '') return 'today'
  return tabPrefixes.find(([pattern]) => pattern.test(path))?.[1] ?? null
}

// Kept for older imports: the mobile bar is now the tab bar.
export function getMobilePrimaryNavigation(context: NavigationContext): NavigationItem[] {
  return context.audience === 'guest' ? getGuestNavigation(context) : []
}
