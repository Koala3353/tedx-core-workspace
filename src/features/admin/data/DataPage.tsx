import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {refreshKey,settled} from '../../shared/settled'
import { useRouteLoaderData, useSearchParams } from 'react-router'
import { ArrowDown, ArrowUp, Check, Download, Lock, RefreshCw, Search } from 'lucide-react'
import { PageHeading } from '../../../components/Page'
import { EmptyState, ErrorState } from '../../../components/FeedbackState'
import type { WorkspaceContext } from '../../auth/gateway'
import { downloadCsv } from '../../exports/downloadCsv'
import { DataError, datasets, type AdminDataApi, type Cell, type Column, type Dataset, type DatasetId } from './api'
import './data.css'

type Sort = { key: string; desc: boolean } | null
type Load = { key: string; data: Dataset | null; error: DataError | null }

const letter = (i: number): string => (i >= 26 ? letter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const timeFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })

function display(value: Cell, column: Column): string {
  if (value === null || value === '') return ''
  if (column.type === 'bool') return value ? 'TRUE' : 'FALSE'
  if (column.type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dayFormat.format(new Date(value + 'T00:00:00Z'))
  if (column.type === 'datetime' && typeof value === 'string' && Number.isFinite(Date.parse(value))) return timeFormat.format(new Date(value))
  return String(value)
}
function compare(a: Cell, b: Cell): number {
  if (a === b) return 0
  if (a === null || a === '') return 1
  if (b === null || b === '') return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a ? -1 : 1
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}
function csvValue(value: Cell): string {
  const text = value === null ? '' : String(value)
  // Leading = + - @ would run as a formula in a spreadsheet app.
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}

export function DataPage({ api }: { api: AdminDataApi }) {
  const context = useRouteLoaderData('workspace') as WorkspaceContext
  const [params, setParams] = useSearchParams()
  const sheet = (datasets.find(d => d.id === params.get('sheet'))?.id ?? 'people') as DatasetId
  const query = params.get('q') ?? ''
  const [sort, setSort] = useState<Sort>(null)
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)
  const [reload, setReload] = useState(0)
  const [load, setLoad] = useState<Load | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const key = refreshKey(context.termId + ':' + sheet, reload)

  useEffect(() => {
    let live = true
    api.read(context.termId, sheet)
      .then(data => { if (live) setLoad({ key, data, error: null }) })
      .catch((error: unknown) => { if (live) setLoad({ key, data: null, error: error instanceof DataError ? error : new DataError('unavailable') }) })
    return () => { live = false }
  }, [api, context.termId, sheet, key])

  const current = settled(load, key)
  // Keep the last sheet on screen while a refresh of the same sheet loads.
  const data = current?.data ?? (load?.data?.dataset === sheet ? load.data : null)
  const rows = useMemo(() => {
    if (!data) return []
    const needle = query.trim().toLowerCase()
    const filtered = needle ? data.rows.filter(row => data.columns.some(c => display(row[c.key], c).toLowerCase().includes(needle))) : data.rows
    if (!sort) return filtered
    const sorted = [...filtered].sort((a, b) => compare(a[sort.key], b[sort.key]))
    return sort.desc ? sorted.reverse() : sorted
  }, [data, query, sort])

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value); else next.delete(name)
    setParams(next, { replace: name === 'q' })
  }
  function openSheet(id: DatasetId) { setSort(null); setSelected(null); setParam('sheet', id === 'people' ? '' : id) }
  function toggleSort(column: Column) {
    setSort(s => !s || s.key !== column.key ? { key: column.key, desc: false } : !s.desc ? { key: column.key, desc: true } : null)
  }
  function download() {
    if (!data) return
    const lines = [data.columns.map(c => csvValue(c.label)).join(','), ...rows.map(row => data.columns.map(c => csvValue(row[c.key])).join(','))]
    downloadCsv('﻿' + lines.join('\r\n'), `tedx-${sheet}-${new Date().toISOString().slice(0, 10)}.csv`)
  }
  function move(event: KeyboardEvent) {
    if (!data || !rows.length) return
    const delta: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const step = delta[event.key]
    if (!step) return
    event.preventDefault()
    const from = selected ?? { row: 0, col: 0 }
    const next = { row: Math.min(rows.length - 1, Math.max(0, from.row + step[0])), col: Math.min(data.columns.length - 1, Math.max(0, from.col + step[1])) }
    setSelected(next)
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${next.row}:${next.col}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const selectedColumn = data && selected ? data.columns[selected.col] : undefined
  const selectedValue = selectedColumn && selected ? rows[selected.row]?.[selectedColumn.key] ?? null : null
  const busy = !current

  return <div className="data-page">
    <PageHeading title="Data" description="A read-only look at the workspace records, like a spreadsheet. To change something, use its own page." />
    <div className="data-toolbar">
      <label className="data-search"><Search className="icon" size={16} aria-hidden="true" /><span className="visually-hidden">Search this sheet</span>
        <input type="search" value={query} placeholder="Search this sheet" onChange={e => setParam('q', e.target.value)} /></label>
      <span className="data-badge"><Lock size={14} aria-hidden="true" />View only</span>
      <span className="data-toolbar__spacer" />
      <button type="button" className="button button--secondary data-tool" onClick={() => setReload(n => n + 1)} disabled={busy}><RefreshCw size={16} aria-hidden="true" className={busy ? 'data-spin' : undefined} />Refresh</button>
      <button type="button" className="button button--secondary data-tool" onClick={download} disabled={!data || !rows.length}><Download size={16} aria-hidden="true" />Download CSV</button>
    </div>

    <div className="data-formula" aria-live="polite">
      <span className="data-formula__ref">{selected && data ? letter(selected.col) + (selected.row + 1) : ''}</span>
      <span className="data-formula__fx" aria-hidden="true">fx</span>
      <span className="data-formula__value">{selectedColumn ? display(selectedValue, selectedColumn) : data ? 'Select a cell to see its full value' : ''}</span>
    </div>

    {current?.error ? current.error.code === 'denied'
      ? <EmptyState title="Only full admins can open Data" description="You need both Admin and Roles & access. Ask a project manager." />
      : <ErrorState title="Couldn't load this sheet" description="Check your connection and try again." action={<button type="button" className="button button--secondary" onClick={() => setReload(n => n + 1)}>Try again</button>} />
      : <div ref={gridRef} className="data-grid" tabIndex={0} role="region" aria-label={`${datasets.find(d => d.id === sheet)?.label} sheet`} aria-busy={busy} onKeyDown={move}>
        {data ? <table>
          <thead>
            <tr className="data-grid__letters"><th className="data-grid__corner" aria-hidden="true" />{data.columns.map((c, i) => <th key={c.key} aria-hidden="true" className={selected?.col === i ? 'is-active' : undefined}>{letter(i)}</th>)}</tr>
            <tr className="data-grid__labels"><th className="data-grid__corner" scope="col"><span className="visually-hidden">Row</span></th>
              {data.columns.map(c => <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'} className={`data-col--${c.type}`}>
                <button type="button" onClick={() => toggleSort(c)}>{c.label}{sort?.key === c.key ? sort.desc ? <ArrowDown size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" /> : null}</button>
              </th>)}</tr>
          </thead>
          <tbody>{rows.map((row, r) => <tr key={r}>
            <th scope="row" className={'data-grid__rownum' + (selected?.row === r ? ' is-active' : '')}>{r + 1}</th>
            {data.columns.map((c, i) => {
              const value = row[c.key], active = selected?.row === r && selected.col === i
              return <td key={c.key} data-cell={`${r}:${i}`} className={`data-col--${c.type}${active ? ' is-selected' : ''}`} onClick={() => setSelected({ row: r, col: i })}>
                {c.type === 'bool' ? <span className={'data-check' + (value ? ' is-on' : '')} role="img" aria-label={value ? 'Yes' : 'No'}>{value ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}</span> : display(value, c)}
              </td>
            })}
          </tr>)}</tbody>
        </table> : <div className="data-grid__loading" role="status">Loading sheet</div>}
        {data && !rows.length ? <p className="data-grid__empty">{query ? 'No rows match your search.' : 'Nothing here yet.'}</p> : null}
      </div>}

    <div className="data-foot">
      <nav className="data-tabs" aria-label="Sheets">{datasets.map(d => <button key={d.id} type="button" className={'data-tab' + (d.id === sheet ? ' is-active' : '')} aria-current={d.id === sheet ? 'page' : undefined} onClick={() => openSheet(d.id)}>{d.label}</button>)}</nav>
      {data ? <p className="data-foot__count">{rows.length === data.rows.length ? `${data.rows.length} rows` : `${rows.length} of ${data.rows.length} rows`}{data.truncated ? ' (first rows only)' : ''} · Read {timeFormat.format(new Date(data.readAt))}</p> : null}
    </div>
    <p className="data-note">Budget, privacy requests, check-ins and private profile details aren't shown here. They stay on their own pages for the people assigned to them.</p>
  </div>
}
