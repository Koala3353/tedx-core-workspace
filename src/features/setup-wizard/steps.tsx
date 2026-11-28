import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Bell, BellRing, Check, Copy, Mail, MonitorSmartphone, Moon, Send, Sun } from 'lucide-react'
import { PendingButton } from '../../components/PendingButton'
import { toast } from '../../components/Toast'
import { celebrate } from '../../components/celebrate/celebrate'
import { TextField } from '../../components/TextField'
import { setThemeChoice, useTheme, type ThemeChoice } from '../../app/shellServices'
import { installPlatform, useInstallPrompt } from '../../app/InstallWorkspace'
import { appPath } from '../../lib/basePath'
import { profileFields, type OwnProfile, type ProfileGateway, type ProfileValues } from '../account/gateway'
import { profileDirty, saveProfile } from '../account/ProfileEditor'
import { contactError } from '../people/contacts'
import type { NotificationsApi } from '../notifications/api'
import type { DeviceState } from '../notifications/push'
import { modeOptions, recommendedPending, useAlertChannels, type AlertMode, type RecommendedResult } from '../notifications/channels'
import { telegramConfirmCode, telegramProofHash, telegramStartCode, type TelegramStatus } from '../integrations/telegram/api'
import { InstallSteps, isPhone, rememberInstallAccepted } from '../install/InstallBanner'
import '../shared/shared.css'

/** A step may save before moving on. Resolve false to stay on the step (the step shows why). */
export type Commit = () => Promise<boolean>
export type StepProps = { headingId: string; registerCommit: (commit: Commit | null) => void }

function StepHeading({ id, children, lead }: { id: string; children: ReactNode; lead?: ReactNode }) {
  return <div className="setup-step__head">
    <h2 id={id} tabIndex={-1}>{children}</h2>
    {lead ? <p className="setup-step__lead">{lead}</p> : null}
  </div>
}

/* 1. Welcome */
export function WelcomeStep({ headingId, name, committee, position, guest }: StepProps & { name: string; committee?: string | null; position?: string | null; guest: boolean }) {
  const role = [position, committee && committee !== position ? committee : null].filter(Boolean).join(' · ')
  return <>
    <StepHeading id={headingId}>Welcome to the <span className="setup-x">TEDx</span>AteneodeManilaU {guest ? 'workspace' : 'core workspace'}</StepHeading>
    <div className="setup-identity">
      <span className="setup-identity__initial" aria-hidden="true">{name.trim().charAt(0).toUpperCase() || '?'}</span>
      <span className="setup-identity__text">
        <strong>{name}</strong>
        <span>{guest ? 'Guest access' : role || 'Core team'}</span>
      </span>
    </div>
    <p>{guest ? 'This is where you see the work the team shared with you, and send back what they need.'
      : 'This is where the core team keeps tasks, deadlines and asks between committees, so nothing gets lost in group chats.'}</p>
    <p className="muted">Setup takes about a minute. You can change all of it later in Settings.</p>
  </>
}

/* 2. Profile: the same fields and commands as the Account page (features/account). */
const emptyValues: ProfileValues = { course: null, yearLevel: null, messenger: null, telegram: null }
const pickValues = (p: ProfileValues): ProfileValues => ({ course: p.course, yearLevel: p.yearLevel, messenger: p.messenger, telegram: p.telegram })

export function ProfileStep({ headingId, registerCommit, api, termId }: StepProps & { api?: ProfileGateway; termId?: string }) {
  const [current, setCurrent] = useState<OwnProfile | null>(null)
  const [values, setValues] = useState<ProfileValues>(emptyValues)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(api && termId ? 'loading' : 'ready')
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const latest = useRef({ current, values })
  useEffect(() => { latest.current = { current, values } })

  useEffect(() => {
    if (!api || !termId) return
    let live = true
    void api.read(termId).then(result => {
      if (!live) return
      setCurrent(result); setValues(pickValues(result)); setState('ready')
    }).catch(() => { if (live) setState('unavailable') })
    return () => { live = false }
  }, [api, termId])

  useEffect(() => {
    registerCommit(async () => {
      const { current: base, values: v } = latest.current
      if (!api || !termId || !base) return true
      if (contactError('messenger', v.messenger) || contactError('telegram', v.telegram)) {
        setTouched(true)
        return false
      }
      if (!profileDirty(base, v)) return true
      setError('')
      try {
        const next = await saveProfile(api, termId, base, v, () => crypto.randomUUID())
        setCurrent(next); setValues(pickValues(next))
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Couldn\'t save your profile. Try again, or skip and finish it in Settings.')
        return false
      }
    })
    return () => registerCommit(null)
  }, [api, termId, registerCommit])

  const fields = profileFields.filter(field => !current || current.contactsAvailable || (field.value !== 'messenger' && field.value !== 'telegram'))
  return <>
    <StepHeading id={headingId} lead="All optional. Core members can see what you add, so they can reach you.">Your profile</StepHeading>
    {error ? <p className="setup-alert" role="alert">{error}</p> : null}
    {state === 'loading' ? <p className="muted" role="status">Loading your profile…</p>
      : state === 'unavailable' ? <p className="muted" role="status">Couldn't load your profile right now. Skip this step and fill it in later from Settings.</p>
        : <div className="setup-fields">
          {fields.map(field => {
            const problem = field.value === 'messenger' || field.value === 'telegram' ? contactError(field.value, values[field.value]) : ''
            return <div className="setup-field" key={field.value}>
              <TextField id={`setup-${field.value}`} label={field.label} hint={field.hint} placeholder={field.placeholder} maxLength={field.max}
                value={values[field.value] ?? ''} autoComplete="off" spellCheck={false} error={touched && problem ? problem : undefined}
                onBlur={() => { if (problem) setTouched(true) }}
                onChange={event => setValues({ ...values, [field.value]: event.target.value || null })} />
            </div>
          })}
        </div>}
    {!api ? <p className="muted">Preview only. Nothing here is saved.</p> : null}
  </>
}

/*
 * 3. Notifications: every channel in one place. Email reminders and this device are recommended,
 * the bell in the app is always on, Telegram is optional. Same RPCs as Settings and Notifications.
 */
const deviceText: Record<DeviceState, string> = {
  loading: 'Checking this device…',
  on: 'On. Alerts show here even when the workspace is closed.',
  off: 'Off on this device.',
  blocked: 'Blocked by your browser for this site.',
  unsupported: 'This browser can\'t show notifications. Chrome, Edge, Firefox and Safari can. Email still works.',
  'ios-install': 'On iPhone and iPad, this works only from the Home Screen app.',
  dev: 'Works on the published workspace, not in local development.',
  unconfigured: 'Not available yet while an admin finishes setting it up. Email still works.',
}

function Recommended() {
  return <span className="setup-badge">Recommended</span>
}

export function NotificationsStep({ headingId, api, termId }: StepProps & { api?: NotificationsApi; termId?: string }) {
  const { channels: c, turnOnRecommended, toggleEmail, toggleDevice, changeMode, refresh } = useAlertChannels(api, termId)
  const [busy, setBusy] = useState<'' | 'both' | 'email' | 'device' | 'mode'>('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const button = useRef<HTMLDivElement>(null)
  const emailId = useId(), deviceId = useId()
  const pending = recommendedPending(c)
  const bothOn = c.email === 'on' && c.device === 'on'
  const label = pending.email && pending.device ? 'Turn on both (recommended)'
    : pending.email ? 'Turn on email reminders (recommended)' : 'Turn on device notifications (recommended)'

  function deviceProblem(result: RecommendedResult['device']): string {
    return result === 'blocked' ? 'Your browser blocked notifications for this site. See how to allow them below.'
      : result === 'dismissed' ? 'Device notifications stay off until you choose Allow when your browser asks. Try again any time.'
        : result === 'unavailable' ? 'Couldn\'t turn on notifications on this device. Try again, or later from Settings.' : ''
  }

  async function both() {
    if (busy) return
    setBusy('both'); setNotice(''); setError('')
    // turnOnRecommended asks for device permission first, inside this click.
    const result = await turnOnRecommended()
    setBusy('')
    const problems = [deviceProblem(result.device), pending.email && !result.email ? 'Couldn\'t turn on email reminders. Try again.' : ''].filter(Boolean)
    const deviceOk = result.device === 'on' || !pending.device
    if (!problems.length) {
      void celebrate(button.current?.querySelector('button'), 'save')
      toast(pending.email && pending.device ? 'Email reminders and device notifications are on.' : pending.email ? 'Email reminders are on.' : 'Device notifications are on.')
    } else {
      setError(problems.join(' '))
      if (pending.email && result.email) setNotice('Email reminders are on.')
      else if (pending.device && deviceOk) setNotice('Device notifications are on.')
    }
  }

  async function flipEmail() {
    if (busy || (c.email !== 'on' && c.email !== 'off')) return
    const enable = c.email === 'off'
    setBusy('email'); setNotice(''); setError('')
    const ok = await toggleEmail(enable)
    setBusy('')
    if (ok) setNotice(enable ? 'Email reminders are on.' : 'Email reminders are off.')
    else setError('Couldn\'t change email reminders. Try again.')
  }

  async function flipDevice() {
    if (busy || (c.device !== 'on' && c.device !== 'off')) return
    const enable = c.device === 'off'
    setBusy('device'); setNotice(''); setError('')
    const result = await toggleDevice(enable)
    setBusy('')
    if (!enable) setNotice(result === 'unavailable' ? '' : 'Device notifications are off on this device.')
    if (!enable && result === 'unavailable') setError('Couldn\'t turn notifications off. Try again.')
    else if (enable && result === 'on') setNotice('Device notifications are on.')
    else if (enable) setError(deviceProblem(result))
  }

  async function pickMode(mode: AlertMode) {
    if (busy || c.mode === mode) return
    setBusy('mode'); setNotice(''); setError('')
    const ok = await changeMode(mode)
    setBusy('')
    if (ok) setNotice('Alert timing saved.')
    else setError('Couldn\'t save alert timing. Try again.')
  }

  const switchable = (state: string) => state === 'on' || state === 'off'
  return <>
    <StepHeading id={headingId} lead="Deadlines and requests reach you even when the workspace is closed. We recommend turning on both email and this device.">Notifications</StepHeading>

    {pending.email || pending.device || busy === 'both' ? <div className="setup-recommend" ref={button}>
      <PendingButton className="button setup-recommend__button" pending={busy === 'both'} pendingLabel="Turning on…" disabled={!!busy && busy !== 'both'} onClick={() => both()}>
        <BellRing className="icon" size={18} strokeWidth={1.75} aria-hidden="true" />{label}
      </PendingButton>
      {pending.device ? <p className="setup-recommend__hint">Your browser will ask to allow notifications. Choose Allow.</p> : null}
    </div> : bothOn ? <p className="setup-recommend setup-recommend--done"><Check className="icon" size={18} strokeWidth={2} aria-hidden="true" />Email and this device are both on. You're set.</p> : null}

    <ul className="setup-channels">
      <li className="setup-channel">
        <Mail className="icon setup-channel__icon" size={20} strokeWidth={1.5} aria-hidden="true" />
        <span className="setup-channel__text">
          <strong id={emailId}>Email reminders <Recommended /></strong>
          <span>Work due soon or overdue, approvals waiting on you and announcements to acknowledge, sent to your sign-in email.</span>
          <span className="setup-channel__state" data-state={c.email}>{c.email === 'loading' ? 'Checking…' : c.email === 'on' ? 'On' : c.email === 'off' ? 'Off' : 'Not available'}{c.emailNote ? '. ' + c.emailNote : ''}</span>
        </span>
        {switchable(c.email) ? <button type="button" className="setup-toggle" role="switch" aria-checked={c.email === 'on'} aria-labelledby={emailId}
          disabled={!!busy} aria-busy={busy === 'email' || undefined} onClick={() => void flipEmail()}><span className="setup-switch" aria-hidden="true" /></button> : <span />}
      </li>
      <li className="setup-channel">
        <MonitorSmartphone className="icon setup-channel__icon" size={20} strokeWidth={1.5} aria-hidden="true" />
        <span className="setup-channel__text">
          <strong id={deviceId}>This device <Recommended /></strong>
          <span>A notification on this phone or computer when you're assigned work, something is due soon or overdue, or an approval needs you. Quiet from 10 PM to 7 AM.</span>
          <span className="setup-channel__state" data-state={c.device}>{deviceText[c.device]}</span>
        </span>
        {switchable(c.device) ? <button type="button" className="setup-toggle" role="switch" aria-checked={c.device === 'on'} aria-labelledby={deviceId}
          disabled={!!busy} aria-busy={busy === 'device' || undefined} onClick={() => void flipDevice()}><span className="setup-switch" aria-hidden="true" /></button> : <span />}
        {c.device === 'ios-install' ? <div className="setup-channel__more">
          <InstallSteps platform="ios" />
          <p className="muted">You can keep going now. Once it's on your Home Screen, open the workspace from there and turn this on in Settings, under Alerts and reminders.</p>
        </div> : c.device === 'blocked' ? <div className="setup-channel__more">
          <ol className="setup-howto">
            <li>Open this site's settings: tap the icon left of the web address, or find Site settings in your browser menu.</li>
            <li>Set Notifications to Allow.</li>
            <li>Come back here and check again.</li>
          </ol>
          <button type="button" className="button button--secondary" onClick={refresh}>Check again</button>
        </div> : null}
      </li>
      <li className="setup-channel">
        <Bell className="icon setup-channel__icon" size={20} strokeWidth={1.5} aria-hidden="true" />
        <span className="setup-channel__text">
          <strong>In the app</strong>
          <span>Always on. Every update also shows under the bell at the top.</span>
        </span>
        <span className="setup-channel__always">Always on</span>
      </li>
    </ul>

    <details className="setup-more">
      <summary>Alert timing: {modeOptions.find(o => o.value === c.mode)?.label ?? 'Checking…'}</summary>
      <fieldset className="setup-choices" disabled={!c.mode || !!busy}>
        <legend className="visually-hidden">Alert timing</legend>
        {modeOptions.map(option => <label key={option.value} className="setup-choice">
          <input type="radio" name="setup-mode" value={option.value} checked={c.mode === option.value} onChange={() => void pickMode(option.value)} />
          <span className="setup-choice__text"><strong>{option.label}</strong><span>{option.hint}</span></span>
          <Check className="icon setup-choice__tick" size={18} strokeWidth={2} aria-hidden="true" />
        </label>)}
      </fieldset>
    </details>

    {api?.telegram && termId ? <TelegramRow api={api.telegram} termId={termId} /> : null}
    <p className="setup-status" role="status">{busy && busy !== 'both' ? 'Saving…' : notice}</p>
    {error ? <p className="setup-alert" role="alert">{error}</p> : null}
    {!api ? <p className="muted">Preview only. Nothing here is saved.</p> : null}
  </>
}

/** Compact version of the Notifications page Telegram link: start, open the bot, paste the code. */
function TelegramRow({ api, termId }: { api: NonNullable<NotificationsApi['telegram']>; termId: string }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null)
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let live = true
    void api.status(termId).then(value => { if (live) setStatus(value) }).catch(() => { if (live) setStatus(null) })
    return () => { live = false }
  }, [api, termId, revision])

  async function start() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const startCode = telegramStartCode()
      await api.run(termId, { action: 'start', hash: await telegramProofHash(startCode), key: crypto.randomUUID() })
      setUrl(api.startUrl(startCode))
    } catch { setError('Couldn\'t start the link. Try again, or link later in Notifications.') }
    finally { setBusy(false) }
  }

  async function confirm() {
    const proof = code.trim()
    if (busy || !telegramConfirmCode.test(proof)) return
    setBusy(true); setError('')
    try {
      await api.run(termId, { action: 'confirm', hash: await telegramProofHash(proof), key: crypto.randomUUID() })
      setUrl(''); setCode(''); setRevision(n => n + 1)
    } catch { setError('That code didn\'t match or has expired. Start a new link and use the new code.') }
    finally { setBusy(false) }
  }

  const linked = status?.state === 'linked'
  return <div className="setup-row setup-row--stack">
    <Send className="icon setup-row__icon" size={20} strokeWidth={1.5} aria-hidden="true" />
    <span className="setup-row__text"><strong>Telegram</strong><span>{linked ? 'Linked. Alerts also arrive in Telegram.' : 'Optional. Get a short alert in Telegram with a link back here.'}</span></span>
    {linked ? <span className="setup-row__done"><Check className="icon" size={18} strokeWidth={2} aria-hidden="true" />Linked</span>
      : <button type="button" className="button button--secondary" disabled={busy || !status} onClick={() => void start()}>{url ? 'Start again' : 'Link Telegram'}</button>}
    {url ? <div className="setup-row__more">
      <a className="button button--secondary" href={url} target="_blank" rel="noopener noreferrer">Open the Telegram bot</a>
      <p className="muted">Press Start in the bot, then type the code it sends you here within 8 minutes.</p>
      <form className="setup-inline-form" onSubmit={event => { event.preventDefault(); void confirm() }}>
        <TextField id="setup-telegram-code" label="Code from Telegram" value={code} maxLength={24} autoComplete="off" spellCheck={false}
          onChange={event => setCode(event.target.value)} disabled={busy} />
        <button type="submit" className="button button--secondary" disabled={busy || !telegramConfirmCode.test(code.trim())}>Confirm</button>
      </form>
    </div> : null}
    {error ? <p className="setup-alert setup-row__more" role="alert">{error}</p> : null}
  </div>
}

/* 4. Look */
const looks: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'Match my device', icon: MonitorSmartphone },
]

export function LookStep({ headingId }: StepProps) {
  const { choice } = useTheme()
  return <>
    <StepHeading id={headingId} lead="It changes right away. You can switch it later in Settings too.">How should it look?</StepHeading>
    <fieldset className="setup-looks">
      <legend className="visually-hidden">Theme</legend>
      {looks.map(look => <label key={look.value} className="setup-look">
        <input type="radio" name="setup-theme" value={look.value} checked={choice === look.value} onChange={() => setThemeChoice(look.value)} />
        <span className={`setup-look__swatch setup-look__swatch--${look.value}`} aria-hidden="true"><span /><span /><span /></span>
        <span className="setup-look__label"><look.icon className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />{look.label}</span>
      </label>)}
    </fieldset>
  </>
}

/* 5. Install */
export function InstallStep({ headingId }: StepProps) {
  const { available, install } = useInstallPrompt()
  const platform = installPlatform(available)
  const phone = isPhone()
  const [status, setStatus] = useState('')
  const link = window.location.origin + appPath('/')

  async function start() {
    const outcome = await install()
    if (outcome === 'accepted') rememberInstallAccepted()
    setStatus(outcome === 'accepted' ? 'Installing. Look for the TEDx icon on your home screen.'
      : outcome === 'dismissed' ? 'No problem. You can install later from Settings.'
        : 'Installation couldn\'t start. Look for Install or Add to Home Screen in your browser menu.')
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); setStatus('Link copied. Paste it in Safari or Chrome.') }
    catch { setStatus('Couldn\'t copy. Press and hold the link to copy it.') }
  }

  if (platform === 'in-app') return <>
    <StepHeading id={headingId} lead="Apps like Messenger and Instagram open links in their own browser, which can't install apps or keep you signed in for long.">Open this in Safari or Chrome first</StepHeading>
    <p className="setup-link" aria-label="Workspace link">{link}</p>
    <button type="button" className="button button--secondary setup-copy" onClick={() => void copy()}><Copy className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Copy link</button>
    <p className="setup-status" role="status">{status}</p>
  </>

  if (!phone) return <>
    <StepHeading id={headingId} lead="Optional on a computer. The app opens in its own window and stays one click away.">Install the app</StepHeading>
    {platform === 'prompt' ? <button type="button" className="button button--secondary" onClick={() => void start()}><MonitorSmartphone className="icon" size={18} strokeWidth={1.75} aria-hidden="true" />Install app</button>
      : <p className="muted">If your browser shows an install icon in the address bar, you can use that. Or skip this, it's fine.</p>}
    <p className="muted">On your phone, open the workspace once and we'll show you how to add it to your home screen.</p>
    <p className="setup-status" role="status">{status}</p>
  </>

  return <>
    <StepHeading id={headingId} lead="It opens like any app, loads faster and can send you reminders.">Put it on your home screen</StepHeading>
    {platform === 'prompt' ? <button type="button" className="button button--secondary setup-install" onClick={() => void start()}><BellRing className="icon" size={18} strokeWidth={1.75} aria-hidden="true" />Install the app</button>
      : <InstallSteps platform={platform} />}
    <p className="setup-status" role="status">{status}</p>
  </>
}

/* 6. Done */
export function DoneStep({ headingId, guest }: StepProps & { guest: boolean }) {
  return <>
    <div className="setup-done-mark" aria-hidden="true"><Check size={28} strokeWidth={2.25} /></div>
    <StepHeading id={headingId}>You're all set</StepHeading>
    {guest ? <p>Your shared work is ready. Find setup again in Settings if you want to change anything.</p>
      : <p>Your workspace is ready. Change any of this, replay the tour or run setup again from Settings.</p>}
  </>
}
