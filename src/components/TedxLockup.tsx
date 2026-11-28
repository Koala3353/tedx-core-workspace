import { Link } from 'react-router'

/** Official event name: "TEDx" in TED red attached to the event name, same height, tracking 0. */
export const eventName = 'TEDxAteneodeManilaU'

const alt = `${eventName}, x = independently organized TED event`
// The official logo file, uncropped (public/brand). On dark grounds the name is white; on light grounds
// the same artwork with the name in near-black. The red is untouched in both.
const width = 2087, height = 322

/** The official TEDx logo set directly on the page background, no tile, at the full artwork. */
export function TedxLockup({ to, size = 'sm' }: { to?: string; size?: 'sm' | 'lg' }) {
  const className = `tedx-lockup tedx-lockup--${size}`
  const content = <OfficialLogo priority={size === 'lg'} />
  return to ? <Link to={to} className={className} aria-label={alt}>{content}</Link> : <span className={className}>{content}</span>
}

function OfficialLogo({ priority }: { priority: boolean }) {
  const base = import.meta.env.BASE_URL
  return <>
    <img className="tedx-logo tedx-logo--on-dark" src={`${base}brand/tedx-logo-on-dark.png`} width={width} height={height}
      fetchPriority={priority ? 'high' : 'auto'} decoding="async" alt={alt} />
    <img className="tedx-logo tedx-logo--on-light" src={`${base}brand/tedx-logo-on-light.png`} width={width} height={height}
      decoding="async" alt="" aria-hidden="true" />
  </>
}

export const licenseLine = 'This independent TEDx event is operated under license from TED.'
