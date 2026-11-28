import { useEffect, useRef, useState, type FormEvent } from 'react'
import '../shared/shared.css'
import { Panel } from '../../components/Page'
import { TextField } from '../../components/TextField'
import { LoadingState } from '../../components/FeedbackState'
import { contactError, contactHandle, contactText, contactUrl } from '../people/contacts'
import { useRevalidator } from 'react-router'
import { celebrate } from '../../components/celebrate'
import { invalidatePeopleOptions } from '../people/peopleOptions'
import { cleanDisplayName, displayNameError, profileFields, visibleToCore, type OwnProfile, type ProfileGateway, type ProfileValues } from './gateway'

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

/** `bare` drops the panel and heading, for the Settings page which supplies its own section heading. */
export function ProfileEditor({ api, termId, bare = false }: { api: ProfileGateway; termId: string; bare?: boolean }) {
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
  const content = <>
    {!bare ? <p className="muted">Everything here is optional. Core members can see what you add, so they can reach you.</p> : null}
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {!current && !error ? <LoadingState /> : null}
    {current && api.rename && current.nameVersion !== null ? <DisplayNameForm api={api} termId={termId} profile={current} onSaved={next => setCurrent({ ...current, ...next })} /> : null}
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
  </>
  return bare ? <div className="profile-editor">{content}</div> : <Panel title="Your profile">{content}</Panel>
}

/**
 * Your display name, as everyone in the workspace sees it. Saved on its own (it isn't part of the
 * private profile). The same name keeps the same request id, so a retry can't apply twice.
 * Names already copied onto older records (task owners, history) keep the name used at the time.
 */
function DisplayNameForm({ api, termId, profile, onSaved }: { api: ProfileGateway; termId: string; profile: OwnProfile; onSaved: (next: { displayName: string; nameVersion: number }) => void }) {
  const [name, setName] = useState(profile.displayName)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<{ signature: string; key: string } | null>(null)
  const revalidator = useRevalidator()
  const problem = displayNameError(name)
  const dirty = cleanDisplayName(name) !== profile.displayName
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !api.rename || profile.nameVersion === null) return
    setTouched(true)
    if (problem || !dirty) return
    const clean = cleanDisplayName(name), signature = JSON.stringify([clean, profile.nameVersion])
    const request = pending.current?.signature === signature ? pending.current : { signature, key: crypto.randomUUID() }
    pending.current = request
    const button = (event.nativeEvent as SubmitEvent).submitter
    setBusy(true); setError('')
    try {
      const next = await api.rename(termId, clean, profile.nameVersion, request.key)
      pending.current = null
      setName(next.displayName); setTouched(false)
      await celebrate(button, 'save')
      onSaved(next)
      invalidatePeopleOptions(termId)
      // The header and menus read the name from the workspace context.
      void revalidator.revalidate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Couldn\'t save your name. Try again.')
    } finally { setBusy(false) }
  }
  return <form className="display-name-form" onSubmit={event => void submit(event)} noValidate>
    <fieldset className="profile-fields" disabled={busy}>
      <legend className="visually-hidden">Display name</legend>
      <TextField id="profile-display-name" label="Display name" maxLength={160} autoComplete="name" value={name}
        hint="How your name shows on tasks, the directory and pickers. Older records keep the name used at the time."
        error={touched && problem ? problem : undefined}
        onBlur={() => { if (problem) setTouched(true) }}
        onChange={event => { setName(event.target.value); setError('') }} />
      {error ? <p role="alert">{error}</p> : null}
      <div className="auth-actions">
        <button className="button" type="submit" disabled={!dirty && !busy}>{busy ? 'Saving…' : 'Save name'}</button>
        {dirty && !busy ? <button className="button button--quiet" type="button" onClick={() => { setName(profile.displayName); setTouched(false); setError('') }}>Discard change</button> : null}
      </div>
    </fieldset>
  </form>
}
