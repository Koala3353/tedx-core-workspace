import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { Printer } from 'lucide-react'
import { PageHeading, Panel } from '../../components/Page'
import { EmptyState, ErrorState, LoadingState } from '../../components/FeedbackState'
import { Status } from '../../components/Status'
import { formatDateTime, formatTime } from '../../lib/format'
import type { WorkspaceContext } from '../auth/gateway'
import type { InventoryApi, StockItem } from '../inventory/api'
import type { CheckInLink, CrewArrivals, CrewPerson, EventQrApi } from './api'
import { QrCode } from './QrCode'
import { checkInLink, itemLink } from './links'
import './event-qr.css'
import { EmptyInbox, NoAccess, NotSwitchedOn } from '../../components/illustrations'

type View = 'labels' | 'door'

export function EventQrPage({ api, inventory }: { api?: EventQrApi; inventory?: InventoryApi }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext
  if (!context || !('memberId' in context)) {
    return <EmptyState illustration={<NoAccess />} title="Event QR codes aren't available" description="Only organizers on this term's roster can print event QR codes." />
  }
  const crewManager = context.capabilities.includes('admin.configure') || context.capabilities.includes('roles.manage')
  return <EventQrBody key={context.termId} term={context.termId} api={api} inventory={inventory} crewManager={crewManager && !!api} />
}

function EventQrBody({ term, api, inventory, crewManager }: { term: string; api?: EventQrApi; inventory?: InventoryApi; crewManager: boolean }) {
  const [view, setView] = useState<View>(inventory ? 'labels' : 'door')
  const name = useId()
  const views: { id: View; label: string }[] = [
    ...(inventory ? [{ id: 'labels' as const, label: 'Item labels' }] : []),
    ...(crewManager ? [{ id: 'door' as const, label: 'Crew check-in' }] : []),
  ]
  if (views.length === 0) return <>
    <PageHeading title="Event QR codes" />
    <EmptyState illustration={<EmptyInbox />} title="Nothing to print here yet" description="Inventory labels need inventory to be set up. Crew check-in is for PMs and admins." />
  </>
  return <div className="eqr">
    <PageHeading title="Event QR codes" description="Print item labels for borrowing and returns, and the crew door code for check-in." />
    <p className="eqr-print-note eqr-noprint"><Printer size={16} aria-hidden="true" />Use your browser’s Print to print what’s shown below. Only the codes print.</p>
    {views.length > 1 ? <fieldset className="eqr-switch eqr-noprint">
      <legend className="visually-hidden">What to show</legend>
      {views.map(v => <label key={v.id} className={'eqr-switch__option' + (view === v.id ? ' eqr-switch__option--on' : '')}>
        <input type="radio" name={name} value={v.id} checked={view === v.id} onChange={() => setView(v.id)} />{v.label}
      </label>)}
    </fieldset> : null}
    {view === 'labels' && inventory ? <ItemLabels term={term} inventory={inventory} /> : null}
    {view === 'door' && api && crewManager ? <CrewDoor term={term} api={api} /> : null}
  </div>
}

function ItemLabels({ term, inventory }: { term: string; inventory: InventoryApi }) {
  const [items, setItems] = useState<StockItem[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'none'>('loading')
  const [filter, setFilter] = useState('')
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  const filterId = useId()

  const load = useCallback(async () => {
    setState('loading')
    try {
      const all: StockItem[] = []
      for (let page = 1; page <= 20; page++) {
        const w = await inventory.read(term, null, page, 1, '')
        if (!w) { setState('none'); return }
        all.push(...w.items)
        if (!w.moreItems) break
      }
      setItems(all); setState('ready')
    } catch { setState('failed') }
  }, [inventory, term])
  useEffect(() => { void load() }, [load])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (items ?? []).filter(i => !q || i.name.toLowerCase().includes(q) || i.location.toLowerCase().includes(q))
  }, [items, filter])
  const printing = shown.filter(i => !skipped.has(i.id))

  if (state === 'loading') return <LoadingState title="Loading inventory items" />
  if (state === 'failed') return <ErrorState title="Couldn't load inventory" description="Check your connection and try again."
    action={<button className="button button--secondary" onClick={() => void load()}>Try again</button>} />
  if (state === 'none' || !items?.length) return <EmptyState illustration={<EmptyInbox />} title="No items to label yet"
    description="Logistics adds items on the Inventory page. Their labels show up here." />

  const toggle = (id: string) => setSkipped(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  return <>
    <Panel title="Item labels" className="eqr-noprint">
      <p>Each label opens that item on the Inventory page, where people borrow and return it. Stick one on each item or its case.</p>
      <div className="form-field eqr-filter">
        <label htmlFor={filterId}>Find items</label>
        <input id={filterId} type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Name or storage place" />
      </div>
      <ul className="eqr-picks">
        {shown.map(i => <li key={i.id}><label className="eqr-pick">
          <input type="checkbox" checked={!skipped.has(i.id)} onChange={() => toggle(i.id)} />
          <span>{i.name}<span className="eqr-muted"> · {i.location}</span></span>
        </label></li>)}
      </ul>
      <p className="eqr-muted">{printing.length} of {items.length} labels will print.</p>
    </Panel>
    <section className="eqr-sheet eqr-print" aria-label="Label sheet preview">
      {printing.map(i => <article key={i.id} className="eqr-label">
        <QrCode value={itemLink(i.id)} label={`QR code for ${i.name}`} />
        <div className="eqr-label__text">
          <p className="eqr-label__name">{i.name}</p>
          <p className="eqr-label__place">{i.location}</p>
          <p className="eqr-label__hint">Scan to borrow or return</p>
        </div>
      </article>)}
    </section>
  </>
}

function CrewDoor({ term, api }: { term: string; api: EventQrApi }) {
  const [link, setLink] = useState<CheckInLink | null>(null)
  const [arrivals, setArrivals] = useState<CrewArrivals | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'unavailable'>('loading')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const [showArrived, setShowArrived] = useState(false)
  const pending = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [l, a] = await Promise.all([api.link(term), api.arrivals(term)])
      if (!l || !a) { setState('unavailable'); return }
      setLink(l); setArrivals(a); setState('ready')
    } catch { setState(s => s === 'ready' ? s : 'failed') }
  }, [api, term])
  useEffect(() => {
    const check = () => { if (document.visibilityState !== 'hidden') void load() }
    check()
    const timer = window.setInterval(check, 15000)
    document.addEventListener('visibilitychange', check)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', check) }
  }, [load])

  async function rotate() {
    const key = pending.current ?? crypto.randomUUID()
    pending.current = key
    setBusy(true); setError('')
    const result = await api.rotate(term, key)
    setBusy(false)
    if (!result.ok) { setError(result.error.message); if (!result.error.retryable) pending.current = null; return }
    pending.current = null
    setConfirm(false); setLink(result.value); void load()
  }

  if (state === 'loading') return <LoadingState title="Loading crew check-in" />
  if (state === 'unavailable') return <EmptyState illustration={<NotSwitchedOn />} title="Crew check-in isn't set up yet" description="It needs a workspace update. Ask the WebDev head to finish setup." />
  if (state === 'failed' || !link || !arrivals) return <ErrorState title="Couldn't load crew check-in" description="Check your connection and try again."
    action={<button className="button button--secondary" onClick={() => void load()}>Try again</button>} />

  const people = arrivals.people
  const here = people.filter(p => p.checkedInAt).length
  const groups = new Map<string, CrewPerson[]>()
  for (const p of people) {
    if (!showArrived && p.checkedInAt) continue
    const key = p.committee ?? 'No committee'
    groups.set(key, [...(groups.get(key) ?? []), p])
  }

  return <>
    <Panel title="Crew door code" className="eqr-door-panel">
      {link.token ? <>
        <div className="eqr-door eqr-print">
          <QrCode value={checkInLink(link.token)} label="Crew check-in QR code" className="eqr-door__qr" />
          <p className="eqr-door__title">Crew, check in here</p>
          <p className="eqr-door__hint">Scan with your phone camera and tap “I’m here”.</p>
        </div>
        <p className="eqr-muted eqr-noprint">Made {formatDateTime(link.rotatedAt)}. Anyone with this code and a core account can check in, so keep it at the crew door.</p>
      </> : <p>No door code yet. {link.canRotate ? 'Make one before the dry run and print it for the crew door.' : 'Ask an admin to make one.'}</p>}
      {link.canRotate ? <div className="eqr-actions eqr-noprint">
        {!link.token ? <button type="button" className="button" disabled={busy} onClick={() => void rotate()}>{busy ? 'Making the code…' : 'Make the door code'}</button>
          : confirm ? <>
            <p>A new code starts a fresh arrival list and the printed code stops working. Do this between the dry run and event day.</p>
            <button type="button" className="button button--secondary" disabled={busy} onClick={() => void rotate()}>{busy ? 'Making a new code…' : 'Yes, make a new code'}</button>
            <button type="button" className="button button--secondary" disabled={busy} onClick={() => setConfirm(false)}>Keep this code</button>
          </> : <button type="button" className="button button--secondary" onClick={() => setConfirm(true)}>Make a new code</button>}
      </div> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </Panel>

    <Panel title="Who's here" className="eqr-noprint">
      {!link.token ? <p>Arrivals show here once the door code is made.</p> : <>
        <p className="eqr-count"><strong>{here}</strong> of {people.length} checked in{arrivals.rotatedAt ? ` since ${formatTime(arrivals.rotatedAt)}` : ''}.</p>
        <label className="eqr-pick"><input type="checkbox" checked={showArrived} onChange={e => setShowArrived(e.target.checked)} />Show people who already checked in</label>
        {groups.size === 0 ? <p>Everyone is here.</p> : [...groups].map(([committee, list]) => <section key={committee} className="eqr-group" aria-label={committee}>
          <h3>{committee} <span className="eqr-muted">· {list.filter(p => !p.checkedInAt).length} not here yet</span></h3>
          <ul>
            {list.map(p => <li key={p.membershipId}>
              <span>{p.name}</span>
              {p.checkedInAt ? <Status state="done" label={`Here since ${formatTime(p.checkedInAt)}`} /> : <Status state="pending" label="Not here yet" />}
            </li>)}
          </ul>
        </section>)}
      </>}
    </Panel>
  </>
}
