import { useEffect, useRef } from 'react'

/**
 * Calls `refresh` when the window regains focus or the tab becomes visible again,
 * so pages stay current without a manual reload button. Throttled to once per `minGapMs`.
 * Pass `paused` while a form is mid-submit to avoid refetching under the user.
 */
export function useAutoRefresh(refresh: () => void, { paused = false, minGapMs = 15_000 }: { paused?: boolean; minGapMs?: number } = {}): void {
  const latest = useRef(refresh)
  const pausedRef = useRef(paused)
  const last = useRef(0)
  useEffect(() => { latest.current = refresh; pausedRef.current = paused })
  useEffect(() => {
    const run = () => {
      if (pausedRef.current || document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - last.current < minGapMs) return
      last.current = now
      latest.current()
    }
    const onVisibility = () => { if (document.visibilityState === 'visible') run() }
    last.current = Date.now()
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', onVisibility) }
  }, [minGapMs])
}
