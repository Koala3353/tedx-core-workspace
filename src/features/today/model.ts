import type { OverviewRow } from '../overview/api'
import type { Announcement } from '../announcements/api'
import type { CalendarEvent } from '../calendar/api'
import { manilaDay } from '../timeline/dates'
import { addDaysTo, dueState, eventWhen, manilaToday, relativeDue, timeAgo, waitingFor } from '../../lib/format'

export type TodayVerb = 'Open' | 'Review' | 'Acknowledge'
export type TodayKind = OverviewRow['source'] | 'announcement' | 'event'

/** One row on Today: what, who's waiting, when, and exactly one verb. */
export type TodayItem = {
  key: string
  kind: TodayKind
  title: string
  chip?: string
  who: string
  when: string
  late: boolean
  href: string
  verb: TodayVerb
  /** Present for announcements that can be acknowledged in place. */
  announcement?: Announcement
  sortAt: number
}

export type TodaySections = {
  overdue: TodayItem[]
  needsOk: TodayItem[]
  incoming: TodayItem[]
  week: TodayItem[]
  later: TodayItem[]
  waiting: TodayItem[]
  comingUp: TodayItem[]
  /** Items that need the person now (overdue, OK, incoming, this week). */
  count: number
  /** Earliest known upcoming deadline, for the empty state. */
  nextDeadline: TodayItem | null
}

const chips: Partial<Record<TodayKind, string>> = { deliverable: 'Deliverable', handoff: 'Handoff', review: 'Approval', request: 'Ask', announcement: 'Announcement' }

export function hrefFor(row: OverviewRow): string {
  switch (row.source) {
    case 'review': return `/reviews/${row.termId}/${row.id}`
    case 'request': return `/requests/${row.termId}/${row.id}`
    case 'task': return `/tasks/${row.id}`
    case 'handoff': return `/working-together/handoffs/${row.id}`
    default: return `/deliverables/${row.id}`
  }
}

function deadline(row: OverviewRow): number {
  const at = row.dueAt ? Date.parse(row.dueAt) : row.dueOn ? Date.parse(row.dueOn + 'T23:59:00+08:00') : NaN
  return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER
}

export function fromOverview(row: OverviewRow, now: Date): TodayItem {
  const state = dueState(row, now)
  const late = row.overdue || state === 'late'
  const who = row.committee ?? row.person
  const when = row.source === 'review'
    ? waitingFor(row.requestedOn ?? null, now) || relativeDue(row, now)
    : state === 'none' ? '' : relativeDue(row, now)
  return {
    key: row.source + ':' + row.id,
    kind: row.source,
    title: row.title,
    chip: chips[row.source],
    who: row.source === 'handoff' ? `from ${who}` : who,
    when: late && row.source === 'review' ? 'Overdue' : when,
    late,
    href: hrefFor(row),
    verb: row.source === 'review' ? 'Review' : 'Open',
    sortAt: deadline(row),
  }
}

export function fromAnnouncement(item: Announcement, now: Date): TodayItem {
  return {
    key: 'announcement:' + item.id,
    kind: 'announcement',
    title: item.title,
    chip: chips.announcement,
    who: `from ${item.publisherName || item.audience.name}`,
    when: timeAgo(item.publishedAt, now),
    late: false,
    href: `/announcements/${item.id}`,
    verb: 'Acknowledge',
    announcement: item,
    sortAt: Date.parse(item.publishedAt),
  }
}

function eventStart(event: CalendarEvent): number {
  return event.allDay ? Date.parse((event.startOn ?? '') + 'T00:00:00+08:00') : Date.parse(event.startsAt ?? '')
}
function eventEnd(event: CalendarEvent): number {
  return event.allDay ? Date.parse((event.endOn ?? '') + 'T00:00:00+08:00') : Date.parse(event.endsAt ?? '')
}

/** The event's own month in the calendar, scrolled to its row, so next month's events are not lost. */
function calendarHref(event: CalendarEvent): string {
  let day: string | null
  try { day = event.allDay ? event.startOn : event.startsAt ? manilaDay(event.startsAt) : null } catch { day = null }
  const anchor = '#calendar-' + event.key.replace(':', '-')
  return day ? `/calendar?month=${day.slice(0, 7)}${anchor}` : '/calendar' + anchor
}

export function fromEvent(event: CalendarEvent, now: Date): TodayItem {
  return {
    key: 'event:' + event.key,
    kind: 'event',
    title: event.title,
    who: event.location,
    when: eventWhen(event, now),
    late: false,
    href: event.href ?? calendarHref(event),
    verb: 'Open',
    sortAt: eventStart(event),
  }
}

/** The calendar window Today asks for: today through three weeks out. */
export function comingUpWindow(now: Date = new Date()): { from: string; to: string } {
  const from = manilaToday(now)
  return { from, to: addDaysTo(from, 21) }
}

export function buildSections(rows: OverviewRow[], announcements: Announcement[], events: CalendarEvent[], now: Date = new Date()): TodaySections {
  const sections: TodaySections = { overdue: [], needsOk: [], incoming: [], week: [], later: [], waiting: [], comingUp: [], count: 0, nextDeadline: null }
  for (const row of rows) {
    const item = fromOverview(row, now)
    if (row.lane === 'waiting') { sections.waiting.push(item); continue }
    if (item.late) sections.overdue.push(item)
    else if (row.source === 'review') sections.needsOk.push(item)
    else if (row.source === 'handoff' || row.source === 'request') sections.incoming.push(item)
    else if (['today', 'soon'].includes(dueState(row, now))) sections.week.push(item)
    else sections.later.push(item)
  }
  for (const announcement of announcements) {
    if (announcement.requiredAck && !announcement.acknowledged && !announcement.expired) sections.needsOk.push(fromAnnouncement(announcement, now))
  }
  sections.comingUp = events
    .filter(event => event.state !== 'cancelled' && Number.isFinite(eventStart(event)) && (eventEnd(event) > now.getTime() || eventStart(event) >= now.getTime()))
    .sort((a, b) => eventStart(a) - eventStart(b))
    .slice(0, 2)
    .map(event => fromEvent(event, now))
  const byDeadline = (a: TodayItem, b: TodayItem) => a.sortAt - b.sortAt
  sections.overdue.sort(byDeadline)
  sections.week.sort(byDeadline)
  sections.incoming.sort(byDeadline)
  sections.later.sort(byDeadline)
  sections.waiting.sort(byDeadline)
  sections.count = sections.overdue.length + sections.needsOk.length + sections.incoming.length + sections.week.length
  sections.nextDeadline = [...sections.later, ...sections.waiting].filter(item => item.sortAt < Number.MAX_SAFE_INTEGER).sort(byDeadline)[0] ?? null
  return sections
}
