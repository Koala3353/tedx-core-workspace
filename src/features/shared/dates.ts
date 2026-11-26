// Feature-page date helpers. All wording comes from src/lib/format.ts so every page shows
// the same Manila-time dates ("25 Nov 2026", "25 Nov 2026, 2:10 PM", "Due tomorrow 6 PM").
// These wrappers only add the fallbacks and number inputs older feature code relies on.
import { formatDate, formatDateTime as formatMoment, formatTime as formatClock, manilaToday, relativeDue } from '../../lib/format'

type Input = string | number | Date | null | undefined
const dateOnly = /^\d{4}-\d{2}-\d{2}$/

function normalize(value: Input): string | Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = typeof value === 'number' ? new Date(value) : value
  if (date instanceof Date) return Number.isFinite(date.getTime()) ? date : null
  return dateOnly.test(date) || Number.isFinite(new Date(date).getTime()) ? date : null
}

/** "25 Nov 2026" */
export function formatDay(value: Input, fallback = 'Not set'): string {
  const date = normalize(value)
  return date ? formatDate(date) : fallback
}

/** "2:10 PM", "6 PM" */
export function formatTime(value: Input, fallback = ''): string {
  const date = normalize(value)
  return date ? formatClock(date) : fallback
}

/** "25 Nov 2026, 2:10 PM" (a bare day reads "25 Nov 2026") */
export function formatDateTime(value: Input, fallback = 'Not set'): string {
  const date = normalize(value)
  return date ? formatMoment(date) : fallback
}

/** "25 Nov 2026 – 30 Jun 2027" (open-ended ranges read "From 25 Nov 2026"). */
export function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return 'No dates set'
  if (!end) return `From ${formatDay(start)}`
  if (!start) return `Until ${formatDay(end)}`
  return `${formatDay(start)} – ${formatDay(end)}`
}

/** Relative due label, same wording as Today: "Due tomorrow 6 PM", "Due Fri", "2 days late", "No due date". */
export function formatDue(value: string | null | undefined, options: { now?: Date; dateOnly?: boolean } = {}): string {
  const date = normalize(value)
  if (!date || typeof date !== 'string') return 'No due date'
  const day = options.dateOnly ?? dateOnly.test(date)
  return relativeDue(day ? { dueOn: dateOnly.test(date) ? date : manilaToday(new Date(date)) } : { dueAt: date }, options.now ?? new Date())
}

/** True when the value falls on today's Manila date. */
export function isManilaToday(value: string | Date, now = new Date()): boolean {
  const date = normalize(value)
  if (!date) return false
  const day = typeof date === 'string' && dateOnly.test(date) ? date : manilaToday(new Date(date))
  return day === manilaToday(now)
}
