/**
 * Calls `callback` once when the person comes back to the page.
 *
 * Returning to a tab fires both `visibilitychange` and `focus`, often a few milliseconds
 * apart, and some browsers fire `focus` again when a native picker or the keyboard closes.
 * Both events share one throttle here, so a return triggers one refresh, not two.
 */
export function onPageReturn(callback: () => void, { minGapMs = 15_000 }: { minGapMs?: number } = {}): () => void {
  let last = Date.now()
  const run = () => {
    if (document.visibilityState !== 'visible') return
    const now = Date.now()
    if (now - last < minGapMs) return
    last = now
    callback()
  }
  window.addEventListener('focus', run)
  document.addEventListener('visibilitychange', run)
  return () => { window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', run) }
}
