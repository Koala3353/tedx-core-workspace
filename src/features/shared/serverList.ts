import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { sessionMemory, type ListFilterDef, type ListFilterState } from '../../components/list'
import type { createSupabaseClient } from '../../lib/supabase'

/**
 * Search and filters for lists the server pages (tasks, deliverables, inbox, finance plans).
 * The search box is debounced into `?q=`, chips write their own URL params, and the last choice is
 * remembered for this browser tab. The server applies every filter after its own access checks,
 * so filters only ever narrow what the viewer can already see.
 */

export const MY_COMMITTEE = 'mine'
export const SEARCH_DEBOUNCE_MS = 250

export type MyUnit = { id: string; name: string; head: boolean }
export type UnitFacet = { id: string; name: string; count: number }
/** What a paged list RPC accepts in p_filters. */
export type ServerFilters = { q?: string; units?: string[]; states?: string[]; sort?: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0

/** Facet and total fields are optional so the page keeps working against the previous backend. */
export function validUnitFacets(v: unknown): v is UnitFacet[] | undefined {
  return v === undefined || Array.isArray(v) && v.length <= 200 && v.every(u => !!u && typeof u === 'object' && uuid.test((u as UnitFacet).id) && typeof (u as UnitFacet).name === 'string' && count((u as UnitFacet).count))
}
export function validStateFacets(v: unknown): v is Record<string, number> | undefined {
  return v === undefined || !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(count)
}
export const validOptionalCount = (v: unknown) => v === undefined || count(v)

/** Drops empty values so the request (and its cache key) stays small. */
export function compactFilters(f: ServerFilters): ServerFilters {
  const out: ServerFilters = {}
  if (f.q?.trim()) out.q = f.q.trim().slice(0, 200)
  if (f.units?.length) out.units = [...f.units].sort()
  if (f.states?.length) out.states = [...f.states].sort()
  if (f.sort) out.sort = f.sort
  return out
}

type Ready = ReturnType<typeof createSupabaseClient>
type UntypedRpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const unitCache = new Map<string, Promise<MyUnit[]>>()

/** The viewer's own active committees this term (cached for the session; empty when unavailable). */
export function readMyUnits(ready: Ready, termId: string): Promise<MyUnit[]> {
  const cached = unitCache.get(termId)
  if (cached) return cached
  const load = (async () => {
    const client = await ready
    if (!client) return []
    const rpc = client.rpc.bind(client) as unknown as UntypedRpc
    const { data, error } = await rpc('read_my_units', { p_term_id: termId })
    const units = (data as { units?: unknown } | null)?.units
    if (error || !Array.isArray(units) || units.length > 100 || !units.every(u => u && uuid.test(u.id) && typeof u.name === 'string' && typeof u.head === 'boolean')) throw new Error('Committees unavailable')
    return units as MyUnit[]
  })()
  unitCache.set(termId, load)
  // A failed read (offline, or the backend not updated yet) is retried on the next page visit.
  load.catch(() => unitCache.delete(termId))
  return load
}

/** Loads the viewer's committees. `ready` turns true once known (or once the read fails). */
export function useMyUnits(load: ((termId: string) => Promise<MyUnit[]>) | undefined, termId: string) {
  const [state, setState] = useState<{ termId: string; units: MyUnit[] } | null>(null)
  useEffect(() => {
    if (!load) return
    let live = true
    load(termId).then(units => { if (live) setState({ termId, units }) }).catch(() => { if (live) setState({ termId, units: [] }) })
    return () => { live = false }
  }, [load, termId])
  const units = useMemo(() => state?.termId === termId ? state.units : [], [state, termId])
  return { units, ready: !load || state?.termId === termId }
}

/** Ids behind the "My committee" chip: the committees the viewer heads, else every committee they are in. */
export function myCommitteeIds(units: MyUnit[]): string[] {
  const heads = units.filter(u => u.head)
  return (heads.length ? heads : units).map(u => u.id)
}

/** Resolves a `unit` URL value ('' | 'mine' | committee id) to the ids the server filters on. */
export function resolveUnits(value: string, units: MyUnit[]): string[] | undefined {
  if (!value) return undefined
  if (value === MY_COMMITTEE) { const ids = myCommitteeIds(units); return ids.length ? ids : undefined }
  return uuid.test(value) ? [value] : undefined
}

const SEARCH = 'q'

/**
 * URL-backed search and filter values for one server-paged list.
 * `keys` are the URL params this list owns besides `q` (e.g. ['unit','state']). Other params
 * (view, phase, owner...) are left alone; `page` is reset whenever a filter changes.
 * When the URL names none of them, the last choice from this tab is used, else `defaults`
 * (once `ready`, so a head's "My committee" default doesn't flash an unfiltered list first).
 */
export function useServerFilters({ storageKey, keys, defaults = {}, ready = true }: {
  storageKey: string
  keys: readonly string[]
  defaults?: Record<string, string>
  ready?: boolean
}) {
  const [params, setParams] = useSearchParams()
  const memoryKey = 'server-list:' + storageKey
  const owned = useMemo(() => [SEARCH, ...keys], [keys])
  const fromUrl = owned.some(k => params.has(k))
  // Read on every render: update() writes the new choice here before the URL changes.
  const saved = sessionMemory.read<Record<string, string>>(memoryKey)
  const pending = !fromUrl && !saved && !ready
  const source: Record<string, string> = fromUrl
    ? Object.fromEntries(owned.map(k => [k, params.get(k) ?? '']))
    : saved ?? (ready ? defaults : {})
  const values = Object.fromEntries(owned.map(k => [k, typeof source[k] === 'string' ? source[k].slice(0, 200) : ''])) as Record<string, string>
  const signature = JSON.stringify(values)

  // Remember a choice that came from the URL, and mirror a remembered or default choice into the URL so it can be shared.
  useEffect(() => {
    if (pending) return
    const current = JSON.parse(signature) as Record<string, string>
    if (fromUrl) { sessionMemory.write(memoryKey, current); return }
    if (!saved) sessionMemory.write(memoryKey, current)
    if (Object.values(current).some(Boolean)) {
      setParams(prev => { const next = new URLSearchParams(prev); for (const [k, v] of Object.entries(current)) if (v) next.set(k, v); return next }, { replace: true })
    }
  }, [pending, signature, fromUrl, saved === null, memoryKey, setParams])

  const update = useCallback((changes: Record<string, string>, replace = false, drop: readonly string[] = []) => {
    const merged: Record<string, string> = { ...(JSON.parse(signature) as Record<string, string>), ...changes }
    // Saved first: with every filter cleared the URL names none of them, and the page then falls back to this.
    sessionMemory.write(memoryKey, merged)
    setParams(prev => {
      const next = new URLSearchParams(prev)
      for (const k of owned) { if (merged[k]) next.set(k, merged[k]); else next.delete(k) }
      for (const k of drop) next.delete(k)
      next.delete('page')
      return next
    }, { replace })
  }, [setParams, owned, signature, memoryKey])

  // The search box updates on every keystroke; the URL (and the request) follow after a short pause.
  const [input, setInput] = useState(values[SEARCH])
  const written = useRef(values[SEARCH])
  useEffect(() => {
    // Back/forward or a link changed ?q=: show it in the box.
    if (values[SEARCH] !== written.current) { written.current = values[SEARCH]; setInput(values[SEARCH]) }
  }, [values[SEARCH]])
  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed === values[SEARCH]) return
    const timer = setTimeout(() => { written.current = trimmed; update({ [SEARCH]: trimmed }, true) }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input, values[SEARCH], update])

  const set = useCallback((key: string, value: string) => update({ [key]: value }), [update])
  /** Clears the search and filters (not the sort). `alsoDrop` removes other URL params in the same navigation. */
  const clear = useCallback((alsoDrop: readonly string[] = []) => { written.current = ''; setInput(''); update(Object.fromEntries(owned.filter(k => k !== 'sort').map(k => [k, ''])), false, alsoDrop) }, [update, owned])
  const active = owned.some(k => k !== 'sort' && values[k] !== '')
  return { values, query: values[SEARCH], input, setInput, set, clear, active, pending }
}

export type ServerChipGroup = { key: string; label: string; options: { value: string; label: string; count: number }[] }

/**
 * Adapts server-side filter state to the shared ListToolbar, which expects a client filter.
 * Chips and their counts come from the server's facets; the count label comes from `count`.
 */
export function toolbarState(filter: ReturnType<typeof useServerFilters>, groups: ServerChipGroup[], onClear?: () => void): ListFilterState<never> {
  const defs: ListFilterDef<never>[] = groups.map(g => ({ key: g.key, label: g.label, get: () => null }))
  return {
    query: filter.input, setQuery: filter.setInput,
    selected: Object.fromEntries(groups.map(g => [g.key, filter.values[g.key] ?? ''])),
    setFilter: filter.set, clear: onClear ?? (() => filter.clear()), active: filter.active || filter.input.trim() !== '',
    results: [], total: 0, defs,
    options: Object.fromEntries(groups.map(g => [g.key, g.options])),
  }
}

/** Committee chips: "My committee" first (when the viewer has one), then every committee in the results. */
export function committeeChips(facets: UnitFacet[] | undefined, mine: MyUnit[], selected: string): ServerChipGroup {
  const ids = new Set(myCommitteeIds(mine))
  const list = facets ?? []
  const options = ids.size ? [{ value: MY_COMMITTEE, label: 'My committee', count: list.filter(f => ids.has(f.id)).reduce((n, f) => n + f.count, 0) }] : []
  for (const f of list) options.push({ value: f.id, label: f.name, count: f.count })
  // Keep a selected committee visible even when the search leaves it empty, so it can be cleared.
  if (selected && !options.some(o => o.value === selected)) options.push({ value: selected, label: mine.find(u => u.id === selected)?.name ?? 'Selected committee', count: 0 })
  return { key: 'unit', label: 'Committee', options }
}

/** Status chips from a facet map, in a fixed order with readable labels. */
export function stateChips(facets: Record<string, number> | undefined, order: readonly (readonly [string, string])[], selected: string): ServerChipGroup {
  const options = order.filter(([value]) => (facets?.[value] ?? 0) > 0 || value === selected).map(([value, label]) => ({ value, label, count: facets?.[value] ?? 0 }))
  return { key: 'state', label: 'Status', options }
}
