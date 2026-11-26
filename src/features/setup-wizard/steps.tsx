import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { BellRing, Check, Copy, Mail, MonitorSmartphone, Moon, Send, Sun } from 'lucide-react'
import { TextField } from '../../components/TextField'
import { setThemeChoice, useTheme, type ThemeChoice } from '../../app/shellServices'
import { installPlatform, useInstallPrompt } from '../../app/InstallWorkspace'
import { appPath } from '../../lib/basePath'
import type { OwnProfile, ProfileGateway, ProfileValues, ProfileVisibility } from '../account/gateway'
import type { NotificationsApi } from '../notifications/api'
import type { EmailDigestStatus } from '../integrations/email/api'
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
    <p className="muted">Setup takes about a minute. You can change all of it later in Account.</p>
  </>
}

/* 2. Profile: the same fields and commands as the Account page (features/account). */
const fields = [
  { value: 'course', share: 'shareCourse', label: 'Course', max: 200 },
  { value: 'yearLevel', share: 'shareYearLevel', label: 'Year level', max: 80 },
  { value: 'phone', share: 'sharePhone', label: 'Personal phone', max: 80 },
  { value: 'externalContact', share: 'shareExternalContact', label: 'Other contact (e.g. Telegram)', max: 320 },
  { value: 'skills', share: 'shareSkills', label: 'Skills', max: 1000 },
  { value: 'pronunciation', share: 'sharePronunciation', label: 'Name pronunciation', max: 200 },
  { value: 'affiliation', share: 'shareAffiliation', label: 'Affiliation', max: 80 },
] as const
const emptyValues: ProfileValues = { course: null, yearLevel: null, phone: null, externalContact: null, skills: null, pronunciation: null, affiliation: null }
const emptyVisibility: ProfileVisibility = { shareCourse: false, shareYearLevel: false, sharePhone: false, shareExternalContact: false, shareSkills: false, sharePronunciation: false, shareAffiliation: false }

export function ProfileStep({ headingId, registerCommit, api, termId }: StepProps & { api?: ProfileGateway; termId?: string }) {
  const [current, setCurrent] = useState<OwnProfile | null>(null)
  const [values, setValues] = useState<ProfileValues>(emptyValues)
  const [visibility, setVisibility] = useState<ProfileVisibility>(emptyVisibility)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(api && termId ? 'loading' : 'ready')
  const [error, setError] = useState('')
  const latest = useRef({ current, values, visibility })
  useEffect(() => { latest.current = { current, values, visibility } })

  useEffect(() => {
    if (!api || !termId) return
    let live = true
    void api.read(termId).then(result => {
      if (!live) return
      setCurrent(result); setValues(result); setVisibility(result); setState('ready')
    }).catch(() => { if (live) setState('unavailable') })
    return () => { live = false }
  }, [api, termId])

  useEffect(() => {
    registerCommit(async () => {
      const { current: base, values: v, visibility: s } = latest.current
      if (!api || !termId || !base) return true
      const dirtyValues = fields.some(f => (base[f.value] ?? null) !== (v[f.value] ?? null))
      const dirtySharing = fields.some(f => base[f.share] !== s[f.share])
      if (!dirtyValues && !dirtySharing) return true
      setError('')
      try {
        // Explicit whitelists keep server identity/version fields out of payloads, as on Account.
        let next = base
        if (dirtyValues) next = await api.save(termId, { course: v.course, yearLevel: v.yearLevel, phone: v.phone, externalContact: v.externalContact, skills: v.skills, pronunciation: v.pronunciation, affiliation: v.affiliation }, next.version, crypto.randomUUID())
        if (dirtySharing) next = await api.share(termId, { shareCourse: s.shareCourse, shareYearLevel: s.shareYearLevel, sharePhone: s.sharePhone, shareExternalContact: s.shareExternalContact, shareSkills: s.shareSkills, sharePronunciation: s.sharePronunciation, shareAffiliation: s.shareAffiliation }, next.version, crypto.randomUUID())
        setCurrent(next); setValues(next); setVisibility(next)
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Couldn\'t save your profile. Try again, or skip and finish it in Account.')
        return false
      }
    })
    return () => registerCommit(null)
  }, [api, termId, registerCommit])

  return <>
    <StepHeading id={headingId} lead="All optional. Switch on Show to members for anything you want the team to see in the directory.">Your profile</StepHeading>
    {error ? <p className="setup-alert" role="alert">{error}</p> : null}
    {state === 'loading' ? <p className="muted" role="status">Loading your profile…</p>
      : state === 'unavailable' ? <p className="muted" role="status">Couldn't load your profile right now. Skip this step and fill it in later from Account.</p>
        : <div className="setup-fields">
          {fields.map(field => <div className="paired-field setup-field" key={field.value}>
            <TextField id={`setup-${field.value}`} label={field.label} maxLength={field.max} value={values[field.value] ?? ''} autoComplete="off"
              onChange={event => setValues({ ...values, [field.value]: event.target.value || null })} />
            <label className="share-toggle setup-share">
              <input type="checkbox" role="switch" checked={visibility[field.share]} aria-describedby={`setup-${field.value}`}
                onChange={event => setVisibility({ ...visibility, [field.share]: event.target.checked })} />
              <span className="setup-switch" aria-hidden="true" />Show to members
            </label>
          </div>)}
        </div>}
    {!api ? <p className="muted">Preview only. Nothing here is saved.</p> : null}
  </>
}

/* 3. Reminders: notification preference, email digest and the Telegram link, same RPCs as Notifications. */
const modes = [
  { value: 'immediate', label: 'Right away', hint: 'An alert as soon as something needs you' },
  { value: 'digest', label: 'Daily digest', hint: 'One round-up each morning after 8 AM' },
  { value: 'mute', label: 'Off', hint: 'Updates stay in the app only' },
] as const

export function RemindersStep({ headingId, api, termId }: StepProps & { api?: NotificationsApi; termId?: string }) {
  const [preference, setPreference] = useState<{ mode: string; version: number } | null>(null)
  const [localMode, setLocalMode] = useState('digest')
  const [email, setEmail] = useState<EmailDigestStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const groupId = useId()

  useEffect(() => {
    if (!api || !termId) return
    let live = true
    void api.read(termId, 1).then(page => { if (live) setPreference(page.preference) }).catch(() => { if (live) setError('Couldn\'t load your alert settings. You can set them later in Notifications.') })
    void api.email?.status(termId).then(status => { if (live) setEmail(status) }).catch(() => undefined)
    return () => { live = false }
  }, [api, termId])

  async function chooseMode(mode: string) {
    setNotice(''); setError('')
    if (!api || !termId) { setLocalMode(mode); return }
    if (!preference || preference.mode === mode || busy) return
    setBusy('mode')
    const result = await api.run({ kind: 'preference', term: termId, mode, version: preference.version }, crypto.randomUUID())
    setBusy('')
    if (result.ok) { setPreference({ mode, version: result.value.version }); setNotice('Saved.') }
    else setError(result.error.message || 'Couldn\'t save that. Try again.')
  }

  async function toggleEmail() {
    if (!api?.email || !termId || !email || busy) return
    setNotice(''); setError(''); setBusy('email')
    const enable = !email.enabled
    const result = await api.email.run({ term: termId, enable, version: email.version }, crypto.randomUUID())
    setBusy('')
    if (result.ok) { setEmail({ ...email, enabled: result.value.enabled, version: result.value.version }); setNotice(enable ? 'Email reminders are on.' : 'Email reminders are off.') }
    else setError(result.error.message || 'Couldn\'t change email reminders. Try again.')
  }

  const mode = api ? preference?.mode : localMode
  const emailOffered = !!email && (email.enabled || (email.activation === 'ready' && !email.bounced))
  return <>
    <StepHeading id={headingId} lead="Everything always shows in the app. Pick how hard we should nudge you about deadlines and requests.">Reminders</StepHeading>
    <fieldset className="setup-choices" disabled={!!api && (!preference || busy === 'mode')}>
      <legend id={groupId}>How fast should alerts reach you?</legend>
      {modes.map(option => <label key={option.value} className="setup-choice">
        <input type="radio" name="setup-mode" value={option.value} checked={mode === option.value} onChange={() => void chooseMode(option.value)} />
        <span className="setup-choice__text"><strong>{option.label}</strong><span>{option.hint}</span></span>
        <Check className="icon setup-choice__tick" size={18} strokeWidth={2} aria-hidden="true" />
      </label>)}
    </fieldset>
    {emailOffered || !api ? <div className="setup-row">
      <Mail className="icon setup-row__icon" size={20} strokeWidth={1.5} aria-hidden="true" />
      <span className="setup-row__text"><strong id="setup-email-label">Email reminders</strong><span>A short email each morning with what's new and what's due.</span></span>
      <button type="button" className="setup-toggle" role="switch" aria-checked={!!email?.enabled} aria-labelledby="setup-email-label"
        disabled={!api || busy === 'email'} onClick={() => void toggleEmail()}><span className="setup-switch" aria-hidden="true" /></button>
    </div> : null}
    {api?.telegram && termId ? <TelegramRow api={api.telegram} termId={termId} /> : null}
    <p className="setup-status" role="status">{busy ? 'Saving…' : notice}</p>
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
    <StepHeading id={headingId} lead="It changes right away. You can switch it later from the account menu too.">How should it look?</StepHeading>
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
      : outcome === 'dismissed' ? 'No problem. You can install later from Account.'
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
    {guest ? <p>Your shared work is ready. Find setup again in the account menu if you want to change anything.</p>
      : <p>Want a quick look around? The tour walks you through Today, Work, Team and search in about two minutes. You can replay it any time from the account menu.</p>}
  </>
}
