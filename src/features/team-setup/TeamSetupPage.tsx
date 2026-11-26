import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useRouteLoaderData } from 'react-router'
import { BellRing, ClipboardPaste, MessageCircle, Search, Send, UserPlus } from 'lucide-react'
import { PageHeading } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { Status } from '../../components/Status'
import { formatDateTime, timeAgo } from '../../lib/format'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import { useShellServices } from '../../app/shellServices'
import type { Committee, Failure, NudgeKind, TeamPerson, TeamSetup, TeamSetupApi, Wave } from './api'
import { AddPersonDialog, PasteListDialog } from './AddPeople'
import { Dialog } from './Dialog'
import { nudgeKinds, nudgeLabels, nudgeOpen, statusFilters, tutorialLabel, waveLabels, type StatusFilter } from './model'
import './team-setup.css'

export const teamSetupCapabilities = ['roles.manage', 'admin.configure'] as const

/** The workspace context when the viewer may manage the roster; null otherwise. */
export function useRosterManager(): WorkspaceContext | null {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  if (!context || isGuest(context)) return null
  return teamSetupCapabilities.some(c => context.capabilities.includes(c)) ? context : null
}

/** The page takes the api as a prop; it falls back to `gateway.teamSetup` from the shell services. */
export function useTeamSetupApi(api?: TeamSetupApi): TeamSetupApi | undefined {
  const { gateway } = useShellServices()
  return api ?? gateway?.teamSetup
}

type Load = { state: 'loading' } | { state: 'ready'; data: TeamSetup } | { state: 'failed'; reason: Failure }

export function useTeamSetup(api: TeamSetupApi | undefined, termId: string | undefined) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!api || !termId) return
    let live = true
    api.read(termId).then(outcome => { if (live) setLoad(outcome.ok ? { state: 'ready', data: outcome.value } : { state: 'failed', reason: outcome.reason }) })
    return () => { live = false }
  }, [api, termId, version])
  const refresh = useCallback(() => setVersion(v => v + 1), [])
  return { load: !api ? { state: 'failed', reason: 'not_deployed' } as Load : load, refresh }
}

function NotSwitchedOn() {
  return <EmptyState title="Team setup isn't switched on yet" description="The database update is pending. Once it's applied, you'll see who has signed in, installed the app and finished the tour here." />
}

function Kpi({ label, value, total, alert = false }: { label: string; value: number; total?: number; alert?: boolean }) {
  return <div className={`ts-kpi${alert ? ' ts-kpi--alert' : ''}`}>
    <dt>{label}</dt>
    <dd><span className="numeric">{value}</span>{total !== undefined ? <span className="ts-kpi__total">/{total}</span> : null}</dd>
  </div>
}

function Yes({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return on ? <Status state="done" label={yes} /> : <Status state="not_started" label={no} />
}

function lastActive(p: TeamPerson) {
  return p.lastActiveAt ? <time dateTime={p.lastActiveAt} title={formatDateTime(p.lastActiveAt)}>{timeAgo(p.lastActiveAt)}</time> : <span className="ts-muted">Never opened</span>
}

type Pending = { kind: NudgeKind; people: TeamPerson[] }

export function TeamSetupPage({ api: apiProp }: { api?: TeamSetupApi }) {
  const manager = useRosterManager()
  const api = useTeamSetupApi(apiProp)
  const termId = manager?.termId
  const { load, refresh } = useTeamSetup(manager ? api : undefined, termId)
  const [committees, setCommittees] = useState<Committee[]>([])
  const [dialog, setDialog] = useState<'add' | 'paste' | null>(null)
  const [nudge, setNudge] = useState<Pending | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [committee, setCommittee] = useState('')
  const [wave, setWave] = useState<Wave | '' | 'none'>('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!api || !termId || !manager) return
    let live = true
    api.committees(termId).then(outcome => { if (live && outcome.ok) setCommittees(outcome.value) })
    return () => { live = false }
  }, [api, termId, manager])

  const data = load.state === 'ready' ? load.data : null
  const people = useMemo(() => data?.people ?? [], [data])
  const filtered = useMemo(() => {
    const test = statusFilters.find(f => f.value === status)?.test ?? (() => true)
    const q = query.trim().toLowerCase()
    return people.filter(p => (!committee || (committee === 'none' ? !p.committeeCode : p.committeeCode === committee))
      && (!wave || (wave === 'none' ? !p.wave : p.wave === wave)) && test(p)
      && (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)))
  }, [people, committee, wave, status, query])
  const committeeChoices = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of committees) seen.set(c.code, c.name)
    for (const p of people) if (p.committeeCode && !seen.has(p.committeeCode)) seen.set(p.committeeCode, p.committee ?? p.committeeCode)
    return [...seen].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [committees, people])

  if (!manager) {
    return <><PageHeading title="Team setup" /><EmptyState title="Only project managers can open this" description="Ask a project manager if someone needs to be added to the team." action={<Link className="button button--secondary" to="/team">Back to Team</Link>} /></>
  }
  const heading = <PageHeading title="Team setup" description="Add people, see who's set up, and nudge anyone who's stuck." />
  if (load.state === 'loading') return <>{heading}<LoadingState title="Loading the roster" rows={6} /></>
  if (load.state === 'failed') {
    if (load.reason === 'not_deployed') return <>{heading}<NotSwitchedOn /></>
    if (load.reason === 'denied') return <>{heading}<EmptyState title="Only project managers can open this" description="Your current role can't manage the roster." /></>
    return <>{heading}<ErrorState title="Couldn't load the roster" description="Check your connection and try again." action={<button type="button" className="button button--secondary" onClick={refresh}>Try again</button>} /></>
  }
  const { totals, openPositions } = load.data
  const person = selected ? people.find(p => p.membershipId === selected) ?? null : null
  const groups = nudgeKinds.map(kind => ({ kind, people: people.filter(nudgeOpen[kind]) })).filter(g => g.people.length)

  async function sendNudge(kind: NudgeKind, targets: TeamPerson[]): Promise<string | null> {
    if (!api || !termId) return 'Team setup is unavailable.'
    let queued = 0
    for (let i = 0; i < targets.length; i += 200) {
      const outcome = await api.nudge(termId, targets.slice(i, i + 200).map(p => p.membershipId), kind)
      if (!outcome.ok) {
        return outcome.reason === 'not_deployed' ? "Nudges aren't switched on yet. The database update is pending."
          : outcome.reason === 'denied' ? 'Only project managers can send nudges.' : "Couldn't send the nudge. Check your connection and try again."
      }
      queued += outcome.value.queued
    }
    const already = targets.length - queued
    setNotice(queued
      ? `Nudge sent to ${queued} ${queued === 1 ? 'person' : 'people'}.${already ? ` ${already} already got one today or finished that step.` : ''}`
      : 'Everyone selected already got this nudge today or has finished that step.')
    return null
  }

  return <div className="team-setup">
    {heading}

    <dl className="ts-kpis" aria-label="Setup progress">
      <Kpi label="Signed in" value={totals.signedIn} total={totals.people} />
      <Kpi label="Installed" value={totals.installed} total={totals.people} />
      <Kpi label="Finished tour" value={totals.tutorialDone} total={totals.people} />
      <Kpi label="Reminders on" value={totals.remindersOn} total={totals.people} />
      <Kpi label="Never opened" value={totals.neverOpened} alert={totals.neverOpened > 0} />
    </dl>

    <div className="ts-toolbar">
      <div className="ts-toolbar__main">
        <button type="button" className="button" onClick={() => setDialog('add')}><UserPlus className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Add people</button>
        <button type="button" className="button button--secondary" onClick={() => setDialog('paste')}><ClipboardPaste className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Paste a list</button>
      </div>
      {groups.length ? <div className="ts-toolbar__nudges" aria-label="Nudges">
        {groups.map(g => <button key={g.kind} type="button" className="button button--secondary ts-nudge" onClick={() => setNudge({ kind: g.kind, people: g.people })}>
          <BellRing className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />{nudgeLabels[g.kind].button(g.people.length)}
        </button>)}
      </div> : null}
    </div>
    {notice ? <p className="ts-notice" role="status">{notice}</p> : null}

    <section aria-labelledby="ts-people-title" className="ts-people">
      <h2 id="ts-people-title" className="ts-section-title">People <span className="ts-muted numeric">{filtered.length === people.length ? people.length : `${filtered.length} of ${people.length}`}</span></h2>
      <div className="ts-filters">
        <div className="ts-search">
          <Search className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />
          <label htmlFor="ts-search" className="visually-hidden">Search by name</label>
          <input id="ts-search" type="search" placeholder="Search by name or email" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <label className="ts-filter"><span>Committee</span>
          <select value={committee} onChange={e => setCommittee(e.target.value)}>
            <option value="">All committees</option>
            {committeeChoices.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            <option value="none">No committee</option>
          </select>
        </label>
        <label className="ts-filter"><span>Wave</span>
          <select value={wave} onChange={e => setWave(e.target.value as Wave | '' | 'none')}>
            <option value="">All waves</option>
            {(Object.keys(waveLabels) as Wave[]).map(w => <option key={w} value={w}>{waveLabels[w]}</option>)}
            <option value="none">Not set</option>
          </select>
        </label>
        <label className="ts-filter"><span>Status</span>
          <select value={status} onChange={e => setStatus(e.target.value as StatusFilter)}>
            {statusFilters.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      </div>

      {!people.length ? <EmptyState title="No one on the roster yet" description="Add people one at a time, or paste a list from Google Sheets." />
        : !filtered.length ? <EmptyState title="No one matches these filters" description="Clear the search or pick another filter." action={<button type="button" className="button button--secondary" onClick={() => { setQuery(''); setCommittee(''); setWave(''); setStatus('all') }}>Clear filters</button>} />
          : <>
            <div className="ts-scroll ts-desktop" tabIndex={0} role="region" aria-labelledby="ts-people-title">
              <table className="ts-table">
                <thead><tr>
                  <th scope="col">Name</th><th scope="col">Committee</th><th scope="col">Position</th><th scope="col">Wave</th>
                  <th scope="col">Signed in</th><th scope="col">Installed</th><th scope="col">Tour</th><th scope="col">Reminders</th>
                  <th scope="col">Telegram</th><th scope="col">Last active</th>
                </tr></thead>
                <tbody>{filtered.map(p => <tr key={p.membershipId} className="ts-row" onClick={() => setSelected(p.membershipId)}>
                  <th scope="row"><button type="button" className="ts-name" onClick={event => { event.stopPropagation(); setSelected(p.membershipId) }}>{p.name}</button><span className="ts-sub ts-mono">{p.email}</span></th>
                  <td>{p.committeeCode ?? <span className="ts-muted">None</span>}</td>
                  <td>{p.position ?? <span className="ts-muted">Member</span>}</td>
                  <td>{p.wave ? waveLabels[p.wave] : <span className="ts-muted">Not set</span>}</td>
                  <td><Yes on={p.signedIn} yes="Yes" no="Not yet" /></td>
                  <td><Yes on={p.installed} yes="Yes" no="No" /></td>
                  <td>{p.tutorialDone ? <Status state="done" label="Done" /> : <Status state={p.tutorialStep > 0 ? 'in_progress' : 'not_started'} label={tutorialLabel(p)} />}</td>
                  <td><Yes on={p.remindersOn} yes="On" no="Off" /></td>
                  <td><Yes on={p.telegramLinked} yes="Linked" no="No" /></td>
                  <td>{lastActive(p)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <ul className="ts-list ts-mobile">{filtered.map(p => <li key={p.membershipId}>
              <button type="button" className="ts-card" onClick={() => setSelected(p.membershipId)}>
                <span className="ts-card__head"><span className="ts-card__name">{p.name}</span><span className="ts-muted">{[p.committeeCode, p.wave ? waveLabels[p.wave] : null].filter(Boolean).join(' · ')}</span></span>
                <span className="ts-card__status">
                  {p.signedIn ? <Status state="done" label="Signed in" /> : <Status state="not_started" label="Not signed in" />}
                  {p.installed ? <Status state="done" label="Installed" /> : null}
                  <Status state={p.tutorialDone ? 'done' : p.tutorialStep > 0 ? 'in_progress' : 'not_started'} label={`Tour: ${tutorialLabel(p)}`} />
                </span>
                <span className="ts-sub">Last active: {p.lastActiveAt ? timeAgo(p.lastActiveAt) : 'never opened'}</span>
              </button>
            </li>)}</ul>
          </>}
    </section>

    <section aria-labelledby="ts-open-title" className="ts-open">
      <h2 id="ts-open-title" className="ts-section-title">Open positions <span className="ts-muted numeric">{openPositions.length}</span></h2>
      {openPositions.length ? <ul className="ts-gaps">{openPositions.map(p => <li key={p.roleCode}>
        <span className="ts-gaps__role">{p.roleName}</span><span className="ts-muted">{p.committee ?? 'Leadership'}</span>
      </li>)}</ul> : <p className="ts-muted">Every position has someone in it.</p>}
      <p className="ts-muted">To fill a position with someone already on the roster, use <Link to="/admin/access">Admin › Roles &amp; access</Link>. To seat a new person, pick the position when you add them.</p>
    </section>

    {dialog === 'add' && api ? <AddPersonDialog api={api} termId={manager.termId} committees={committees} openPositions={openPositions} roster={people} onClose={() => setDialog(null)} onAdded={refresh} /> : null}
    {dialog === 'paste' && api ? <PasteListDialog api={api} termId={manager.termId} committees={committees} openPositions={openPositions} roster={people} onClose={() => setDialog(null)} onAdded={refresh} /> : null}
    {nudge ? <NudgeDialog pending={nudge} onClose={() => setNudge(null)} send={async () => { const err = await sendNudge(nudge.kind, nudge.people); if (!err) { setNudge(null); refresh() } return err }} /> : null}
    {person ? <PersonSheet person={person} onClose={() => setSelected(null)} send={async kind => { const err = await sendNudge(kind, [person]); if (!err) refresh(); return err }} /> : null}
  </div>
}

function NudgeDialog({ pending, onClose, send }: { pending: Pending; onClose: () => void; send: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const n = pending.people.length
  const names = pending.people.slice(0, 5).map(p => p.name).join(', ') + (n > 5 ? ` and ${n - 5} more` : '')
  return <Dialog title={`Nudge ${n} ${n === 1 ? 'person' : 'people'}?`} onClose={onClose}
    description={`${nudgeLabels[pending.kind].group[0].toUpperCase()}${nudgeLabels[pending.kind].group.slice(1)}: ${names}.`}
    footer={<><button type="button" className="button button--secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="button" data-autofocus disabled={busy} onClick={async () => { setBusy(true); setError(''); const err = await send(); setBusy(false); if (err) setError(err) }}>
        <Send className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />{busy ? 'Sending…' : 'Send nudge'}</button></>}>
    <p>They'll see a note in the app and get an email at their school address. Each person gets at most one nudge of this kind a day.</p>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
  </Dialog>
}

function PersonSheet({ person: p, onClose, send }: { person: TeamPerson; onClose: () => void; send: (kind: NudgeKind) => Promise<string | null> }) {
  const [busy, setBusy] = useState<NudgeKind | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const open = nudgeKinds.filter(kind => nudgeOpen[kind](p))
  async function run(kind: NudgeKind) {
    setBusy(kind); setMessage(null)
    const err = await send(kind)
    setBusy(null)
    setMessage(err ? { text: err, error: true } : { text: kind === 'sign_in' ? 'Invite sent again.' : 'Nudge sent.', error: false })
  }
  return <Dialog variant="sheet" title={p.name} description={<span className="ts-mono">{p.email}</span>} onClose={onClose}>
    <dl className="ts-facts">
      <div><dt>Committee</dt><dd>{p.committee ?? 'None yet'}</dd></div>
      <div><dt>Position</dt><dd>{p.position ?? 'Committee member'}</dd></div>
      <div><dt>Wave</dt><dd>{p.wave ? waveLabels[p.wave] : 'Not set'}</dd></div>
      <div><dt>Signed in</dt><dd>{p.signedIn ? <>Yes{p.lastSignInAt ? <span className="ts-muted"> · last {timeAgo(p.lastSignInAt)}</span> : null}</> : <>Not yet{p.invitedAt ? <span className="ts-muted"> · invited {timeAgo(p.invitedAt)}</span> : null}</>}</dd></div>
      <div><dt>Installed</dt><dd>{p.installed ? 'Yes' : 'No'}</dd></div>
      <div><dt>Tour</dt><dd>{tutorialLabel(p)}</dd></div>
      <div><dt>Reminders</dt><dd>{p.remindersOn ? 'On' : 'Off'}</dd></div>
      <div><dt>Telegram</dt><dd>{p.telegramLinked ? 'Linked' : 'Not linked'}</dd></div>
      <div><dt>Last active</dt><dd>{p.lastActiveAt ? <time dateTime={p.lastActiveAt}>{timeAgo(p.lastActiveAt)}</time> : 'Never opened'}</dd></div>
    </dl>
    <h3 className="ts-subhead">Nudge</h3>
    {open.length ? <div className="ts-sheet-actions">
      {open.map(kind => <button key={kind} type="button" className="button button--secondary" disabled={busy !== null} onClick={() => run(kind)}>
        {kind === 'sign_in' ? <Send className="icon" size={16} strokeWidth={1.75} aria-hidden="true" /> : <MessageCircle className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />}
        {busy === kind ? 'Sending…' : nudgeLabels[kind].single}
      </button>)}
    </div> : <p className="ts-muted">Nothing to nudge. They're all set.</p>}
    {message ? <p className={message.error ? 'field-error' : 'ts-notice'} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
    <h3 className="ts-subhead">Committee, position or wave</h3>
    <p className="ts-muted">Change committees and positions in <Link to="/admin/access">Admin › Roles &amp; access</Link>. Changing someone's wave isn't available yet.</p>
  </Dialog>
}
