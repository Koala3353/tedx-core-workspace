import { Link } from 'react-router'

/** Official event name: "TEDx" in TED red attached to the event name, same height, tracking 0. */
export const eventName = 'TEDxAteneodeManilaU'

function Wordmark() {
  return <><span className="tedx-lockup__x">TEDx</span><span className="tedx-lockup__name">AteneodeManilaU</span></>
}

/** The TEDx lockup on its own solid tile (black in dark, white in light) with clear space. */
export function TedxLockup({ to, size = 'sm' }: { to?: string; size?: 'sm' | 'lg' }) {
  const className = `tedx-lockup tedx-lockup--${size}`
  return to ? <Link to={to} className={className}><Wordmark /></Link> : <span className={className}><Wordmark /></span>
}

export const licenseLine = 'This independent TEDx event is operated under license from TED.'
