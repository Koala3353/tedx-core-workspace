// Deterministic quick-add parsing. No AI: committee names come from the person's own
// committee list, dates from a small set of words.
//
//   "Logistics: venue floorplan by Fri"  -> committee Logistics, due Friday, "Venue floorplan"
//   "#FIN reimbursement form tomorrow"   -> committee FIN, due tomorrow, "Reimbursement form"
//   "Brand book v1 due 3 Dec"            -> due 3 Dec, "Brand book v1"

import { addDaysTo, daysBetween, manilaToday } from '../../lib/format'

export type Committee = { id: string; name: string }
export type QuickAdd = { title: string; committee: Committee | null; dueOn: string | null; dueText: string | null }

const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** Month index for "nov", "Nov.", "november", "sept"; -1 for words that only start like a month ("marketing"). */
function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '')
  if (w.length < 3) return -1
  return months.findIndex(month => month.startsWith(w) || (w === 'sept' && month === 'september'))
}

const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Names a committee can be called by: full name, code in brackets, initials, first word. */
function aliases(committee: Committee): string[] {
  const name = committee.name
  const bracket = /\(([^)]+)\)/.exec(name)?.[1]
  const plain = name.replace(/\([^)]*\)/g, '').trim()
  const words = plain.split(/[\s&/,-]+/).filter(word => word.length > 0 && !['and', 'of', 'the'].includes(word.toLowerCase()))
  const initials = words.length > 1 ? words.map(word => word[0]).join('') : ''
  return [name, plain, bracket ?? '', initials, words[0] ?? ''].map(normal).filter(alias => alias.length >= 2)
}

export function matchCommittee(text: string, committees: readonly Committee[]): Committee | null {
  const wanted = normal(text)
  if (wanted.length < 2) return null
  return committees.find(c => normal(c.name) === wanted)
    ?? committees.find(c => aliases(c).includes(wanted))
    ?? committees.find(c => wanted.length >= 4 && normal(c.name).startsWith(wanted))
    ?? null
}

function weekdayIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '')
  if (w.length < 3) return -1
  return weekdays.findIndex(day => day.startsWith(w))
}

/** The coming weekday; today's weekday means a week from today. "Next Mon" reads the same as "Mon". */
function weekdayFrom(today: string, target: number): string {
  const current = new Date(today + 'T00:00:00Z').getUTCDay()
  return addDaysTo(today, (target - current + 7) % 7 || 7)
}

function monthDay(month: number, day: number, today: string): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  const year = Number(today.slice(0, 4))
  for (const y of [year, year + 1]) {
    const value = `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) return null
    if (daysBetween(today, value) >= -1) return value
  }
  return null
}

type DateMatch = { dueOn: string; text: string; index: number }

/** Finds a date phrase (optionally after "by", "due", "on", "before") and returns the day. */
export function findDate(input: string, now: Date = new Date()): DateMatch | null {
  const today = manilaToday(now)
  const lead = String.raw`(?:\b(?:by|due|on|before|until)\s+)?`
  const patterns: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [new RegExp(lead + String.raw`\b(\d{4})-(\d{2})-(\d{2})\b`, 'i'), m => monthDay(Number(m[2]) - 1, Number(m[3]), m[1] + '-01-01')],
    [new RegExp(lead + String.raw`\b(today|tonight|eod)\b`, 'i'), () => today],
    [new RegExp(lead + String.raw`\b(tomorrow|tmrw|tmr)\b`, 'i'), () => addDaysTo(today, 1)],
    [new RegExp(lead + String.raw`\bin\s+(\d{1,2})\s+(day|days|week|weeks)\b`, 'i'), m => addDaysTo(today, Number(m[1]) * (m[2].toLowerCase().startsWith('week') ? 7 : 1))],
    [new RegExp(lead + String.raw`\b(next\s+week)\b`, 'i'), () => weekdayFrom(today, 1)],
    [new RegExp(lead + String.raw`\b(eow|end of (?:the )?week)\b`, 'i'), () => weekdayFrom(today, 5)],
    [new RegExp(lead + String.raw`\b(next\s+)?((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)\.?(?=\s|$|[,;!?])`, 'i'), m => {
      const index = weekdayIndex(m[2]); return index < 0 ? null : weekdayFrom(today, index)
    }],
    [new RegExp(lead + String.raw`\b(\d{1,2})\s+([a-z]{3,9})\.?(?=\s|$|[,;!?])`, 'i'), m => monthDay(monthIndex(m[2]), Number(m[1]), today)],
    [new RegExp(lead + String.raw`\b([a-z]{3,9})\.?\s+(\d{1,2})\b`, 'i'), m => monthDay(monthIndex(m[1]), Number(m[2]), today)],
    [new RegExp(lead + String.raw`\b(\d{1,2})/(\d{1,2})\b`), m => monthDay(Number(m[1]) - 1, Number(m[2]), today)],
  ]
  for (const [pattern, resolve] of patterns) {
    // Check every occurrence: "Monitor setup by Fri" must skip "Monitor" and find "Fri".
    for (const match of input.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))) {
      const dueOn = resolve(match)
      if (dueOn) return { dueOn, text: match[0].trim(), index: match.index + (match[0].length - match[0].trimStart().length) }
    }
  }
  return null
}

const tidy = (value: string) => {
  const text = value.replace(/\s{2,}/g, ' ').replace(/^[\s:,.;-]+|[\s:,.;-]+$/g, '').replace(/\s+(?:by|due|on|for|before|until)$/i, '').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : ''
}

export function parseQuickAdd(input: string, committees: readonly Committee[], now: Date = new Date()): QuickAdd {
  let rest = input.trim()
  let committee: Committee | null = null

  // "Logistics: venue floorplan" — a committee before the first colon.
  const colon = /^([^:]{2,40}):\s*(.+)$/.exec(rest)
  if (colon) {
    const found = matchCommittee(colon[1], committees)
    if (found) { committee = found; rest = colon[2] }
  }
  // "#FIN" or "@Logistics" anywhere.
  if (!committee) {
    const tag = /(?:^|\s)[#@]([\w&-]{2,30})/.exec(rest)
    const found = tag ? matchCommittee(tag[1], committees) : null
    if (tag && found) { committee = found; rest = rest.replace(tag[0], ' ') }
  }
  const date = findDate(rest, now)
  if (date) rest = (rest.slice(0, date.index) + ' ' + rest.slice(date.index + date.text.length)).trim()

  // "... for Logistics" at the end (after any date is taken out).
  if (!committee) {
    const tail = /\s+for\s+([\w&() -]{2,40})$/i.exec(rest)
    const found = tail ? matchCommittee(tail[1], committees) : null
    if (tail && found) { committee = found; rest = rest.slice(0, tail.index) }
  }
  return { title: tidy(rest), committee, dueOn: date?.dueOn ?? null, dueText: date?.text.replace(/^(?:by|due|on|before|until)\s+/i, '') ?? null }
}

/** True when the text reads like a task to add rather than a search. */
export function looksLikeQuickAdd(input: string, committees: readonly Committee[]): boolean {
  const parsed = parseQuickAdd(input, committees)
  return parsed.title.length >= 3 && (!!parsed.committee || !!parsed.dueOn)
}
