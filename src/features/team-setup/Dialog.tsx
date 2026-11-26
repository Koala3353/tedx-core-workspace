import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'

const focusable = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A modal dialog (or side sheet) with a focus trap. Esc and the close button call onClose,
 * and focus goes back to whatever opened it.
 */
export function Dialog({ title, description, onClose, children, footer, variant = 'dialog', wide = false }: {
  title: string
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  variant?: 'dialog' | 'sheet'
  wide?: boolean
}) {
  const titleId = useId()
  const descriptionId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = panel.current
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(focusable)
    ;(first ?? node)?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      if (opener && opener.isConnected) opener.focus()
    }
  }, [])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.stopPropagation(); close.current(); return }
    if (event.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(focusable)].filter(el => el.offsetParent !== null || el === document.activeElement)
    if (!items.length) { event.preventDefault(); return }
    const first = items[0], last = items[items.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return <div className={`ts-overlay ts-overlay--${variant}`} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close.current() }}>
    <div ref={panel} className={`ts-dialog ts-dialog--${variant}${wide ? ' ts-dialog--wide' : ''}`} role="dialog" aria-modal="true"
      aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="ts-dialog__head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId} className="ts-dialog__description">{description}</p> : null}
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => close.current()}>
          <X className="icon" size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>
      <div className="ts-dialog__body">{children}</div>
      {footer ? <footer className="ts-dialog__foot">{footer}</footer> : null}
    </div>
  </div>
}
