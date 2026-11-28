import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { sessionMemory } from './fold'
import type { ListFilterState } from './useListFilter'
import './list.css'

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** "12 of 64 people" while narrowed, "64 people" otherwise. */
export function countLabel(shown: number, total: number, noun: [string, string]) {
  const word = (n: number) => n === 1 ? noun[0] : noun[1]
  return shown === total ? `${total} ${word(total)}` : `${shown} of ${total} ${word(total)}`
}

/**
 * Search box, filter chips and a live result count for one list. Sticks under the page header while
 * the list scrolls. Press "/" anywhere on the page (outside a field) to jump to the first search box.
 */
export function ListToolbar<T>({ filter, label, placeholder, noun, sort, group, actions, sticky = true, count }: {
  filter: ListFilterState<T>
  /** Accessible name of the search box, e.g. "Search the roster". */
  label: string
  placeholder: string
  noun: [string, string]
  sort?: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }
  group?: { on: boolean; onChange: (on: boolean) => void; label: string }
  actions?: ReactNode
  sticky?: boolean
  /** For server-paged lists: matching rows and the unfiltered total ("12 of 340"). Defaults to the client filter's counts. */
  count?: { shown: number; total: number }
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      // Only the first list search on the page answers, so two toolbars don't fight over the key.
      if (document.querySelector('[data-list-search]') !== input.current || !input.current) return
      event.preventDefault()
      input.current.focus()
      input.current.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const chipGroups = filter.defs.map(def => ({ def, options: filter.options[def.key] ?? [] })).filter(g => g.options.length > 1 || filter.selected[g.def.key])
  // Only the search row sticks (as a direct child of the list's section); the chips scroll away with the page.
  return <>
    <div className={'list-toolbar' + (sticky ? ' list-toolbar--sticky' : '')}>
      <div className="list-toolbar__search" role="search">
        <Search className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />
        <label htmlFor={id} className="visually-hidden">{label}</label>
        <input ref={input} id={id} data-list-search type="search" autoComplete="off" spellCheck={false} placeholder={placeholder}
          value={filter.query} onChange={event => filter.setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape' && filter.query) { event.preventDefault(); filter.setQuery('') } }} />
        <kbd className="list-toolbar__kbd" aria-hidden="true">/</kbd>
      </div>
      {sort ? <label className="list-toolbar__sort"><span className="visually-hidden">{sort.label}</span>
        <select aria-label={sort.label} value={sort.value} onChange={event => sort.onChange(event.target.value)}>
          {sort.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label> : null}
      {group ? <label className="list-toolbar__toggle"><input type="checkbox" checked={group.on} onChange={event => group.onChange(event.target.checked)} />{group.label}</label> : null}
      <p className="list-toolbar__count numeric" role="status" aria-live="polite">{count ? countLabel(count.shown, count.total, noun) : countLabel(filter.results.length, filter.total, noun)}</p>
      {filter.active ? <button type="button" className="button button--quiet list-toolbar__clear" onClick={filter.clear}><X className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Clear</button> : null}
      {actions}
    </div>
    {chipGroups.length ? <div className="list-filters">{chipGroups.map(({ def, options }) => <div key={def.key} className="list-chips" role="group" aria-label={'Filter by ' + def.label.toLowerCase()}>
      <span className="list-chips__label" aria-hidden="true">{def.label}</span>
      <div className="list-chips__scroll">
        <button type="button" className="list-chip" aria-pressed={!filter.selected[def.key]} onClick={() => filter.setFilter(def.key, '')}>All</button>
        {options.map(option => <button key={option.value} type="button" className="list-chip" aria-pressed={filter.selected[def.key] === option.value}
          onClick={() => filter.setFilter(def.key, filter.selected[def.key] === option.value ? '' : option.value)}>
          {option.label}<span className="list-chip__count numeric" aria-label={`, ${option.count}`}>{option.count}</span>
        </button>)}
      </div>
    </div>)}</div> : null}
  </>
}

/** Shown in place of the list when a search or filter leaves nothing. */
export function EmptyResults({ query, noun, onClear }: { query: string; noun: string; onClear: () => void }) {
  return <div className="list-empty" role="status">
    <p>{query.trim() ? <>No {noun} match <strong>{query.trim()}</strong> with these filters.</> : <>No {noun} match these filters.</>}</p>
    <button type="button" className="button button--secondary" onClick={onClear}>Clear search and filters</button>
  </div>
}

export type ListGroup = { key: string; label: string; order?: number }

/**
 * A list split into collapsible groups (usually one per committee), each with its count.
 * Groups open automatically while a search is running so matches are never hidden.
 */
export function GroupedList<T>({ items, groupOf, renderItem, listClassName = 'organization-list', forceOpen = false, storageKey, headingLevel = 3 }: {
  items: T[]
  groupOf: (item: T) => ListGroup
  /** Returns the whole <li>, with its key. */
  renderItem: (item: T) => ReactNode
  listClassName?: string
  forceOpen?: boolean
  storageKey?: string
  headingLevel?: 3 | 4
}) {
  const id = useId()
  const memoryKey = storageKey ? 'list-groups:' + storageKey : null
  const [closed, setClosed] = useState<string[]>(() => (memoryKey ? sessionMemory.read<string[]>(memoryKey) : null) ?? [])
  useEffect(() => { if (memoryKey) sessionMemory.write(memoryKey, closed) }, [memoryKey, closed])

  const groups = new Map<string, ListGroup & { items: T[] }>()
  for (const item of items) {
    const g = groupOf(item)
    const entry = groups.get(g.key) ?? { ...g, items: [] }
    entry.items.push(item)
    groups.set(g.key, entry)
  }
  const ordered = [...groups.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label))
  const toggle = (key: string) => setClosed(list => list.includes(key) ? list.filter(k => k !== key) : [...list, key])
  const allClosed = ordered.every(g => closed.includes(g.key))
  const Heading = headingLevel === 3 ? 'h3' : 'h4'

  return <div className="list-groups">
    {ordered.length > 3 && !forceOpen ? <div className="list-groups__bar">
      <button type="button" className="button button--quiet" onClick={() => setClosed(allClosed ? [] : ordered.map(g => g.key))}>{allClosed ? 'Expand all' : 'Collapse all'}</button>
    </div> : null}
    {ordered.map((group, index) => {
      const open = forceOpen || !closed.includes(group.key)
      const bodyId = `${id}-group-${index}`
      return <section key={group.key} className="list-group">
        <Heading className="list-group__heading">
          <button type="button" className="list-group__toggle" aria-expanded={open} aria-controls={bodyId} disabled={forceOpen} onClick={() => toggle(group.key)}>
            <ChevronDown className="icon list-group__chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="list-group__label">{group.label}</span>
            <span className="list-group__count numeric">{group.items.length}</span>
          </button>
        </Heading>
        <ul id={bodyId} className={listClassName} hidden={!open}>
          {group.items.map(renderItem)}
        </ul>
      </section>
    })}
  </div>
}
