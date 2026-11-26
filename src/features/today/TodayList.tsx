import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { TodayItem } from './model'

export type AcknowledgeHandler = (item: TodayItem) => Promise<string | null>

/**
 * One Today row: what (title), who's waiting and when, and exactly one verb.
 * Navigation verbs are part of the row link, so each row is one tab stop; Acknowledge
 * is a real button that runs the command in place.
 */
export function TodayRow({ item, onAcknowledge, illustrative = false, tour }: { item: TodayItem; onAcknowledge?: AcknowledgeHandler; illustrative?: boolean; tour?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const errorId = useId()
  const inPlace = item.verb === 'Acknowledge' && !!onAcknowledge && !illustrative

  async function acknowledge() {
    if (!onAcknowledge || busy) return
    setBusy(true); setError('')
    const failure = await onAcknowledge(item)
    setBusy(false)
    if (failure) setError(failure)
    else setDone(true)
  }

  const meta = <span className="today-row__meta">
    {item.chip ? <span className="today-chip">{item.chip}</span> : null}
    {item.when ? <span className={item.late ? 'today-row__late' : undefined}>{item.when}</span> : null}
    {item.when && item.who ? <span aria-hidden="true"> · </span> : null}
    {item.who ? <span>{item.who}</span> : null}
  </span>

  return <li className={`today-row${done ? ' today-row--done' : ''}`} data-kind={item.kind}>
    <span className="today-row__text">
      <Link className="today-row__title" to={illustrative ? '#' : item.href} aria-disabled={illustrative || undefined} tabIndex={illustrative ? -1 : undefined}
        onClick={illustrative ? event => event.preventDefault() : undefined}
        aria-describedby={error ? errorId : undefined}>
        {item.title}
        {!inPlace ? <span className="visually-hidden">, {item.verb.toLowerCase()}</span> : null}
      </Link>
      {meta}
      {error ? <span className="today-row__error" id={errorId} role="alert">{error}</span> : null}
    </span>
    {inPlace
      ? <button className={`button today-verb${done ? ' today-verb--done' : ''}`} type="button" disabled={busy || done} data-tour={tour} onClick={() => void acknowledge()}>
        {done ? 'Got it' : busy ? 'Saving…' : 'Acknowledge'}
      </button>
      : <span className={`today-verb today-verb--link${item.late ? ' today-verb--primary' : ''}`} aria-hidden="true" data-tour={tour}>{item.verb}</span>}
  </li>
}

/** A titled group of rows with a count; renders nothing when empty unless `always`. */
export function TodaySection({ title, items, onAcknowledge, illustrative, tourFirstVerb, children, collapsible = false }: {
  title: string; items: TodayItem[]; onAcknowledge?: AcknowledgeHandler; illustrative?: boolean; tourFirstVerb?: boolean; children?: ReactNode; collapsible?: boolean
}) {
  const headingId = useId()
  if (!items.length && !children) return null
  const list = <ul className="today-list">{items.map((item, index) => <TodayRow key={item.key} item={item} onAcknowledge={onAcknowledge} illustrative={illustrative} tour={tourFirstVerb && index === 0 ? 'today-verb' : undefined} />)}</ul>
  if (collapsible) return <details className="today-section today-section--folded">
    <summary><h2 className="today-section__title">{title}</h2><span className="today-count">{items.length}</span></summary>
    {list}{children}
  </details>
  return <section className="today-section" aria-labelledby={headingId}>
    <h2 className="today-section__title" id={headingId}>{title}<span className="today-count">{items.length}</span></h2>
    {list}{children}
  </section>
}
