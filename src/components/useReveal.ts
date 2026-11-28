import { useEffect, useRef } from 'react'

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * For panels and editors that open away from the button that opened them: on mount, bring the
 * element into view (smoothly, unless reduced motion is on) and move focus to its heading, so
 * the person sees and hears that something opened. Does nothing when it's already fully visible
 * except move focus.
 */
export function revealElement(node: HTMLElement | null, { focus = true }: { focus?: boolean } = {}) {
  if (!node) return
  const rect = node.getBoundingClientRect()
  const header = 76 // sticky header + breathing room; matches scroll-margin in global.css
  const visible = rect.top >= header && rect.top < window.innerHeight - 120
  if (!visible) node.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
  if (!focus) return
  const target = node.querySelector<HTMLElement>('[data-reveal-focus], h2, h3, legend') ?? node
  if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
}

export function useRevealOnMount<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!enabled) return
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    // Next frame: let the layout settle (fonts, sibling panels) before measuring.
    const frame = requestAnimationFrame(() => revealElement(ref.current))
    return () => {
      cancelAnimationFrame(frame)
      // Closing (cancel or success) hands focus back to whatever opened it, if it's still there
      // and focus would otherwise fall to <body>.
      const lost = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [enabled])
  return ref
}
