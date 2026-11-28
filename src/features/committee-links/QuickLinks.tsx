import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowDown, ArrowRight, ArrowUp, ExternalLink, Pencil, Pin, Plus, Trash2 } from 'lucide-react'
import { PendingButton } from '../../components/PendingButton'
import { toast } from '../../components/Toast'
import { celebrate, submitterOf } from '../../components/celebrate'
import { ListToolbar, EmptyResults, useListFilter } from '../../components/list'
import { useAutoRefresh } from '../shared/useAutoRefresh'
import { refreshKey, settled } from '../shared/settled'
import type { CommandError } from '../../lib/commands'
import type { CommitteeLink, CommitteeLinks, CommitteeLinksApi, LinkValues, LinksRead, MyCommitteeLinks } from './api'
import { NOTE_MAX, TITLE_MAX, checkUrl, domainOf, moved, ordered, suggestTitle } from './model'
import './committee-links.css'

type Loaded = { key: string; read: LinksRead | null; failed: boolean }

/** One request id per distinct submission, reused on retry of the same values. */
function useRequest() {
  const ref = useRef<{ key: string; id: string } | null>(null)
  return (key: string) => {
    if (ref.current?.key !== key) ref.current = { key, id: crypto.randomUUID() }
    return { id: ref.current.id, clear: () => { ref.current = null } }
  }
}

function saveMessage(error: CommandError, adding: boolean): string {
  if (error.kind === 'stale_version') return 'Someone else just changed this link. Close this and check the latest version.'
  if (error.kind === 'permission_denied') return 'Only this committee\'s heads and the PMs can change its links.'
  if (error.kind === 'quota_limit') return 'This committee already has 50 links. Remove one before adding another.'
  if (error.kind === 'validation_failed') return 'Check the title and link. Links must start with https://.'
  return adding ? 'The link wasn\'t added. Check your connection and try again.' : 'Your changes weren\'t saved. Check your connection and try again.'
}

/**
 * The committee's quick links, pinned first. Members see the list; heads and full admins can add,
 * edit, pin, reorder and remove. Renders nothing for people outside the committee.
 */
export function QuickLinks({ api, termId, unitId, unitName, compact = false }: { api?: CommitteeLinksApi; termId: string; unitId: string; unitName: string; compact?: boolean }) {
  const [epoch, setEpoch] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const key = refreshKey(termId + ':' + unitId, epoch)
  const [state, setState] = useState<Loaded | null>(null)
  useAutoRefresh(() => setEpoch(n => n + 1), { paused: editing !== null || busy })
  useEffect(() => {
    if (!api) return
    let live = true
    api.readLinks(termId, unitId).then(read => { if (live) setState({ key, read, failed: false }) }, () => { if (live) setState({ key, read: null, failed: true }) })
    return () => { live = false }
    // The key identifies the request; the api object is stable.
  }, [key])
  const current = settled(state, key)
  const data = current?.read?.kind === 'ok' ? current.read.value : null
  const links = data ? ordered(data.links) : []
  const filter = useListFilter(links, { text: l => [l.title, l.note, domainOf(l.url)] })
  const focusAfter = useRef<string | null>(null)
  const request = useRequest()

  const scrolled = useRef(false)
  useEffect(() => {
    // Arriving from "Your committee's links" (…#quick-links): bring the list into view once it loads.
    if (scrolled.current || compact || !data || window.location.hash !== '#quick-links') return
    scrolled.current = true
    document.getElementById('quick-links')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  })
  useEffect(() => {
    if (!focusAfter.current) return
    const target = document.querySelector<HTMLElement>(focusAfter.current)
    focusAfter.current = null
    target?.focus()
  })

  if (!api || !current) return api && !compact ? <section className="quick-links" aria-busy="true" aria-label="Quick links"><div className="quick-links__skeleton" /></section> : null
  if (current.read?.kind === 'denied' || current.read?.kind === 'unavailable') return null
  if (current.failed || !data) return <section className="quick-links" aria-labelledby={'ql-' + unitId}>
    <h2 id={'ql-' + unitId} className="quick-links__title">Quick links</h2>
    <p className="muted" role="alert">The links didn't load. <button className="quick-links__inline-button" type="button" onClick={() => setEpoch(n => n + 1)}>Try again</button></p>
  </section>

  const replace = (next: CommitteeLinks) => setState(s => s ? { ...s, read: { kind: 'ok', value: next } } : s)
  const update = (link: CommitteeLink | null, archived: boolean, value: CommitteeLink) => replace({
    ...data, links: archived ? data.links.filter(l => l.id !== value.id) : link ? data.links.map(l => l.id === value.id ? value : l) : [...data.links, value],
  })

  async function move(link: CommitteeLink, step: -1 | 1) {
    if (!data || busy) return
    const next = moved(links, link.id, step)
    if (!next) return
    const order = next.map(l => l.id)
    const previous = data
    // Show the new order at once; put it back if the server says no.
    replace({ ...data, links: next.map((l, i) => ({ ...l, position: i })) })
    // Keep focus on the moved link: the same arrow if it can move further, otherwise the other one.
    focusAfter.current = `[data-link-move="${link.id}:${moved(next, link.id, step) ? step : -step}"]`
    const r = request(JSON.stringify(order))
    setBusy(true)
    const result = await api!.reorderLinks(termId, unitId, order, r.id)
    setBusy(false)
    if (result.ok) { r.clear(); replace(result.value); return }
    replace(previous)
    toast(result.error.kind === 'stale_version' ? 'The list changed. Showing the latest order.' : 'The new order wasn\'t saved. Try again.', { tone: 'error' })
    if (result.error.kind === 'stale_version') setEpoch(n => n + 1)
  }

  const full = links.length >= data.limit
  const shown = links.length > 8 ? filter.results : links
  const headingId = 'ql-' + unitId
  return <section className={'quick-links' + (compact ? ' quick-links--compact' : '')} aria-labelledby={headingId} id={compact ? undefined : 'quick-links'}>
    <div className="quick-links__head">
      <h2 id={headingId} className="quick-links__title">Quick links{compact ? <span className="muted"> · {unitName}</span> : null}</h2>
      {data.canManage && editing !== 'new' ? <button className="button button--secondary quick-links__add" type="button" disabled={full}
        onClick={() => setEditing('new')}><Plus className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Add link</button> : null}
    </div>
    {full && data.canManage ? <p className="muted">This committee has {data.limit} links, the most it can keep. Remove one to add another.</p> : null}
    {editing === 'new' ? <LinkForm api={api} termId={termId} unitId={unitId} onDone={(value) => { setEditing(null); if (value) update(null, false, value) }} /> : null}

    {!links.length && editing !== 'new' ? <p className="quick-links__empty">{data.canManage
      ? 'Add the links your committee uses: drive folders, trackers, group chats.'
      : `No links yet. ${unitName} heads add the drive folders, trackers and group chats here.`}</p> : null}

    {links.length > 8 ? <ListToolbar filter={filter} label={`Search ${unitName} links`} placeholder="Search links" noun={['link', 'links']} sticky={false} /> : null}
    {links.length > 8 && !shown.length ? <EmptyResults query={filter.query} noun="links" onClear={filter.clear} /> : null}

    {shown.length ? <ul className="quick-links__list">{shown.map(link => {
      const at = links.findIndex(l => l.id === link.id)
      if (editing === link.id) return <li key={link.id} className="quick-links__item quick-links__item--form">
        <LinkForm api={api} termId={termId} unitId={unitId} link={link} onDone={(value, archived) => { setEditing(null); if (value) update(link, archived, value) }} />
      </li>
      return <li key={link.id} className="quick-links__item">
        <a className="quick-links__link" href={link.url} target="_blank" rel="noopener noreferrer">
          <span className="quick-links__name">
            {link.pinned ? <Pin className="icon quick-links__pin" size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
            <span>{link.title}</span>{link.pinned ? <span className="visually-hidden"> (pinned)</span> : null}
            <ExternalLink className="icon quick-links__out" size={14} strokeWidth={1.75} aria-hidden="true" />
            <span className="visually-hidden"> (opens in a new tab)</span>
          </span>
          <span className="quick-links__domain">{domainOf(link.url)}</span>
          {link.note ? <span className="quick-links__note">{link.note}</span> : null}
        </a>
        {data.canManage ? <div className="quick-links__tools">
          {links.length > 8 && filter.active ? null : <>
            <button className="icon-button" type="button" data-link-move={link.id + ':-1'} aria-label={`Move ${link.title} up`} disabled={!moved(links, link.id, -1)} onClick={() => void move(link, -1)}><ArrowUp className="icon" size={16} strokeWidth={1.75} aria-hidden="true" /></button>
            <button className="icon-button" type="button" data-link-move={link.id + ':1'} aria-label={`Move ${link.title} down`} disabled={!moved(links, link.id, 1)} onClick={() => void move(link, 1)}><ArrowDown className="icon" size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          </>}
          <button className="icon-button" type="button" aria-label={`Edit ${link.title}`} disabled={busy} onClick={() => setEditing(link.id)}><Pencil className="icon" size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          <span className="visually-hidden">Position {at + 1} of {links.length}</span>
        </div> : null}
      </li>
    })}</ul> : null}
  </section>
}

function LinkForm({ api, termId, unitId, link, onDone }: { api: CommitteeLinksApi; termId: string; unitId: string; link?: CommitteeLink; onDone: (value: CommitteeLink | null, archived: boolean) => void }) {
  const id = useId()
  const [title, setTitle] = useState(link?.title ?? '')
  const [url, setUrl] = useState(link?.url ?? '')
  const [note, setNote] = useState(link?.note ?? '')
  const [pinned, setPinned] = useState(link?.pinned ?? false)
  const [urlError, setUrlError] = useState('')
  const [titleError, setTitleError] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const titleTouched = useRef(!!link)
  const first = useRef<HTMLInputElement>(null)
  const keep = useRef<HTMLButtonElement>(null)
  const removeButton = useRef<HTMLButtonElement>(null)
  const reopened = useRef(false)
  const request = useRequest()
  useEffect(() => { first.current?.focus() }, [])
  // Move focus into the confirmation, and back to "Remove" when it is dismissed.
  useEffect(() => {
    if (confirming) { reopened.current = true; keep.current?.focus() }
    else if (reopened.current) removeButton.current?.focus()
  }, [confirming])

  function prefill(value: string) {
    if (titleTouched.current && title.trim()) return
    const suggestion = suggestTitle(value)
    if (suggestion) setTitle(suggestion)
  }

  async function run(values: LinkValues, button: HTMLElement | null, archived: boolean) {
    const r = request(JSON.stringify([link?.id, link?.version, values]))
    setBusy(true); setError('')
    const result = await api.saveLink(termId, unitId, link ?? null, values, r.id)
    setBusy(false)
    if (!result.ok) { setError(saveMessage(result.error, !link)); return }
    r.clear()
    if (archived) toast('Link removed')
    else { await celebrate(button, link ? 'save' : 'create'); toast(link ? 'Link saved' : 'Link added') }
    onDone(result.value, archived)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const check = checkUrl(url)
    const cleanTitle = title.trim()
    setUrlError(check.ok ? '' : check.message)
    setTitleError(cleanTitle ? '' : 'Give the link a short title.')
    if (!check.ok || !cleanTitle) return
    setUrl(check.url)
    void run({ title: cleanTitle, url: check.url, note: note.trim() || null, pinned }, submitterOf(event), false)
  }

  return <form className="quick-links__form" onSubmit={submit} noValidate aria-label={link ? `Edit ${link.title}` : 'Add a link'}>
    <div className="form-field">
      <label htmlFor={id + '-url'}>Link (required)</label>
      <input ref={first} id={id + '-url'} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://drive.google.com/..."
        maxLength={2100} value={url} aria-invalid={urlError ? true : undefined} aria-describedby={urlError ? id + '-url-error' : undefined}
        onChange={e => { setUrl(e.target.value); if (urlError) setUrlError('') }}
        onPaste={e => prefill(e.clipboardData.getData('text'))}
        onBlur={() => { if (url.trim()) { const check = checkUrl(url); setUrlError(check.ok ? '' : check.message); if (check.ok) prefill(check.url) } }} />
      {urlError ? <p className="field-error" id={id + '-url-error'}>{urlError}</p> : null}
    </div>
    <div className="form-field">
      <label htmlFor={id + '-title'}>Title (required)</label>
      <input id={id + '-title'} maxLength={TITLE_MAX} value={title} aria-invalid={titleError ? true : undefined} aria-describedby={titleError ? id + '-title-error' : undefined}
        onChange={e => { titleTouched.current = true; setTitle(e.target.value); if (titleError) setTitleError('') }} />
      {titleError ? <p className="field-error" id={id + '-title-error'}>{titleError}</p> : null}
    </div>
    <div className="form-field">
      <label htmlFor={id + '-note'}>Note</label>
      <p className="field-hint" id={id + '-note-hint'}>Optional. What it's for, or who keeps it up to date.</p>
      <input id={id + '-note'} maxLength={NOTE_MAX} value={note} aria-describedby={id + '-note-hint'} onChange={e => setNote(e.target.value)} />
    </div>
    <label className="quick-links__check"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Pin to the top</label>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {confirming && link ? <div className="quick-links__confirm" role="group" aria-label="Confirm removal">
      <p>Remove "{link.title}" for everyone in the committee?</p>
      <div className="quick-links__actions">
        <PendingButton className="button" pending={busy} pendingLabel="Removing…" onClick={() => run({ title: link.title, url: link.url, note: link.note, pinned: link.pinned, archived: true }, null, true)}>Remove link</PendingButton>
        <button ref={keep} className="button button--secondary" type="button" disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
      </div>
    </div> : <div className="quick-links__actions">
      <PendingButton className="button" type="submit" pending={busy} pendingLabel={link ? 'Saving…' : 'Adding…'}>{link ? 'Save link' : 'Add link'}</PendingButton>
      <button className="button button--secondary" type="button" disabled={busy} onClick={() => onDone(null, false)}>Cancel</button>
      {link ? <button ref={removeButton} className="button button--secondary quick-links__remove" type="button" disabled={busy} onClick={() => setConfirming(true)}><Trash2 className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Remove</button> : null}
    </div>}
  </form>
}

/**
 * "Your committee's links": the top links of each committee the person is deployed in, for hubs.
 * Renders nothing when they are in no committee or the feature is not switched on.
 */
export function MyCommitteeLinks({ api, termId, limit = 4 }: { api?: CommitteeLinksApi; termId: string; limit?: number }) {
  const [state, setState] = useState<{ key: string; value: MyCommitteeLinks | null } | null>(null)
  const [epoch, setEpoch] = useState(0)
  useAutoRefresh(() => setEpoch(n => n + 1))
  const key = refreshKey(termId + ':' + limit, epoch)
  useEffect(() => {
    if (!api) return
    let live = true
    api.readMyLinks(termId, limit).then(value => { if (live) setState({ key, value }) }, () => { if (live) setState({ key, value: null }) })
    return () => { live = false }
  }, [key])
  const current = settled(state, key)
  const units = current?.value?.units ?? []
  if (!units.length) return null
  return <section className="my-links" aria-labelledby="my-links-title">
    <h2 id="my-links-title" className="quick-links__title">Your committee's links</h2>
    <div className="my-links__grid">{units.map(u => <div key={u.unitId} className="my-links__unit">
      <h3>{u.name}</h3>
      {!u.links.length ? <p className="muted">{u.canManage ? 'Add the links your committee uses: drive folders, trackers, group chats.' : 'No links yet.'}</p>
        : <ul className="my-links__list">{u.links.map(l => <li key={l.id}>
          <a href={l.url} target="_blank" rel="noopener noreferrer">
            <span>{l.title}<span className="visually-hidden"> (opens in a new tab)</span></span>
            <ExternalLink className="icon" size={14} strokeWidth={1.75} aria-hidden="true" />
          </a>
          <span className="quick-links__domain">{domainOf(l.url)}</span>
        </li>)}</ul>}
      <Link className="my-links__all" to={'/team/committees/' + encodeURIComponent(u.code) + '#quick-links'}>
        {u.total > u.links.length ? `All ${u.total} links` : u.canManage ? 'Manage links' : 'Committee page'}<ArrowRight className="icon" size={16} aria-hidden="true" />
      </Link>
    </div>)}</div>
  </section>
}
