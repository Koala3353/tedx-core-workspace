import { Bell, BookOpen, Boxes, BriefcaseBusiness, Building2, CalendarDays, ChartColumn, CircleHelp, CircleUser, Clapperboard, Contact, FileText, ChartGantt, Handshake, Inbox, LayoutList, ListChecks, MapPin, Megaphone, MessageCircleHeart, Mic, Newspaper, Package, Presentation, QrCode, Search, Send, Settings, Share2, Siren, Sprout, Stamp, Sun, Ticket, Trophy, UserCog, UserPlus, Users, Wallet, type LucideIcon } from 'lucide-react'
import type { TabId } from './navigation'

/** One icon per navigation item id; unknown ids fall back to a document. */
const navIcons: Record<string, LucideIcon> = {
  overview: Sun,
  notifications: Bell,
  announcements: Newspaper,
  work: LayoutList,
  tasks: ListChecks,
  deliverables: Package,
  working: Handshake,
  requests: Send,
  department: Inbox,
  search: Search,
  event: Ticket,
  calendar: CalendarDays,
  timeline: ChartGantt,
  publicity: Megaphone,
  inventory: Boxes,
  guests: UserPlus,
  team: Users,
  people: Contact,
  committee: Users,
  resources: BookOpen,
  desk: BriefcaseBusiness,
  finance: Wallet,
  signoff: Stamp,
  feedback: MessageCircleHeart,
  mentoring: Sprout,
  reports: ChartColumn,
  admin: Settings,
  shared: Share2,
  account: CircleUser,
  'my-part': Mic,
  'event-info': MapPin,
  // Hub slots and pages without a navigation item.
  'event.warRoom': Siren,
  'event.runOfShow': Clapperboard,
  'event.contestBoard': Trophy,
  'event.tedifyBoard': Presentation,
  'team.setup': UserCog,
  'team.whoToAsk': CircleHelp,
  'team.committeePages': Building2,
  speakers: Mic,
  qr: QrCode,
}

const tabIcons: Record<TabId, LucideIcon> = { today: Sun, work: LayoutList, event: Ticket, team: Users, desk: BriefcaseBusiness }

export function navIcon(id: string): LucideIcon { return navIcons[id] ?? FileText }
export function tabIcon(id: TabId): LucideIcon { return tabIcons[id] }
