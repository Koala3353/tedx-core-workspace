import { useState, type CSSProperties } from 'react'

/*
 * The workspace loader: a short title sequence on a black stage. Letterbox bars part, a stage
 * light strikes from above, "TED" pulls into focus, the red x draws in two strokes and blooms,
 * then "AteneodeManilaU" tracks in. While loading continues, the light breathes and a glint
 * passes over the lockup now and then. Styles live in public/boot.css and the same markup is
 * served as the static boot screen in index.html, so the hand-off from boot to React does not
 * flash. It never delays anything: it is shown only while something else is loading, and only
 * after a 250ms delay so fast loads never flash.
 */

const NAME = 'AteneodeManilaU'

/**
 * --boot-t shifts every animation delay. While the static boot screen from index.html is still on
 * the page (React has not committed over it yet), the loader continues that screen's timeline:
 * minus the time since page start, so the intro does not replay. Any later loader starts its own
 * sequence from zero, show delay included.
 */
function useBootClock(): CSSProperties {
  const [style] = useState(() => {
    const continuesStaticBoot = document.querySelector('.boot-screen--static') !== null
    return { '--boot-t': `${continuesStaticBoot ? -Math.round(performance.now()) : 0}ms` } as CSSProperties
  })
  return style
}

export function BrandLoader({ label = 'Loading' }: { label?: string }) {
  const clock = useBootClock()
  return <div className="boot-loader" role="status" aria-label={label} style={clock}>
    <span className="boot-loader__mark" aria-hidden="true">
      <span className="boot-loader__ted"><span>T</span><span>E</span><span>D</span></span>
      <span className="boot-loader__x">
        <svg className="boot-loader__glow" viewBox="0 0 10 10" focusable="false"><path pathLength={1} d="M1 0 9 10M9 0 1 10" /></svg>
        <svg viewBox="0 0 10 10" focusable="false"><path pathLength={1} d="M1 0 9 10" /><path pathLength={1} d="M9 0 1 10" /></svg>
      </span>
      <span className="boot-loader__name">{NAME.split('').map((letter, index) => <span key={index}>{letter}</span>)}</span>
      <span className="boot-loader__glint" />
    </span>
  </div>
}

/** Full-screen variant for route hydration and session checks: the lockup on a lit, letterboxed stage. */
export function BootScreen({ label }: { label?: string }) {
  const clock = useBootClock()
  return <main className="boot-screen" style={clock}>
    <div className="boot-stage" aria-hidden="true">
      <span className="boot-stage__beam" />
      <span className="boot-stage__pool" />
      <span className="boot-stage__vignette" />
      <span className="boot-stage__bar boot-stage__bar--top" />
      <span className="boot-stage__bar boot-stage__bar--bottom" />
    </div>
    <BrandLoader label={label} />
  </main>
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
