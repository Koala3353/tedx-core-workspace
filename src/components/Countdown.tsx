import { useEffect, useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import { eventDay, manilaDay } from '../features/timeline/dates'
import { eventName } from './TedxLockup'

const dayMs = 86_400_000
const eventLabel = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(eventDay + 'T00:00:00Z'))

/** Whole days from today in Manila to the event day; negative after the event. */
function daysToEvent(now = new Date()): number {
  const today = manilaDay(now.toISOString())
  return Math.round((Date.parse(eventDay + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / dayMs)
}

function useDaysToEvent() {
  const [days, setDays] = useState(daysToEvent)
  useEffect(() => {
    const timer = window.setInterval(() => setDays(daysToEvent()), 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])
  return days
}

export function Countdown({ variant = 'sidebar' }: { variant?: 'sidebar' | 'hero' | 'overview' }) {
  const days = useDaysToEvent()
  const className = `countdown countdown--${variant === 'sidebar' ? 'sidebar' : 'hero'}${variant === 'overview' ? ' countdown--overview' : ''}`
  const date = <time dateTime={eventDay}>{eventLabel}</time>
  if (days < 0) return variant === 'sidebar' ? null : <div className={className}><p className="countdown__caption">Thank you for making <strong>{eventName}</strong> happen · {date}</p></div>
  if (days === 0) return <div className={className}><span className="countdown-chip"><CalendarCheck className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Event day</span><p className="countdown__caption"><strong>{eventName}</strong> · {date}</p></div>
  return <div className={className}>
    <span className="countdown__number" aria-hidden="true">{days}</span>
    <p className="countdown__caption"><span className="visually-hidden">{days} </span>{days === 1 ? 'day' : 'days'} to <strong>{eventName}</strong> · {date}</p>
  </div>
}
