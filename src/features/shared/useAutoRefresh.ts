import { useEffect, useRef } from 'react'
import { onPageReturn } from '../../lib/pageReturn'

// Last time this person touched the page. Shared by every poller, so one listener set serves all.
let lastActivity = Date.now()
let tracking = false
function trackActivity() {
  if (tracking || typeof window === 'undefined') return
  tracking = true
  const mark = () => { lastActivity = Date.now() }
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const) window.addEventListener(type, mark, { passive: true, capture: true })
}

/**
 * Delay before the next background poll. Backs off while the person is idle (an open tab
 * nobody is looking at should not cost the same as one in use) and adds ±20% jitter so many
 * people who opened the app at the same moment don't all hit the database on the same second.
 */
export function pollDelay(baseMs: number, now = Date.now(), random = Math.random()): number {
  const idle = now - lastActivity
  const factor = idle > 15 * 60_000 ? 8 : idle > 5 * 60_000 ? 4 : idle > 2 * 60_000 ? 2 : 1
  const delay = Math.min(baseMs * factor, Math.max(baseMs, 5 * 60_000))
  return Math.round(delay * (0.8 + 0.4 * random))
}

/**
 * Calls `refresh` when the person comes back to the tab (focus and visibility are deduped),
 * so pages stay current without a manual reload button. Throttled to once per `minGapMs`.
 * With `intervalMs`, also polls in the background: only while the tab is visible and online,
 * with jitter, and slower while the person is idle (see pollDelay).
 * Pass `paused` while a form is open or mid-submit to avoid refetching under the user.
 * Callers must refresh in place: keep showing the current data until the new data arrives.
 */
export function useAutoRefresh(refresh: () => void, { paused = false, minGapMs = 15_000, intervalMs }: { paused?: boolean; minGapMs?: number; intervalMs?: number } = {}): void {
  const latest = useRef(refresh)
  const pausedRef = useRef(paused)
  useEffect(() => { latest.current = refresh; pausedRef.current = paused })
  useEffect(() => onPageReturn(() => { if (!pausedRef.current) latest.current() }, { minGapMs }), [minGapMs])
  useEffect(() => {
    if (!intervalMs) return
    trackActivity()
    let timer: number | undefined
    const tick = () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false && !pausedRef.current) latest.current()
      timer = window.setTimeout(tick, pollDelay(intervalMs))
    }
    timer = window.setTimeout(tick, pollDelay(intervalMs))
    return () => window.clearTimeout(timer)
  }, [intervalMs])
}
