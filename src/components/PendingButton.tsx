import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

/**
 * Pending state for a click that does network work. `run(fn)` flips `pending` on in the same
 * event, so the button reacts on press, and ignores repeat presses until the work settles.
 */
export function usePending() {
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined
    busy.current = true
    setPending(true)
    try { return await work() }
    finally { busy.current = false; if (live.current) setPending(false) }
  }, [])
  return { pending, run }
}

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  /** Async work. The button shows its pending state until the promise settles. */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => unknown
  /** Externally controlled pending state (for example a form submit or a hook's `busy`). */
  pending?: boolean
  /** Label while pending, e.g. "Saving…". Defaults to the normal label. */
  pendingLabel?: ReactNode
  children: ReactNode
}

/**
 * A button that shows a spinner, aria-busy and disabled while its work runs.
 * Keeps its width while pending so the layout doesn't jump.
 */
export function PendingButton({ onClick, pending: controlled, pendingLabel, children, className = 'button', disabled, type = 'button', ...rest }: Props) {
  const own = usePending()
  const pending = controlled ?? own.pending
  return <button {...rest} type={type} className={className} disabled={disabled || pending} aria-busy={pending || undefined}
    data-pending={pending || undefined}
    onClick={onClick ? event => { const result = onClick(event); if (result instanceof Promise) void own.run(() => result) } : undefined}>
    {pending ? <span className="pending-spinner" aria-hidden="true" /> : null}
    <span className="pending-label">{pending && pendingLabel ? pendingLabel : children}</span>
  </button>
}

/** Inline spinner + label for buttons that aren't PendingButton (keeps markup consistent). */
export function Pending({ when, label, children }: { when: boolean; label?: ReactNode; children: ReactNode }) {
  return <>{when ? <span className="pending-spinner" aria-hidden="true" /> : null}{when && label ? label : children}</>
}
