import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { CircleCheck } from 'lucide-react'
import { PageHeading } from '../../components/Page'
import { ErrorState } from '../../components/FeedbackState'
import { formatTime } from '../../lib/format'
import { validToken, type CheckInReceipt, type EventQrApi } from './api'
import './event-qr.css'

/** Opened from the crew door QR code: one big "I'm here" button. */
export function CrewCheckInPage({ api }: { api: EventQrApi }) {
  const { token } = useParams()
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<CheckInReceipt | null>(null)
  const [error, setError] = useState('')
  const done = useRef<HTMLHeadingElement>(null)

  if (!validToken(token)) return <div className="eqr-checkin">
    <PageHeading title="Crew check-in" />
    <ErrorState title="This check-in code doesn't work" description="It may be old or cut off. Scan the code at the crew door again." />
  </div>

  async function checkIn(value: string) {
    setBusy(true); setError('')
    const result = await api.checkIn(value)
    setBusy(false)
    if (!result.ok) { setError(result.error.message); return }
    setReceipt(result.value)
    requestAnimationFrame(() => done.current?.focus())
  }

  return <div className="eqr-checkin">
    <PageHeading title="Crew check-in" description="Tap once when you arrive so the PMs know you’re here." />
    {receipt ? <section className="eqr-checkin__done" aria-labelledby="eqr-checkin-done">
      <CircleCheck size={48} strokeWidth={1.75} aria-hidden="true" />
      <h2 id="eqr-checkin-done" ref={done} tabIndex={-1}>
        {receipt.already ? `You’re already checked in, ${receipt.name}.` : `You’re checked in, ${receipt.name}.`}
      </h2>
      <p>{receipt.already ? 'You checked in' : 'Arrived'} at {formatTime(receipt.checkedInAt)}.</p>
      <Link className="button button--secondary" to="/event/run-of-show">Open the run of show</Link>
    </section> : <>
      <button type="button" className="button eqr-checkin__button" disabled={busy} onClick={() => void checkIn(token)}>
        {busy ? 'Checking you in…' : 'I’m here'}
      </button>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </>}
  </div>
}
