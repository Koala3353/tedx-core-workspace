import type { Board, BoardDeliverable, BoardUnit } from '../committee-pages/board'

export const eventDay = '2027-04-17'

/** Primer milestones drawn on the heatmap. Edit dates here. */
export const milestones = [
  { day: '2027-02-28', label: 'Online contest' },
  { day: '2027-03-20', label: 'TEDify' },
  { day: '2027-04-16', label: 'Dry run' },
  { day: eventDay, label: 'Event day' },
] as const

/** green, amber, red, grey. `done` is shown as green with its own label. */
export type Health = 'done' | 'on_track' | 'at_risk' | 'behind' | 'not_started'
export const healthRank: Record<Health, number> = { behind: 4, at_risk: 3, on_track: 2, done: 1, not_started: 0 }
export const healthLabel: Record<Health, string> = { done: 'Done', on_track: 'On track', at_risk: 'At risk', behind: 'Behind', not_started: 'Not started' }
export const healthTone: Record<Health, 'ok' | 'warn' | 'danger' | 'neutral'> = { done: 'ok', on_track: 'ok', at_risk: 'warn', behind: 'danger', not_started: 'neutral' }

const dayMs = 86_400_000
const epoch = (day: string) => Date.parse(day + 'T00:00:00Z')
export const daysBetween = (from: string, to: string) => Math.round((epoch(to) - epoch(from)) / dayMs)
export function addDays(day: string, n: number): string { return new Date(epoch(day) + n * dayMs).toISOString().slice(0, 10) }
/** Monday of the week containing `day`. */
export function weekStart(day: string): string { const dow = new Date(epoch(day)).getUTCDay(); return addDays(day, -((dow + 6) % 7)) }

/** Share of the checklist done, 0–1. A deliverable with no checklist counts as 0 until submitted. */
export function progress(d: BoardDeliverable): number {
  if (d.state === 'accepted' || d.state === 'submitted') return 1
  return d.tasksTotal ? d.tasksDone / d.tasksTotal : 0
}

/**
 * Checklist progress against time left. Six weeks out nothing needs to be done yet; on the due
 * date everything should be. Behind = more than a quarter short of where it should be, or late.
 */
export function health(d: BoardDeliverable, today: string): Health {
  if (d.state === 'accepted') return 'done'
  const p = progress(d)
  if (!d.dueOn) return d.blocked ? 'at_risk' : p > 0 ? 'on_track' : 'not_started'
  const left = daysBetween(today, d.dueOn)
  if (left < 0) return 'behind'
  if (d.state === 'submitted') return 'on_track'
  const untouched = p === 0 && (d.tasksTotal === 0 || d.state === 'proposed' || d.state === 'draft')
  if (untouched && left > 21) return 'not_started'
  const expected = Math.min(1, Math.max(0, 1 - left / 42))
  let result: Health = p >= expected ? 'on_track' : p >= expected - 0.25 ? 'at_risk' : 'behind'
  if ((d.blocked || d.waiting) && result === 'on_track') result = 'at_risk'
  if (d.blocked && left <= 7) result = 'behind'
  return result
}

export function worst(list: Health[]): Health | null {
  return list.reduce<Health | null>((a, b) => a === null || healthRank[b] > healthRank[a] ? b : a, null)
}

export type Column = { key: string; start: string; end: string; label: string; milestones: { day: string; label: string }[]; earlier?: boolean }
export type Cell = { column: Column; items: { d: BoardDeliverable; health: Health }[]; health: Health | null }
export type Row = { unit: BoardUnit | null; name: string; code: string; cells: Cell[]; total: number; behind: number; allClear: boolean }
export type Summary = { days: number; onTrack: number; atRisk: number; waiting: number; total: number; undated: number }
export type WarRoom = { columns: Column[]; rows: Row[]; summary: Summary; undated: { d: BoardDeliverable; health: Health; unit: BoardUnit | null }[] }

const shortDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
export const labelDay = (day: string) => shortDay.format(new Date(epoch(day)))

export function buildWarRoom(board: Board): WarRoom {
  const today = board.today
  const first = weekStart(today)
  const last = weekStart(eventDay)
  const columns: Column[] = []
  for (let start = first; start <= last; start = addDays(start, 7)) {
    const end = addDays(start, 6)
    columns.push({ key: start, start, end, label: labelDay(start), milestones: milestones.filter(m => m.day >= start && m.day <= end) })
  }
  const live = board.deliverables.filter(d => d.state !== 'cancelled')
  const hasEarlier = live.some(d => d.dueOn !== null && d.dueOn < first)
  if (hasEarlier) columns.unshift({ key: 'earlier', start: '0000-01-01', end: addDays(first, -1), label: 'Earlier', milestones: [], earlier: true })
  const columnFor = (day: string) => columns.find(c => day >= c.start && day <= c.end) ?? columns[columns.length - 1]

  const delivery = board.units.filter(u => u.delivery)
  const units = delivery.length ? delivery : board.units
  const known = new Set(units.map(u => u.id))
  const rowOf = (d: BoardDeliverable) => d.unitId && known.has(d.unitId) ? d.unitId : 'none'
  const makeRow = (unit: BoardUnit | null): Row => {
    const mine = live.filter(d => d.dueOn !== null && rowOf(d) === (unit?.id ?? 'none'))
    const cells = columns.map(column => {
      const items = mine.filter(d => columnFor(d.dueOn!) === column).map(d => ({ d, health: health(d, today) }))
      return { column, items, health: worst(items.map(i => i.health)) }
    })
    const behind = cells.reduce((n, c) => n + c.items.filter(i => i.health === 'behind').length, 0)
    return { unit, name: unit?.name ?? 'No committee', code: unit?.code ?? '', cells, total: mine.length, behind, allClear: behind === 0 }
  }
  const rows = units.map(makeRow)
  if (live.some(d => d.dueOn !== null && rowOf(d) === 'none')) rows.push(makeRow(null))

  const healths = live.map(d => health(d, today))
  const undated = live.filter(d => d.dueOn === null).map(d => ({ d, health: health(d, today), unit: board.units.find(u => u.id === d.unitId) ?? null }))
  return {
    columns, rows, undated,
    summary: {
      days: daysBetween(today, eventDay),
      onTrack: healths.filter(h => h === 'on_track' || h === 'done').length,
      atRisk: healths.filter(h => h === 'at_risk' || h === 'behind').length,
      waiting: live.filter(d => d.waiting && d.state !== 'accepted').length,
      total: live.length,
      undated: undated.length,
    },
  }
}

/** Fallback phase name when the workspace has no current phase set. */
export function primerPhase(today: string): string {
  if (today > eventDay) return 'After the event'
  if (today === eventDay) return 'Event day'
  if (today >= '2027-04-06') return 'Freeze and show'
  if (today >= '2027-03-21') return 'Show prep'
  if (today >= '2027-03-13') return 'TEDify'
  if (today >= '2027-01-29') return 'Campaign'
  return 'Preparation'
}

export function firstName(name: string): string { return name.trim().split(/\s+/)[0] || name }
