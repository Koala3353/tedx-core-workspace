import { useCallback, useEffect, useState } from 'react'
import { fold, matchesWords, sessionMemory } from './fold'

type Value = string | null | undefined

export type ListFilterDef<T> = {
  /** Stable key, also used in sessionStorage. */
  key: string
  /** Group label shown before the chips, e.g. "Committee". */
  label: string
  /** The value(s) an item has for this filter. An item with several values matches any of them. */
  get: (item: T) => Value | Value[]
  /** Fixed chip order and labels. When left out, chips come from the items, sorted by label. */
  options?: { value: string; label: string }[]
  /** Label for items with no value (shown as its own chip when some items have none). */
  noneLabel?: string
  /** Derived chips to pin to the front, e.g. "Leadership" before the committees. */
  first?: string[]
}

export type ListFilterOption = { value: string; label: string; count: number }

export type ListFilterState<T> = {
  query: string
  setQuery: (query: string) => void
  selected: Record<string, string>
  setFilter: (key: string, value: string) => void
  clear: () => void
  /** True when a search or a filter is narrowing the list. */
  active: boolean
  results: T[]
  total: number
  defs: ListFilterDef<T>[]
  /** Chips per filter, with how many items match each chip given the other active filters and the search. */
  options: Record<string, ListFilterOption[]>
}

const NONE = '__none'
const rank = <T,>(def: ListFilterDef<T>, value: string) => { const at = def.first?.indexOf(value) ?? -1; return at < 0 ? Infinity : at }
const valuesOf = <T,>(def: ListFilterDef<T>, item: T) => {
  const raw = def.get(item)
  const list = (Array.isArray(raw) ? raw : [raw]).filter((v): v is string => typeof v === 'string' && v !== '')
  return list.length ? list : [NONE]
}

/**
 * Client-side search and filter chips over a list the page already loaded.
 * Search is case and accent-insensitive and matches every word anywhere in `text(item)`.
 * With `storageKey`, the last search and filters are remembered for this browser tab.
 */
export function useListFilter<T>(items: T[], { text, filters = [], storageKey, initial }: {
  text: (item: T) => Value[]
  filters?: ListFilterDef<T>[]
  storageKey?: string
  initial?: Record<string, string>
}): ListFilterState<T> {
  const memoryKey = storageKey ? 'list-filter:' + storageKey : null
  const [state, setState] = useState<{ query: string; selected: Record<string, string> }>(() => {
    const saved = memoryKey ? sessionMemory.read<{ query?: unknown; selected?: unknown }>(memoryKey) : null
    const selected = saved && saved.selected && typeof saved.selected === 'object' ? saved.selected as Record<string, string> : { ...initial }
    return { query: typeof saved?.query === 'string' ? saved.query : '', selected }
  })
  useEffect(() => { if (memoryKey) sessionMemory.write(memoryKey, state) }, [memoryKey, state])

  const setQuery = useCallback((query: string) => setState(s => ({ ...s, query })), [])
  const setFilter = useCallback((key: string, value: string) => setState(s => ({ ...s, selected: { ...s.selected, [key]: value } })), [])
  const clear = useCallback(() => setState({ query: '', selected: {} }), [])

  // Lists here stay in the low hundreds, so recomputing on render is cheaper than tracking inline callbacks.
  const indexed = items.map(item => ({ item, text: fold(text(item).filter(Boolean).join(' ')), values: filters.map(def => valuesOf(def, item)) }))
  // A remembered filter whose value no longer exists (an archived committee, say) is ignored, not stuck on.
  const want = filters.map((def, i) => {
    const value = state.selected[def.key]
    return value && indexed.some(row => row.values[i].includes(value)) ? value : ''
  })
  const { results, options } = (() => {
    const searched = indexed.filter(row => matchesWords(row.text, state.query))
    const pass = (row: typeof indexed[number], skip: number) => filters.every((_def, i) => {
      if (i === skip || !want[i]) return true
      return row.values[i].includes(want[i])
    })
    const options: Record<string, ListFilterOption[]> = {}
    filters.forEach((def, i) => {
      const counts = new Map<string, number>()
      for (const row of searched) if (pass(row, i)) for (const v of new Set(row.values[i])) counts.set(v, (counts.get(v) ?? 0) + 1)
      const all = new Map<string, string>()
      for (const row of indexed) for (const v of row.values[i]) if (!all.has(v)) all.set(v, v)
      const base = def.options
        ? def.options.filter(o => all.has(o.value))
        : [...all.keys()].filter(v => v !== NONE).sort((a, b) => rank(def, a) - rank(def, b) || a.localeCompare(b)).map(v => ({ value: v, label: v }))
      const withNone = all.has(NONE) && def.noneLabel ? [...base, { value: NONE, label: def.noneLabel }] : base
      options[def.key] = withNone.map(o => ({ ...o, count: counts.get(o.value) ?? 0 }))
    })
    return { results: searched.filter(row => pass(row, -1)).map(row => row.item), options }
  })()

  const active = !!state.query.trim() || want.some(Boolean)
  const selected = Object.fromEntries(filters.map((def, i) => [def.key, want[i]]))
  return { query: state.query, setQuery, selected, setFilter, clear, active, results, total: items.length, defs: filters, options }
}
