import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { CircleAlert, CircleCheck, Clock3, WifiOff, X } from 'lucide-react'
import { useLocation } from 'react-router'
import { celebrate, submitterOf } from '../../components/celebrate'
import { DeveloperMessageError, type DeveloperMessage, type DeveloperMessageApi, type DeveloperTopic } from './api'
import './developer-message.css'

const topics: Array<{ id: DeveloperTopic; label: string; hint: string }> = [
  { id: 'bug', label: 'Something is broken', hint: 'What happened, what you expected, and the steps to get there.' },
  { id: 'question', label: 'Question', hint: 'What are you trying to do?' },
  { id: 'idea', label: 'Idea or request', hint: 'What would help, and who would use it?' },
  { id: 'access', label: 'Access or account', hint: 'What can\'t you open or change?' },
  { id: 'other', label: 'Other', hint: 'Tell us what\'s on your mind.' },
]
const MAX_SUBJECT = 120, MAX_MESSAGE = 4000
const draftKey = 'tedx-developer-message-draft'

type Draft = { requestId: string; topic: DeveloperTopic; subject: string; message: string; include: boolean }
type Notice = { tone: 'wait' | 'error' | 'offline'; title: string; body: string }

function freshDraft(): Draft { return { requestId: crypto.randomUUID(), topic: 'bug', subject: '', message: '', include: true } }
function readDraft(): Draft {
  try {
    const value = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null') as Partial<Draft> | null
    if (value && typeof value.requestId === 'string' && topics.some(t => t.id === value.topic)) return { ...freshDraft(), ...value } as Draft
  } catch { /* Storage optional. */ }
  return freshDraft()
}
function saveDraft(draft: Draft | null) {
  try { if (draft) sessionStorage.setItem(draftKey, JSON.stringify(draft)); else sessionStorage.removeItem(draftKey) } catch { /* Storage optional. */ }
}

function failureNotice(error: unknown): Notice {
  const failure = error instanceof DeveloperMessageError ? error : new DeveloperMessageError('unavailable')
  const minutes = failure.retryAfter ? Math.max(1, Math.ceil(failure.retryAfter / 60)) : null
  switch (failure.code) {
    case 'limited': return { tone: 'wait', title: 'You\'ve sent 5 messages this hour',
      body: `You can send another ${minutes ? `in about ${minutes} minute${minutes === 1 ? '' : 's'}` : 'later'}. Your draft is saved here.` }
    case 'busy': return { tone: 'wait', title: 'Email is busy right now', body: 'Try again in a minute. Your draft is saved here.' }
    case 'quota': return { tone: 'wait', title: 'No more email today', body: 'The workspace has used today\'s email allowance. Try again tomorrow. Your draft is saved here.' }
    case 'offline': return { tone: 'offline', title: 'You seem to be offline', body: 'Your draft is saved. Send it when you\'re back online.' }
    case 'denied': return { tone: 'error', title: 'Your session has ended', body: 'Sign in again, then send. Your draft is saved in this tab.' }
    case 'invalid': return { tone: 'error', title: 'Check your message', body: 'Add a subject of at least 3 characters and a message of at least 10.' }
    default: return { tone: 'error', title: 'Messages can\'t be sent right now', body: 'Try again later. Your draft is saved here.' }
  }
}

export function DeveloperMessageDialog({ api, onClose }: { api: DeveloperMessageApi; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const location = useLocation()
  const [draft, setDraft] = useState<Draft>(readDraft)
  const [errors, setErrors] = useState<{ subject?: string; message?: string }>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  // Layout effect so close() runs while the dialog is still attached and focus returns to the opener.
  useLayoutEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    subjectRef.current?.focus()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  useEffect(() => { if (!sent) saveDraft(draft) }, [draft, sent])

  const topic = topics.find(t => t.id === draft.topic) ?? topics[0]
  const context: DeveloperMessage['context'] = draft.include ? {
    path: location.pathname, userAgent: navigator.userAgent.slice(0, 300), viewport: `${window.innerWidth}x${window.innerHeight}`,
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila',
  } : null

  function update(patch: Partial<Draft>) {
    setDraft(current => ({ ...current, ...patch }))
    if (patch.subject !== undefined && errors.subject) setErrors(e => ({ ...e, subject: undefined }))
    if (patch.message !== undefined && errors.message) setErrors(e => ({ ...e, message: undefined }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const button = submitterOf(event)
    const subject = draft.subject.trim(), message = draft.message.trim()
    const next = { subject: subject.length < 3 ? 'Add a short subject (at least 3 characters).' : undefined,
      message: message.length < 10 ? 'Add a few more details (at least 10 characters).' : undefined }
    setErrors(next)
    if (next.subject || next.message) { (next.subject ? subjectRef.current : ref.current?.querySelector('textarea'))?.focus(); return }
    setBusy(true); setNotice(null)
    try {
      await api.send({ requestId: draft.requestId, topic: draft.topic, subject, message, context })
      void celebrate(button, 'send')
      saveDraft(null); setSent(true)
    } catch (cause) { setNotice(failureNotice(cause)) }
    finally { setBusy(false) }
  }

  function close() { if (!busy) onClose() }

  const NoticeIcon = notice?.tone === 'wait' ? Clock3 : notice?.tone === 'offline' ? WifiOff : CircleAlert
  const titleId = `${id}-title`
  return <dialog ref={ref} className="developer-message" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="developer-message__head">
      <h2 id={titleId}>{sent ? 'Message sent' : 'Message the developer'}</h2>
      <button type="button" className="icon-button" onClick={close} aria-label="Close" disabled={busy}><X className="icon" size={20} strokeWidth={1.75} aria-hidden="true" /></button>
    </div>
    {sent ? <div className="developer-message__sent" role="status">
      <CircleCheck className="developer-message__sent-icon" size={28} strokeWidth={1.75} aria-hidden="true" />
      <p>Thanks. Your message went straight to the developer. Replies come to the email you signed in with.</p>
      <button type="button" className="button" onClick={onClose}>Done</button>
    </div> : <form className="developer-message__form" onSubmit={submit} noValidate>
      <p className="developer-message__intro">Report a problem, ask a question or suggest an idea. It goes to the person who builds this workspace, and replies come to your email.</p>
      <fieldset className="developer-message__topics" disabled={busy}>
        <legend>What is it about?</legend>
        <div className="developer-message__chips">
          {topics.map(t => <label key={t.id} className="developer-message__chip">
            <input type="radio" name={`${id}-topic`} value={t.id} checked={draft.topic === t.id} onChange={() => update({ topic: t.id })} />
            <span>{t.label}</span>
          </label>)}
        </div>
      </fieldset>
      <div className="form-field">
        <label htmlFor={`${id}-subject`}>Subject</label>
        <input ref={subjectRef} id={`${id}-subject`} type="text" maxLength={MAX_SUBJECT} value={draft.subject} disabled={busy} autoComplete="off"
          aria-invalid={errors.subject ? true : undefined} aria-describedby={errors.subject ? `${id}-subject-error` : undefined}
          onChange={event => update({ subject: event.target.value })} />
        {errors.subject ? <p className="field-error" id={`${id}-subject-error`}>{errors.subject}</p> : null}
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-message`}>Details</label>
        <textarea id={`${id}-message`} className="developer-message__textarea" rows={6} maxLength={MAX_MESSAGE} value={draft.message} disabled={busy}
          placeholder={topic.hint} aria-invalid={errors.message ? true : undefined}
          aria-describedby={`${id}-count${errors.message ? ` ${id}-message-error` : ''}`}
          onChange={event => update({ message: event.target.value })} />
        <p className="field-hint developer-message__count" id={`${id}-count`}>{draft.message.length} / {MAX_MESSAGE}</p>
        {errors.message ? <p className="field-error" id={`${id}-message-error`}>{errors.message}</p> : null}
      </div>
      <label className="developer-message__include">
        <input type="checkbox" checked={draft.include} disabled={busy} onChange={event => update({ include: event.target.checked })} />
        <span>Include this page and my device details
          <span className="field-hint">{context ? `${context.path} · ${context.viewport} · ${context.theme} theme` : 'Only your name, email and role are sent.'}</span>
        </span>
      </label>
      {notice ? <div className={`developer-message__notice developer-message__notice--${notice.tone}`} role="alert">
        <NoticeIcon className="developer-message__notice-icon" size={20} strokeWidth={1.75} aria-hidden="true" />
        <div><p className="developer-message__notice-title">{notice.title}</p><p>{notice.body}</p></div>
      </div> : null}
      <div className="developer-message__actions">
        <button type="submit" className="button" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
        <button type="button" className="button button--secondary" onClick={close} disabled={busy}>Cancel</button>
      </div>
    </form>}
  </dialog>
}
