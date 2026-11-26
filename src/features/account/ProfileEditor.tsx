import { useEffect, useRef, useState, type FormEvent } from 'react'
import '../shared/shared.css'
import { Panel } from '../../components/Page'
import { TextField } from '../../components/TextField'
import { LoadingState } from '../../components/FeedbackState'
import { contactError, contactHandle, contactText, contactUrl } from '../people/contacts'
import { profileFields, visibleToCore, type OwnProfile, type ProfileGateway, type ProfileValues } from './gateway'

const empty: ProfileValues = { course: null, yearLevel: null, messenger: null, telegram: null }
const pick = (p: ProfileValues): ProfileValues => ({ course: p.course, yearLevel: p.yearLevel, messenger: p.messenger, telegram: p.telegram })

/** Save changed profile values, then make them visible to core members. Shared by Account and the setup wizard. */
export async function saveProfile(api: ProfileGateway, termId: string, base: OwnProfile, values: ProfileValues,
  requestId: (signature: string) => string): Promise<OwnProfile> {
  // Explicit whitelist keeps server identity/version fields out of payloads.
  const payload: Partial<ProfileValues> = { course: values.course, yearLevel: values.yearLevel,
    ...(base.contactsAvailable ? { messenger: values.messenger, telegram: values.telegram } : {}) }
  let next = await api.save(termId, payload as ProfileValues, base.version, requestId(JSON.stringify(['values', base.version, payload])))
  const visibility = visibleToCore(next)
  if (visibility) next = await api.share(termId, visibility, next.version, requestId(JSON.stringify(['visibility', next.version, visibility])))
  return next
}

export function profileDirty(base: OwnProfile, values: ProfileValues): boolean {
  return profileFields.some(field => (base[field.value] ?? '') !== (values[field.value] ?? ''))
}

export function ProfileEditor({ api, termId }: { api: ProfileGateway; termId: string }) {
  const [current, setCurrent] = useState<OwnProfile | null>(null)
  const [values, setValues] = useState<ProfileValues>(empty)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const pending = useRef(new Map<string, string>())
  useEffect(() => {
    let active = true
    void api.read(termId).then(result => {
      if (!active) return
      setCurrent(result); setValues(pick(result)); pending.current.clear()
    }).catch(() => { if (active) setError('Couldn\'t load your profile. Check your connection and try again.') })
    return () => { active = false }
  }, [api, termId, reload])
  const fields = profileFields.filter(field => current?.contactsAvailable || (field.value !== 'messenger' && field.value !== 'telegram'))
  const problems = { messenger: contactError('messenger', values.messenger), telegram: contactError('telegram', values.telegram) }
  const dirty = !!current && profileDirty(current, values)
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!current || busy) return
    setTouched(true)
    if (problems.messenger || problems.telegram) return
    if (!dirty) { setNotice('No changes to save.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      // The same details keep the same request ids, so a retry can't apply twice.
      const latest = await saveProfile(api, termId, current, values, signature => {
        const key = termId + signature
        if (!pending.current.has(key)) pending.current.set(key, crypto.randomUUID())
        return pending.current.get(key)!
      })
      pending.current.clear()
      setCurrent(latest); setValues(pick(latest)); setTouched(false)
      setNotice('Saved.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Couldn\'t save. Try again.') }
    finally { setBusy(false) }
  }
  return <Panel title="Your profile">
    <p className="muted">Everything here is optional. Core members can see what you add, so they can reach you.</p>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {!current && !error ? <LoadingState /> : null}
    {current ? <form onSubmit={event => void save(event)} noValidate>
        <fieldset className="profile-fields" disabled={busy}>
          <legend className="visually-hidden">Profile details</legend>
          {fields.map(field => {
            const problem = field.value === 'messenger' || field.value === 'telegram' ? problems[field.value] : ''
            const handle = field.value === 'messenger' || field.value === 'telegram' ? contactHandle(field.value, values[field.value]) : null
            return <div key={field.value}>
              <TextField id={`profile-${field.value}`} label={field.label} hint={field.hint} placeholder={field.placeholder} maxLength={field.max}
                value={values[field.value] ?? ''} autoComplete="off" spellCheck={false}
                error={touched && problem ? problem : undefined}
                onBlur={() => { if (problem) setTouched(true) }}
                onChange={event => setValues({ ...values, [field.value]: event.target.value || null })} />
              {handle && (field.value === 'messenger' || field.value === 'telegram') ? <p className="muted">Opens as <a href={contactUrl(field.value, handle)} target="_blank" rel="noopener noreferrer">{contactText(field.value, handle)}</a></p> : null}
            </div>
          })}
          <div className="auth-actions"><button className="button" type="submit">{busy ? 'Saving…' : 'Save'}</button>{dirty ? <button className="button button--quiet" type="button" onClick={() => { setValues(pick(current)); setTouched(false); setNotice(''); setError('') }}>Discard changes</button> : null}</div>
        </fieldset>
      </form> : error ? <button className="button button--secondary" type="button" onClick={() => { setError(''); setReload(reload + 1) }}>Try again</button> : null}
  </Panel>
}
