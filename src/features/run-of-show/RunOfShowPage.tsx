import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { ArrowDown, ArrowUp, CloudOff, MonitorPlay, Pencil, Trash2 } from 'lucide-react'
import { PageHeading, Panel } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { Status } from '../../components/Status'
import { formatTime } from '../../lib/format'
import type { WorkspaceContext } from '../auth/gateway'
import type { LiveAction, PlanEdit, RunOfShowApi, Segment, SegmentInput } from './api'
import { LiveStage } from './LiveStage'
import { SegmentEditor } from './SegmentEditor'
import { clockLabel, delayLabel, durationLabel, kindLabels, plannedEnd } from './time'
import { useRunOfShow } from './useRunOfShow'
import './run-of-show.css'

const statusLabels = { planned: 'Planned', live: 'On stage', done: 'Done', skipped: 'Skipped' }
const statusStates = { planned: 'todo', live: 'in_progress', done: 'done', skipped: 'cancelled' }

export function RunOfShowPage({ api }: { api: RunOfShowApi }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext
  if (!context || !('memberId' in context)) {
    return <EmptyState title="Run of show isn't available" description="Only organizers on this term's roster can see the run of show." />
  }
  return <RunOfShowBody key={context.termId} api={api} term={context.termId} />
}

type Pending<T> = { input: T; key: string }

function RunOfShowBody({ api, term }: { api: RunOfShowApi; term: string }) {
  const source = useRunOfShow(api, term)
  const { show, status } = source
  const [live, setLive] = useState(false)
  const [editing, setEditing] = useState<Segment | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [liveError, setLiveError] = useState('')
  const [livePending, setLivePending] = useState<LiveAction | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [start, setStart] = useState<string | null>(null)
  const pendingEdit = useRef<Pending<PlanEdit> | null>(null)
  const pendingLive = useRef<Pending<LiveAction> | null>(null)
  const openButton = useRef<HTMLButtonElement>(null)
  const startId = useId()

  const run = useCallback(async (edit: PlanEdit, done?: () => void) => {
    const same = pendingEdit.current && JSON.stringify(pendingEdit.current.input) === JSON.stringify(edit)
    const request = same && pendingEdit.current ? pendingEdit.current : { input: edit, key: crypto.randomUUID() }
    pendingEdit.current = request
    setBusy(true); setError(''); setNotice('')
    const result = await api.edit(term, request.input, request.key)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      if (!result.error.retryable) pendingEdit.current = null
      if (result.error.kind === 'stale_version') source.reload()
      return
    }
    pendingEdit.current = null
    source.accept(result.value)
    done?.()
  }, [api, term, source])

  const control = useCallback(async (action: LiveAction) => {
    if (!show) return
    const request = pendingLive.current?.input === action ? pendingLive.current : { input: action, key: crypto.randomUUID() }
    pendingLive.current = request
    setLivePending(action); setLiveError('')
    const result = await api.control(term, action, show.state.version, request.key)
    setLivePending(null)
    if (!result.ok) {
      setLiveError(result.error.message)
      pendingLive.current = result.error.retryable ? request : null
      if (result.error.kind === 'stale_version') source.reload()
      return
    }
    pendingLive.current = null
    source.accept(result.value)
  }, [api, term, show, source])

  const exitLive = useCallback(() => { setLive(false); setLiveError('') }, [])
  useEffect(() => { if (!live) openButton.current?.focus({ preventScroll: true }) }, [live])
  useEffect(() => {
    if (!live) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [live])

  if (status === 'unavailable') return <>
    <PageHeading title="Run of show" />
    <EmptyState title="Run of show isn't set up yet" description="The run of show needs a workspace update. Ask the WebDev head to finish setup." />
  </>
  if (!show) return <>
    <PageHeading title="Run of show" />
    {status === 'loading' ? <LoadingState title="Opening the run of show" /> : <ErrorState title="Couldn't load the run of show"
      description="Check your connection and try again." action={<button className="button button--secondary" onClick={source.reload}>Try again</button>} />}
  </>

  const offlineSince = status === 'offline' && source.savedAt ? formatTime(new Date(source.savedAt)) : null
  const { segments, state, canEdit } = show
  const end = plannedEnd(segments)
  const totalS = segments.filter(s => s.status !== 'skipped').reduce((sum, s) => sum + s.durationS, 0)
  const showStart = start ?? state.showStart ?? ''

  return <div className="ros">
    <PageHeading title="Run of show" description={canEdit ? 'Build the plan from the OpSched, then run it live on event day.'
      : 'The plan for event day. StageMan runs it live.'} />

    {offlineSince ? <p className="ros-offline" role="status"><CloudOff size={16} aria-hidden="true" />Offline. Last updated {offlineSince}</p> : null}

    <div className="ros-summary">
      <dl>
        <div><dt>Starts</dt><dd>{state.showStart ? clockLabel(state.showStart) : 'Not set'}</dd></div>
        <div><dt>Ends around</dt><dd>{end ? clockLabel(end) : 'Not set'}</dd></div>
        <div><dt>Length</dt><dd>{segments.length ? durationLabel(totalS) : 'No segments yet'}</dd></div>
        {state.phase !== 'idle' ? <div><dt>Live</dt><dd className={state.delayS >= 60 ? 'ros-late' : undefined}>{delayLabel(state.delayS)}</dd></div> : null}
      </dl>
      {segments.length ? <button ref={openButton} type="button" className="button" onClick={() => setLive(true)}>
        <MonitorPlay size={18} aria-hidden="true" />{canEdit ? 'Open live controls' : 'Open live view'}
      </button> : null}
    </div>

    {canEdit ? <form className="ros-start" onSubmit={e => { e.preventDefault(); void run({ action: 'set_start', showStart: showStart || null }, () => setStart(null)) }}>
      <div className="form-field">
        <label htmlFor={startId}>Show start time</label>
        <input id={startId} type="time" value={showStart} onChange={e => setStart(e.target.value)} />
      </div>
      <button type="submit" className="button button--secondary" disabled={busy || showStart === (state.showStart ?? '')}>Save start time</button>
    </form> : null}

    {error && !editing ? <p className="field-error" role="alert">{error}</p> : null}
    {notice ? <p className="ros-notice" role="status">{notice}</p> : null}

    <Panel title="Segments" className="ros-plan">
      {segments.length === 0 ? <EmptyState title="No segments yet" description={canEdit
        ? 'Build the plan from the OpSched: add each talk, performance, host spot, break and tech cue in show order. Times fill in from the start time.'
        : 'StageMan builds the run of show from the OpSched before the dry run. Check back closer to event day.'} /> :
        <ol className="ros-list">
          {segments.map((s, index) => editing !== 'new' && editing?.id === s.id
            ? <li key={s.id} className="ros-row ros-row--editing">
              <SegmentEditor segment={s} units={show.units} busy={busy} error={error}
                onSave={input => void run({ action: 'save', segment: input }, () => setEditing(null))}
                onCancel={() => { setEditing(null); setError('') }} />
            </li>
            : <li key={s.id} className={'ros-row' + (s.id === state.currentSegmentId ? ' ros-row--current' : '')}>
              <p className="ros-row__time">{s.scheduledStart ? clockLabel(s.scheduledStart) : 'No time set'}</p>
              <div className="ros-row__main">
                <p className="ros-row__title">{s.title}</p>
                <p className="ros-row__meta">
                  {kindLabels[s.kind]} · {durationLabel(s.durationS)}{s.ownerUnit ? ` · On cue: ${s.ownerUnit}` : ''}
                  {s.plannedStart ? ' · Fixed start' : ''}
                </p>
                {s.cueNotes ? <p className="ros-row__notes">{s.cueNotes}</p> : null}
              </div>
              <div className="ros-row__status"><Status state={statusStates[s.status]} label={statusLabels[s.status]} /></div>
              {canEdit ? <div className="ros-row__actions">
                <button type="button" className="ros-icon" disabled={busy || index === 0} aria-label={`Move ${s.title} up`}
                  onClick={() => void run({ action: 'move', id: s.id, direction: 'up' })}><ArrowUp size={18} aria-hidden="true" /></button>
                <button type="button" className="ros-icon" disabled={busy || index === segments.length - 1} aria-label={`Move ${s.title} down`}
                  onClick={() => void run({ action: 'move', id: s.id, direction: 'down' })}><ArrowDown size={18} aria-hidden="true" /></button>
                <button type="button" className="ros-icon" disabled={busy} aria-label={`Edit ${s.title}`}
                  onClick={() => { setError(''); setEditing(s) }}><Pencil size={18} aria-hidden="true" /></button>
                <button type="button" className="ros-icon" disabled={busy || (s.status === 'live' && state.phase !== 'finished')} aria-label={`Remove ${s.title}`}
                  onClick={() => void run({ action: 'remove', id: s.id, version: s.version }, () => setNotice(`Removed ${s.title}.`))}>
                  <Trash2 size={18} aria-hidden="true" /></button>
              </div> : null}
            </li>)}
        </ol>}

      {canEdit ? editing === 'new'
        ? <SegmentEditor segment={null} units={show.units} busy={busy} error={error}
          onSave={(input: SegmentInput) => void run({ action: 'save', segment: input }, () => { setEditing(null); setNotice(`Added ${input.title}.`) })}
          onCancel={() => { setEditing(null); setError('') }} />
        : <button type="button" className={segments.length ? 'button button--secondary' : 'button'} disabled={busy}
          onClick={() => { setError(''); setEditing('new') }}>Add a segment</button> : null}
    </Panel>

    {canEdit && segments.length ? <Panel title="After the dry run" className="ros-reset">
      <p>Set every segment back to planned and clear the live clock and delay. The plan itself stays.</p>
      {confirmReset ? <div className="ros-editor__actions">
        <button type="button" className="button button--secondary" disabled={busy}
          onClick={() => void run({ action: 'reset' }, () => { setConfirmReset(false); setNotice('Live run cleared. Ready for the show.') })}>Yes, clear the live run</button>
        <button type="button" className="button button--secondary" onClick={() => setConfirmReset(false)}>Keep it</button>
      </div> : <button type="button" className="button button--secondary" onClick={() => setConfirmReset(true)}>Clear the live run</button>}
    </Panel> : null}

    {live ? <LiveStage show={show} skew={source.skew} offlineSince={offlineSince} pending={livePending} error={liveError}
      onControl={action => void control(action)} onExit={exitLive} /> : null}
  </div>
}
