import { useRef, type KeyboardEvent } from 'react'
import './shared.css'

export type ViewTab<T extends string> = { value: T; label: string; count?: number | null }

/** Views as tabs with counts. Arrow keys move between tabs. */
export function ViewTabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: ViewTab<T>[]; value: T; onChange: (value: T) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = (index + step + tabs.length) % tabs.length
    onChange(tabs[next].value)
    refs.current[next]?.focus()
  }
  return <div className="view-tabs" role="tablist" aria-label={label}>{tabs.map((tab, index) => {
    const selected = tab.value === value
    return <button key={tab.value} ref={node => { refs.current[index] = node }} type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} className="view-tabs__tab" onClick={() => onChange(tab.value)} onKeyDown={event => onKey(event, index)}>
      {tab.label}{typeof tab.count === 'number' ? <span className="view-tabs__count">{tab.count}</span> : null}
    </button>
  })}</div>
}
