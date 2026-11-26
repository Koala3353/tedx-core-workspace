import { useEffect, useRef } from 'react'
import { onPageReturn } from '../../lib/pageReturn'

/**
 * Calls `refresh` when the person comes back to the tab (focus and visibility are deduped),
 * so pages stay current without a manual reload button. Throttled to once per `minGapMs`.
 * Pass `paused` while a form is open or mid-submit to avoid refetching under the user.
 * Callers must refresh in place: keep showing the current data until the new data arrives.
 */
export function useAutoRefresh(refresh: () => void, { paused = false, minGapMs = 15_000 }: { paused?: boolean; minGapMs?: number } = {}): void {
  const latest = useRef(refresh)
  const pausedRef = useRef(paused)
  useEffect(() => { latest.current = refresh; pausedRef.current = paused })
  useEffect(() => onPageReturn(() => { if (!pausedRef.current) latest.current() }, { minGapMs }), [minGapMs])
}
