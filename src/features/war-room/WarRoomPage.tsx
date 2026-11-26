import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useRouteLoaderData } from 'react-router'
import { CircleCheck, CircleDashed, Clock, Copy, ExternalLink, Flag, LayoutGrid, List, MonitorPlay, OctagonAlert, RefreshCw, X, type LucideIcon } from 'lucide-react'
import { PageHeading } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { Status } from '../../components/Status'
import { appPath } from '../../lib/basePath'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import { formatDay, formatDue } from '../shared/dates'
import { useBoard } from '../committee-pages/useBoard'
import type { BoardDeliverable, BoardUnit } from '../committee-pages/board'
import { buildWarRoom, firstName, healthLabel, healthTone, labelDay, primerPhase, progress, type Cell, type Health, type Row, type WarRoom } from './model'
import type { WarRoomApi } from './api'
import './war-room.css'

const healthIcon: Record<Health, LucideIcon> = { done: CircleCheck, on_track: CircleCheck, at_risk: Clock, behind: OctagonAlert, not_started: CircleDashed }

function HealthMark({ health, size = 16 }: { health: Health; size?: number }) {
  const Icon = healthIcon[health]
  return <Icon className="icon" size={size} strokeWidth={2} aria-hidden="true" />
}

function steps(d: BoardDeliverable): string {
  if (d.state === 'accepted') return 'Accepted'
  if (d.state === 'submitted') return 'Submitted for review'
  return d.tasksTotal ? `${d.tasksDone} of ${d.tasksTotal} steps done` : 'No checklist yet'
}
function due(d: BoardDeliverable): string { return d.dueAt ?? d.dueOn ? formatDue(d.dueAt ?? d.dueOn) : 'No due date' }

function cellText(row: Row, cell: Cell): string {
  const week = cell.column.earlier ? 'earlier weeks' : `week of ${labelDay(cell.column.start)}`
  const marks = cell.column.milestones.map(m => m.label).join(', ')
  if (!cell.items.length) return `${row.name}, ${week}: nothing due${marks ? '. ' + marks : ''}`
  const counts = (['behind', 'at_risk', 'on_track', 'done', 'not_started'] as Health[])
    .map(h => [h, cell.items.filter(i => i.health === h).length] as const).filter(([, n]) => n)
    .map(([h, n]) => `${n} ${healthLabel[h].toLowerCase()}`).join(', ')
  return `${row.name}, ${week}: ${cell.items.length} ${cell.items.length === 1 ? 'deliverable' : 'deliverables'} due, ${counts}${marks ? '. ' + marks : ''}`
}

export function WarRoomPage({ api }: { api?: WarRoomApi }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  const heading = <PageHeading title="War room" description="Every committee's deliverables, week by week, until April 17." />
  if (!context || isGuest(context)) return <>{heading}<EmptyState title="Not available for guests" description="The war room is for core members." action={<Link className="button button--secondary" to="/shared">Shared with me</Link>} /></>
  return <WarRoomBody key={context.termId} api={api} termId={context.termId} heading={heading} />
}

function WarRoomBody({ api, termId, heading }: { api?: WarRoomApi; termId: string; heading: ReactNode }) {
  const state = useBoard(api?.board, termId)
  const [phase, setPhase] = useState<string | null>(null)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [open, setOpen] = useState<{ row: Row; cell: Cell } | null>(null)
  const [presenting, setPresenting] = useState(false)
  useEffect(() => {
    let live = true
    void api?.phase(termId).then(p => { if (live) setPhase(p) })
    return () => { live = false }
  }, [api, termId])

  if (state.unavailable && !state.board) return <>{heading}<EmptyState title="The war room isn't switched on yet" description="It appears once the latest workspace update is installed. Ask the web team." /></>
  if (!state.board) return <>{heading}{state.error
    ? <ErrorState title="The war room didn't load" description={state.error} action={<button className="button button--secondary" type="button" onClick={state.reload}>Try again</button>} />
    : <LoadingState title="Loading the war room" rows={5} />}</>

  const room = buildWarRoom(state.board)
  const phaseName = phase ?? primerPhase(state.board.today)
  const groupLabelId = 'war-room-view'
  return <div className="war-room">
    {heading}
    <TopStrip room={room} phase={phaseName} />
    <div className="war-room__toolbar">
      <div className="war-room__views" role="group" aria-labelledby={groupLabelId}>
        <span id={groupLabelId} className="visually-hidden">View</span>
        <button type="button" className="button button--secondary" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid className="icon" size={16} aria-hidden="true" />Heatmap</button>
        <button type="button" className="button button--secondary" aria-pressed={view === 'list'} onClick={() => setView('list')}><List className="icon" size={16} aria-hidden="true" />List view</button>
      </div>
      <button type="button" className="button button--secondary" onClick={state.reload} disabled={state.loading}><RefreshCw className="icon" size={16} aria-hidden="true" />{state.loading ? 'Refreshing' : 'Refresh'}</button>
      <button type="button" className="button" onClick={() => setPresenting(true)}><MonitorPlay className="icon" size={16} aria-hidden="true" />Present</button>
    </div>
    {state.error ? <p className="field-error" role="alert">{state.error} Showing the last loaded copy.</p> : null}
    {!room.summary.total ? <EmptyState title="No deliverables yet" description="Once committees add deliverables with due dates, they show up here week by week." action={<Link className="button button--secondary" to="/deliverables">Go to deliverables</Link>} />
      : view === 'grid' ? <><Heatmap room={room} onOpen={(row, cell) => setOpen({ row, cell })} /><Legend /></>
      : <ListView room={room} units={state.board.units} />}
    {room.undated.length ? <p className="muted war-room__note">{room.undated.length} {room.undated.length === 1 ? 'deliverable has' : 'deliverables have'} no due date and {room.undated.length === 1 ? 'is' : 'are'} only in the list view.</p> : null}
    <p className="muted war-room__note">Updated {formatDay(state.board.refreshedAt)} · refreshes when you come back to this tab.</p>
    {open ? <CellDialog row={open.row} cell={open.cell} onClose={() => setOpen(null)} /> : null}
    {presenting ? <Presenter room={room} phase={phaseName} refresh={state.reload} onExit={() => setPresenting(false)} /> : null}
  </div>
}

function TopStrip({ room, phase, large = false }: { room: WarRoom; phase: string; large?: boolean }) {
  const s = room.summary
  const days = s.days > 0 ? <><strong className="numeric">{s.days}</strong> {s.days === 1 ? 'day' : 'days'} to April 17</> : s.days === 0 ? <strong>Event day</strong> : <>After the event</>
  return <dl className={`war-room__strip${large ? ' war-room__strip--large' : ''}`}>
    <div><dt className="visually-hidden">Countdown</dt><dd>{days}</dd></div>
    <div><dt>On track</dt><dd><strong className="numeric">{s.onTrack}</strong> of {s.total}</dd></div>
    <div><dt>At risk</dt><dd><strong className="numeric">{s.atRisk}</strong></dd></div>
    <div><dt>Waiting on another committee</dt><dd><strong className="numeric">{s.waiting}</strong></dd></div>
    <div><dt>Phase</dt><dd>{phase}</dd></div>
  </dl>
}

function Legend() {
  return <ul className="war-room__legend" aria-label="Colour key">
    {(['on_track', 'at_risk', 'behind', 'not_started'] as Health[]).map(h => <li key={h}><span className={`war-room__swatch war-room__swatch--${healthTone[h]}`}><HealthMark health={h} size={14} /></span>{healthLabel[h]}</li>)}
    <li><Flag className="icon" size={14} aria-hidden="true" />Milestone</li>
    <li className="muted">Colour = checklist progress against time left. A cell shows its worst deliverable.</li>
  </ul>
}

function Heatmap({ room, onOpen, presenting = false }: { room: WarRoom; onOpen?: (row: Row, cell: Cell) => void; presenting?: boolean }) {
  const captionId = useId()
  return <div className="war-room__scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
    <table className={`war-room__grid${presenting ? ' war-room__grid--present' : ''}`}>
      <caption id={captionId} className="visually-hidden">Deliverables due per committee and week. Each cell says how many are due and how they are doing.</caption>
      <thead><tr>
        <th scope="col" className="war-room__corner">Committee</th>
        {room.columns.map(c => <th scope="col" key={c.key} className={c.milestones.length ? 'war-room__week war-room__week--milestone' : 'war-room__week'}>
          <span>{c.label}</span>
          {c.milestones.map(m => <span key={m.day} className="war-room__milestone"><Flag className="icon" size={12} aria-hidden="true" />{m.label} {labelDay(m.day)}</span>)}
        </th>)}
      </tr></thead>
      <tbody>{room.rows.map(row => <tr key={row.unit?.id ?? 'none'}>
        <th scope="row" className="war-room__committee">
          <span className="war-room__committee-name">{row.name}</span>
          {row.total && row.allClear ? <span className="war-room__clear"><CircleCheck className="icon" size={14} aria-hidden="true" />All clear</span>
            : row.behind ? <span className="war-room__behind">{row.behind} behind</span> : null}
        </th>
        {row.cells.map(cell => <td key={cell.column.key} className={cell.column.milestones.length ? 'war-room__td--milestone' : undefined}>
          {cell.items.length && cell.health ? (presenting || !onOpen
            ? <span className={`war-room__cell war-room__cell--${healthTone[cell.health]}`} aria-label={cellText(row, cell)} role="img"><HealthMark health={cell.health} size={presenting ? 22 : 16} /><span className="numeric">{cell.items.length}</span></span>
            : <button type="button" className={`war-room__cell war-room__cell--${healthTone[cell.health]}`} aria-label={cellText(row, cell)} onClick={() => onOpen(row, cell)}><HealthMark health={cell.health} /><span className="numeric">{cell.items.length}</span></button>)
            : <span className="war-room__cell war-room__cell--empty" aria-hidden="true" />}
        </td>)}
      </tr>)}</tbody>
    </table>
  </div>
}

function ListView({ room, units }: { room: WarRoom; units: BoardUnit[] }) {
  const rows = [
    ...room.rows.flatMap(row => row.cells.flatMap(cell => cell.items.map(i => ({ ...i, committee: row.name })))),
    ...room.undated.map(u => ({ d: u.d, health: u.health, committee: u.unit?.name ?? 'No committee' })),
  ]
  return <div className="war-room__list-wrap">
    <table className="war-room__list">
      <caption className="visually-hidden">Every deliverable with its committee, owner, due date, checklist and status</caption>
      <thead><tr><th scope="col">Deliverable</th><th scope="col">Committee</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Checklist</th><th scope="col">Status</th></tr></thead>
      <tbody>{rows.map(({ d, health, committee }) => <tr key={d.id}>
        <th scope="row" data-label="Deliverable"><Link to={'/deliverables/' + d.id}>{d.title}</Link>{d.waiting ? <span className="muted"> · waiting on another committee</span> : null}</th>
        <td data-label="Committee">{committee}</td>
        <td data-label="Owner">{d.ownerName}</td>
        <td data-label="Due">{due(d)}</td>
        <td data-label="Checklist"><ProgressBar d={d} /></td>
        <td data-label="Status"><Status state={health} label={healthLabel[health]} tone={healthTone[health]} />{units.find(u => u.id === d.unitId)?.canNudge && health !== 'done' ? <NudgeButton d={d} compact /> : null}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

export function ProgressBar({ d }: { d: BoardDeliverable }) {
  const value = Math.round(progress(d) * 100)
  return <span className="war-room__progress"><span className="war-room__bar" aria-hidden="true"><span style={{ inlineSize: value + '%' }} /></span><span>{steps(d)}</span></span>
}

function nudgeMessage(d: BoardDeliverable): string {
  const link = window.location.origin + appPath('/deliverables/' + d.id)
  const when = due(d)
  return `Hi ${firstName(d.ownerName)}, quick check on "${d.title}" (${when.charAt(0).toLowerCase() + when.slice(1)}). ${steps(d)} so far. Anything blocking you or anything I can help with? ${link}`
}

function NudgeButton({ d, compact = false }: { d: BoardDeliverable; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const message = nudgeMessage(d)
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setState('copied') } catch { setState('manual') }
  }
  return <span className={compact ? 'war-room__nudge war-room__nudge--compact' : 'war-room__nudge'}>
    <button type="button" className="button button--secondary" onClick={() => void copy()} aria-label={`Nudge ${d.ownerName}: copy a message about ${d.title}`}><Copy className="icon" size={16} aria-hidden="true" />Nudge owner</button>
    {state === 'copied' ? <span role="status" className="muted">Message copied. Paste it to {firstName(d.ownerName)} in Telegram or Messenger.</span> : null}
    {state === 'manual' ? <label className="war-room__manual">Copy this message<textarea readOnly value={message} rows={4} onFocus={e => e.currentTarget.select()} /></label> : null}
  </span>
}

function CellDialog({ row, cell, onClose }: { row: Row; cell: Cell; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  const week = cell.column.earlier ? 'Earlier weeks' : `Week of ${labelDay(cell.column.start)}`
  const canNudge = !!row.unit?.canNudge
  return <dialog ref={ref} className="war-room__dialog" aria-labelledby={titleId} onClose={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="war-room__dialog-head">
      <h2 id={titleId}>{row.name} · {week}</h2>
      <button type="button" className="button button--secondary" onClick={onClose} aria-label="Close"><X className="icon" size={18} aria-hidden="true" /></button>
    </div>
    {cell.column.milestones.length ? <p className="muted"><Flag className="icon" size={14} aria-hidden="true" /> {cell.column.milestones.map(m => `${m.label} ${labelDay(m.day)}`).join(' · ')}</p> : null}
    <ul className="war-room__dialog-list">{cell.items.map(({ d, health }) => <li key={d.id}>
      <h3>{d.title}</h3>
      <p><Status state={health} label={healthLabel[health]} tone={healthTone[health]} /> · {due(d)}</p>
      <p>Owner: {d.ownerName}{d.waiting ? ' · waiting on another committee' : ''}{d.blocked ? ' · marked blocked' : ''}</p>
      <ProgressBar d={d} />
      <div className="war-room__actions">
        <Link className="button button--secondary" to={'/deliverables/' + d.id} onClick={onClose}><ExternalLink className="icon" size={16} aria-hidden="true" />Open</Link>
        {canNudge && health !== 'done' ? <NudgeButton d={d} /> : null}
      </div>
    </li>)}</ul>
  </dialog>
}

function Presenter({ room, phase, refresh, onExit }: { room: WarRoom; phase: string; refresh: () => void; onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const exit = useRef(onExit)
  useEffect(() => { exit.current = onExit })
  useEffect(() => {
    const element = ref.current
    const previous = document.activeElement
    let entered = false
    element?.focus()
    if (element?.requestFullscreen) element.requestFullscreen().then(() => { entered = true }, () => undefined)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); exit.current() } }
    const change = () => { if (entered && !document.fullscreenElement) exit.current() }
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('keydown', key)
    document.addEventListener('fullscreenchange', change)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('keydown', key)
      document.removeEventListener('fullscreenchange', change)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [refresh])
  return <div ref={ref} className="war-room-present" role="dialog" aria-modal="true" aria-label="War room, presenting" tabIndex={-1}>
    <div className="war-room-present__head">
      <h1>War room</h1>
      <button type="button" className="button button--secondary" onClick={onExit}><X className="icon" size={20} aria-hidden="true" />Exit (Esc)</button>
    </div>
    <TopStrip room={room} phase={phase} large />
    <Heatmap room={room} presenting />
    <p className="war-room-present__foot">Refreshes every minute.</p>
  </div>
}
