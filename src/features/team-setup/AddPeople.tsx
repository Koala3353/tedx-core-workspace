import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { FileUp } from 'lucide-react'
import { Status } from '../../components/Status'
import type { AddResult, Committee, NewPerson, OpenPosition, TeamPerson, TeamSetupApi, Wave } from './api'
import { Dialog } from './Dialog'
import { chunk, positionsFor, previewRows, schoolEmail, skipReason, waveOptions } from './model'

type Shared = {
  api: TeamSetupApi
  termId: string
  committees: Committee[]
  openPositions: OpenPosition[]
  roster: TeamPerson[]
  onClose: () => void
  onAdded: () => void
}

const failureText = {
  not_deployed: "Team setup isn't switched on yet. The database update is pending.",
  denied: 'Only project managers can add people.',
  invalid: 'Something in the list could not be read. Check the rows and try again.',
  unavailable: "Couldn't reach the workspace. Your entries are kept. Check your connection and try again.",
} as const

function ResultSummary({ result }: { result: AddResult }) {
  const queued = result.added.filter(a => a.welcomeQueued).length
  return <div className="ts-result" role="status">
    {result.added.length ? <p><Status state="done" label={`${result.added.length} added`} /></p> : null}
    {result.added.length ? <p>{queued === result.added.length
      ? `Welcome email queued for ${queued === 1 ? 'them' : `all ${queued}`}. It goes out from 8 AM Manila time.`
      : queued > 0
        ? `Welcome email queued for ${queued} of ${result.added.length}. The rest will see the app when they sign in with Google.`
        : 'No welcome email was queued (email sending is off for this term). Tell them to sign in with their school Google account.'}</p> : null}
    {result.skipped.length ? <>
      <p><Status state="returned" tone="warn" label={`${result.skipped.length} skipped`} /></p>
      <ul className="ts-result__list">{result.skipped.map((s, i) => <li key={s.email + i}><span className="ts-mono">{s.email || 'Row without email'}</span> · {skipReason(s.reason)}</li>)}</ul>
    </> : null}
  </div>
}

/* ---------- Add one person ---------- */

export function AddPersonDialog({ api, termId, committees, openPositions, roster, onClose, onAdded }: Shared) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [committee, setCommittee] = useState('')
  const [position, setPosition] = useState('')
  const [wave, setWave] = useState<Wave | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AddResult | null>(null)
  const request = useRef<{ key: string; id: string } | null>(null)

  const normalized = email.trim().toLowerCase()
  const emailError = !normalized ? 'Enter their school email.'
    : !schoolEmail.test(normalized) ? 'Use their @student.ateneo.edu address.'
      : roster.some(p => p.email.toLowerCase() === normalized) ? 'This person is already on the roster.' : ''
  const nameError = name.trim() ? '' : 'Enter their name.'
  const positions = positionsFor(openPositions, committee || null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setEmailTouched(true)
    if (emailError || nameError || busy) return
    const person: NewPerson = { name: name.trim(), email: normalized, committeeCode: committee || null, roleCode: position || null, wave: wave || null }
    const key = JSON.stringify(person)
    // Same details keep the same request id, so a retry after a dropped connection cannot add twice.
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
    setBusy(true); setError('')
    const outcome = await api.add(termId, [person], request.current.id)
    setBusy(false)
    if (!outcome.ok) { setError(failureText[outcome.reason]); return }
    setResult(outcome.value)
    if (outcome.value.added.length) onAdded()
  }

  function addAnother() {
    setName(''); setEmail(''); setEmailTouched(false); setPosition(''); setResult(null); request.current = null
  }

  if (result) {
    return <Dialog title={result.added.length ? 'Person added' : 'Not added'} onClose={onClose}
      footer={<><button type="button" className="button button--secondary" onClick={addAnother}>Add another</button><button type="button" className="button" data-autofocus onClick={onClose}>Done</button></>}>
      <ResultSummary result={result} />
    </Dialog>
  }

  return <Dialog title="Add a person" description="They get a welcome email and can sign in with their school Google account." onClose={onClose}
    footer={<><button type="button" className="button button--secondary" onClick={onClose}>Cancel</button><button type="submit" form="ts-add-person" className="button" disabled={busy}>{busy ? 'Adding…' : 'Add person'}</button></>}>
    <form id="ts-add-person" className="ts-form" onSubmit={submit} noValidate>
      <div className="form-field">
        <label htmlFor="ts-name">Name</label>
        <input id="ts-name" data-autofocus value={name} maxLength={200} autoComplete="off" onChange={e => setName(e.target.value)}
          aria-invalid={emailTouched && nameError ? true : undefined} aria-describedby={emailTouched && nameError ? 'ts-name-error' : undefined} />
        {emailTouched && nameError ? <p className="field-error" id="ts-name-error">{nameError}</p> : null}
      </div>
      <div className="form-field">
        <label htmlFor="ts-email">School email</label>
        <input id="ts-email" type="email" inputMode="email" autoComplete="off" spellCheck={false} value={email} placeholder="name@student.ateneo.edu"
          onChange={e => setEmail(e.target.value)} onBlur={() => setEmailTouched(Boolean(email.trim()) || emailTouched)}
          aria-invalid={emailTouched && emailError ? true : undefined} aria-describedby={emailTouched && emailError ? 'ts-email-error' : undefined} />
        {emailTouched && emailError ? <p className="field-error" id="ts-email-error">{emailError}</p> : null}
      </div>
      <div className="form-field">
        <label htmlFor="ts-committee">Committee</label>
        <select id="ts-committee" value={committee} onChange={e => { setCommittee(e.target.value); setPosition('') }}>
          <option value="">No committee yet</option>
          {committees.map(c => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="ts-position">Position (optional)</label>
        <p className="field-hint" id="ts-position-hint">Only open positions are listed. Leave it as committee member if unsure.</p>
        <select id="ts-position" value={position} aria-describedby="ts-position-hint" onChange={e => setPosition(e.target.value)} disabled={!positions.length}>
          <option value="">{committee ? 'Committee member' : 'No position'}</option>
          {positions.map(p => <option key={p.roleCode} value={p.roleCode}>{p.roleName}{!committee && p.committeeCode ? ` (${p.committeeCode})` : ''}</option>)}
        </select>
      </div>
      <fieldset className="ts-choice">
        <legend>Wave</legend>
        <label><input type="radio" name="ts-wave" value="" checked={wave === ''} onChange={() => setWave('')} /> Not set</label>
        {waveOptions.map(w => <label key={w.value}><input type="radio" name="ts-wave" value={w.value} checked={wave === w.value} onChange={() => setWave(w.value)} /> {w.label}</label>)}
      </fieldset>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </form>
  </Dialog>
}

/* ---------- Paste a list ---------- */

export function PasteListDialog({ api, termId, committees, openPositions, roster, onClose, onAdded }: Shared) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<AddResult | null>(null)
  const attempt = useRef<{ key: string; ids: string[]; done: AddResult[] } | null>(null)
  const preview = useMemo(() => previewRows(text, committees, openPositions, roster), [text, committees, openPositions, roster])
  const ready = preview.rows.filter(r => r.person)
  const blocked = preview.rows.length - ready.length

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 1_000_000) { setError('That file is too big. Keep it under 1 MB.'); return }
    try { setText(await file.text()); setError('') } catch { setError("Couldn't read that file. Try copying the rows and pasting them instead.") }
  }

  async function importRows() {
    if (!ready.length || busy) return
    const people = ready.map(r => r.person!)
    const batches = chunk(people, 50)
    const key = JSON.stringify(people)
    // A retry with the same rows reuses each batch's request id and skips batches already done.
    if (attempt.current?.key !== key) attempt.current = { key, ids: batches.map(() => crypto.randomUUID()), done: [] }
    const current = attempt.current
    setBusy(true); setError('')
    for (let i = current.done.length; i < batches.length; i++) {
      setProgress(batches.length > 1 ? `Adding batch ${i + 1} of ${batches.length}…` : 'Adding…')
      const outcome = await api.add(termId, batches[i], current.ids[i])
      if (!outcome.ok) {
        setBusy(false); setProgress('')
        setError(failureText[outcome.reason] + (current.done.length ? ` ${current.done.reduce((n, r) => n + r.added.length, 0)} people were already added; trying again continues from there.` : ''))
        if (current.done.some(r => r.added.length)) onAdded()
        return
      }
      current.done.push(outcome.value)
    }
    setBusy(false); setProgress('')
    const merged = { added: current.done.flatMap(r => r.added), skipped: current.done.flatMap(r => r.skipped) }
    setResult(merged)
    if (merged.added.length) onAdded()
  }

  if (result) {
    return <Dialog title="Import finished" onClose={onClose} footer={<button type="button" className="button" data-autofocus onClick={onClose}>Done</button>}>
      <ResultSummary result={result} />
      {blocked ? <p className="ts-muted">{blocked} {blocked === 1 ? 'row was' : 'rows were'} left out before importing because of the problems shown in the preview.</p> : null}
    </Dialog>
  }

  return <Dialog wide title="Paste a list" onClose={onClose}
    description="Copy rows from Google Sheets and paste them here: name, email, committee, position, wave. A header row is optional."
    footer={<>
      <button type="button" className="button button--secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="button" disabled={!ready.length || busy} onClick={importRows}>{busy ? progress || 'Adding…' : ready.length ? `Import ${ready.length} ${ready.length === 1 ? 'person' : 'people'}` : 'Import'}</button>
    </>}>
    <div className="ts-form">
      <div className="form-field">
        <label htmlFor="ts-paste">Rows</label>
        <textarea id="ts-paste" data-autofocus className="ts-textarea" value={text} rows={7} spellCheck={false} onChange={e => setText(e.target.value)}
          placeholder={'Juan dela Cruz\tjuan.delacruz@student.ateneo.edu\tLogistics\t\tWave 1'} />
      </div>
      <label className="button button--secondary ts-file">
        <FileUp className="icon" size={16} strokeWidth={1.75} aria-hidden="true" />Choose a .csv file
        <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="visually-hidden" onChange={readFile} />
      </label>
      {preview.rows.length ? <section aria-labelledby="ts-preview-title">
        <h3 id="ts-preview-title" className="ts-subhead">Preview</h3>
        <p className="ts-muted" role="status">{ready.length} ready{blocked ? `, ${blocked} with problems (left out)` : ''}.{preview.header ? ' First row read as headers.' : ' No header row found, so columns are read in order: name, email, committee, position, wave.'}</p>
        <div className="ts-scroll" tabIndex={0} role="region" aria-label="Preview rows">
          <table className="ts-table ts-table--preview">
            <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Committee</th><th scope="col">Position</th><th scope="col">Wave</th><th scope="col">Check</th></tr></thead>
            <tbody>{preview.rows.map(r => <tr key={r.line} className={r.errors.length ? 'is-error' : undefined}>
              <td className="numeric">{r.line}</td><td>{r.name || 'Blank'}</td><td className="ts-mono">{r.email || 'Blank'}</td>
              <td>{r.person?.committeeCode ?? (r.committeeText || 'Blank')}</td><td>{r.positionText || 'Blank'}</td><td>{r.waveText || 'Blank'}</td>
              <td>{r.errors.length
                ? <><Status state="blocked" label="Fix" /><ul className="ts-issues">{r.errors.map(e => <li key={e}>{e}</li>)}</ul></>
                : <><Status state="done" label="Ready" />{r.warnings.length ? <ul className="ts-issues ts-issues--warn">{r.warnings.map(w => <li key={w}>{w}</li>)}</ul> : null}</>}
              </td>
            </tr>)}</tbody>
          </table>
        </div>
      </section> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  </Dialog>
}
