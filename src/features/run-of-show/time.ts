import type { RunOfShow, Segment, SegmentKind, ShowState } from './api'

export const kindLabels: Record<SegmentKind, string> = {
  talk: 'Talk', performance: 'Performance', host: 'Host', break: 'Break', tech: 'Tech cue',
}

/** "18:05" -> "6:05 PM". */
export function clockLabel(hhmm: string | null): string {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** Seconds -> "4:05" or "1:02:05". Negative values keep a minus sign. */
export function countdown(totalSeconds: number): string {
  const negative = totalSeconds < 0
  const s = Math.floor(Math.abs(totalSeconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
  return (negative ? '−' : '') + body
}

/** Seconds -> "12 min", "1 h 5 min". */
export function durationLabel(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60)
  if (m < 60) return totalSeconds > 0 && m === 0 ? `${totalSeconds} s` : `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** Seconds of delay -> "2 min late" / "1 min early" / "On time". */
export function delayLabel(delayS: number): string {
  const m = Math.round(Math.abs(delayS) / 60)
  if (m === 0) return 'On time'
  return delayS > 0 ? `${m} min late` : `${m} min early`
}

/** Seconds since midnight in Manila for a moment. */
export function manilaSeconds(at: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(at))
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
  return get('hour') * 3600 + get('minute') * 60 + get('second')
}

const hhmmSeconds = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 3600 + m * 60 }

/** Seconds from now until a Manila clock time, wrapped into the nearest +/- 12 hours. */
export function secondsUntil(hhmm: string, now: number): number {
  let diff = hhmmSeconds(hhmm) - manilaSeconds(now)
  if (diff > 43200) diff -= 86400
  if (diff < -43200) diff += 86400
  return diff
}

/** "18:00" + seconds -> "HH:MM" (wraps past midnight). */
export function addToClock(hhmm: string, seconds: number): string {
  const total = ((hhmmSeconds(hhmm) + Math.round(seconds)) % 86400 + 86400) % 86400
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}`
}

/** Time on stage so far for the current segment, excluding holds. */
export function elapsedSeconds(state: ShowState, now: number): number {
  if (!state.segmentStartedAt) return 0
  const end = state.heldAt ? Date.parse(state.heldAt) : now
  return Math.max(0, (end - Date.parse(state.segmentStartedAt)) / 1000 - state.heldS)
}

export type LiveView = {
  current: Segment | null
  next: Segment | null
  elapsed: number
  remaining: number | null
  /** Seconds until the next segment is expected to start, or null when unknown. */
  nextIn: number | null
}

export function liveView(show: RunOfShow, now: number): LiveView {
  const { segments, state } = show
  const current = segments.find(s => s.id === state.currentSegmentId) ?? null
  const after = current ? segments.filter(s => s.position > current.position) : segments
  const next = after.find(s => s.status === 'planned') ?? null
  const elapsed = current ? elapsedSeconds(state, now) : 0
  const remaining = current ? current.durationS - elapsed : null
  let nextIn: number | null = null
  if (next) {
    if (current && remaining !== null) nextIn = Math.max(0, remaining)
    else if (next.scheduledStart) nextIn = secondsUntil(next.scheduledStart, now) + state.delayS
  }
  return { current, next, elapsed, remaining, nextIn }
}

/** Show end time "HH:MM" from the last scheduled segment, or null. */
export function plannedEnd(segments: Segment[]): string | null {
  const last = [...segments].reverse().find(s => s.scheduledStart)
  return last?.scheduledStart ? addToClock(last.scheduledStart, last.durationS) : null
}
