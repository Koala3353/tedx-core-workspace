import { useEffect, useRef } from 'react'
import { ChevronsRight, Minus, Pause, Play, Plus, SkipForward, X } from 'lucide-react'
import type { LiveAction, RunOfShow } from './api'
import { countdown, delayLabel, kindLabels, liveView } from './time'
import { useNow, useWakeLock } from './useRunOfShow'

type Props = {
  show: RunOfShow
  skew: number
  offlineSince: string | null
  pending: LiveAction | null
  error: string
  onControl: (action: LiveAction) => void
  onExit: () => void
}

const phaseLabels = { idle: 'Not started', running: 'On stage', held: 'Held', finished: 'Show finished' }

/** Full-screen stage display. Always black so it reads the same backstage in either theme. */
export function LiveStage({ show, skew, offlineSince, pending, error, onControl, onExit }: Props) {
  const now = useNow(true, skew)
  const wake = useWakeLock(true)
  const exit = useRef<HTMLButtonElement>(null)
  const { state, canEdit } = show
  const view = liveView(show, now)
  const late = state.delayS >= 60
  const over = view.remaining !== null && view.remaining < 0

  useEffect(() => { exit.current?.focus() }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onExit() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onExit])

  const primary: LiveAction = state.phase === 'running' ? 'next' : 'go'
  const control = (action: LiveAction, label: string, Icon: typeof Play, disabled = false) =>
    <button type="button" className={'ros-live__control' + (action === primary ? ' ros-live__control--primary' : '')}
      disabled={!!pending || disabled} aria-busy={pending === action || undefined} onClick={() => onControl(action)}>
      <Icon size={28} strokeWidth={2} aria-hidden="true" /><span>{label}</span>
    </button>

  return <div className="ros-live" role="dialog" aria-modal="true" aria-label="Live run of show">
    <header className="ros-live__bar">
      <p className="ros-live__phase" data-phase={state.phase}>
        {state.phase === 'running' ? <Play size={16} aria-hidden="true" /> : state.phase === 'held' ? <Pause size={16} aria-hidden="true" /> : null}
        {phaseLabels[state.phase]}
      </p>
      {late ? <p className="ros-live__delay" role="status">+{Math.round(state.delayS / 60)} min late</p>
        : <p className="ros-live__ontime">{delayLabel(state.delayS)}</p>}
      <button ref={exit} type="button" className="ros-live__exit" onClick={onExit}><X size={20} aria-hidden="true" /><span>Exit live view</span></button>
    </header>

    <main className="ros-live__body">
      <section className="ros-live__now" aria-labelledby="ros-now-label">
        <h2 id="ros-now-label" className="ros-live__label">Now</h2>
        {view.current ? <div key={view.current.id} className="ros-live__swap">
          <p className="ros-live__kind">{kindLabels[view.current.kind]}{view.current.ownerUnit ? ` · On cue: ${view.current.ownerUnit}` : ''}</p>
          <p className="ros-live__title">{view.current.title}</p>
          <p className="ros-live__clock">
            <span className="ros-live__elapsed" aria-label={`Elapsed ${countdown(view.elapsed)}`}>{countdown(view.elapsed)}</span>
            <span className={'ros-live__remaining' + (over ? ' ros-live__remaining--over' : '')}>
              {over ? `${countdown(-(view.remaining ?? 0))} over` : `${countdown(view.remaining ?? 0)} left`}
            </span>
          </p>
          {view.current.cueNotes ? <p className="ros-live__notes">{view.current.cueNotes}</p> : null}
        </div> : <div className="ros-live__swap">
          <p className="ros-live__title ros-live__title--quiet">{state.phase === 'finished' ? 'That’s the show.' : 'Waiting for the first cue'}</p>
        </div>}
      </section>

      <section className="ros-live__next" aria-labelledby="ros-next-label">
        <h2 id="ros-next-label" className="ros-live__label">Next</h2>
        {view.next ? <div key={view.next.id} className="ros-live__swap">
          <p className="ros-live__next-title">
            {view.next.title}{view.nextIn !== null ? <> in <span className="ros-live__tabular">{countdown(Math.max(0, view.nextIn))}</span></> : null}
          </p>
          <p className="ros-live__kind">{kindLabels[view.next.kind]}{view.next.ownerUnit ? ` · On cue: ${view.next.ownerUnit}` : ''}</p>
          {view.next.cueNotes ? <p className="ros-live__notes">{view.next.cueNotes}</p> : null}
        </div> : <p className="ros-live__kind">Nothing after this.</p>}
      </section>
    </main>

    <footer className="ros-live__foot">
      {canEdit ? <div className="ros-live__controls" aria-label="Show controls" role="group">
        {control('go', state.phase === 'held' ? 'Resume' : 'Go', Play, state.phase === 'running')}
        {control('hold', 'Hold', Pause, state.phase !== 'running')}
        {control('next', 'Next', ChevronsRight, state.phase === 'idle' || state.phase === 'finished')}
        {control('plus', '+1 min', Plus)}
        {control('minus', '−1 min', Minus)}
        {control('skip', 'Skip next', SkipForward, !view.next)}
      </div> : null}
      {error ? <p className="ros-live__error" role="alert">{error}</p> : null}
      <p className="ros-live__meta" aria-live="polite">
        {offlineSince ? <strong>Offline — last updated {offlineSince}. </strong> : null}
        {canEdit ? '' : 'Read only. StageMan runs the controls. '}
        {wake === 'off' || wake === 'unsupported' ? 'Keep this screen on in your phone settings.' : ''}
      </p>
    </footer>
  </div>
}
