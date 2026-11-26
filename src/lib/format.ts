// Shared date wording for the workspace. Every value is shown in Manila time
// (Asia/Manila, UTC+8, no daylight saving), whatever the device's own zone is.
//
//   formatDate('2026-11-25')                -> "25 Nov 2026"
//   formatDateTime('2026-11-25T06:10:00Z')  -> "25 Nov 2026, 2:10 PM"
//   relativeDue({ dueAt: ... })             -> "Due tomorrow 6 PM"
//   relativeDue({ dueOn: '2026-11-24' })    -> "2 days late"

const zone = 'Asia/Manila'
const dayMs = 86_400_000
const dateOnly = /^\d{4}-\d{2}-\d{2}$/

type DateInput = string | Date | null | undefined

const partsFormat = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Calendar parts of a moment as seen in Manila. */
type ManilaParts = { day: string; year: number; month: number; date: number; weekday: number; hour: number; minute: number }

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  // A bare calendar day means that day in Manila; read it at Manila noon so no zone can shift it.
  const date = new Date(dateOnly.test(value) ? value + 'T12:00:00+08:00' : value)
  return Number.isFinite(date.getTime()) ? date : null
}

function manilaParts(date: Date): ManilaParts {
  const parts = Object.fromEntries(partsFormat.formatToParts(date).map(part => [part.type, part.value]))
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day)
  return {
    day: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    year, month, date: day,
    weekday: weekdayNames.indexOf(String(parts.weekday).slice(0, 3)),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute),
  }
}

/** Today's calendar day in Manila, as YYYY-MM-DD. */
export function manilaToday(now: Date = new Date()): string { return manilaParts(now).day }

/** Whole calendar days from one YYYY-MM-DD day to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / dayMs)
}

/** Adds whole days to a YYYY-MM-DD day. */
export function addDaysTo(day: string, amount: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + amount * dayMs).toISOString().slice(0, 10)
}

/** "6 PM", "6:30 PM". */
export function formatTime(value: DateInput): string {
  const date = toDate(value)
  if (!date) return ''
  const { hour, minute } = manilaParts(date)
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${minute ? ':' + String(minute).padStart(2, '0') : ''} ${hour < 12 ? 'AM' : 'PM'}`
}

/** "25 Nov 2026". Accepts YYYY-MM-DD or a timestamp. Empty input gives "Not set". */
export function formatDate(value: DateInput): string {
  const date = toDate(value)
  if (!date) return 'Not set'
  const p = manilaParts(date)
  return `${p.date} ${monthNames[p.month - 1]} ${p.year}`
}

/** "25 Nov 2026, 2:10 PM". A bare day falls back to formatDate. */
export function formatDateTime(value: DateInput): string {
  if (typeof value === 'string' && dateOnly.test(value)) return formatDate(value)
  const date = toDate(value)
  return date ? `${formatDate(date)}, ${formatTime(date)}` : 'Not set'
}

/** "Thu 26 Nov". Short day label for lists and headers. */
export function formatDayLabel(value: DateInput): string {
  const date = toDate(value)
  if (!date) return ''
  const p = manilaParts(date)
  return `${weekdayNames[p.weekday]} ${p.date} ${monthNames[p.month - 1]}`
}

/** A short "when" for a day near today: "today", "tomorrow", "Fri", "3 Dec", "3 Dec 2027". */
export function relativeDay(day: string, now: Date = new Date()): string {
  const today = manilaToday(now), offset = daysBetween(today, day)
  if (offset === 0) return 'today'
  if (offset === 1) return 'tomorrow'
  if (offset === -1) return 'yesterday'
  const p = manilaParts(toDate(day)!)
  if (offset > 1 && offset < 7) return weekdayNames[p.weekday]
  return `${p.date} ${monthNames[p.month - 1]}${p.year === manilaParts(now).year ? '' : ' ' + p.year}`
}

export type Due = { dueOn?: string | null; dueAt?: string | null }
export type DueState = 'none' | 'late' | 'today' | 'soon' | 'later'

/** Where a deadline sits relative to now. Date-only deadlines end at 23:59 Manila. */
export function dueState({ dueOn, dueAt }: Due, now: Date = new Date()): DueState {
  const at = toDate(dueAt ?? null)
  const day = at ? manilaParts(at).day : dueOn && dateOnly.test(dueOn) ? dueOn : null
  if (!day) return 'none'
  const offset = daysBetween(manilaToday(now), day)
  if (offset < 0 || (at && at.getTime() < now.getTime())) return 'late'
  if (offset === 0) return 'today'
  return offset < 7 ? 'soon' : 'later'
}

/** "Due tomorrow 6 PM", "Due Fri", "Due 3 Dec", "2 days late", "Late since 6 PM", "No due date". */
export function relativeDue({ dueOn, dueAt }: Due, now: Date = new Date()): string {
  const at = toDate(dueAt ?? null)
  const day = at ? manilaParts(at).day : dueOn && dateOnly.test(dueOn) ? dueOn : null
  if (!day) return 'No due date'
  const offset = daysBetween(manilaToday(now), day)
  if (offset < 0) return `${-offset} ${offset === -1 ? 'day' : 'days'} late`
  if (at && at.getTime() < now.getTime()) return `Late since ${formatTime(at)}`
  const time = at ? ' ' + formatTime(at) : ''
  return `Due ${relativeDay(day, now)}${time}`
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". For past moments only. */
export function timeAgo(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value)
  if (!date) return ''
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

/** "waiting 3 days" from a request date; empty when unknown. */
export function waitingFor(since: DateInput, now: Date = new Date()): string {
  const date = toDate(since)
  if (!date) return ''
  const days = daysBetween(manilaParts(date).day, manilaToday(now))
  return days <= 0 ? 'waiting since today' : `waiting ${days} ${days === 1 ? 'day' : 'days'}`
}

/** When a calendar event starts, in words: "Today 6 PM", "Tomorrow", "Thu 26 Nov 3 PM". */
export function eventWhen(event: { allDay: boolean; startOn: string | null; startsAt: string | null }, now: Date = new Date()): string {
  const day = event.allDay ? event.startOn : event.startsAt ? manilaParts(toDate(event.startsAt)!).day : null
  if (!day) return ''
  const offset = daysBetween(manilaToday(now), day)
  const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : formatDayLabel(day)
  return event.allDay || !event.startsAt ? label : `${label} ${formatTime(event.startsAt)}`
}
