import { useState, type CSSProperties } from 'react'
import { eventName } from './TedxLockup'

/**
 * The workspace loader: "TED" rises letter by letter, the red x draws itself, then a thin red
 * line sweeps underneath until the app is ready. The same markup and classes are used by the
 * static boot screen in index.html (styles in public/boot.css), so the hand-off from boot to
 * React does not flash. --boot-t shifts every animation by the time since page start, so a
 * loader mounted mid-load continues the static one instead of replaying the intro. It never
 * delays anything: it is shown only while something else is loading.
 */
export function BrandLoader({ label = 'Opening the workspace' }: { label?: string }) {
  const [offset] = useState(() => ({ '--boot-t': `${-Math.round(performance.now())}ms` }) as CSSProperties)
  return <div className="boot-loader" role="status" aria-live="polite" style={offset}>
    <span className="boot-loader__mark" aria-hidden="true">
      <span className="boot-loader__ted"><span className="boot-loader__l"><span>T</span></span><span className="boot-loader__l"><span>E</span></span><span className="boot-loader__l"><span>D</span></span></span>
      <svg className="boot-loader__x" viewBox="0 0 10 10" focusable="false"><path pathLength={1} d="M1.5 1.5 8.5 8.5" /><path pathLength={1} d="M8.5 1.5 1.5 8.5" /></svg>
    </span>
    <span className="boot-loader__line" aria-hidden="true" />
    <span className="visually-hidden">{label} · {eventName}</span>
  </div>
}

/** Full-screen variant for route hydration and session checks. */
export function BootScreen({ label }: { label?: string }) {
  return <main className="boot-screen"><BrandLoader label={label} /></main>
}

/** Placeholder rows shaped like list rows: title, meta line and a verb button. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return <ul className="skeleton-rows" aria-hidden="true">
    {Array.from({ length: rows }, (_, index) => <li key={index} className="skeleton-row">
      <span className="skeleton-row__text"><span className="skeleton-bar skeleton-bar--title" /><span className="skeleton-bar skeleton-bar--meta" /></span>
      <span className="skeleton-bar skeleton-bar--verb" />
    </li>)}
  </ul>
}
