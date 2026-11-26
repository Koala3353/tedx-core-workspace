import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { forgetRecordDrafts } from '../../auth/draftScope'
import { downloadCsv } from '../../exports/downloadCsv'
import { useFinDecision } from '../../finance/DecisionMemory'
import { spreadsheetCsv } from '../../imports/csv'
import { formatDateTime } from '../../shared/dates'
import type { RequestDetail } from './api'
import { profileFields, type Fulfillment, type FulfillmentApi, type FulfillmentCommand, type ProfileField, type ProfileResponse } from './fulfillment'

const options: Record<'member' | 'guest', ProfileField[]> = {
  member: ['course', 'yearLevel', 'phone', 'externalContact', 'skills', 'pronunciation', 'affiliation'],
  guest: ['displayName', 'contactRoute'],
}
const messages = {
  waiting: 'A custodian is reviewing your request.',
  step_up: 'You need a stronger sign-in to open or review this response. Sign in again with your school account\'s extra verification, or ask the privacy contact for help.',
  paused: 'This response isn\'t available right now. Ask the privacy contact why.',
  finished: 'Review recorded. The requester can now open their response.',
  identity_needed: 'Waiting for the requester\'s identity to be confirmed through the official privacy channel.',
  stale: 'The profile, identity check or custodian changed. Add a new handling update before preparing another response.',
}

function ProfileValues({ values, sharing }: Pick<ProfileResponse, 'values' | 'sharing'>) {
  return <dl>{(Object.keys(profileFields) as ProfileField[]).filter(field => Object.hasOwn(values, field)).map(field =>
    <div key={field}>
      <dt>{profileFields[field]}</dt>
      <dd className="privacy-text">{values[field] ?? 'Blank'}{Object.hasOwn(sharing, field) &&
        <small className="muted"> · {sharing[field] ? 'Sharing enabled' : 'Private'}</small>}</dd>
    </div>)}</dl>
}

export function FulfillmentPanel({ api, term, request, refresh }: {
  api: FulfillmentApi; term: string; request: RequestDetail; refresh: () => void
}) {
  const record = 'privacy-fulfillment:' + request.id
  const fieldId = useId()
  const [view, setView] = useState<Fulfillment | null>(null)
  const [response, setResponse] = useState<ProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)
  const [denied, setDenied] = useState(false)
  const [message, setMessage] = useState('')
  const live = useRef(false)
  const { id, version, kind } = request
  const isCorrection = kind === 'correction'
  const isExport = kind === 'export'
  function clearDenied() {
    forgetRecordDrafts(id)
    setView(null)
    setResponse(null)
    setDenied(true)
  }
  const decision = useFinDecision({
    async run(command: FulfillmentCommand, key: string) {
      const result = await api.run(command, key)
      if (live.current && !result.ok && result.error.kind === 'permission_denied') clearDenied()
      if (live.current && !result.ok && result.error.kind === 'stale_version') setView(null)
      return result
    },
  }, record, { field: '', value: '', base: String(version) })
  const stale = String(version) !== decision.fields.base
  const expires = view && 'validUntil' in view ? view.validUntil : null
  useLayoutEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])
  useEffect(() => {
    let current = true
    setLoading(true)
    setView(null)
    setResponse(null)
    setDenied(false)
    void api.read({ term, id }).then(data => {
      if (!current) return
      setView(data)
      if (!data || data.status === 'step_up') {
        forgetRecordDrafts(id)
        setDenied(!data)
      }
    }).catch(error => {
      if (!current) return
      if (isDenied(error)) {
        forgetRecordDrafts(id)
        setDenied(true)
      } else setMessage('Couldn\'t load the profile review. Reload this request to try again.')
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [api, term, id, version])
  useEffect(() => {
    if (!expires) return
    const timeout = window.setTimeout(() => {
      setResponse(null)
      setView(null)
      setMessage('Your access to this response ended. Reload this request to see the current status.')
    }, Math.max(0, Math.min(Date.parse(expires) - Date.now(), 2_147_483_647)))
    return () => window.clearTimeout(timeout)
  }, [expires])

  async function run(command?: FulfillmentCommand) {
    if (await decision.run(command)) refresh()
  }
  async function open() {
    if (opening) return
    setOpening(true)
    setResponse(null)
    setMessage('')
    try {
      const result = await api.response({ term, id }, isExport)
      if (!live.current) return
      if (!result || Date.parse(result.validUntil) <= Date.now() || result.reference !== request.reference) {
        setView(null)
        setMessage('Access changed. Reload this request, then open the response again.')
        return
      }
      if (isExport) {
        const fields = (Object.keys(profileFields) as ProfileField[]).filter(field => Object.hasOwn(result.values, field))
        const csv = spreadsheetCsv([['request_reference', 'profile_field', 'value', 'sharing_enabled'], ...fields.map(field =>
          [result.reference, profileFields[field], result.values[field] ?? '', String(result.sharing[field] ?? '')])])
        downloadCsv(csv, 'tedx-profile-' + result.reference + '.csv')
        setMessage('Profile CSV downloaded.')
      } else setResponse(result)
    } catch (error) {
      if (!live.current) return
      if (isDenied(error)) clearDenied()
      else setMessage('Couldn\'t open the response. Reload this request and try again.')
    } finally {
      if (live.current) setOpening(false)
    }
  }

  if (denied) return <p role="alert">You no longer have access to this response, so it was hidden.</p>

  return <section data-unsaved-changes={!!decision.fields.value} data-pending-command={decision.locked}>
    <h2>Profile response</h2>
    <p>This covers your profile in this workspace. For other records, contact the privacy office.</p>
    {loading && <p role="status">Loading…</p>}
    {view && view.status in messages && <p role="status">{messages[view.status as keyof typeof messages]}</p>}
    {view?.status === 'released' && <button type="button" className="button" disabled={opening} onClick={() => void open()}>
      {isExport ? 'Download my profile CSV' : 'Open my profile response'}
    </button>}
    {response && <section aria-label="Profile response">
      <ProfileValues values={response.values} sharing={response.sharing} />
      <button type="button" className="button button--secondary" onClick={() => setResponse(null)}>Close</button>
    </section>}
    {(view?.status === 'ready' || view?.status === 'prepared') && <section aria-label="Custodian response review">
      <p>Identity check {view.verificationReference} · Valid until {formatDateTime(view.validUntil)}</p>
      {Object.keys(view.values).length > 0 && <ProfileValues values={view.values} sharing={view.sharing} />}
      {view.status === 'ready' && <>
        {isCorrection && <>
          <label htmlFor={fieldId}>Profile field to correct</label>
          <select id={fieldId} value={decision.fields.field} disabled={decision.locked}
            onChange={e => decision.change({ ...decision.fields, field: e.target.value })}>
            <option value="">Choose a field</option>
            {options[view.audience].map(field => <option key={field} value={field}>{profileFields[field]}</option>)}
          </select>
          <label htmlFor={fieldId + '-value'}>Corrected value</label>
          <textarea id={fieldId + '-value'} value={decision.fields.value} rows={3} maxLength={1000}
            disabled={decision.locked} onChange={e => decision.change({ ...decision.fields, value: e.target.value })} />
          <p>Leave it blank to clear the field. A second custodian checks the change before it\'s applied.</p>
        </>}
        {stale && <button type="button" className="button button--secondary" disabled={decision.locked}
          onClick={() => decision.change({ ...decision.fields, base: String(version) })}>Keep my changes</button>}
        <button type="button" className="button" disabled={decision.locked || stale || isCorrection && !decision.fields.field}
          onClick={() => void run({ action: 'prepare', term, id, version,
            field: isCorrection ? decision.fields.field : null, value: isCorrection ? decision.fields.value : null })}>
          Send for second review
        </button>
      </>}
      {view.status === 'prepared' && <>
        {view.correctionField && <p className="privacy-text">Proposed {profileFields[view.correctionField]} value · {view.correctionValue ?? 'Clear this field'}</p>}
        {view.canApprove && view.reviewHash
          ? <button type="button" className="button" disabled={decision.locked}
              onClick={() => void run({ action: 'approve', term, id, version, reviewHash: view.reviewHash! })}>
              {isCorrection ? 'Approve correction and release' : 'Approve and release'}
            </button>
          : <p>Another privacy custodian has to review and release this.</p>}
      </>}
    </section>}
    {decision.pending && view && view.status !== 'step_up' && <button type="button" className="button button--secondary" disabled={decision.busy}
      onClick={() => void run()}>Try again</button>}
    {decision.error && <p role="alert">{decision.error}</p>}
    {message && <p role="status">{message}</p>}
  </section>
}

function isDenied(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error &&
    (error.code === '42501' || error.code === 'PGRST301' || error.code === 'PGRST302')
}
