import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import type { DirectoryMember } from './api'

export const sampleOptionId = 'sample'

export type PreviewOption = { id: string; label: string; meta: string; member?: DirectoryMember }

export const sampleOption: PreviewOption = { id: sampleOptionId, label: 'Sample member', meta: 'Example data, not a real person' }

export function memberOption(member: DirectoryMember): PreviewOption {
  const meta = [member.committee ?? 'No committee yet', member.position, member.signedIn ? null : 'Not signed in yet'].filter(Boolean).join(' · ')
  return { id: member.membershipId, label: member.name + (member.isSelf ? ' (you)' : ''), meta, member }
}

function matches(option: PreviewOption, words: string[]) {
  const m = option.member
  const haystack = (m ? [m.name, m.committee, m.committeeCode, m.position] : [option.label]).filter(Boolean).join(' ').toLowerCase()
  return words.every(word => haystack.includes(word))
}

/**
 * Type-ahead picker over the roster (name, committee, position). Follows the ARIA 1.2 combobox
 * pattern: the input owns a listbox, arrows move the active option, Enter picks, Escape closes.
 */
export function MemberCombobox({ label, options, selectedId, onSelect, disabled = false }: {
  label: string
  options: PreviewOption[]
  selectedId: string
  onSelect: (option: PreviewOption) => void
  disabled?: boolean
}) {
  const id = useId()
  const inputId = id + '-input'
  const listId = id + '-list'
  const optionId = (index: number) => `${id}-option-${index}`
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const selected = options.find(option => option.id === selectedId) ?? sampleOption
  const filtered = useMemo(() => {
    const words = (query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    return words.length ? options.filter(option => matches(option, words)) : options
  }, [options, query])
  const current = Math.min(active, Math.max(filtered.length - 1, 0))

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, current])

  function show() {
    if (open) return
    setActive(Math.max(filtered.findIndex(option => option.id === selectedId), 0))
    setOpen(true)
  }
  function close() {
    setOpen(false)
    setQuery(null)
  }
  function pick(option: PreviewOption | undefined) {
    if (!option) return
    close()
    if (option.id !== selectedId) onSelect(option)
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = filtered.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) show()
        else setActive(current >= last ? 0 : current + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (!open) show()
        else setActive(current <= 0 ? last : current - 1)
        break
      case 'Home':
      case 'End':
        if (!open || query) return
        event.preventDefault()
        setActive(event.key === 'Home' ? 0 : last)
        break
      case 'Enter':
        if (!open) return
        event.preventDefault()
        pick(filtered[current])
        break
      case 'Escape':
        if (!open && query === null) return
        event.preventDefault()
        close()
        break
      case 'Tab':
        close()
        break
    }
  }

  const expanded = open && !disabled
  return <div className="view-as-combobox">
    <label className="view-as-combobox__label" htmlFor={inputId}>{label}</label>
    <div className="view-as-combobox__control">
      <input
        id={inputId}
        className="view-as-combobox__input"
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && filtered.length ? optionId(current) : undefined}
        aria-describedby={id + '-meta'}
        disabled={disabled}
        value={query ?? selected.label}
        placeholder="Type a name, committee or position"
        onFocus={event => event.currentTarget.select()}
        onClick={show}
        onBlur={close}
        onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true) }}
        onKeyDown={onKeyDown}
      />
      <ChevronDown className="icon view-as-combobox__chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
    </div>
    <span id={id + '-meta'} className="view-as-combobox__meta">{selected.meta}</span>
    <ul id={listId} ref={listRef} className="view-as-combobox__list" role="listbox" aria-label={label} hidden={!expanded}>
      {filtered.map((option, index) => <li
        key={option.id}
        id={optionId(index)}
        data-index={index}
        role="option"
        aria-selected={option.id === selectedId}
        className={'view-as-combobox__option' + (index === current ? ' is-active' : '')}
        onMouseDown={event => event.preventDefault()}
        onMouseMove={() => { if (index !== current) setActive(index) }}
        onClick={() => pick(option)}
      >
        <span className="view-as-combobox__name">{option.label}</span>
        <span className="view-as-combobox__option-meta">{option.meta}</span>
      </li>)}
      {!filtered.length ? <li className="view-as-combobox__empty" role="presentation">No one matches. Try a shorter name or a committee.</li> : null}
    </ul>
  </div>
}
