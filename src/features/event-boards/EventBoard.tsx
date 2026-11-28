import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useRouteLoaderData } from 'react-router'
import { CalendarClock, MapPin, Plus, Users } from 'lucide-react'
import { Status } from '../../components/Status'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { safeStorage } from '../../lib/clientState'
import { daysBetween, dueState, formatDayLabel, formatTime, manilaToday, relativeDue } from '../../lib/format'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import type { BoardData, BoardId, EventBoardsApi, SessionValues, TedifySession } from './api'
import { boards, type BoardConfig } from './boards'
import './event-boards.css'
import { EmptyBoard, EmptyStage, NotSwitchedOn } from '../../components/illustrations'

type Load = { state: 'loading' } | { state: 'ready'; data: BoardData } | { state: 'missing' } | { state: 'error' }

/** Route "/event/online-contest". */
export function ContestBoardPage({ api }: { api?: EventBoardsApi }) { return <EventBoard id="contest" api={api} /> }
/** Route "/event/tedify". */
export function TedifyBoardPage({ api }: { api?: EventBoardsApi }) { return <EventBoard id="tedify" api={api} /> }

function EventBoard({ id, api }: { id: BoardId; api?: EventBoardsApi }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  const config = boards[id]
  const member = context && !isGuest(context) ? context : null
  return <div className="board">
    <header className="board-head">
      <h1>{config.title}</h1>
      <p>{config.description}</p>
    </header>
    <BoardCountdown config={config} />
    <section className="board-section" aria-labelledby={id + '-who'}>
      <h2 id={id + '-who'}>Who runs it</h2>
      <ul className="board-list">{config.committees.map(c => <li key={c.name} className="board-row">
        <Users className="icon board-row__icon" size={18} strokeWidth={1.5} aria-hidden="true" />
        <span className="board-row__text"><span className="board-row__title">{c.name}</span><span className="board-row__meta">{c.role}</span></span>
      </li>)}</ul>
    </section>
    {member && api ? <BoardWork key={member.termId + ':' + id} api={api} termId={member.termId} config={config} />
      : <section className="board-section"><EmptyState illustration={<NotSwitchedOn />} title="Live work isn't connected yet" description="Tasks and deliverables for this board will show here once the workspace connection is set up." /></section>}
    <KeyDates config={config} />
    <RunChecklist config={config} />
  </div>
}

function BoardCountdown({ config }: { config: BoardConfig }) {
  const [today, setToday] = useState(manilaToday)
  useEffect(() => {
    const timer = window.setInterval(() => setToday(manilaToday()), 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])
  const toStart = daysBetween(today, config.start), toEnd = daysBetween(today, config.end)
  const span = config.start === config.end ? formatDayLabel(config.start) : `${formatDayLabel(config.start)} to ${formatDayLabel(config.end)}`
  let number: string | null = null, caption: string
  if (toStart > 0) { number = String(toStart); caption = `${toStart === 1 ? 'day' : 'days'} to ${config.title}` }
  else if (toEnd >= 0) caption = config.start === config.end ? `${config.title} is today` : `${config.title} is running · day ${1 - toStart} of ${daysBetween(config.start, config.end) + 1}`
  else caption = `${config.title} is done. Thank you, everyone.`
  return <div className="board-countdown">
    {number ? <span className="board-countdown__number" aria-hidden="true">{number}</span> : <CalendarClock className="icon board-countdown__icon" size={24} strokeWidth={1.5} aria-hidden="true" />}
    <p className="board-countdown__caption">{number ? <span className="visually-hidden">{number} </span> : null}{caption}<span className="board-countdown__when">{span}</span></p>
  </div>
}

function workState(category: string) {
  return ({ completed: 'done', approved: 'approved', needs_revision: 'changes_requested', rejected: 'rejected', cancelled: 'cancelled', draft: 'draft' } as Record<string, string>)[category] ?? 'in_progress'
}

function BoardWork({ api, termId, config }: { api: EventBoardsApi; termId: string; config: BoardConfig }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    void api.read(termId, config.id)
      .then(data => { if (active) setLoad(data ? { state: 'ready', data } : { state: 'missing' }) })
      .catch(() => { if (active) setLoad({ state: 'error' }) })
    return () => { active = false }
  }, [api, termId, config.id, revision])
  const refresh = () => setRevision(v => v + 1)
  const hint = `Add "${config.keyword}" to a deliverable or task title to show it here.`
  if (load.state === 'loading') return <section className="board-section"><LoadingState title="Loading this board" /></section>
  if (load.state === 'missing') return <section className="board-section"><h2>What's due</h2><EmptyState illustration={<NotSwitchedOn />} title="This board isn't switched on yet" description={`Ask WebDev to apply the event boards update. ${hint}`} /></section>
  if (load.state === 'error') return <section className="board-section"><ErrorState title="Couldn't load this board" description="Check your connection and try again."
    action={<button className="button button--secondary" type="button" onClick={refresh}>Try again</button>} /></section>
  const { data } = load
  const open = data.items.filter(i => !['completed', 'approved', 'cancelled', 'rejected'].includes(i.state))
  const late = open.filter(i => dueState(i) === 'late').length
  return <>
    {data.sessions ? <Sessions api={api} termId={termId} sessions={data.sessions} canManage={data.canManageSessions} onChanged={refresh} /> : null}
    <section className="board-section" aria-labelledby={config.id + '-due'}>
      <h2 id={config.id + '-due'}>What's due {data.items.length ? <span className="board-count">{open.length} open{late ? ` · ${late} late` : ''}</span> : null}</h2>
      {!data.items.length ? <EmptyState illustration={<EmptyBoard />} title="Nothing on this board yet" description={hint}
        action={<Link className="button button--secondary" to="/deliverables">Open deliverables</Link>} />
        : <>
          <ul className="board-list">{data.items.map(item => {
            const late = !['completed', 'approved', 'cancelled', 'rejected'].includes(item.state) && dueState(item) === 'late'
            return <li key={item.id} className="board-row">
              <span className="board-row__text">
                <Link className="board-row__title" to={(item.kind === 'task' ? '/tasks/' : '/deliverables/') + item.id}>{item.title}</Link>
                <span className="board-row__meta">{[item.kind === 'task' ? 'Task' : 'Deliverable', item.committee].filter(Boolean).join(' · ')} · <span className={late ? 'board-late' : undefined}>{relativeDue(item)}</span></span>
              </span>
              <Status state={workState(item.state)} label={item.stateLabel} />
            </li>
          })}</ul>
          <p className="board-muted">{hint}</p>
        </>}
    </section>
  </>
}

function KeyDates({ config }: { config: BoardConfig }) {
  const today = manilaToday()
  return <section className="board-section" aria-labelledby={config.id + '-dates'}>
    <h2 id={config.id + '-dates'}>Key dates</h2>
    <ol className="board-list board-dates">{config.dates.map(d => <li key={d.day + d.label} className={`board-row${d.day < today ? ' board-row--past' : ''}`}>
      <span className="board-date numeric">{formatDayLabel(d.day)}</span>
      <span className="board-row__text"><span className="board-row__title">{d.label}</span>{d.suggested ? <span className="board-row__meta">Suggested. Agree the exact date with the heads.</span> : null}</span>
    </li>)}</ol>
  </section>
}

function RunChecklist({ config }: { config: BoardConfig }) {
  const key = 'tedx.board.' + config.id + '.checklist'
  const [checked, setChecked] = useState<string[]>(() => {
    try { const v: unknown = JSON.parse(safeStorage.get(key) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
  })
  function toggle(id: string) {
    setChecked(current => {
      const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
      safeStorage.set(key, JSON.stringify(next))
      return next
    })
  }
  const done = config.checklist.filter(c => checked.includes(c.id)).length
  return <section className="board-section" aria-labelledby={config.id + '-run'}>
    <h2 id={config.id + '-run'}>Run checklist <span className="board-count">{done} of {config.checklist.length}</span></h2>
    <p className="board-muted">Ticks are saved on this device only. Use them as your own check before the day.</p>
    <ul className="board-list">{config.checklist.map(c => <li key={c.id} className="board-check">
      <input id={key + c.id} type="checkbox" checked={checked.includes(c.id)} onChange={() => toggle(c.id)} />
      <label htmlFor={key + c.id}><span className="board-row__title">{c.text}</span><span className="board-row__meta">{c.owner}</span></label>
    </li>)}</ul>
  </section>
}

function useRequest() {
  const ref = useRef<{ key: string; id: string } | null>(null)
  return (key: string) => {
    if (ref.current?.key !== key) ref.current = { key, id: crypto.randomUUID() }
    return { id: ref.current.id, clear: () => { ref.current = null } }
  }
}

function Sessions({ api, termId, sessions, canManage, onChanged }: { api: EventBoardsApi; termId: string; sessions: TedifySession[]; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  return <section className="board-section" aria-labelledby="tedify-sessions">
    <h2 id="tedify-sessions">Breakout sessions {sessions.length ? <span className="board-count">{sessions.length}</span> : null}</h2>
    {!sessions.length && editing !== 'new' ? <EmptyState illustration={<EmptyStage />} title="No breakout sessions yet"
      description={canManage ? 'Add each session with its speaker, room and time. Everyone in the core team can see this list.' : 'ProgAct and TalRec heads add sessions here with the speaker, room and time.'} /> : null}
    {sessions.length ? <ul className="board-list">{sessions.map(s => editing === s.id
      ? <li key={s.id} className="board-row board-row--form"><SessionForm api={api} termId={termId} session={s} onDone={saved => { setEditing(null); if (saved) onChanged() }} /></li>
      : <li key={s.id} className="board-row">
        <span className="board-session__time numeric">{s.startsAt ? formatTime(s.startsAt) : 'Time TBA'}{s.endsAt ? <span className="board-row__meta">to {formatTime(s.endsAt)}</span> : null}</span>
        <span className="board-row__text">
          <span className="board-row__title">{s.title}</span>
          <span className="board-row__meta">{s.speakerName ?? 'Speaker TBA'}</span>
          <span className="board-row__meta"><MapPin className="icon" size={13} strokeWidth={1.75} aria-hidden="true" /> {s.room ?? 'Room TBA'}</span>
          {s.note ? <span className="board-row__meta">{s.note}</span> : null}
        </span>
        {canManage ? <button className="button button--secondary board-row__action" type="button" onClick={() => setEditing(s.id)}>Edit<span className="visually-hidden"> {s.title}</span></button> : null}
      </li>)}</ul> : null}
    {canManage ? editing === 'new'
      ? <SessionForm api={api} termId={termId} onDone={saved => { setEditing(null); if (saved) onChanged() }} />
      : <div className="board-actions"><button className="button" type="button" onClick={() => setEditing('new')}><Plus className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Add session</button></div>
      : null}
  </section>
}

/** datetime-local values are read as Manila time. */
function toInput(value: string | null) {
  if (!value) return ''
  const shifted = new Date(Date.parse(value) + 8 * 3600_000).toISOString()
  return shifted.slice(0, 16)
}
function fromInput(value: string) { return value ? value + ':00+08:00' : null }

function SessionForm({ api, termId, session, onDone }: { api: EventBoardsApi; termId: string; session?: TedifySession; onDone: (saved: boolean) => void }) {
  const id = useId()
  const [title, setTitle] = useState(session?.title ?? '')
  const [speaker, setSpeaker] = useState(session?.speakerName ?? '')
  const [room, setRoom] = useState(session?.room ?? '')
  const [starts, setStarts] = useState(toInput(session?.startsAt ?? null) || '2027-03-20T13:00')
  const [ends, setEnds] = useState(toInput(session?.endsAt ?? null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRequest()
  async function run(values: SessionValues) {
    const r = request(JSON.stringify([session?.id, session?.version, values]))
    setBusy(true); setError('')
    const result = await api.saveSession(termId, session ?? null, values, r.id)
    setBusy(false)
    if (result.ok) { r.clear(); onDone(true); return }
    setError(result.error.kind === 'stale_version' ? 'Someone else just changed this session. Refresh to see the latest.'
      : result.error.kind === 'permission_denied' ? 'Only ProgAct and TalRec heads can change sessions.'
      : result.error.kind === 'validation_failed' ? 'Check the times: the end must be after the start.' : 'Couldn\'t save. Try again.')
  }
  function values(archived = false): SessionValues {
    return { title: title.trim(), speakerName: speaker.trim() || null, room: room.trim() || null, startsAt: fromInput(starts), endsAt: fromInput(ends), note: session?.note ?? null, ...(archived ? { archived: true } : {}) }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (ends && (!starts || ends <= starts)) { setError('The end time must be after the start time.'); return }
    void run(values())
  }
  return <form className="board-form" onSubmit={submit}>
    <div className="board-form__grid">
      <div className="form-field"><label htmlFor={id + '-title'}>Session (required)</label><input id={id + '-title'} required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="form-field"><label htmlFor={id + '-speaker'}>Speaker</label><input id={id + '-speaker'} maxLength={200} value={speaker} onChange={e => setSpeaker(e.target.value)} /></div>
      <div className="form-field"><label htmlFor={id + '-room'}>Room</label><input id={id + '-room'} maxLength={120} value={room} onChange={e => setRoom(e.target.value)} /></div>
      <div className="form-field"><label htmlFor={id + '-starts'}>Starts (Manila time)</label><input id={id + '-starts'} type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} /></div>
      <div className="form-field"><label htmlFor={id + '-ends'}>Ends</label><input id={id + '-ends'} type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} /></div>
    </div>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <div className="board-actions">
      <button className="button" disabled={busy}>{session ? 'Save session' : 'Add session'}</button>
      <button className="button button--secondary" type="button" disabled={busy} onClick={() => onDone(false)}>Cancel</button>
      {session ? <button className="button button--secondary" type="button" disabled={busy}
        onClick={() => { if (window.confirm(`Remove "${session.title}" from the session list?`)) void run(values(true)) }}>Remove session</button> : null}
    </div>
  </form>
}
