import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useRouteLoaderData } from 'react-router'
import { Copy, Link2, Plus, UserPlus } from 'lucide-react'
import { Status } from '../../components/Status'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { manilaToday, relativeDue } from '../../lib/format'
import type { CommandResult } from '../../lib/commands'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import type { Requirement, RequirementKind, RequirementStatus, SpeakerPortalApi, SpeakerTracker, TrackedSpeaker } from './api'
import { invitationLabels, requirementKinds, requirementStatusLabel } from './labels'
import './speaker-portal.css'

type Load = { state: 'loading' } | { state: 'ready'; data: SpeakerTracker } | { state: 'missing' } | { state: 'error' }

/** TalRec view of every speaker and what they still owe. Route "/event/speakers". */
export function SpeakerTrackerPage({ api }: { api?: SpeakerPortalApi }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  if (!context || isGuest(context)) return null
  if (!api) return <div className="speaker-page speaker-page--wide"><TrackerHeading />
    <EmptyState title="Speaker tracking isn't switched on yet" description="Ask WebDev to finish setting it up. Until then, keep the speaker list where TalRec already tracks it." /></div>
  return <TrackerContent key={context.termId} api={api} termId={context.termId} />
}

function TrackerHeading({ canManage }: { canManage?: boolean }) {
  return <header className="speaker-tracker-head">
    <div><h1>Speakers</h1><p>Who's speaking, what they've sent, and what's still missing.</p></div>
    {canManage ? <Link className="button button--secondary" to="/guests"><UserPlus className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Invite a speaker</Link> : null}
  </header>
}

function TrackerContent({ api, termId }: { api: SpeakerPortalApi; termId: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [revision, setRevision] = useState(0)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    let active = true
    void api.readTracker(termId)
      .then(data => { if (active) setLoad(data ? { state: 'ready', data } : { state: 'missing' }) })
      .catch(() => { if (active) setLoad({ state: 'error' }) })
    return () => { active = false }
  }, [api, termId, revision])
  const refresh = () => setRevision(v => v + 1)

  if (load.state === 'loading') return <div className="speaker-page speaker-page--wide"><TrackerHeading /><LoadingState title="Loading speakers" /></div>
  if (load.state === 'missing') return <div className="speaker-page speaker-page--wide"><TrackerHeading />
    <EmptyState title="Speaker tracking isn't switched on yet" description="Ask WebDev to apply the speaker update. Until then, keep the speaker list where TalRec already tracks it." /></div>
  if (load.state === 'error') return <div className="speaker-page speaker-page--wide"><TrackerHeading />
    <ErrorState title="Couldn't load speakers" description="Only TalRec and admins can see this list. If you're one of them, try again."
      action={<button className="button button--secondary" type="button" onClick={refresh}>Try again</button>} /></div>

  const { data } = load
  const today = manilaToday()
  const all = data.speakers.flatMap(s => s.requirements)
  const toCheck = all.filter(r => r.status === 'submitted').length
  const late = all.filter(r => r.status !== 'done' && r.status !== 'submitted' && r.dueOn !== null && r.dueOn < today).length
  return <div className="speaker-page speaker-page--wide">
    <TrackerHeading canManage={data.canManage} />
    {data.speakers.length ? <p className="speaker-summary">
      <span>{data.speakers.length} {data.speakers.length === 1 ? 'speaker' : 'speakers'}</span>
      <span>{toCheck} sent and waiting for your check</span>
      <span className={late ? 'speaker-row__late' : undefined}>{late} late</span>
    </p> : null}
    {data.canManage ? adding
      ? <SpeakerForm api={api} termId={termId} data={data} onDone={saved => { setAdding(false); if (saved) refresh() }} />
      : <div className="speaker-row__actions speaker-add"><button className="button" type="button" onClick={() => setAdding(true)}><Plus className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Add speaker</button></div>
      : null}
    {!data.speakers.length ? <EmptyState title="No speakers yet"
      description={data.canManage ? 'Add a speaker with the email they\'ll sign in with. They get a checklist (bio, headshot, outline, script, slides, rehearsal RSVP) with dates before the event. Then invite them on the guest page so they can open My part.'
        : 'TalRec heads add speakers here. Each speaker gets a checklist with due dates.'} />
      : <>
        <Matrix speakers={data.speakers} today={today} />
        {data.speakers.map(speaker => <SpeakerBlock key={speaker.id} api={api} termId={termId} speaker={speaker} data={data} today={today} onChanged={refresh} />)}
      </>}
    <p className="speaker-muted speaker-footnote">Speakers sign in with the invite link from the guest page and land on My part. Invite links can only be copied right after you create them there.</p>
  </div>
}

const columns: RequirementKind[] = ['bio', 'headshot', 'outline', 'script', 'slides', 'rehearsal_rsvp']

/** Speakers by checklist item, for a quick scan. Scrolls inside itself on small screens. */
function Matrix({ speakers, today }: { speakers: TrackedSpeaker[]; today: string }) {
  return <div className="speaker-matrix" role="region" aria-label="Checklist by speaker" tabIndex={0}>
    <table>
      <thead><tr><th scope="col">Speaker</th>{columns.map(kind => <th scope="col" key={kind}>{requirementKinds.find(k => k.kind === kind)!.label}</th>)}</tr></thead>
      <tbody>{speakers.map(speaker => <tr key={speaker.id}>
        <th scope="row"><a href={'#speaker-' + speaker.id}>{speaker.name}</a></th>
        {columns.map(kind => {
          const items = speaker.requirements.filter(r => r.kind === kind)
          const label = requirementKinds.find(k => k.kind === kind)!.label
          if (!items.length) return <td key={kind} data-label={label}><span className="speaker-muted">Not asked</span></td>
          const worst = items.find(r => r.status !== 'done') ?? items[0]
          const isLate = worst.status !== 'done' && worst.status !== 'submitted' && worst.dueOn !== null && worst.dueOn < today
          return <td key={kind} data-label={label}><Status state={isLate ? 'overdue' : worst.status} label={isLate ? 'Late' : requirementStatusLabel(worst.status, 'team')} /></td>
        })}
      </tr>)}</tbody>
    </table>
  </div>
}

function useRequest() {
  const ref = useRef<{ key: string; id: string } | null>(null)
  return (key: string) => {
    if (ref.current?.key !== key) ref.current = { key, id: crypto.randomUUID() }
    return { id: ref.current.id, clear: () => { ref.current = null } }
  }
}

function failure(result: CommandResult<unknown>): string {
  if (result.ok) return ''
  if (result.error.kind === 'stale_version') return 'Someone else just changed this. Refresh to see the latest.'
  if (result.error.kind === 'conflict') return 'A speaker with this email is already on the list.'
  if (result.error.kind === 'permission_denied') return 'Only TalRec heads and admins can change this.'
  if (result.error.kind === 'validation_failed') return 'Check the fields. Links must start with https://.'
  return 'Couldn\'t save. Check your connection and try again.'
}

function SpeakerForm({ api, termId, data, speaker, onDone }: { api: SpeakerPortalApi; termId: string; data: SpeakerTracker; speaker?: TrackedSpeaker; onDone: (saved: boolean) => void }) {
  const id = useId()
  const [email, setEmail] = useState(speaker?.email ?? '')
  const [name, setName] = useState(speaker?.name ?? '')
  const [talk, setTalk] = useState(speaker?.talkTitle ?? '')
  const [contact, setContact] = useState(speaker?.contact?.membershipId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRequest()
  async function save(event: FormEvent) {
    event.preventDefault()
    const values = { email: email.trim(), name: name.trim(), talkTitle: talk.trim() || null, contactMembershipId: contact || null }
    const r = request(JSON.stringify([speaker?.id, speaker?.version, values]))
    setBusy(true); setError('')
    const result = await api.saveSpeaker(termId, speaker ?? null, values, r.id)
    setBusy(false)
    if (result.ok) { r.clear(); onDone(true) } else setError(failure(result))
  }
  return <form className="speaker-form speaker-form--card" onSubmit={event => void save(event)}>
    <h2>{speaker ? `Edit ${speaker.name}` : 'Add a speaker'}</h2>
    <div className="speaker-form__grid">
      <div className="form-field"><label htmlFor={id + '-name'}>Name (required)</label><input id={id + '-name'} required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="form-field"><label htmlFor={id + '-email'}>Email they'll sign in with (required)</label><input id={id + '-email'} type="email" required maxLength={254} autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} /></div>
      <div className="form-field"><label htmlFor={id + '-talk'}>Talk title</label><input id={id + '-talk'} maxLength={240} value={talk} onChange={e => setTalk(e.target.value)} /></div>
      <div className="form-field"><label htmlFor={id + '-contact'}>Their contact from TalRec</label>
        <select id={id + '-contact'} value={contact} onChange={e => setContact(e.target.value)}>
          <option value="">Whoever sent the invite</option>
          {data.contacts.map(c => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}
        </select></div>
    </div>
    {!speaker ? <p className="speaker-muted">They'll start with the usual checklist: bio, headshot, outline, script draft, slides and rehearsal RSVP. You can change any item after.</p> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <div className="speaker-form__actions">
      <button className="button" disabled={busy}>{speaker ? 'Save speaker' : 'Add speaker'}</button>
      <button className="button button--secondary" type="button" disabled={busy} onClick={() => onDone(false)}>Cancel</button>
    </div>
  </form>
}

function SpeakerBlock({ api, termId, speaker, data, today, onChanged }: { api: SpeakerPortalApi; termId: string; speaker: TrackedSpeaker; data: SpeakerTracker; today: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState('')
  const request = useRequest()
  const done = speaker.requirements.filter(r => r.status === 'done').length
  const invite = speaker.invitation ? invitationLabels[speaker.invitation.state] : { state: 'not_started', label: 'Not invited yet' }
  async function remove() {
    if (!window.confirm(`Remove ${speaker.name} from the speaker list? Their checklist is kept in the records but hidden.`)) return
    const values = { email: speaker.email, name: speaker.name, talkTitle: speaker.talkTitle, contactMembershipId: speaker.contact?.membershipId ?? null, archived: true }
    const r = request(JSON.stringify(['archive', speaker.id, speaker.version]))
    const result = await api.saveSpeaker(termId, speaker, values, r.id)
    if (result.ok) { r.clear(); onChanged() } else setNotice(failure(result))
  }
  if (editing) return <SpeakerForm api={api} termId={termId} data={data} speaker={speaker} onDone={saved => { setEditing(false); if (saved) onChanged() }} />
  return <section className="speaker-block" id={'speaker-' + speaker.id} aria-labelledby={'speaker-name-' + speaker.id}>
    <header className="speaker-block__head">
      <div>
        <h2 id={'speaker-name-' + speaker.id}>{speaker.name}</h2>
        <p className="speaker-muted">{speaker.talkTitle ?? 'Talk title not set'} · {done} of {speaker.requirements.length} done</p>
        <p className="speaker-block__facts">
          <Status state={invite.state} label={invite.label} />
          <span className="speaker-selectable">{speaker.email}</span>
          {speaker.contact ? <span className="speaker-muted">Contact: {speaker.contact.name}</span> : null}
        </p>
      </div>
      <div className="speaker-block__actions">
        <button className="button button--secondary" type="button" onClick={() => void navigator.clipboard.writeText(speaker.email)
          .then(() => setNotice('Email copied. Paste it on the guest page to create their invite link.')).catch(() => setNotice('Select the email and copy it.'))}>
          <Copy className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Copy email
        </button>
        {data.canManage ? <Link className="button button--secondary" to="/guests"><Link2 className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Get invite link</Link> : null}
        {data.canManage ? <button className="button button--secondary" type="button" onClick={() => setEditing(true)}>Edit</button> : null}
      </div>
    </header>
    {notice ? <p className="speaker-muted" role="status">{notice}</p> : null}
    <ul className="speaker-list">{speaker.requirements.map(item => <RequirementRow key={item.id + ':' + item.version} api={api} termId={termId} item={item} canManage={data.canManage} today={today} onChanged={onChanged} />)}</ul>
    {data.canManage ? adding
      ? <RequirementForm api={api} termId={termId} speakerId={speaker.id} onDone={saved => { setAdding(false); if (saved) onChanged() }} />
      : <div className="speaker-row__actions">
        <button className="button button--secondary" type="button" onClick={() => setAdding(true)}><Plus className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Add item</button>
        <button className="button button--secondary" type="button" onClick={() => void remove()}>Remove speaker</button>
      </div> : null}
  </section>
}

function RequirementRow({ api, termId, item, canManage, today, onChanged }: { api: SpeakerPortalApi; termId: string; item: Requirement; canManage: boolean; today: string; onChanged: () => void }) {
  const id = useId()
  const [status, setStatus] = useState<RequirementStatus>(item.status)
  const [due, setDue] = useState(item.dueOn ?? '')
  const [note, setNote] = useState(item.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRequest()
  const isLate = item.status !== 'done' && item.status !== 'submitted' && item.dueOn !== null && item.dueOn < today
  const dirty = status !== item.status || due !== (item.dueOn ?? '') || note !== (item.note ?? '')
  async function save(archived = false) {
    const values = { kind: item.kind, label: item.label, dueOn: due || null, status, linkUrl: item.linkUrl, note: note.trim() || null, ...(archived ? { archived: true } : {}) }
    const r = request(JSON.stringify([item.id, item.version, values]))
    setBusy(true); setError('')
    const result = await api.saveRequirement(termId, item, values, r.id)
    setBusy(false)
    if (result.ok) { r.clear(); onChanged() } else setError(failure(result))
  }
  return <li className="speaker-row speaker-row--stack">
    <div className="speaker-row__line">
      <div className="speaker-row__text">
        <span className="speaker-row__title">{item.label}</span>
        <span className={`speaker-row__meta${isLate ? ' speaker-row__late' : ''}`}>{item.status === 'done' ? 'Done' : relativeDue({ dueOn: item.dueOn })}</span>
      </div>
      <Status state={isLate ? 'overdue' : item.status} label={isLate ? 'Late' : requirementStatusLabel(item.status, 'team')} />
    </div>
    {item.linkUrl ? <p className="speaker-row__note"><Link2 className="icon" size={14} strokeWidth={1.75} aria-hidden="true" /> <a href={item.linkUrl} target="_blank" rel="noreferrer noopener">Open what they sent</a></p> : null}
    {item.guestNote ? <p className="speaker-row__note">From the speaker: {item.guestNote}</p> : null}
    {canManage ? <div className="speaker-row__edit">
      <div className="form-field"><label htmlFor={id + '-status'}>Status</label>
        <select id={id + '-status'} value={status} onChange={e => setStatus(e.target.value as RequirementStatus)}>
          {(['not_started', 'submitted', 'changes_requested', 'done'] as const).map(s => <option key={s} value={s}>{requirementStatusLabel(s, 'team')}</option>)}
        </select></div>
      <div className="form-field"><label htmlFor={id + '-due'}>Due</label><input id={id + '-due'} type="date" value={due} onChange={e => setDue(e.target.value)} /></div>
      <div className="form-field speaker-row__edit-note"><label htmlFor={id + '-note'}>Note to the speaker</label><input id={id + '-note'} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></div>
      <div className="speaker-row__edit-actions">
        {dirty ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => void save()}>Save</button> : null}
        <button className="button button--secondary" type="button" disabled={busy} onClick={() => { if (window.confirm(`Remove "${item.label}" from this checklist?`)) void save(true) }}>Remove</button>
      </div>
    </div> : item.note ? <p className="speaker-row__note">Note to the speaker: {item.note}</p> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
  </li>
}

function RequirementForm({ api, termId, speakerId, onDone }: { api: SpeakerPortalApi; termId: string; speakerId: string; onDone: (saved: boolean) => void }) {
  const id = useId()
  const [kind, setKind] = useState<RequirementKind>('script')
  const [label, setLabel] = useState('Script draft 2')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRequest()
  async function save(event: FormEvent) {
    event.preventDefault()
    const values = { speakerId, kind, label: label.trim(), dueOn: due || null }
    const r = request(JSON.stringify(values))
    setBusy(true); setError('')
    const result = await api.saveRequirement(termId, null, values, r.id)
    setBusy(false)
    if (result.ok) { r.clear(); onDone(true) } else setError(failure(result))
  }
  return <form className="speaker-form" onSubmit={event => void save(event)}>
    <div className="speaker-form__grid">
      <div className="form-field"><label htmlFor={id + '-kind'}>Type</label>
        <select id={id + '-kind'} value={kind} onChange={e => { const next = e.target.value as RequirementKind; setKind(next); setLabel(requirementKinds.find(k => k.kind === next)!.label) }}>
          {requirementKinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select></div>
      <div className="form-field"><label htmlFor={id + '-label'}>What the speaker sees (required)</label><input id={id + '-label'} required maxLength={120} value={label} onChange={e => setLabel(e.target.value)} /></div>
      <div className="form-field"><label htmlFor={id + '-due'}>Due</label><input id={id + '-due'} type="date" value={due} onChange={e => setDue(e.target.value)} /></div>
    </div>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <div className="speaker-form__actions">
      <button className="button button--secondary" disabled={busy}>Add item</button>
      <button className="button button--secondary" type="button" disabled={busy} onClick={() => onDone(false)}>Cancel</button>
    </div>
  </form>
}
