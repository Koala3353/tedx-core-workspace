import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { BellRing, Smartphone, X } from 'lucide-react'
import { PendingButton } from '../../components/PendingButton'
import { toast } from '../../components/Toast'
import { celebrate } from '../../components/celebrate/celebrate'
import { formatDateTime, formatDay } from '../shared/dates'
import {
  alertsChangedEvent, announceAlertsChanged, currentSubscription, disableDevice, enableDevice, endpointHash, readDeviceState, syncDevice,
  PushCommandError, type DeviceState, type PushApi, type PushDevice,
} from './push'
import './device-push.css'

export type { DeviceState } from './push'

const statusText: Record<DeviceState, string> = {
  loading: 'Checking this device…',
  on: 'On. Alerts show on this device, even when the workspace is closed.',
  off: 'Off. Turn it on to get alerts on this device even when the workspace is closed.',
  blocked: 'Blocked in your browser. Allow notifications for this site in your browser or phone settings, then come back here.',
  unsupported: 'This browser can\'t show device notifications. Try Chrome, Edge, Firefox or Safari.',
  'ios-install': 'On iPhone and iPad, add the workspace to your Home Screen first. Then open it from the Home Screen and turn this on.',
  dev: 'Device notifications work on the published workspace, not in local development.',
  unconfigured: 'Device notifications aren\'t set up yet. An admin runs scripts/setup-push.sh, then publishes the app again.',
}

/**
 * "Notifications on this device": on, off, blocked, unsupported, or the iPhone Home Screen step.
 * Turning on asks the browser for permission (only from the button press), subscribes with the
 * workspace's public key and saves the device. The list shows every device the person turned on.
 */
export function DevicePush({ api, term, canManage, mode, installHint }: {
  api: PushApi; term: string; canManage: boolean; mode?: string
  /** Where the iPhone Home Screen steps are. Defaults to the Settings install section. */
  installHint?: React.ReactNode
}) {
  const [state, setState] = useState<DeviceState>('loading')
  const [devices, setDevices] = useState<PushDevice[] | null>(null)
  const [thisDevice, setThisDevice] = useState('')
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState('')
  const [revision, setRevision] = useState(0)
  const toggle = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const refresh = useCallback(() => setRevision(n => n + 1), [])

  useEffect(() => {
    let live = true
    void (async () => {
      // Quietly re-save a subscription the browser rotated since the last visit.
      await syncDevice(api, term).catch(() => undefined)
      const list = api.vapidKey ? await api.devices(term).catch(() => null) : []
      const subscription = await currentSubscription()
      const hash = subscription ? await endpointHash(subscription.endpoint) : ''
      const next = await readDeviceState(api, list)
      if (!live) return
      setDevices(list); setThisDevice(hash); setState(next)
      if (list === null) setError('Couldn\'t load your devices. Check your connection and try again.')
    })()
    return () => { live = false }
  }, [api, term, revision])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const listen = (event: MessageEvent) => { if ((event.data as { type?: unknown } | null)?.type === 'push-subscription-changed') refresh() }
    navigator.serviceWorker.addEventListener('message', listen)
    return () => navigator.serviceWorker.removeEventListener('message', listen)
  }, [refresh])
  // The recommended-alerts summary above can turn this device on too.
  useEffect(() => {
    window.addEventListener(alertsChangedEvent, refresh)
    return () => window.removeEventListener(alertsChangedEvent, refresh)
  }, [refresh])

  if (state === 'unconfigured' && !canManage) return null

  async function turnOn() {
    setError('')
    try {
      const result = await enableDevice(api, term)
      if (result === 'on') { void celebrate(toggle.current?.querySelector('button'), 'save'); toast('Device notifications are on.') }
      else if (result === 'blocked') setError('Your browser blocked notifications for this site. Allow them in your browser or phone settings, then try again.')
      else if (result === 'dismissed') setError('Notifications stay off until you choose Allow when your browser asks.')
      else setError('Couldn\'t turn on notifications here. Reload the page and try again.')
    } catch { setError('Couldn\'t turn on notifications here. Check your connection and try again.') }
    announceAlertsChanged()
  }

  async function turnOff() {
    setError('')
    try { await disableDevice(api, term); toast('Device notifications are off on this device.', { tone: 'info' }) }
    catch { setError('Couldn\'t turn notifications off. Check your connection and try again.') }
    announceAlertsChanged()
  }

  async function sendTest(target: HTMLElement | null) {
    setError('')
    try {
      const result = await api.test(term)
      void celebrate(target, 'send')
      toast(result.sentNow ? 'Test sent. It should appear in a few seconds.' : 'Test queued. It arrives within 15 minutes.')
    } catch (cause) {
      const kind = cause instanceof PushCommandError ? cause.kind : 'unavailable'
      setError(kind === 'rate_limited' ? 'You just sent a test. Wait a minute, then try again.'
        : kind === 'no_device' ? 'Turn on notifications on a device first.' : 'Couldn\'t send a test. Check your connection and try again.')
    }
    refresh()
  }

  async function remove(device: PushDevice) {
    if (removing) return
    setRemoving(device.id); setError('')
    try {
      if (device.endpointHash === thisDevice) await disableDevice(api, term)
      else await api.remove({ id: device.id })
      toast('Device removed.', { tone: 'info' })
    } catch { setError('Couldn\'t remove that device. Try again.') }
    finally { setRemoving('') }
    announceAlertsChanged()
  }

  const others = devices ?? []
  return <div className="device-push">
    <div className="device-push__row" ref={toggle}>
      <BellRing className="icon device-push__icon" size={20} strokeWidth={1.5} aria-hidden="true" />
      <span className="device-push__text">
        <strong id={labelId}>Notifications on this device</strong>
        <span role="status" data-state={state}>{statusText[state]}</span>
      </span>
      {state === 'on' ? <PendingButton className="button button--secondary" pendingLabel="Turning off…" aria-describedby={labelId} onClick={() => turnOff()}>Turn off</PendingButton>
        : state === 'off' ? <PendingButton className="button" pendingLabel="Turning on…" aria-describedby={labelId} onClick={() => turnOn()}>Turn on</PendingButton> : null}
    </div>
    {state === 'ios-install' ? <p className="device-push__note">{installHint ?? <Link to="/account#install">How to add it to your Home Screen</Link>}</p> : null}
    {state === 'on' && mode && mode !== 'immediate' ? <p className="device-push__note">Your alerts are set to {mode === 'digest' ? 'Daily digest' : 'Off'}, so devices only get alerts when that is set to Right away.</p> : null}
    {state === 'on' ? <div className="auth-actions">
      <PendingButton className="button button--secondary" pendingLabel="Sending…" onClick={event => sendTest(event.currentTarget)}>Send a test notification</PendingButton>
    </div> : null}
    {error ? <p className="device-push__error" role="alert">{error}</p> : null}
    {others.length ? <div className="device-push__devices">
      <h3>Your devices</h3>
      <ul>
        {others.map(device => <li key={device.id}>
          <Smartphone className="icon" size={18} strokeWidth={1.5} aria-hidden="true" />
          <span className="device-push__device">
            <strong>{device.label ?? 'A device'}{device.endpointHash === thisDevice ? <span className="device-push__this"> · This device</span> : null}</strong>
            <span>{device.failing ? 'Not reached lately. Turn it on again from that device.'
              : device.lastSuccessAt ? `Last alert ${formatDateTime(device.lastSuccessAt)}` : `Added ${formatDay(device.createdAt)}`}</span>
          </span>
          <button type="button" className="button button--quiet device-push__remove" disabled={!!removing} aria-busy={removing === device.id || undefined}
            aria-label={`Remove ${device.label ?? 'device'}`} onClick={() => void remove(device)}>
            <X className="icon" size={16} strokeWidth={1.75} aria-hidden="true" /><span className="device-push__remove-label">Remove</span>
          </button>
        </li>)}
      </ul>
    </div> : null}
  </div>
}
