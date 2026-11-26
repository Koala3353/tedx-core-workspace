import { navigationItems } from './navigation'

export type PageTitle = { title: string; parent?: { label: string; href: string } }

const id = '[0-9a-f-]{36}'
const label = (href: string, fallback: string) => navigationItems.find(item => item.href === href)?.label ?? fallback
const up = (href: string, fallback: string) => ({ label: label(href, fallback), href })

// Sub-pages show their own name with a link up one level, never a generic "Core workspace".
const subPages: [RegExp, (labels: (href: string, fallback: string) => string) => PageTitle][] = [
  [new RegExp(`^/tasks/${id}$`), () => ({ title: 'Task', parent: up('/tasks', 'Tasks') })],
  [new RegExp(`^/deliverables/${id}$`), () => ({ title: 'Deliverable', parent: up('/deliverables', 'Deliverables') })],
  [/^\/working-together\/handoffs$/, () => ({ title: 'Handoffs', parent: up('/working-together', 'Working together') })],
  [new RegExp(`^/working-together/handoffs/${id}$`), () => ({ title: 'Handoff', parent: { label: 'Handoffs', href: '/working-together/handoffs' } })],
  [/^\/working-together\/timeline$/, () => ({ title: 'Timeline', parent: up('/event', 'Event') })],
  [new RegExp(`^/working-together/${id}$`), () => ({ title: 'Committee deal', parent: up('/working-together', 'Working together') })],
  [/^\/requests\/mine$/, () => ({ title: 'My requests', parent: up('/requests', 'Ask a committee') })],
  [new RegExp(`^/requests/services/${id}/new$`), () => ({ title: 'New request', parent: up('/requests', 'Ask a committee') })],
  [new RegExp(`^/requests/services/${id}/preview$`), () => ({ title: 'Form preview', parent: up('/requests', 'Ask a committee') })],
  [new RegExp(`^/requests/services/${id}$`), () => ({ title: 'Service details', parent: up('/requests', 'Ask a committee') })],
  [new RegExp(`^/requests/${id}/${id}$`), () => ({ title: 'Request', parent: { label: 'My requests', href: '/requests/mine' } })],
  [new RegExp(`^/reviews/${id}/${id}$`), () => ({ title: 'Review', parent: up('/reviews', 'Inbox') })],
  [new RegExp(`^/finance/reviews/${id}/${id}$`), () => ({ title: 'Budget review', parent: up('/finance', 'Budget') })],
  [new RegExp(`^/finance/${id}/${id}$`), () => ({ title: 'Budget request', parent: up('/finance', 'Budget') })],
  [new RegExp(`^/publicity/${id}/${id}$`), () => ({ title: 'Publicity item', parent: up('/publicity', 'Publicity sign-off') })],
  [new RegExp(`^/inventory/${id}$`), () => ({ title: 'Inventory item', parent: up('/inventory', 'Inventory') })],
  [new RegExp(`^/announcements/${id}$`), () => ({ title: 'Announcement', parent: up('/announcements', 'Announcements') })],
  [/^\/prism\/.+/, () => ({ title: 'Check-in', parent: up('/prism', 'Check-ins') })],
  [/^\/admin\/access$/, () => ({ title: 'Roles & access', parent: up('/admin', 'Admin') })],
  [/^\/admin\/imports$/, () => ({ title: 'Imports', parent: up('/admin', 'Admin') })],
  [/^\/admin\/process$/, () => ({ title: 'Process', parent: up('/admin', 'Admin') })],
  [/^\/admin\/config(?:\/.*)?$/, () => ({ title: 'Service setup', parent: up('/admin', 'Admin') })],
  [/^\/admin\/layouts$/, () => ({ title: 'Layouts', parent: up('/admin', 'Admin') })],
  [/^\/admin\/announcements$/, () => ({ title: 'Publish announcements', parent: up('/admin', 'Admin') })],
  [/^\/admin\/privacy$/, () => ({ title: 'Data & privacy', parent: up('/admin', 'Admin') })],
  [/^\/admin\/privacy\/retention$/, () => ({ title: 'Retention', parent: { label: 'Data & privacy', href: '/admin/privacy' } })],
  [/^\/admin\/privacy\/emergency$/, () => ({ title: 'Temporary access', parent: { label: 'Data & privacy', href: '/admin/privacy' } })],
  [/^\/admin\/privacy\/disposition$/, () => ({ title: 'Data sources', parent: { label: 'Data & privacy', href: '/admin/privacy' } })],
  [/^\/admin\/privacy\/recovery$/, () => ({ title: 'Recovery status', parent: { label: 'Data & privacy', href: '/admin/privacy' } })],
  [/^\/archive(?:\/.*)?$/, () => ({ title: 'Archive', parent: up('/desk', 'Desk') })],
  [/^\/handover(?:\/.*)?$/, () => ({ title: 'Handover', parent: up('/desk', 'Desk') })],
  [/^\/privacy$/, () => ({ title: 'Privacy', parent: up('/account', 'Account') })],
  [new RegExp(`^/privacy/requests/${id}$`), () => ({ title: 'Privacy request', parent: { label: 'Privacy', href: '/privacy' } })],
  [/^\/overview$/, () => ({ title: 'Classic overview', parent: up('/', 'Today') })],
  [/^\/team\/setup$/, () => ({ title: 'Team setup', parent: up('/team', 'Team') })],
  [/^\/team\/ask$/, () => ({ title: 'Who do I ask?', parent: up('/team', 'Team') })],
  [/^\/team\/committees$/, () => ({ title: 'Committees', parent: up('/team', 'Team') })],
  [/^\/team\/committees\/[^/]+$/, () => ({ title: 'Committee', parent: { label: 'Committees', href: '/team/committees' } })],
  [/^\/event\/war-room$/, () => ({ title: 'War room', parent: up('/event', 'Event') })],
  [/^\/event\/speakers$/, () => ({ title: 'Speakers', parent: up('/event', 'Event') })],
  [/^\/event\/online-contest$/, () => ({ title: 'Online contest', parent: up('/event', 'Event') })],
  [/^\/event\/tedify$/, () => ({ title: 'TEDify', parent: up('/event', 'Event') })],
  [/^\/event\/run-of-show$/, () => ({ title: 'Run of show', parent: up('/event', 'Event') })],
  [/^\/event\/qr$/, () => ({ title: 'Event QR codes', parent: up('/event', 'Event') })],
  [/^\/event\/check-in\/[^/]+$/, () => ({ title: 'Crew check-in', parent: up('/event', 'Event') })],
]

/** Title and parent for the header, from the visible (possibly re-worded) navigation. */
export function pageTitleFor(path: string, items: readonly { href: string; label: string }[] = navigationItems): PageTitle {
  const clean = path.length > 1 ? path.replace(/\/$/, '') : path
  const own = items.find(item => item.href === clean)
  if (own) return { title: own.label }
  const labels = (href: string, fallback: string) => items.find(item => item.href === href)?.label ?? fallback
  const match = subPages.find(([pattern]) => pattern.test(clean))
  if (!match) return { title: 'Workspace' }
  const result = match[1](labels)
  return result.parent ? { ...result, parent: { ...result.parent, label: labels(result.parent.href, result.parent.label) } } : result
}
