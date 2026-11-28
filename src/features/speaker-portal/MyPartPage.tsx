import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useRouteLoaderData } from 'react-router'
import { CalendarDays, Copy, Link2, MapPin, Send } from 'lucide-react'
import { Status } from '../../components/Status'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { eventName } from '../../components/TedxLockup'
import { addDaysTo, eventWhen, formatDayLabel, formatTime, manilaToday, relativeDue } from '../../lib/format'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import type { MyPart, PortalEvent, Requirement, SpeakerPortalApi } from './api'
import { requirementStatusLabel } from './labels'
import './speaker-portal.css'
import { EmptyStage, NoAccess, EmptyTasks } from '../../components/illustrations'

type Load = { state: 'loading' } | { state: 'ready'; part: MyPart } | { state: 'missing' } | { state: 'error' }

/**
 * A speaker's home: what we need from them, when and where to be, and who to ask.
 * Route "/my-part". Guests should land here after accepting their invitation.
 */
export function MyPartPage({ api }: { api?: SpeakerPortalApi }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  if (!context || !isGuest(context)) {
    return <div className="speaker-page">
      <EmptyState illustration={<NoAccess />} title="This page is for invited speakers" description="Speakers see their checklist, rehearsal times and their contact here. To follow every speaker, open the speaker tracker."
        action={<Link className="button button--secondary" to="/event/speakers">Open speaker tracker</Link>} />
    </div>
  }
  if (!api) return <div className="speaker-page"><Unavailable /></div>
  return <MyPartContent key={context.termId + ':' + context.guestAccessId} api={api} termId={context.termId} />
}

function Unavailable() {
  return <EmptyState illustration={<EmptyStage />} title="Your page isn't ready yet" description="We're still setting things up for speakers. Check back soon, or email the person who invited you." />
}

function MyPartContent({ api, termId }: { api: SpeakerPortalApi; termId: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  // "/my-part" and "/my-part/info" are the guest's two places; the tabs follow the address.
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const tab: 'part' | 'info' = /\/info\/?$/.test(pathname) ? 'info' : 'part'
  const setTab = (next: 'part' | 'info') => { void navigate(next === 'info' ? '/my-part/info' : '/my-part', { replace: true }) }
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    void api.readMyPart(termId)
      .then(part => { if (active) setLoad(part ? { state: 'ready', part } : { state: 'missing' }) })
      .catch(() => { if (active) setLoad({ state: 'error' }) })
    return () => { active = false }
  }, [api, termId, revision])
  const replace = useCallback((item: Requirement) => setLoad(current => current.state === 'ready'
    ? { state: 'ready', part: { ...current.part, requirements: current.part.requirements.map(r => r.id === item.id ? item : r) } }
    : current), [])

  if (load.state === 'loading') return <div className="speaker-page"><LoadingState title="Opening your page" /></div>
  if (load.state === 'missing') return <div className="speaker-page"><Unavailable /></div>
  if (load.state === 'error') return <div className="speaker-page"><ErrorState title="Couldn't open your page" description="Check your connection and try again. If it keeps happening, email the person who invited you."
    action={<button className="button button--secondary" type="button" onClick={() => { setLoad({ state: 'loading' }); setRevision(v => v + 1) }}>Try again</button>} /></div>

  const { part } = load
  const firstName = part.speaker?.name.split(/\s+/).find(word => !/\.$/.test(word)) ?? null
  return <div className="speaker-page">
    <header className="speaker-head">
      <p className="speaker-head__event">{eventName}</p>
      <h1>{firstName ? `Hi, ${firstName}` : 'Welcome'}</h1>
      {part.speaker?.talkTitle ? <p className="speaker-head__talk">Your talk: <strong>{part.speaker.talkTitle}</strong></p>
        : <p className="speaker-head__talk">Thank you for joining us. Everything we need from you is on this page.</p>}
    </header>
    <nav className="speaker-tabs" aria-label="Your pages">
      <button type="button" className={`speaker-tab${tab === 'part' ? ' is-active' : ''}`} aria-pressed={tab === 'part'} onClick={() => setTab('part')}>My part</button>
      <button type="button" className={`speaker-tab${tab === 'info' ? ' is-active' : ''}`} aria-pressed={tab === 'info'} onClick={() => setTab('info')}>Event info</button>
    </nav>
    {tab === 'part' ? <>
      <Checklist api={api} termId={termId} part={part} onSaved={replace} />
      {part.shared.length ? <section className="speaker-section" aria-labelledby="speaker-shared">
        <h2 id="speaker-shared">Also shared with you</h2>
        <ul className="speaker-list">{part.shared.map(item => <li key={item.id} className="speaker-row">
          <div className="speaker-row__text">
            <Link className="speaker-row__title" to={(item.kind === 'task' ? '/tasks/' : '/deliverables/') + item.id}>{item.title}</Link>
            <span className="speaker-row__meta">{relativeDue({ dueOn: item.dueOn, dueAt: item.dueAt })}</span>
          </div>
          <Status state={sharedState(item.state)} label={item.stateLabel} />
        </li>)}</ul>
      </section> : null}
      <ContactCard part={part} />
    </> : <>
      <WhereAndWhen part={part} />
      <ContactCard part={part} />
    </>}
  </div>
}

function sharedState(category: string) {
  return ({ completed: 'done', approved: 'approved', needs_revision: 'changes_requested', rejected: 'rejected', cancelled: 'cancelled', draft: 'draft' } as Record<string, string>)[category] ?? 'in_progress'
}

function Checklist({ api, termId, part, onSaved }: { api: SpeakerPortalApi; termId: string; part: MyPart; onSaved: (item: Requirement) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const left = part.requirements.filter(r => r.status === 'not_started' || r.status === 'changes_requested').length
  return <section className="speaker-section" aria-labelledby="speaker-needs">
    <h2 id="speaker-needs">What we need from you</h2>
    {!part.requirements.length
      ? <EmptyState level={3} illustration={<EmptyTasks size={96} />} title="Nothing needed from you yet" description="Your contact will add what we need here, like your bio, photo or slides, with a date for each." />
      : <>
        <p className="speaker-muted">{left === 0 ? 'You\'re all caught up. Thank you.' : `${left} ${left === 1 ? 'thing' : 'things'} left. Send each one when it's ready.`}</p>
        <ul className="speaker-list">{part.requirements.map(item => <li key={item.id} className="speaker-row speaker-row--stack">
          <div className="speaker-row__line">
            <div className="speaker-row__text">
              <span className="speaker-row__title">{item.label}</span>
              <span className={`speaker-row__meta${item.status !== 'done' && item.dueOn && item.dueOn < manilaToday() ? ' speaker-row__late' : ''}`}>
                {item.status === 'done' ? 'Done' : relativeDue({ dueOn: item.dueOn })}
              </span>
            </div>
            <Status state={item.status} label={requirementStatusLabel(item.status, 'speaker')} />
          </div>
          {item.note ? <p className="speaker-row__note">From the team: {item.note}</p> : null}
          {item.linkUrl ? <p className="speaker-row__note"><Link2 className="icon" size={14} strokeWidth={1.75} aria-hidden="true" /> <a href={item.linkUrl} target="_blank" rel="noreferrer noopener">Your link</a></p> : null}
          {item.status !== 'done' ? open === item.id
            ? <SubmitForm api={api} termId={termId} item={item} onCancel={() => setOpen(null)} onSaved={saved => { onSaved(saved); setOpen(null) }} />
            : <div className="speaker-row__actions"><button type="button" className="button button--secondary" onClick={() => setOpen(item.id)}>
              {item.kind === 'rehearsal_rsvp' ? (item.status === 'submitted' ? 'Change my answer' : 'Reply') : item.status === 'submitted' ? 'Send a new version' : 'Mark as sent'}
            </button></div> : null}
        </li>)}</ul>
      </>}
  </section>
}

function SubmitForm({ api, termId, item, onCancel, onSaved }: { api: SpeakerPortalApi; termId: string; item: Requirement; onCancel: () => void; onSaved: (item: Requirement) => void }) {
  const id = useId()
  const rsvp = item.kind === 'rehearsal_rsvp'
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<{ key: string; id: string } | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (link.trim() && !/^https:\/\/\S+$/.test(link.trim())) { setError('Paste a link that starts with https://, or leave it empty.'); return }
    const key = JSON.stringify([item.id, item.version, link.trim(), note.trim()])
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
    setBusy(true); setError('')
    const result = await api.submit(termId, item, rsvp ? '' : link, note, request.current.id)
    setBusy(false)
    if (result.ok) { request.current = null; onSaved(result.value) }
    else setError(result.error.kind === 'stale_version' ? 'This item was just updated. Refresh the page to see the latest.' : 'Couldn\'t send that. Check your connection and try again.')
  }
  return <form className="speaker-form" onSubmit={event => void submit(event)}>
    {rsvp ? <p className="speaker-muted">Let us know you can make the rehearsal. Add a note if your timing is tight.</p> : <div className="form-field">
      <label htmlFor={id + '-link'}>Link to your file</label>
      <p id={id + '-link-hint'} className="field-hint">A Google Drive or Docs link we can open. Leave it empty if you emailed it instead.</p>
      <input id={id + '-link'} type="url" inputMode="url" autoComplete="off" value={link} placeholder="https://" aria-describedby={id + '-link-hint'} onChange={event => setLink(event.target.value)} />
    </div>}
    <div className="form-field">
      <label htmlFor={id + '-note'}>{rsvp ? 'Note (optional)' : 'Anything we should know? (optional)'}</label>
      <textarea id={id + '-note'} rows={2} maxLength={500} value={note} onChange={event => setNote(event.target.value)} />
    </div>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <div className="speaker-form__actions">
      <button className="button" disabled={busy}><Send className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />{rsvp ? 'I\'ll be there' : 'Send'}</button>
      <button className="button button--secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>
}

function WhereAndWhen({ part }: { part: MyPart }) {
  // Without calendar entries, still show the two dates every speaker needs.
  const fallback: PortalEvent[] = [
    { id: 'rehearsal', title: 'Rehearsal and dry run', location: '', allDay: true, startOn: addDaysTo(part.eventDate, -1), endOn: part.eventDate, startsAt: null, endsAt: null },
    { id: 'event', title: 'Event day', location: '', allDay: true, startOn: part.eventDate, endOn: addDaysTo(part.eventDate, 1), startsAt: null, endsAt: null },
  ]
  const events = part.events.length ? part.events : fallback
  return <section className="speaker-section" aria-labelledby="speaker-when">
    <h2 id="speaker-when">Where and when</h2>
    <ul className="speaker-list">{events.map(event => <li key={event.id} className="speaker-row">
      <CalendarDays className="icon speaker-row__icon" size={18} strokeWidth={1.5} aria-hidden="true" />
      <div className="speaker-row__text">
        <span className="speaker-row__title">{event.title}</span>
        <span className="speaker-row__meta">{whenLabel(event)}</span>
        {event.location ? <span className="speaker-row__meta"><MapPin className="icon" size={13} strokeWidth={1.75} aria-hidden="true" /> {event.location}</span> : null}
      </div>
    </li>)}</ul>
    {!part.events.length ? <p className="speaker-muted">Exact times and the venue will appear here once they're set.</p> : null}
  </section>
}

function whenLabel(event: PortalEvent) {
  if (event.allDay || !event.startsAt) return event.startOn ? formatDayLabel(event.startOn) : ''
  const start = eventWhen(event)
  return event.endsAt ? `${start} to ${formatTime(event.endsAt)}` : start
}

function ContactCard({ part }: { part: MyPart }) {
  const [copied, setCopied] = useState('')
  const contact = part.contact
  return <section className="speaker-section" aria-labelledby="speaker-contact">
    <h2 id="speaker-contact">Your contact</h2>
    {contact ? <div className="speaker-contact">
      <p className="speaker-contact__name">{contact.name}</p>
      {contact.position ? <p className="speaker-muted">{contact.position}</p> : null}
      <p className="speaker-contact__email"><span className="speaker-selectable">{contact.email}</span></p>
      <div className="speaker-row__actions">
        <button type="button" className="button button--secondary" onClick={() => void navigator.clipboard.writeText(contact.email)
          .then(() => setCopied('Email copied.')).catch(() => setCopied('Select the email above and copy it.'))}>
          <Copy className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Copy email
        </button>
      </div>
      <p className="speaker-muted" role="status">{copied}</p>
    </div> : <p className="speaker-muted">Reply to the email your invitation came with, and we'll get back to you.</p>}
  </section>
}
