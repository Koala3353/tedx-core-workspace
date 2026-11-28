import { useRef, useState } from 'react'
import { Check, Mail, MonitorSmartphone } from 'lucide-react'
import { PendingButton } from '../../components/PendingButton'
import { toast } from '../../components/Toast'
import { celebrate } from '../../components/celebrate/celebrate'
import type { NotificationsApi } from './api'
import { recommendedPending, useAlertChannels, type Channels } from './channels'
import './device-push.css'

const emailLabel: Record<Channels['email'], string> = { loading: 'Checking…', on: 'On', off: 'Off', unavailable: 'Not available' }
const deviceLabel = (state: Channels['device']) => state === 'loading' ? 'Checking…' : state === 'on' ? 'On' : state === 'off' ? 'Off'
  : state === 'blocked' ? 'Blocked' : state === 'ios-install' ? 'Needs Home Screen' : 'Not available'

/**
 * Settings > Alerts and reminders: the recommended setup at a glance (email reminders and this
 * device both on) with one click to turn on whatever is still off.
 */
export function RecommendedAlerts({ api, term }: { api: NotificationsApi; term: string }) {
  const { channels: c, turnOnRecommended } = useAlertChannels(api, term)
  const [error, setError] = useState('')
  const action = useRef<HTMLDivElement>(null)
  const pending = recommendedPending(c)
  const bothOn = c.email === 'on' && c.device === 'on'

  async function turnOn() {
    setError('')
    const wanted = pending
    const target = action.current?.querySelector('button')
    // Asks for device permission first, inside this click.
    const result = await turnOnRecommended()
    const problems = [
      result.device === 'blocked' ? 'Your browser blocked notifications for this site. Allow them in your browser or phone settings, then try again.'
        : result.device === 'dismissed' ? 'Device notifications stay off until you choose Allow when your browser asks.'
          : result.device === 'unavailable' ? 'Couldn\'t turn on notifications on this device. Try again.' : '',
      wanted.email && !result.email ? 'Couldn\'t turn on email reminders. Try again.' : '',
    ].filter(Boolean)
    if (problems.length) { setError(problems.join(' ')); return }
    void celebrate(target, 'save')
    toast(wanted.email && wanted.device ? 'Email reminders and device notifications are on.' : wanted.email ? 'Email reminders are on.' : 'Device notifications are on.')
  }

  const note = c.device === 'ios-install' ? 'On iPhone and iPad, add the workspace to your Home Screen and open it from there to turn on device notifications.'
    : c.device === 'blocked' ? 'Device notifications are blocked. Allow notifications for this site in your browser or phone settings.'
      : c.emailNote
  return <div className="recommended-alerts" ref={action}>
    <p className="recommended-alerts__title" role="status">{bothOn
      ? <><Check className="icon recommended-alerts__ok" size={18} strokeWidth={2} aria-hidden="true" />You get the recommended alerts: email and this device.</>
      : 'Recommended: turn on email reminders and notifications on this device.'}</p>
    <ul className="recommended-alerts__list">
      <li><Mail className="icon" size={18} strokeWidth={1.5} aria-hidden="true" /><span>Email reminders</span>
        <strong data-state={c.email}>{emailLabel[c.email]}</strong></li>
      <li><MonitorSmartphone className="icon" size={18} strokeWidth={1.5} aria-hidden="true" /><span>This device</span>
        <strong data-state={c.device}>{deviceLabel(c.device)}</strong></li>
    </ul>
    {note ? <p className="recommended-alerts__note">{note}</p> : null}
    {pending.email || pending.device ? <PendingButton className="button" pendingLabel="Turning on…" onClick={() => turnOn()}>
      {pending.email && pending.device ? 'Turn on recommended' : pending.email ? 'Turn on email reminders' : 'Turn on this device'}
    </PendingButton> : null}
    {error ? <p className="device-push__error" role="alert">{error}</p> : null}
  </div>
}
