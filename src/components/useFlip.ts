import { useCallback, useLayoutEffect, useRef } from 'react'

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * FLIP move for reorder buttons: the swap happens in state instantly, then the rows that moved
 * glide from their old spot to the new one (transform only, ~220ms, nothing under reduced motion).
 *
 * Mark rows with `data-flip="<group>:<id>"` inside the element `ref` is on, call
 * `capture(group, focusSelector?)` right before the state change. After the swap, focus is put
 * back on `focusSelector` (resolved inside the moved row) if the move dropped it.
 */
export function useFlip<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const pending = useRef<{ group: string; rects: Map<string, number>; focus?: () => HTMLElement | null } | null>(null)

  const capture = useCallback((group: string, focus?: () => HTMLElement | null) => {
    const root = ref.current
    if (!root) return
    const rects = new Map<string, number>()
    root.querySelectorAll<HTMLElement>(`[data-flip^="${group}:"]`).forEach(el => rects.set(el.dataset.flip!, el.getBoundingClientRect().top))
    pending.current = { group, rects, focus }
  }, [])

  useLayoutEffect(() => {
    const job = pending.current
    const root = ref.current
    if (!job || !root) return
    pending.current = null
    const lost = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected
    const target = job.focus?.() ?? null
    if (lost) target?.focus({ preventScroll: true })
    // Keep the control that was pressed on screen: a tall row can move it below the fold.
    if (target) {
      const top = target.getBoundingClientRect().top
      if (top < 80 || top > window.innerHeight - 48) target.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
    }
    if (reducedMotion()) return
    root.querySelectorAll<HTMLElement>(`[data-flip^="${job.group}:"]`).forEach(el => {
      const before = job.rects.get(el.dataset.flip!)
      if (before === undefined) return
      const delta = before - el.getBoundingClientRect().top
      if (Math.abs(delta) < 1) return
      el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' })
    })
  })

  return { ref, capture }
}
