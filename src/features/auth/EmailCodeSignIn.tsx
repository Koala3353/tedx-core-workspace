import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import './EmailCodeSignIn.css'

// Email one-time-code sign-in for students whose school Google account is blocked from the Google consent screen.
// The integrator implements requestCode/verifyCode in gateway.ts with the existing Supabase client and throws
// emailCodeErrorFrom(error) on failure so this component can show the right message.

export type EmailCodeErrorKind = 'rate_limited' | 'invalid_code' | 'not_allowed' | 'unavailable'
export class EmailCodeError extends Error {
  readonly kind: EmailCodeErrorKind
  constructor(kind: EmailCodeErrorKind, message: string = kind) { super(message); this.kind = kind; this.name = 'EmailCodeError' }
}

/** Maps a Supabase AuthError (or anything thrown) to an EmailCodeError. */
export function emailCodeErrorFrom(error: unknown): EmailCodeError {
  if (error instanceof EmailCodeError) return error
  const value = (error && typeof error === 'object' ? error : {}) as { status?: unknown; code?: unknown; message?: unknown }
  const code = typeof value.code === 'string' ? value.code : ''
  const message = typeof value.message === 'string' ? value.message : ''
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

function normalizeEmail(value: string) { return value.trim().toLowerCase() }
function emailProblem(value: string) {
  const email = normalizeEmail(value)
  if (!email) return 'Enter your school email.'
  if (!SCHOOL_EMAIL.test(email)) return 'Use your @student.ateneo.edu email.'
  return ''
}

function requestMessage(error: unknown) {
  const { kind } = emailCodeErrorFrom(error)
  if (kind === 'rate_limited') return 'Too many codes asked for. Wait a minute, then try again.'
  if (kind === 'not_allowed') return 'Email codes aren\'t available for this address. Use your @student.ateneo.edu email or ask your committee head.'
  return 'We couldn\'t send a code. Try again in a minute.'
}

function verifyMessage(error: unknown) {
  const { kind } = emailCodeErrorFrom(error)
  if (kind === 'rate_limited') return 'Too many tries. Wait a minute, then send a new code.'
  if (kind === 'invalid_code') return 'That code didn\'t work. Check the latest email or send a new one.'
  return 'We couldn\'t check that code. Try again in a moment.'
}

export function EmailCodeSignIn({ requestCode, verifyCode, onSignedIn, codeLength = 6 }: EmailCodeSignInProps) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
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

  function holdResend() { const current = Date.now(); setNow(current); setResendAt(current + RESEND_SECONDS * 1000) }

  async function send(target: string) {
    setBusy(true); setError('')
    try {
      await requestCode(target)
      setSentTo(target); setCode(''); lastTried.current = ''
      holdResend()
    } catch (cause) {
      setError(requestMessage(cause))
      if (emailCodeErrorFrom(cause).kind === 'rate_limited') holdResend()
    } finally { setBusy(false) }
  }

  async function verify(value: string) {
    if (busy || value.length !== codeLength || value === lastTried.current) return
    lastTried.current = value
    setBusy(true); setError('')
    try {
      await verifyCode(sentTo, value)
      onSignedIn()
    } catch (cause) {
      setError(verifyMessage(cause))
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
    if (code.length !== codeLength) { setError(`Enter the ${codeLength}-digit code from the email.`); return }
    lastTried.current = ''
    void verify(code)
  }

  function changeCode(raw: string) {
    // Paste-friendly: keep digits only, so "123 456" or "Code: 123456" both work.
    const digits = raw.replace(/\D/g, '').slice(0, codeLength)
    setCode(digits)
    if (error) setError('')
    if (digits.length === codeLength) void verify(digits)
  }

  function changeEmail() {
    setSentTo(''); setCode(''); setError(''); setResendAt(0); lastTried.current = ''
    window.setTimeout(() => emailInput.current?.focus(), 0)
  }

  const errorId = `${id}-error`
  return <details className="email-code">
    <summary className="email-code__summary">Can't use Google? Get a code by email</summary>
    <div className="email-code__body">
      {!sentTo ? <form className="email-code__form" onSubmit={submitEmail} noValidate>
        <p className="muted">If your school Google account says "Access blocked", we can email you a sign-in code instead. You still need to be on this term's roster.</p>
        <div className="form-field">
          <label htmlFor={`${id}-email`}>School email</label>
          <input ref={emailInput} id={`${id}-email`} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
            placeholder="name@student.ateneo.edu" value={email} disabled={busy}
            aria-invalid={emailError ? true : undefined} aria-describedby={emailError ? `${id}-email-error` : error ? errorId : undefined}
            onChange={(event) => { setEmail(event.target.value); if (emailError) setEmailError('') }}
            onBlur={() => { if (email.trim()) setEmailError(emailProblem(email)) }} />
          {emailError ? <p className="field-error" id={`${id}-email-error`}>{emailError}</p> : null}
        </div>
        <button className="button button--secondary" type="submit" disabled={busy || waitSeconds > 0}>
          {busy ? 'Sending code…' : waitSeconds > 0 ? `Try again in ${waitSeconds}s` : 'Email me a code'}
        </button>
      </form> : <form className="email-code__form" onSubmit={submitCode} noValidate>
        <p role="status">We sent a code to <strong>{sentTo}</strong>. It can take a minute to arrive. Check spam if you don't see it.</p>
        <div className="form-field">
          <label htmlFor={`${id}-code`}>{codeLength}-digit code</label>
          <input ref={codeInput} id={`${id}-code`} className="email-code__code" type="text" inputMode="numeric" autoComplete="one-time-code"
            maxLength={codeLength * 3} value={code} disabled={busy}
            aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
            onChange={(event) => changeCode(event.target.value)} />
        </div>
        <button className="button button--secondary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
        <div className="email-code__actions">
          <button className="button button--quiet" type="button" disabled={busy || waitSeconds > 0} onClick={() => void send(sentTo)}>
            {waitSeconds > 0 ? `Send a new code in ${waitSeconds}s` : 'Send a new code'}
          </button>
          <button className="button button--quiet" type="button" disabled={busy} onClick={changeEmail}>Use a different email</button>
        </div>
      </form>}
      {error ? <p className="field-error" id={errorId} role="alert">{error}</p> : null}
    </div>
  </details>
}
