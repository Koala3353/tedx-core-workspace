import { eventName } from './TedxLockup'

/**
 * The workspace loader: the TEDx wordmark with a thin red line drawing across beneath it.
 * The same markup and classes are used by the static boot screen in index.html
 * (styles in public/boot.css), so the hand-off from boot to React does not flash.
 */
export function BrandLoader({ label = 'Opening the workspace' }: { label?: string }) {
  return <div className="boot-loader" role="status" aria-live="polite">
    <span className="boot-loader__mark" aria-hidden="true"><span className="boot-loader__x">TEDx</span></span>
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
