import { CircleCheck, CircleDashed, CircleDot, CirclePause, CircleX, Clock, OctagonAlert, type LucideIcon } from 'lucide-react'

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

const tones: Record<string, Tone> = {
  done: 'ok', completed: 'ok', complete: 'ok', approved: 'ok', accepted: 'ok', paid: 'ok', closed: 'ok', resolved: 'ok', published: 'ok', reconciled: 'ok', fulfilled: 'ok',
  blocked: 'danger', rejected: 'danger', failed: 'danger', declined: 'danger', overdue: 'danger', returned: 'warn',
  ready_for_review: 'warn', submitted: 'warn', in_review: 'warn', under_review: 'warn', pending: 'warn', revision_requested: 'warn', changes_requested: 'warn', awaiting_review: 'warn', paused: 'warn',
  in_progress: 'info', active: 'info', open: 'info', claimed: 'info', scheduled: 'info',
  todo: 'neutral', draft: 'neutral', revision_draft: 'neutral', not_started: 'neutral', cancelled: 'neutral', withdrawn: 'neutral', archived: 'neutral',
}

const icons: Record<string, LucideIcon> = { paused: CirclePause, cancelled: CircleX, withdrawn: CircleX, rejected: CircleX, declined: CircleX }
const toneIcons: Record<Tone, LucideIcon> = { ok: CircleCheck, warn: Clock, danger: OctagonAlert, info: CircleDot, neutral: CircleDashed }

export function statusTone(state: string): Tone { return tones[state] ?? 'neutral' }

/** A status is always an icon plus its text label, never colour alone. */
export function Status({ state, label, tone }: { state: string; label?: string; tone?: Tone }) {
  const resolved = tone ?? statusTone(state)
  const Icon = icons[state] ?? toneIcons[resolved]
  return <span className={`status status--${resolved}`}><Icon className="icon" size={14} strokeWidth={2} aria-hidden="true" />{label ?? state.replaceAll('_', ' ')}</span>
}
