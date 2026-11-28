import { Link } from 'react-router'

/** Official event name: "TEDx" in TED red attached to the event name, same height, tracking 0. */
export const eventName = 'TEDxAteneodeManilaU'

function Wordmark() {
  return <><span className="tedx-lockup__x">TEDx</span><span className="tedx-lockup__name">AteneodeManilaU</span></>
}

/** The TEDx lockup set directly on the page background (white name in dark, black in light), no tile. */
export function TedxLockup({ to, size = 'sm' }: { to?: string; size?: 'sm' | 'lg' }) {
  const className = `tedx-lockup tedx-lockup--${size}`
  const content = size === 'lg' ? <OfficialLogo /> : <Wordmark />
  return to ? <Link to={to} className={className}>{content}</Link> : <span className={className}>{content}</span>
}

/** The official logo with its "x = independently organized TED event" line. Large sizes only: the line is unreadable small. */
function OfficialLogo() {
  const base = import.meta.env.BASE_URL
  // Large lockups sit on the always-black sign-in stage. tedx-logo-on-light.png is the version for white pages.
  return <img className="tedx-logo" src={`${base}brand/tedx-logo-on-dark.png`} width={1200} height={161} alt={`${eventName}, x = independently organized TED event`} />
}

export const licenseLine = 'This independent TEDx event is operated under license from TED.'
