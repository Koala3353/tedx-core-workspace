import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate, useRouteLoaderData } from 'react-router'
import { ArrowRight, CalendarDays, CornerDownLeft, FileText, ListChecks, Search, Send, SquarePlus, Users, X } from 'lucide-react'
import { useShellServices } from '../../app/shellServices'
import { navIcon } from '../../app/navIcons'
import type { NavigationItem } from '../../app/navigation'
import { formatDayLabel } from '../../lib/format'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import type { SearchRow } from '../search/api'
import { replayTour } from '../tutorial/events'
import { whoToAskEntries } from '../who-to-ask'
import { parseQuickAdd, type Committee, type QuickAdd } from './parse'
import './palette.css'

/** Opens the palette from anywhere (header button, menus, other features). */
export const paletteEvent = 'workspace-palette-open'
type PaletteMode = 'find' | 'add'
export function openPalette(text = '', mode: PaletteMode = 'find'): void { window.dispatchEvent(new CustomEvent(paletteEvent, { detail: { text, mode } })) }

type Option = { id: string; group: string; label: string; detail?: string; icon: ReactNode; run: () => void; keywords?: string }

const kindLabels: Record<SearchRow['kind'], string> = { task: 'Task', deliverable: 'Deliverable', request: 'Request', guide: 'Guide', glossary: 'Glossary', contact: 'Person' }
const icon = (Icon: typeof Search) => <Icon size={16} strokeWidth={1.75} aria-hidden="true" />

/** Team and Event pages that live under a hub rather than in the navigation. Members only. */
const hubPages: { id: string; label: string; description: string; href: string; icon: string; anyOf?: readonly string[] }[] = [
  { id: 'team-setup', label: 'Team setup', description: 'Who has signed in, installed and finished the tour', href: '/team/setup', icon: 'team.setup', anyOf: ['roles.manage', 'admin.configure'] },
  { id: 'who-to-ask', label: 'Who do I ask?', description: 'The committee and person for a poster, a room, money and more', href: '/team/ask', icon: 'team.whoToAsk' },
  { id: 'committees', label: 'Committees', description: 'What each committee does and who leads it', href: '/team/committees', icon: 'team.committeePages' },
  { id: 'war-room', label: 'War room', description: 'Every deliverable at risk, by committee and week', href: '/event/war-room', icon: 'event.warRoom' },
  { id: 'speakers', label: 'Speakers', description: 'Speaker checklists, rehearsals and contacts', href: '/event/speakers', icon: 'speakers' },
  { id: 'online-contest', label: 'Online contest', description: 'What is due, who runs it and the run checklist', href: '/event/online-contest', icon: 'event.contestBoard' },
  { id: 'tedify', label: 'TEDify', description: 'Breakout sessions, what is due and the run checklist', href: '/event/tedify', icon: 'event.tedifyBoard' },
  { id: 'run-of-show', label: 'Run of show', description: 'The event-day running order and live stage view', href: '/event/run-of-show', icon: 'event.runOfShow' },
  { id: 'event-qr', label: 'Event QR codes', description: 'Print item labels and the crew check-in code', href: '/event/qr', icon: 'qr' },
]
const askEntries = whoToAskEntries()

/**
 * ⌘K / Ctrl+K command palette: jump to pages, people and work, run actions, or quick-add
 * a task ("Logistics: venue floorplan by Fri"). Opens without animation: it is used often.
 */
export function CommandPalette({ items }: { items: NavigationItem[] }) {
  const [open, setOpen] = useState(false)
  const [seed, setSeed] = useState<{ text: string; mode: PaletteMode }>({ text: '', mode: 'find' })
  useEffect(() => {
    const keys = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setSeed({ text: '', mode: 'find' }); setOpen(value => !value) }
    }
    const request = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: unknown; mode?: unknown }>).detail
      setSeed({ text: typeof detail?.text === 'string' ? detail.text : '', mode: detail?.mode === 'add' ? 'add' : 'find' })
      setOpen(true)
    }
    window.addEventListener('keydown', keys)
    window.addEventListener(paletteEvent, request)
    return () => { window.removeEventListener('keydown', keys); window.removeEventListener(paletteEvent, request) }
  }, [])
  return open ? <PaletteDialog items={items} seed={seed.text} initialMode={seed.mode} onClose={() => setOpen(false)} /> : null
}

function PaletteDialog({ items, seed, initialMode, onClose }: { items: NavigationItem[]; seed: string; initialMode: PaletteMode; onClose: () => void }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  const { gateway } = useShellServices()
  const navigate = useNavigate()
  const listId = useId(), titleId = useId()
  const input = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<Element | null>(null)
  const [query, setQuery] = useState(seed)
  const [mode, setMode] = useState<PaletteMode>(initialMode)
  const [active, setActive] = useState(0)
  const [results, setResults] = useState<{ query: string; rows: SearchRow[]; failed: boolean } | null>(null)
  const [committees, setCommittees] = useState<Committee[]>([])
  const [actor, setActor] = useState<string | null>(null)
  const [draft, setDraft] = useState<QuickAdd | null>(null)
  const member = context && !isGuest(context) ? context : null
  const termId = member?.termId
  const tasks = gateway?.tasks, search = gateway?.search

  useEffect(() => {
    returnFocus.current = document.activeElement
    input.current?.focus()
    return () => { if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus() }
  }, [])

  // Committee names for quick add come from the task form's own options.
  useEffect(() => {
    if (!termId || !tasks?.options) return
    let live = true
    void tasks.options(termId).then(options => { if (live && options) { setCommittees(options.units.map(unit => ({ id: unit.id, name: unit.name }))); setActor(options.actorId) } }, () => undefined)
    return () => { live = false }
  }, [termId, tasks])

  // Work, guides and people from global search, after a short pause in typing.
  const trimmed = query.trim()
  useEffect(() => {
    if (!termId || !search || trimmed.length < 2) return
    let live = true
    const timer = window.setTimeout(() => {
      void search.read(termId, trimmed.slice(0, 120), 'all', null)
        .then(value => { if (live) setResults({ query: trimmed, rows: value.items.slice(0, 8), failed: false }) },
          () => { if (live) setResults({ query: trimmed, rows: [], failed: true }) })
    }, 220)
    return () => { live = false; window.clearTimeout(timer) }
  }, [termId, search, trimmed])

  const go = (to: string) => { onClose(); void navigate(to) }
  const parsed = useMemo(() => trimmed.length >= 3 ? parseQuickAdd(trimmed, committees) : null, [trimmed, committees])
  // Quick add parses for any member; creating in place needs the task command, else it opens the form.
  const canCreate = !!member

  const options = useMemo<Option[]>(() => {
    const q = trimmed.toLowerCase()
    const matches = (text: string) => !q || text.toLowerCase().includes(q)
    const list: Option[] = []
    if (parsed && canCreate && (mode === 'add' || parsed.committee || parsed.dueOn) && parsed.title.length >= 2) {
      list.push({ id: 'quick-add', group: 'Quick add', label: `Add task “${parsed.title}”`, detail: [parsed.committee?.name, parsed.dueOn ? 'due ' + formatDayLabel(parsed.dueOn) : null].filter(Boolean).join(' · '), icon: icon(SquarePlus), run: () => setDraft(parsed) })
    }
    const actions: Option[] = [
      { id: 'ask', group: 'Actions', label: 'Ask a committee', detail: 'Request help from another committee', icon: icon(Send), run: () => go('/requests'), keywords: 'request help room budget poster' },
      ...(canCreate ? [{ id: 'new-task', group: 'Actions', label: 'New task', detail: 'Type a title, then a committee or date', icon: icon(SquarePlus), run: () => { setMode('add'); setQuery(''); input.current?.focus() }, keywords: 'add create todo' }] : []),
      { id: 'reminders', group: 'Actions', label: 'Turn on reminders', detail: 'Notification settings', icon: icon(CalendarDays), run: () => go('/notifications'), keywords: 'notifications telegram email' },
      { id: 'tour', group: 'Actions', label: 'Replay the tour', icon: icon(ArrowRight), run: () => { onClose(); replayTour() }, keywords: 'help tutorial' },
    ]
    list.push(...actions.filter(option => matches(option.label + ' ' + (option.keywords ?? ''))))
    const extra = member ? hubPages.filter(page => !page.anyOf || page.anyOf.some(capability => member.capabilities.includes(capability))) : []
    const pages = [...items.map(item => ({ ...item, icon: item.id })), ...extra].filter(item => matches(item.label + ' ' + item.description)).slice(0, q ? 8 : 6)
    list.push(...pages.map(item => { const Icon = navIcon(item.icon); return { id: 'page:' + item.id + item.href, group: 'Pages', label: item.label, detail: item.description, icon: icon(Icon), run: () => go(item.href) } }))
    if (member && q) {
      list.push(...askEntries.filter(entry => matches(entry.label + ' ' + entry.keywords)).slice(0, 4)
        .map(entry => ({ id: entry.id, group: entry.group, label: entry.label, detail: entry.detail, icon: icon(navIcon('team.whoToAsk')), run: () => go(entry.href) })))
    }
    if (results && results.query === trimmed) {
      list.push(...results.rows.map(row => ({ id: 'work:' + row.kind + row.id, group: row.kind === 'contact' ? 'People' : 'Work', label: row.title, detail: [kindLabels[row.kind], row.reference].filter(Boolean).join(' · '), icon: icon(row.kind === 'contact' ? Users : row.kind === 'task' ? ListChecks : FileText), run: () => go(row.href) })))
    }
    if (q.length >= 2) list.push({ id: 'find', group: 'Find', label: `Search everything for “${trimmed}”`, icon: icon(Search), run: () => go('/search?q=' + encodeURIComponent(trimmed)) })
    if (mode !== 'add' && parsed && canCreate && !parsed.committee && !parsed.dueOn && parsed.title.length >= 3) {
      list.push({ id: 'quick-add-plain', group: 'Quick add', label: `Add task “${parsed.title}”`, detail: 'No committee or date yet', icon: icon(SquarePlus), run: () => setDraft(parsed) })
    }
    return list
    // `go` is recreated each render but only closes and navigates; options follow the inputs.
  }, [trimmed, parsed, canCreate, results, items, mode, member])

  const current = Math.min(active, Math.max(options.length - 1, 0))
  const searching = !!search && !!termId && trimmed.length >= 2 && results?.query !== trimmed

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); if (draft) { setDraft(null); input.current?.focus() } else onClose(); return }
    if (event.key === 'Tab') {
      // Keep focus inside the palette.
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input, select, button:not(:disabled)'))
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      return
    }
    if (draft) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((current + 1) % Math.max(options.length, 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current - 1 + options.length) % Math.max(options.length, 1)) }
    else if (event.key === 'Enter' && options[current]) { event.preventDefault(); options[current].run() }
  }

  useEffect(() => { document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: 'nearest' }) }, [current, listId])

  let lastGroup = ''
  return <div className="palette" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="palette__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={keys}>
      <h2 className="visually-hidden" id={titleId}>Find or add</h2>
      {draft ? <QuickAddConfirm draft={draft} committees={committees} actor={actor} termId={termId!} onBack={() => { setDraft(null); input.current?.focus() }} onDone={go} /> : <>
        <div className="palette__search">
          <Search className="icon" size={18} strokeWidth={1.75} aria-hidden="true" />
          <input ref={input} className="palette__input" value={query} placeholder={mode === 'add' ? 'Task title, e.g. “Logistics: venue floorplan by Fri”' : 'Find a page, person or task, or add “Logistics: floorplan by Fri”'}
            role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={options.length ? `${listId}-${current}` : undefined} aria-autocomplete="list" aria-label="Find or add"
            maxLength={200} onChange={event => { setQuery(event.target.value); setActive(0) }} />
          <button className="icon-button palette__close" type="button" aria-label="Close" onClick={onClose}><X className="icon" size={18} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>
        <div className="palette__results" id={listId} role="listbox" aria-label="Results">
          {options.map((option, index) => {
            const heading = option.group !== lastGroup ? option.group : null
            lastGroup = option.group
            return <div key={option.id} role="presentation">
              {heading ? <div className="palette__group" role="presentation">{heading}</div> : null}
              <div id={`${listId}-${index}`} role="option" aria-selected={index === current} className={`palette__option${index === current ? ' is-active' : ''}`}
                onMouseMove={() => { if (index !== current) setActive(index) }} onClick={option.run}>
                <span className="palette__icon">{option.icon}</span>
                <span className="palette__label">{option.label}{option.detail ? <span className="palette__detail">{option.detail}</span> : null}</span>
                {index === current ? <CornerDownLeft className="palette__enter" size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
              </div>
            </div>
          })}
          {!options.length && !searching ? <p className="palette__empty">No matches. Try another word, or press Esc.</p> : null}
        </div>
        <p className="palette__status" role="status">{searching ? 'Searching…' : results?.failed && results.query === trimmed ? 'Search is unavailable right now. Pages and actions still work.' : ''}</p>
      </>}
    </div>
  </div>
}

function QuickAddConfirm({ draft, committees, actor, termId, onBack, onDone }: { draft: QuickAdd; committees: Committee[]; actor: string | null; termId: string; onBack: () => void; onDone: (to: string) => void }) {
  const { gateway } = useShellServices()
  const [title, setTitle] = useState(draft.title)
  const [unit, setUnit] = useState(draft.committee?.id ?? '')
  const [dueOn, setDueOn] = useState(draft.dueOn ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = useRef(crypto.randomUUID())
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const tasks = gateway?.tasks
  const formLink = '/tasks?' + new URLSearchParams({ compose: '1', title, ...(dueOn ? { due: dueOn } : {}), ...(unit ? { committee: unit } : {}) }).toString()

  async function create() {
    if (!tasks?.execute || !title.trim() || busy) return
    setBusy(true); setError('')
    const result = await tasks.execute({ command: 'create', termId, data: {
      title: title.trim(), summary: '', body: '', leadUnitId: unit || null, parentId: null, dueOn: dueOn || null, dueAt: null,
      classification: 'restricted', taskType: 'ordinary', assigneeId: actor, assignedUnitId: unit || null, collaborators: [], checklist: [], reason: 'Quick add',
    } }, key.current)
    setBusy(false)
    if (result.ok) { onDone('/tasks/' + result.value.workItemId); return }
    if (!result.error.retryable) key.current = crypto.randomUUID()
    setError(result.error.message)
  }

  return <form className="palette__confirm" onSubmit={event => { event.preventDefault(); void create() }}>
    <p className="palette__confirm-title">New task</p>
    <label className="palette__field"><span>Title</span><input ref={first} value={title} maxLength={240} required onChange={event => setTitle(event.target.value)} /></label>
    <div className="palette__chips">
      <label className="palette__field"><span>Committee</span>
        <select value={unit} onChange={event => setUnit(event.target.value)}>
          <option value="">Personal</option>
          {committees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="palette__field"><span>Due</span><input type="date" value={dueOn} onChange={event => setDueOn(event.target.value)} /></label>
    </div>
    <p className="palette__hint">It starts as To do and is assigned to you. Add details and a checklist on the task page.</p>
    {error ? <p className="palette__error" role="alert">{error}</p> : null}
    <div className="palette__actions">
      <button className="button button--secondary" type="button" onClick={onBack}>Back</button>
      <button className="button button--secondary" type="button" onClick={() => onDone(formLink)}>Open task form</button>
      {tasks?.execute ? <button className="button" type="submit" disabled={busy || !title.trim() || !actor}>{busy ? 'Adding…' : 'Add task'}</button> : null}
    </div>
  </form>
}
