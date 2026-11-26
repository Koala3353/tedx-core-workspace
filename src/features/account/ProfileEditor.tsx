import { useEffect, useRef, useState, type FormEvent } from 'react'
import '../shared/shared.css'
import { Panel } from '../../components/Page'
import { TextField } from '../../components/TextField'
import { LoadingState } from '../../components/FeedbackState'
import type { OwnProfile, ProfileGateway, ProfileValues, ProfileVisibility } from './gateway'

const fields = [
  { value: 'course', share: 'shareCourse', label: 'Course', max: 200 },
  { value: 'yearLevel', share: 'shareYearLevel', label: 'Year level', max: 80 },
  { value: 'phone', share: 'sharePhone', label: 'Personal phone', max: 80 },
  { value: 'externalContact', share: 'shareExternalContact', label: 'Other contact (e.g. Telegram)', max: 320 },
  { value: 'skills', share: 'shareSkills', label: 'Skills', max: 1000 },
  { value: 'pronunciation', share: 'sharePronunciation', label: 'Name pronunciation', max: 200 },
  { value: 'affiliation', share: 'shareAffiliation', label: 'Affiliation', max: 80 },
] as const
export function ProfileEditor({ api, termId }: { api: ProfileGateway; termId: string }) {
  const [current, setCurrent] = useState<OwnProfile | null>(null)
  const [values, setValues] = useState<ProfileValues>({ course: null, yearLevel: null, phone: null, externalContact: null, skills: null, pronunciation: null, affiliation: null })
  const [visibility, setVisibility] = useState<ProfileVisibility>({ shareCourse: false, shareYearLevel: false, sharePhone: false, shareExternalContact: false, shareSkills: false, sharePronunciation: false, shareAffiliation: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const pending = useRef<{ signature: string; id: string } | null>(null)
  useEffect(() => {
    let active = true
    void api.read(termId).then(result => {
      if (!active) return
      setCurrent(result); setValues(result); setVisibility(result); pending.current = null
    }).catch(() => { if (active) setError('Couldn\'t load your profile. Check your connection and try again.') })
    return () => { active = false }
  }, [api, termId, reload])
  const dirtyValues = !!current && fields.some(field => (current[field.value] ?? null) !== (values[field.value] ?? null))
  const dirtySharing = !!current && fields.some(field => current[field.share] !== visibility[field.share])
  async function send(command: 'values' | 'visibility', base: OwnProfile): Promise<OwnProfile> {
    // Explicit whitelists keep server identity/version fields out of payloads.
    const privateValues: ProfileValues = { course: values.course, yearLevel: values.yearLevel, phone: values.phone, externalContact: values.externalContact, skills: values.skills, pronunciation: values.pronunciation, affiliation: values.affiliation }
    const choices: ProfileVisibility = { shareCourse: visibility.shareCourse, shareYearLevel: visibility.shareYearLevel, sharePhone: visibility.sharePhone, shareExternalContact: visibility.shareExternalContact, shareSkills: visibility.shareSkills, sharePronunciation: visibility.sharePronunciation, shareAffiliation: visibility.shareAffiliation }
    const signature = JSON.stringify([termId, command, base.version, command === 'values' ? privateValues : choices])
    if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() }
    const result = command === 'values' ? await api.save(termId, privateValues, base.version, pending.current.id) : await api.share(termId, choices, base.version, pending.current.id)
    pending.current = null
    return result
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!current || busy) return
    if (!dirtyValues && !dirtySharing) { setNotice('No changes to save.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      let latest = current
      if (dirtyValues) { latest = await send('values', latest); setCurrent(latest) }
      if (dirtySharing) { latest = await send('visibility', latest); setCurrent(latest) }
      setValues(latest); setVisibility(latest)
      setNotice('Saved.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Couldn\'t save. Try again.') }
    finally { setBusy(false) }
  }
  return <Panel title="Your profile">
    <p className="muted">Everything here is optional. Tick "Show in directory" to let other core members see a field.</p>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {!current && !error ? <LoadingState /> : null}
    {current ? <form onSubmit={event => void save(event)}>
        <fieldset className="profile-fields" disabled={busy}>
          <legend className="visually-hidden">Profile details</legend>
          {fields.map(field => <div className="paired-field" key={field.value}>
            <TextField id={`profile-${field.value}`} label={field.label} hint={field.value === 'affiliation' ? 'A short note about yourself for this term. It doesn\'t change your role.' : undefined} maxLength={field.max} value={values[field.value] ?? ''} onChange={event => setValues({ ...values, [field.value]: event.target.value || null })} autoComplete="off" />
            <label className="share-toggle"><input type="checkbox" checked={visibility[field.share]} onChange={event => setVisibility({ ...visibility, [field.share]: event.target.checked })} aria-describedby={`profile-${field.value}`} />Show in directory</label>
          </div>)}
          <div className="auth-actions"><button className="button" type="submit">{busy ? 'Saving…' : 'Save'}</button>{dirtyValues || dirtySharing ? <button className="button button--quiet" type="button" onClick={() => { setValues(current); setVisibility(current); setNotice(''); setError('') }}>Discard changes</button> : null}</div>
        </fieldset>
      </form> : error ? <button className="button button--secondary" type="button" onClick={() => { setError(''); setReload(reload + 1) }}>Try again</button> : null}
  </Panel>
}
