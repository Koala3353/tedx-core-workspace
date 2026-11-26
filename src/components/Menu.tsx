import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'

export type MenuEntry =
  | { kind: 'link'; label: string; to: string; icon?: ReactNode; hint?: string }
  | { kind: 'action'; label: string; onSelect: () => void; icon?: ReactNode; hint?: string; checked?: boolean; quiet?: boolean }
  | { kind: 'separator' }
  | { kind: 'label'; label: ReactNode }

/**
 * A button that opens a small menu anchored to it. Arrow keys move, Escape closes and
 * returns focus, Tab closes. Opens instantly: it is used many times a day.
 */
export function Menu({ trigger, label, entries, align = 'end', className = '', triggerClassName = 'icon-button', tour }: {
  trigger: ReactNode; label: string; entries: MenuEntry[]; align?: 'start' | 'end'; className?: string; triggerClassName?: string; tour?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  function items() { return Array.from(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []) }
  function close(refocus = true) { setOpen(false); if (refocus) button.current?.focus() }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const all = items(), index = all.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') { event.preventDefault(); close() }
    else if (event.key === 'Tab') close(false)
    else if (event.key === 'ArrowDown') { event.preventDefault(); all[(index + 1) % all.length]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); all[(index - 1 + all.length) % all.length]?.focus() }
    else if (event.key === 'Home') { event.preventDefault(); all[0]?.focus() }
    else if (event.key === 'End') { event.preventDefault(); all[all.length - 1]?.focus() }
  }

  return <div className={`menu ${className}`.trim()}>
    <button ref={button} type="button" className={triggerClassName} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} data-tour={tour}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true) } }}>
      {trigger}
    </button>
    {open ? <div ref={list} id={id} className={`menu__list menu__list--${align}`} role="menu" aria-label={label} onKeyDown={keys}>
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') return <div key={index} className="menu__separator" role="separator" />
        if (entry.kind === 'label') return <div key={index} className="menu__label" role="presentation">{entry.label}</div>
        const content = <>{entry.icon ? <span className="menu__icon" aria-hidden="true">{entry.icon}</span> : null}<span className="menu__text">{entry.label}{entry.hint ? <span className="menu__hint">{entry.hint}</span> : null}</span></>
        if (entry.kind === 'link') return <Link key={index} className="menu__item" role="menuitem" tabIndex={-1} to={entry.to} onClick={() => close(false)}>{content}</Link>
        return <button key={index} type="button" className={`menu__item${entry.quiet ? ' menu__item--quiet' : ''}`} tabIndex={-1}
          role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={entry.checked}
          onClick={() => { close(); entry.onSelect() }}>{content}</button>
      })}
    </div> : null}
  </div>
}
