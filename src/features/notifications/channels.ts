import { useCallback, useEffect, useState } from 'react'
import type { NotificationsApi } from './api'
import type { EmailDigestStatus } from '../integrations/email/api'
import {
  alertsChangedEvent, announceAlertsChanged, disableDevice, enableDevice, readDeviceState, syncDevice, type DeviceState,
} from './push'

/**
 * The two recommended alert channels (email reminders and this device), plus the alert timing
 * they depend on. Shared by the setup wizard's Notifications step and the Settings summary.
 *
 * - Email reminders send unless timing is Off.
 * - Device alerts send only when timing is Right away (quiet 10 PM to 7 AM, Manila time).
 * So turning either one on also moves timing to Right away when it would otherwise stay silent.
 */
export type AlertMode = 'immediate' | 'digest' | 'mute'
export type EmailState = 'loading' | 'on' | 'off' | 'unavailable'
export type Channels = {
  mode: AlertMode | null
  email: EmailState
  /** Why email can't be turned on, when it can't. */
  emailNote: string
  device: DeviceState
}
export type RecommendedResult = { device: 'on' | 'blocked' | 'dismissed' | 'unavailable' | 'skipped'; email: boolean; mode: boolean }

const emailNotes: Record<EmailDigestStatus['activation'], string> = {
  ready: '',
  sender: 'Email isn\'t set up for this workspace yet.',
  domain: 'Email is paused while the sending address is checked.',
  quota: 'Email is paused for today. It starts again tomorrow.',
}

function emailState(status: EmailDigestStatus | null | undefined): { email: EmailState; emailNote: string } {
  if (status === undefined) return { email: 'loading', emailNote: '' }
  if (!status) return { email: 'unavailable', emailNote: 'Couldn\'t load email settings right now.' }
  if (status.enabled) return { email: 'on', emailNote: status.bounced ? 'Emails to your address keep bouncing, so they\'re paused. Tell an admin if the address is right.' : '' }
  if (status.bounced) return { email: 'unavailable', emailNote: 'Emails to your address keep bouncing. Tell an admin if the address is right.' }
  return status.activation === 'ready' ? { email: 'off', emailNote: '' } : { email: 'unavailable', emailNote: emailNotes[status.activation] }
}

/** Live state and actions. Without an api (the development preview) it keeps everything in memory. */
export function useAlertChannels(api: NotificationsApi | undefined, term: string | undefined) {
  const live = !!api && !!term
  const [preference, setPreference] = useState<{ mode: AlertMode; version: number } | null>(live ? null : { mode: 'immediate', version: 0 })
  const [email, setEmail] = useState<EmailDigestStatus | null | undefined>(live ? (api?.email ? undefined : null) : { activation: 'ready', enabled: false, version: 0, health: null, bounced: false })
  const [device, setDevice] = useState<DeviceState>(live ? 'loading' : 'off')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!api || !term) return
    let alive = true
    void api.read(term, 1).then(page => { if (alive) setPreference({ mode: page.preference.mode as AlertMode, version: page.preference.version }) }).catch(() => undefined)
    if (api.email) void api.email.status(term).then(status => { if (alive) setEmail(status) }).catch(() => { if (alive) setEmail(null) })
    const push = api.push
    if (!push) setDevice('unconfigured')
    else void (async () => {
      await syncDevice(push, term).catch(() => undefined)
      const list = push.vapidKey ? await push.devices(term).catch(() => null) : []
      const next = await readDeviceState(push, list).catch(() => 'unsupported' as const)
      if (alive) setDevice(next)
    })()
    return () => { alive = false }
  }, [api, term, revision])

  useEffect(() => {
    const refresh = () => setRevision(n => n + 1)
    window.addEventListener(alertsChangedEvent, refresh)
    return () => window.removeEventListener(alertsChangedEvent, refresh)
  }, [])

  const setMode = useCallback(async (mode: AlertMode): Promise<boolean> => {
    if (!preference) return false
    if (preference.mode === mode) return true
    if (!api || !term) { setPreference({ mode, version: preference.version + 1 }); return true }
    const result = await api.run({ kind: 'preference', term, mode, version: preference.version }, crypto.randomUUID())
    if (result.ok) setPreference({ mode, version: result.value.version })
    return result.ok
  }, [api, term, preference])

  const setEmailOn = useCallback(async (enable: boolean): Promise<boolean> => {
    if (!email) return false
    if (email.enabled === enable) return true
    if (!api?.email || !term) { setEmail({ ...email, enabled: enable }); return true }
    const result = await api.email.run({ term, enable, version: email.version }, crypto.randomUUID())
    if (result.ok) setEmail({ ...email, enabled: result.value.enabled, version: result.value.version })
    return result.ok
  }, [api, term, email])

  /**
   * Must be called straight from a click: the browser's permission prompt needs the user's gesture,
   * so it is the first thing that runs.
   */
  const setDeviceOn = useCallback((enable: boolean): Promise<RecommendedResult['device']> => {
    const push = api?.push
    if (!push || !term) { setDevice(enable ? 'on' : 'off'); return Promise.resolve(enable ? 'on' : 'skipped') }
    if (!enable) return disableDevice(push, term).then(() => 'skipped' as const, () => 'unavailable' as const)
    return enableDevice(push, term).catch(() => 'unavailable' as const)
  }, [api, term])

  const done = useCallback(() => { if (live) announceAlertsChanged() }, [live])

  /** Email on, then device on (asks permission), and timing Right away. One click, one gesture. */
  const turnOnRecommended = useCallback(async (): Promise<RecommendedResult> => {
    const state = emailState(email)
    // The device first, in the same tick as the click.
    const deviceWork = device === 'off' ? setDeviceOn(true) : Promise.resolve<RecommendedResult['device']>('skipped')
    const emailWork = state.email === 'off' ? setEmailOn(true) : Promise.resolve(state.email === 'on')
    const modeWork = preference && preference.mode !== 'immediate' ? setMode('immediate') : Promise.resolve(!!preference)
    const [deviceResult, emailOk, modeOk] = await Promise.all([deviceWork, emailWork, modeWork])
    done()
    return { device: deviceResult, email: emailOk, mode: modeOk }
  }, [device, email, preference, setDeviceOn, setEmailOn, setMode, done])

  /** Single toggles. Turning a channel on also makes sure timing lets it send. */
  const toggleEmail = useCallback(async (enable: boolean) => {
    const [ok] = await Promise.all([setEmailOn(enable), enable && preference?.mode === 'mute' ? setMode('immediate') : Promise.resolve(true)])
    done()
    return ok
  }, [preference, setEmailOn, setMode, done])

  const toggleDevice = useCallback(async (enable: boolean) => {
    const deviceWork = setDeviceOn(enable)
    const [result] = await Promise.all([deviceWork, enable && preference && preference.mode !== 'immediate' ? setMode('immediate') : Promise.resolve(true)])
    done()
    return result
  }, [preference, setDeviceOn, setMode, done])

  const changeMode = useCallback(async (mode: AlertMode) => { const ok = await setMode(mode); done(); return ok }, [setMode, done])

  const channels: Channels = api && term && !api.email
    ? { mode: preference?.mode ?? null, email: 'unavailable', emailNote: 'Email reminders aren\'t set up for this workspace yet.', device }
    : { mode: preference?.mode ?? null, ...emailState(email), device }
  return { channels, turnOnRecommended, toggleEmail, toggleDevice, changeMode, refresh: () => setRevision(n => n + 1) }
}

/** Whether "Turn on recommended" has anything it can still turn on. */
export function recommendedPending(c: Channels): { email: boolean; device: boolean } {
  return { email: c.email === 'off', device: c.device === 'off' }
}

export const modeOptions: { value: AlertMode; label: string; hint: string }[] = [
  { value: 'immediate', label: 'Right away', hint: 'Device and Telegram alerts arrive as things happen. Devices stay quiet 10 PM to 7 AM.' },
  { value: 'digest', label: 'Daily digest', hint: 'One round-up each morning after 8 AM. Device alerts pause.' },
  { value: 'mute', label: 'Off', hint: 'Only the bell in the app. Email reminders and device alerts pause.' },
]
