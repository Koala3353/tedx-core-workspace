import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { matchesWords } from './fold'
import './search-select.css'

export type SearchOption = {
  value: string
  label: string
  /** Second line, e.g. "Logistics · Core". Also searched. */
  meta?: string
  /** Options with the same group are listed together under that heading, in first-seen order. */
  group?: string
  /** Extra words to match that aren't shown (email, committee code). */
  keywords?: string
  disabled?: boolean
}

/**
 * Searchable stand-in for a native <select> with many options (people, deliverables, tasks).
 * ARIA 1.2 combobox: the input owns a listbox; arrows move, Enter picks, Escape closes, Tab leaves.
 * Pass `name` and it submits the chosen value through a hidden input, exactly like the select it replaces.
 * Controlled with `value` + `onChange`, or uncontrolled with `defaultValue`.
 */
export function SearchSelect({
  id: givenId, name, label, options, value, defaultValue = '', onChange, required = false, disabled = false,
  placeholder = 'Type to search', emptyText = 'Nothing matches. Try fewer letters.', showMeta = true, className = '', hint,
  'aria-label': ariaLabel, 'aria-describedby': describedBy,
}: {
  id?: string
  name?: string
  /** Visible label. Leave out when the page already has a <label htmlFor={id}>. */
  label?: ReactNode
  options: SearchOption[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  required?: boolean
  disabled?: boolean
  placeholder?: string
  emptyText?: string
  showMeta?: boolean
  className?: string
  hint?: ReactNode
  'aria-label'?: string
  'aria-describedby'?: string
}) {
  const auto = useId()
  const inputId = givenId ?? auto + '-input'
  const listId = auto + '-list'
  const metaId = auto + '-meta'
  const optionId = (index: number) => `${auto}-option-${index}`
  const listRef = useRef<HTMLUListElement>(null)
  const [own, setOwn] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const current = value ?? own
  const selected = options.find(option => option.value === current)
  const filtered = query?.trim()
    ? options.filter(option => matchesWords([option.label, option.meta, option.group, option.keywords].filter(Boolean).join(' '), query))
    : options
  // Display order: grouped by first appearance, so the flat index matches what is on screen.
  const groups: { name: string; items: { option: SearchOption; index: number }[] }[] = []
  for (const option of filtered) {
    const key = option.group ?? ''
    let group = groups.find(g => g.name === key)
    if (!group) { group = { name: key, items: [] }; groups.push(group) }
    group.items.push({ option, index: -1 })
  }
  const flat: SearchOption[] = []
  for (const group of groups) for (const item of group.items) { item.index = flat.length; flat.push(item.option) }
  const enabled = flat.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0)
  const cursor = enabled.includes(active) ? active : enabled[0] ?? -1

  useEffect(() => {
    if (!open || cursor < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, cursor])

  function show() {
    if (open || disabled) return
    const at = flat.findIndex(option => option.value === current)
    setActive(at >= 0 ? at : enabled[0] ?? 0)
    setOpen(true)
  }
  function close() { setOpen(false); setQuery(null) }
  function pick(option: SearchOption | undefined) {
    if (!option || option.disabled) return
    close()
    if (option.value === current) return
    if (value === undefined) setOwn(option.value)
    onChange?.(option.value)
  }
  function step(by: number) {
    if (!enabled.length) return
    const at = enabled.indexOf(cursor)
    setActive(enabled[(at + by + enabled.length) % enabled.length])
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); if (!open) show(); else step(1); break
      case 'ArrowUp': event.preventDefault(); if (!open) show(); else step(-1); break
      case 'PageDown': if (open) { event.preventDefault(); step(8) } break
      case 'PageUp': if (open) { event.preventDefault(); step(-8) } break
      case 'Home': case 'End':
        if (!open || query) return
        event.preventDefault(); setActive(event.key === 'Home' ? enabled[0] ?? 0 : enabled[enabled.length - 1] ?? 0); break
      case 'Enter':
        if (!open) return
        event.preventDefault(); pick(flat[cursor]); break
      case 'Escape':
        if (!open && query === null) return
        event.preventDefault(); close(); break
      case 'Tab': close(); break
    }
  }

  const expanded = open && !disabled
  const meta = showMeta && selected?.meta && query === null ? selected.meta : null
  const describedByAll = [meta ? metaId : null, describedBy].filter(Boolean).join(' ') || undefined
  const renderOption = ({ option, index }: { option: SearchOption; index: number }) => <li
    key={option.value + ':' + index}
    id={optionId(index)}
    data-index={index}
    role="option"
    aria-selected={option.value === current}
    aria-disabled={option.disabled || undefined}
    className={'search-select__option' + (index === cursor ? ' is-active' : '')}
    onMouseDown={event => event.preventDefault()}
    onMouseMove={() => { if (index !== cursor && !option.disabled) setActive(index) }}
    // preventDefault stops a wrapping <label> from re-clicking the input and reopening the list.
    onClick={event => { event.preventDefault(); pick(option) }}
  >
    <span className="search-select__name">{option.label || ' '}</span>
    {option.meta ? <span className="search-select__meta">{option.meta}</span> : null}
  </li>

  return <div className={'search-select ' + className}>
    {label ? <label className="search-select__label" htmlFor={inputId}>{label}</label> : null}
    <div className="search-select__control">
      <input
        id={inputId}
        className="search-select__input"
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && cursor >= 0 ? optionId(cursor) : undefined}
        aria-describedby={describedByAll}
        aria-label={ariaLabel}
        required={required}
        disabled={disabled}
        value={query ?? selected?.label ?? ''}
        placeholder={placeholder}
        onFocus={event => event.currentTarget.select()}
        onClick={show}
        onBlur={close}
        // Typing a query is not a change of value: keep it from reaching a parent form's onChange.
        onChange={event => { event.stopPropagation(); setQuery(event.target.value); setActive(0); setOpen(true) }}
        onKeyDown={onKeyDown}
      />
      <ChevronDown className="icon search-select__chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
    </div>
    {name ? <input type="hidden" name={name} value={current} disabled={disabled} /> : null}
    {meta ? <span id={metaId} className="search-select__selected-meta">{meta}</span> : null}
    {hint}
    <ul id={listId} ref={listRef} className="search-select__list" role="listbox" aria-label={typeof label === 'string' ? label : ariaLabel} hidden={!expanded}>
      {groups.map((group, g) => group.name
        ? <li key={'g' + g} role="presentation">
          <div id={`${auto}-group-${g}`} className="search-select__group" aria-hidden="true">{group.name}<span className="numeric">{group.items.length}</span></div>
          <ul role="group" aria-labelledby={`${auto}-group-${g}`}>{group.items.map(renderOption)}</ul>
        </li>
        : group.items.map(renderOption))}
      {!flat.length ? <li className="search-select__empty" role="presentation">{emptyText}</li> : null}
    </ul>
    {expanded && query?.trim() ? <span className="visually-hidden" role="status">{flat.length === 1 ? '1 match' : flat.length + ' matches'}</span> : null}
  </div>
}
