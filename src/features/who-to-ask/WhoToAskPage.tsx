import { useId, useState } from 'react'
import { Link, useRouteLoaderData, useSearchParams } from 'react-router'
import { ArrowRight, Mail, Search, Send, Users } from 'lucide-react'
import { PageHeading } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { isGuest, type WorkspaceContext } from '../auth/gateway'
import { useBoard } from '../committee-pages/useBoard'
import { findUnit, leadContacts, roleLabel, type BoardUnit } from '../committee-pages/board'
import { bestService, resolveNeed, type WhoToAskApi } from './api'
import { matchTopics, needs, type Need } from './topics'
import './who-to-ask.css'
import { NoAccess, NotSwitchedOn, EmptySearch } from '../../components/illustrations'

export function WhoToAskPage({ api }: { api?: WhoToAskApi }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext | undefined
  const heading = <PageHeading title="Who do I ask?" description="Pick what you need. You'll see the committee that handles it and who to message." />
  if (!context || isGuest(context)) return <>{heading}<EmptyState illustration={<NoAccess />} title="Not available for guests" description="Ask the person who shared this workspace with you." action={<Link className="button button--secondary" to="/shared">Shared with me</Link>} /></>
  return <WhoToAskBody key={context.termId} api={api} termId={context.termId} heading={heading} />
}

function WhoToAskBody({ api, termId, heading }: { api?: WhoToAskApi; termId: string; heading: React.JSX.Element }) {
  const state = useBoard(api?.board, termId)
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const chipsLabel = useId(), searchId = useId()
  const selected = needs.find(n => n.id === params.get('need')) ?? null
  const choose = (need: Need) => setParams(p => { const next = new URLSearchParams(p); if (next.get('need') === need.id) next.delete('need'); else next.set('need', need.id); return next }, { replace: true, preventScrollReset: true })

  const units = state.board?.units ?? []
  const matches = matchTopics(query)
  const needHits = query.trim() ? needs.filter(n => (n.label + ' ' + n.keywords.join(' ')).toLowerCase().includes(query.trim().toLowerCase())) : []

  return <div className="who-to-ask">
    {heading}
    <section aria-labelledby={chipsLabel}>
      <h2 id={chipsLabel} className="who-to-ask__lead">I need…</h2>
      <div className="who-to-ask__chips">
        {needs.map(n => <button key={n.id} type="button" className="who-to-ask__chip" aria-pressed={selected?.id === n.id} onClick={() => choose(n)}>{n.label}</button>)}
      </div>
    </section>

    {selected ? <section className="who-to-ask__answer" aria-live="polite">
      {!state.board ? (state.unavailable
        ? <EmptyState illustration={<NotSwitchedOn />} title="Contacts aren't switched on yet" description="They appear once the latest workspace update is installed. Meanwhile, check People." action={<Link className="button button--secondary" to="/people">People</Link>} />
        : state.error ? <ErrorState title="Contacts didn't load" description={state.error} action={<button className="button button--secondary" type="button" onClick={state.reload}>Try again</button>} />
        : <LoadingState title="Finding who to ask" rows={2} />)
        : <NeedAnswer need={selected} unit={resolveNeed(selected, units)} />}
    </section> : null}

    <section className="who-to-ask__search">
      <label htmlFor={searchId} className="who-to-ask__lead">Or search a topic</label>
      <div className="who-to-ask__field">
        <Search className="icon" size={18} aria-hidden="true" />
        <input id={searchId} type="search" value={query} placeholder="sponsors, LED wall, ushers…" autoComplete="off"
          onChange={e => { setQuery(e.target.value); setParams(p => { const next = new URLSearchParams(p); if (e.target.value.trim()) next.set('q', e.target.value); else next.delete('q'); return next }, { replace: true, preventScrollReset: true }) }} />
      </div>
      {query.trim() ? <div aria-live="polite">
        {!matches.length && !needHits.length ? <EmptyState level={3} illustration={<EmptySearch size={88} />} title={`No committee lists “${query.trim()}” yet`} description="Try another word, or pick a need above. Still stuck? Ask the Project Managers." /> : null}
        {needHits.length ? <div className="who-to-ask__chips who-to-ask__chips--small">{needHits.map(n => <button key={n.id} type="button" className="who-to-ask__chip" aria-pressed={selected?.id === n.id} onClick={() => choose(n)}>I need {n.label}</button>)}</div> : null}
        {matches.length ? <ul className="who-to-ask__results">{dedupe(matches.map(m => ({ ...m, unit: findUnit(units, m.group.codes) }))).map(m => <li key={m.key}>
          <TopicResult name={m.group.name} hits={m.hits} unit={m.unit} loaded={!!state.board} />
        </li>)}</ul> : null}
      </div> : null}
    </section>
  </div>
}

function dedupe<T extends { unit: BoardUnit | null; group: { name: string }; hits: string[] }>(list: T[]): (T & { key: string })[] {
  const seen = new Map<string, T & { key: string }>()
  for (const item of list) {
    const key = item.unit?.id ?? 'none:' + item.group.name
    const prior = seen.get(key)
    if (prior) prior.hits = [...new Set([...prior.hits, ...item.hits])]
    else seen.set(key, { ...item, hits: [...item.hits], key })
  }
  return [...seen.values()]
}

function Contacts({ unit }: { unit: BoardUnit }) {
  const leads = leadContacts(unit)
  if (!leads.length) return <p className="muted">No head is listed for {unit.name} yet. The committee page shows everyone on it.</p>
  return <ul className="who-to-ask__people">{leads.map(p => <li key={p.id}>
    <span className="who-to-ask__name">{p.name}</span> <span className="muted">· {roleLabel[p.role]}</span>
    {p.contact ? <a className="who-to-ask__mail" href={'mailto:' + p.contact}><Mail className="icon" size={16} aria-hidden="true" />{p.contact}</a> : null}
  </li>)}</ul>
}

function NeedAnswer({ need, unit }: { need: Need; unit: BoardUnit | null }) {
  if (!unit) return <div className="who-to-ask__card">
    <h2>No committee handles {need.label} yet</h2>
    <p>Ask the Project Managers, and they'll point you to the right person.</p>
    <Link className="button button--secondary" to="/people"><Users className="icon" size={16} aria-hidden="true" />People</Link>
  </div>
  const service = bestService(unit, need.keywords)
  return <div className="who-to-ask__card">
    <p className="muted">For {need.label}, ask</p>
    <h2>{unit.name} <span className="muted">({unit.code})</span></h2>
    <Contacts unit={unit} />
    <div className="who-to-ask__actions">
      {service ? <Link className="button" to={'/requests/services/' + service.id + '/new'}><Send className="icon" size={16} aria-hidden="true" />Start request: {service.label}</Link> : null}
      <Link className="button button--secondary" to={'/team/committees/' + encodeURIComponent(unit.code)}>{unit.name} page<ArrowRight className="icon" size={16} aria-hidden="true" /></Link>
    </div>
    {!service ? <p className="muted">{unit.name} has no request form yet, so message the head directly.</p> : null}
  </div>
}

function TopicResult({ name, hits, unit, loaded }: { name: string; hits: string[]; unit: BoardUnit | null; loaded: boolean }) {
  return <div className="who-to-ask__result">
    <h3>{unit ? <>{unit.name} <span className="muted">({unit.code})</span></> : name}</h3>
    {hits.length ? <p className="muted">Handles: {hits.join(', ')}{unit && unit.name !== name ? ` (${name})` : ''}</p> : null}
    {unit ? <><Contacts unit={unit} /><Link className="button button--secondary" to={'/team/committees/' + encodeURIComponent(unit.code)}>{unit.name} page<ArrowRight className="icon" size={16} aria-hidden="true" /></Link></>
      : loaded ? <p className="muted">This committee isn't set up this term. Ask the Project Managers.</p> : null}
  </div>
}
