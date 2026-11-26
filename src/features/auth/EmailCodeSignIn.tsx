import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CircleAlert, Clock3, MailX } from 'lucide-react'
import './EmailCodeSignIn.css'

// Email one-time-code sign-in for students whose school Google account is blocked from the Google consent screen.
// The integrator implements requestCode/verifyCode in gateway.ts with the existing Supabase client and throws
// emailCodeErrorFrom(error) on failure so this component can show the right message.

// busy: the project-wide auth email cap (Supabase Auth > Rate Limits, 30 an hour) is used up.
// cooldown: this address asked for a code moments ago; Auth says how many seconds to wait.
// daily_limit: the Apps Script relay has no MailApp quota left today (send-auth-email answers 429).
// rate_limited: any other 429, such as too many code checks from this network.
export type EmailCodeErrorKind = 'busy' | 'cooldown' | 'daily_limit' | 'rate_limited' | 'invalid_code' | 'not_allowed' | 'unavailable'
export class EmailCodeError extends Error {
  readonly kind: EmailCodeErrorKind
  readonly waitSeconds?: number
  constructor(kind: EmailCodeErrorKind, message: string = kind, waitSeconds?: number) {
    super(message); this.kind = kind; this.name = 'EmailCodeError'; this.waitSeconds = waitSeconds
  }
}

/** Maps a Supabase AuthError (or anything thrown) to an EmailCodeError. */
export function emailCodeErrorFrom(error: unknown): EmailCodeError {
  if (error instanceof EmailCodeError) return error
  const value = (error && typeof error === 'object' ? error : {}) as { status?: unknown; code?: unknown; message?: unknown }
  const code = typeof value.code === 'string' ? value.code : ''
  const message = typeof value.message === 'string' ? value.message : ''
  if (/too many emails today/i.test(message)) return new EmailCodeError('daily_limit', message)
  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(message)) return new EmailCodeError('busy', message)
  const after = /after (\d{1,4}) seconds?/i.exec(message)
  if (after) return new EmailCodeError('cooldown', message, Math.min(3600, Number(after[1])))
  if (value.status === 429 || /rate_limit|over_.*limit/.test(code) || /rate limit|too many/i.test(message)) return new EmailCodeError('rate_limited', message)
  if (/otp_expired|invalid_credentials|token/.test(code) || /expired|invalid.*(token|otp|code)/i.test(message)) return new EmailCodeError('invalid_code', message)
  if (/signup_disabled|email_address_not_authorized|email_address_invalid|otp_disabled|email_provider_disabled/.test(code)) return new EmailCodeError('not_allowed', message)
  return new EmailCodeError('unavailable', message)
}

export type EmailCodeSignInProps = {
  requestCode: (email: string) => Promise<void>
  verifyCode: (email: string, code: string) => Promise<void>
  onSignedIn: () => void
  /** Must match Authentication -> Providers -> Email -> Email OTP length. */
  codeLength?: number
}

const SCHOOL_EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@student\.ateneo\.edu$/
const RESEND_SECONDS = 60
// Auth refills its hourly email allowance gradually, so a few minutes is usually enough.
const BUSY_SECONDS = 180

// A field notice sits under the code input; a panel notice explains a limit and counts down to the next try.
type Notice = { tone: 'wait' | 'stop' | 'error'; title: string; body: string; hold?: number; field?: boolean }

function normalizeEmail(value: string) { return value.trim().toLowerCase() }
function emailProblem(value: string) {
  const email = normalizeEmail(value)
  if (!email) return 'Enter your school email.'
  if (!SCHOOL_EMAIL.test(email)) return 'Use your @student.ateneo.edu email.'
  return ''
}

function requestNotice(error: unknown): Notice {
  const failure = emailCodeErrorFrom(error)
  switch (failure.kind) {
    case 'busy': return { tone: 'wait', title: 'Sign-in emails are busy', hold: BUSY_SECONDS,
      body: 'The workspace sends up to 30 sign-in codes an hour, and that limit has just been reached. Try again in a few minutes, or use Google sign-in if it works for you.' }
    case 'cooldown': return { tone: 'wait', title: 'A code is already on its way', hold: failure.waitSeconds ?? RESEND_SECONDS,
      body: 'Check your inbox and spam folder for the last code before asking for another.' }
    case 'daily_limit': return { tone: 'stop', title: 'No more sign-in emails today', hold: RESEND_SECONDS,
      body: 'The workspace has sent all the email it can for today. Try again tomorrow, or sign in with Google. If this keeps happening, tell your committee head.' }
    case 'rate_limited': return { tone: 'wait', title: 'Too many requests', hold: RESEND_SECONDS,
      body: 'Too many codes were asked for from this network. Wait a minute, then try again.' }
    case 'not_allowed': return { tone: 'error', title: 'Email codes aren\'t available for this address',
      body: 'Use your @student.ateneo.edu email, or ask your committee head to check you are on this term\'s roster.' }
    default: return { tone: 'error', title: 'We couldn\'t send a code', body: 'Something went wrong on our side. Try again in a minute.' }
  }
}

function verifyNotice(error: unknown): Notice {
  const failure = emailCodeErrorFrom(error)
  if (failure.kind === 'invalid_code') return { tone: 'error', field: true, title: 'That code didn\'t work', body: 'Check the latest email or send a new code.' }
  if (failure.kind === 'rate_limited' || failure.kind === 'busy' || failure.kind === 'cooldown') return { tone: 'wait', title: 'Too many tries', hold: failure.waitSeconds ?? 300,
    body: 'Too many codes were checked from this network. Wait a few minutes, then send a new code.' }
  return { tone: 'error', title: 'We couldn\'t check that code', body: 'Try again in a moment.' }
}

function clock(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }

// Must match Supabase Auth > Sign In / Providers > Email OTP length (8 on this project).
export function EmailCodeSignIn({ requestCode, verifyCode, onSignedIn, codeLength = 8 }: EmailCodeSignInProps) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const codeInput = useRef<HTMLInputElement>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const lastTried = useRef('')

  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000))
  useEffect(() => {
    if (!resendAt) return
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= resendAt) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendAt])

  useEffect(() => { if (sentTo) codeInput.current?.focus() }, [sentTo])

  function hold(seconds: number) { const current = Date.now(); setNow(current); setResendAt(current + seconds * 1000) }

  async function send(target: string) {
    setBusy(true); setNotice(null)
    try {
      await requestCode(target)
      setSentTo(target); setCode(''); lastTried.current = ''
      hold(RESEND_SECONDS)
    } catch (cause) {
      const next = requestNotice(cause)
      setNotice(next)
      if (next.hold) hold(next.hold)
    } finally { setBusy(false) }
  }

  async function verify(value: string) {
    if (busy || value.length !== codeLength || value === lastTried.current) return
    lastTried.current = value
    setBusy(true); setNotice(null)
    try {
      await verifyCode(sentTo, value)
      onSignedIn()
    } catch (cause) {
      const next = verifyNotice(cause)
      setNotice(next)
      if (next.hold) hold(next.hold)
      window.setTimeout(() => codeInput.current?.select(), 0)
    } finally { setBusy(false) }
  }

  function submitEmail(event: FormEvent) {
    event.preventDefault()
    const problem = emailProblem(email)
    setEmailError(problem)
    if (problem) { emailInput.current?.focus(); return }
    void send(normalizeEmail(email))
  }

  function submitCode(event: FormEvent) {
    event.preventDefault()
    if (code.length !== codeLength) { setNotice({ tone: 'error', field: true, title: `Enter the ${codeLength}-digit code from the email.`, body: '' }); return }
    lastTried.current = ''
    void verify(code)
  }

  function changeCode(raw: string) {
    // Paste-friendly: keep digits only, so "123 456" or "Code: 12345678" both work.
    const digits = raw.replace(/\D/g, '').slice(0, codeLength)
    setCode(digits)
    if (notice?.field) setNotice(null)
    if (digits.length === codeLength) void verify(digits)
  }

  function changeEmail() {
    setSentTo(''); setCode(''); setNotice(null); setResendAt(0); lastTried.current = ''
    window.setTimeout(() => emailInput.current?.focus(), 0)
  }

  const errorId = `${id}-error`
  const Icon = notice?.tone === 'stop' ? MailX : notice?.tone === 'wait' ? Clock3 : CircleAlert
  const codeInvalid = notice?.field === true
  return <details className="email-code">
    <summary className="email-code__summary">Can't use Google? Get a code by email</summary>
    <div className="email-code__body">
      {!sentTo ? <form className="email-code__form" onSubmit={submitEmail} noValidate>
        <p className="muted">If your school Google account says "Access blocked", we can email you a sign-in code instead. You still need to be on this term's roster.</p>
        <div className="form-field">
          <label htmlFor={`${id}-email`}>School email</label>
          <input ref={emailInput} id={`${id}-email`} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
            placeholder="name@student.ateneo.edu" value={email} disabled={busy}
            aria-invalid={emailError ? true : undefined} aria-describedby={emailError ? `${id}-email-error` : notice ? errorId : undefined}
            onChange={(event) => { setEmail(event.target.value); if (emailError) setEmailError('') }}
            onBlur={() => { if (email.trim()) setEmailError(emailProblem(email)) }} />
          {emailError ? <p className="field-error" id={`${id}-email-error`}>{emailError}</p> : null}
        </div>
        <button className="button button--secondary" type="submit" disabled={busy || waitSeconds > 0}>
          {busy ? 'Sending code…' : waitSeconds > 0 ? `Try again in ${clock(waitSeconds)}` : 'Email me a code'}
        </button>
      </form> : <form className="email-code__form" onSubmit={submitCode} noValidate>
        <p role="status">We sent a code to <strong>{sentTo}</strong>. It can take a minute to arrive. Check spam if you don't see it.</p>
        <div className="form-field">
          <label htmlFor={`${id}-code`}>{codeLength}-digit code</label>
          <input ref={codeInput} id={`${id}-code`} className="email-code__code" type="text" inputMode="numeric" autoComplete="one-time-code"
            maxLength={codeLength * 3} value={code} disabled={busy}
            aria-invalid={codeInvalid ? true : undefined} aria-describedby={notice ? errorId : undefined}
            onChange={(event) => changeCode(event.target.value)} />
          {codeInvalid ? <p className="field-error" id={errorId} role="alert">{notice.title}{notice.body ? ' ' + notice.body : ''}</p> : null}
        </div>
        <button className="button button--secondary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
        <div className="email-code__actions">
          <button className="button button--quiet" type="button" disabled={busy || waitSeconds > 0} onClick={() => void send(sentTo)}>
            {waitSeconds > 0 ? `Send a new code in ${clock(waitSeconds)}` : 'Send a new code'}
          </button>
          <button className="button button--quiet" type="button" disabled={busy} onClick={changeEmail}>Use a different email</button>
        </div>
      </form>}
      {notice && !codeInvalid ? <div className={`email-code__notice email-code__notice--${notice.tone}`}>
        <Icon className="email-code__notice-icon" size={20} strokeWidth={1.75} aria-hidden="true" />
        <div>
          {/* Announced once; the ticking countdown sits outside the alert so it isn't read out every second. */}
          <div id={errorId} role="alert"><p className="email-code__notice-title">{notice.title}</p><p>{notice.body}</p></div>
          {notice.hold && waitSeconds > 0 ? <p className="email-code__notice-wait">You can try again in <strong>{clock(waitSeconds)}</strong>.</p>
            : notice.hold ? <p className="email-code__notice-wait">You can try again now.</p> : null}
        </div>
      </div> : null}
    </div>
  </details>
}
