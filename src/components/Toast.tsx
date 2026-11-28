import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import './toast.css'

export type ToastTone = 'success' | 'error' | 'info'
type Entry = { id: number; message: string; tone: ToastTone; leaving: boolean }

/*
 * A tiny module-level toast store: call `toast('Saved')` from anywhere, render <Toaster /> once.
 * Toasts are plain text confirmations; the success animation on the button itself belongs to
 * the celebrate kit. Errors that need action should stay inline next to the form, not here.
 */
let entries: Entry[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => { for (const listener of listeners) listener() }
const MAX = 3

export function toast(message: string, { tone = 'success' }: { tone?: ToastTone } = {}): number {
  const id = nextId++
  // Repeat of the newest message: replace it instead of stacking duplicates.
  entries = [...entries.filter(entry => !(entry.message === message && !entry.leaving)), { id, message, tone, leaving: false }].slice(-MAX)
  emit()
  return id
}

export function dismissToast(id: number) {
  if (!entries.some(entry => entry.id === id && !entry.leaving)) return
  entries = entries.map(entry => entry.id === id ? { ...entry, leaving: true } : entry)
  emit()
  // Exit is faster than enter; remove after it finishes (instantly under reduced motion via CSS).
  window.setTimeout(() => { entries = entries.filter(entry => entry.id !== id); emit() }, 160)
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => entries

const icons = { success: CircleCheck, error: CircleAlert, info: Info }

function ToastItem({ entry }: { entry: Entry }) {
  const [hovered, setHovered] = useState(false)
  const remaining = useRef(entry.tone === 'error' ? 7000 : 4200)
  useEffect(() => {
    if (hovered || entry.leaving) return
    // Pause while the tab is hidden too, so a toast isn't missed.
    let started = Date.now(), timer = 0
    const arm = () => { started = Date.now(); timer = window.setTimeout(() => dismissToast(entry.id), remaining.current) }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { clearTimeout(timer); remaining.current -= Date.now() - started }
      else arm()
    }
    if (document.visibilityState !== 'hidden') arm()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { clearTimeout(timer); remaining.current -= Date.now() - started; document.removeEventListener('visibilitychange', onVisibility) }
  }, [hovered, entry.leaving, entry.id])
  const Icon = icons[entry.tone]
  return <li className={`toast toast--${entry.tone}`} data-leaving={entry.leaving || undefined}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}>
    <Icon className="icon toast__icon" size={18} strokeWidth={1.75} aria-hidden="true" />
    <span className="toast__message">{entry.message}</span>
    <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismissToast(entry.id)}>
      <X className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  </li>
}

/** Render once near the root. Polite live region: confirmations never interrupt screen readers. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot)
  return <ol className="toaster" aria-live="polite" aria-relevant="additions text" aria-label="Notifications">
    {list.map(entry => <ToastItem key={entry.id} entry={entry} />)}
  </ol>
}
