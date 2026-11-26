import { Bell, BookOpen, CalendarDays, ChartColumn, CircleUser, Contact, FileText, Handshake, Inbox, LayoutDashboard, ListChecks, Megaphone, MessageCircleHeart, Package, Search, Send, Settings, Share2, Sprout, UserPlus, Users, Wallet, type LucideIcon } from 'lucide-react'

/** One icon per navigation item id; unknown ids fall back to a document. */
const navIcons: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  deliverables: Package,
  shared: Share2,
  tasks: ListChecks,
  working: Handshake,
  requests: Send,
  calendar: CalendarDays,
  resources: BookOpen,
  people: Contact,
  committee: Users,
  department: Inbox,
  publicity: Megaphone,
  finance: Wallet,
  feedback: MessageCircleHeart,
  mentoring: Sprout,
  reports: ChartColumn,
  admin: Settings,
  guests: UserPlus,
  search: Search,
  notifications: Bell,
  account: CircleUser,
}

export function navIcon(id: string): LucideIcon { return navIcons[id] ?? FileText }

/** Short labels for the mobile bar; each is contained in the full label so the accessible name matches. */
export const shortLabels: Record<string, string> = {
  overview: 'Overview', deliverables: 'Deliverables', tasks: 'Tasks', working: 'Together',
  shared: 'Shared', calendar: 'Calendar', resources: 'Resources',
}
