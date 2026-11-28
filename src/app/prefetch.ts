import { stripBase } from '../lib/basePath'

/**
 * Warms route chunks before they are needed: when a pointer rests on, a finger lands on, or
 * focus reaches a link to a lazy page, and once the browser is idle after the first render.
 * Only downloads (and evaluates) code; no data is read. Skipped on Save-Data and 2G.
 */
export type Preload = () => Promise<unknown>
type Rule = readonly [pattern: RegExp, preload: Preload]

function constrained(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return !!connection && (connection.saveData === true || /(?:^|-)2g$/.test(connection.effectiveType ?? ''))
}

function whenIdle(task: () => void, timeout = 4000) {
  const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(task, { timeout })
  else window.setTimeout(task, 1500)
}

const warmed = new Set<Preload>()
function warm(preload: Preload) {
  if (warmed.has(preload)) return
  warmed.add(preload)
  // A failed prefetch is forgotten so a real visit retries (and recovers) normally.
  preload().catch(() => warmed.delete(preload))
}

/** Delegated listeners for every same-app link, plus an idle warm-up of the likely next pages. */
export function installRoutePrefetch(rules: readonly Rule[], onIdle: readonly Preload[]): () => void {
  if (typeof document === 'undefined') return () => {}
  const forPath = (path: string) => rules.find(([pattern]) => pattern.test(path))?.[1]
  const onIntent = (event: Event) => {
    if (constrained()) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor || anchor.origin !== window.location.origin || anchor.target === '_blank') return
    const preload = forPath(stripBase(anchor.pathname))
    if (preload) warm(preload)
  }
  const options = { passive: true, capture: true } as const
  for (const type of ['pointerover', 'focusin', 'touchstart'] as const) document.addEventListener(type, onIntent, options)
  // Signed-out visitors on the sign-in pages don't need workspace pages yet.
  whenIdle(() => { if (!constrained() && !/^\/(?:login|auth|guest)(?:\/|$)/.test(stripBase(window.location.pathname))) onIdle.forEach(warm) })
  return () => { for (const type of ['pointerover', 'focusin', 'touchstart'] as const) document.removeEventListener(type, onIntent, options) }
}
