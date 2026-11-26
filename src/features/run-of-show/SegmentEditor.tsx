import { useId, useState, type FormEvent } from 'react'
import { segmentKinds, type Segment, type SegmentInput, type Unit } from './api'
import { kindLabels } from './time'

type Props = {
  segment: Segment | null
  units: Unit[]
  busy: boolean
  error: string
  onSave: (input: SegmentInput) => void
  onCancel: () => void
}

/** Add or edit one segment. Durations are entered as minutes and seconds. */
export function SegmentEditor({ segment, units, busy, error, onSave, onCancel }: Props) {
  const id = useId()
  const [title, setTitle] = useState(segment?.title ?? '')
  const [kind, setKind] = useState(segment?.kind ?? 'talk')
  const [minutes, setMinutes] = useState(segment ? String(Math.floor(segment.durationS / 60)) : '10')
  const [seconds, setSeconds] = useState(segment ? String(segment.durationS % 60) : '0')
  const [pinned, setPinned] = useState(segment?.plannedStart ?? '')
  const [owner, setOwner] = useState(segment?.ownerUnitId ?? '')
  const [notes, setNotes] = useState(segment?.cueNotes ?? '')
  const [problem, setProblem] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const m = Number(minutes), s = Number(seconds)
    if (!title.trim()) { setProblem('Give the segment a name, like “Speaker 3: Juan dela Cruz”.'); return }
    if (!Number.isInteger(m) || !Number.isInteger(s) || m < 0 || s < 0 || s > 59 || m * 60 + s > 86400) {
      setProblem('Enter the length as whole minutes and 0 to 59 seconds.'); return
    }
    setProblem('')
    onSave({
      ...(segment ? { id: segment.id, version: segment.version } : {}),
      title: title.trim(), kind, durationS: m * 60 + s, plannedStart: pinned || null,
      ownerUnitId: owner || null, cueNotes: notes.trim(),
    })
  }

  const shown = problem || error
  return <form className="ros-editor" onSubmit={submit} aria-labelledby={`${id}-heading`} noValidate>
    <h3 id={`${id}-heading`}>{segment ? `Edit ${segment.title}` : 'Add a segment'}</h3>
    <div className="ros-editor__grid">
      <div className="form-field ros-editor__wide">
        <label htmlFor={`${id}-title`}>Name (required)</label>
        <input id={`${id}-title`} value={title} maxLength={160} required onChange={e => setTitle(e.target.value)}
          aria-invalid={problem && !title.trim() ? true : undefined} />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-kind`}>Type</label>
        <select id={`${id}-kind`} className="ros-select" value={kind} onChange={e => setKind(e.target.value as Segment['kind'])}>
          {segmentKinds.map(k => <option key={k} value={k}>{kindLabels[k]}</option>)}
        </select>
      </div>
      <fieldset className="ros-editor__length">
        <legend>Length</legend>
        <div className="form-field">
          <label htmlFor={`${id}-min`}>Minutes</label>
          <input id={`${id}-min`} type="number" inputMode="numeric" min={0} max={1440} value={minutes} onChange={e => setMinutes(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor={`${id}-sec`}>Seconds</label>
          <input id={`${id}-sec`} type="number" inputMode="numeric" min={0} max={59} value={seconds} onChange={e => setSeconds(e.target.value)} />
        </div>
      </fieldset>
      <div className="form-field">
        <label htmlFor={`${id}-start`}>Fixed start time</label>
        <p className="field-hint" id={`${id}-start-hint`}>Leave blank to start right after the segment before it.</p>
        <input id={`${id}-start`} type="time" value={pinned} aria-describedby={`${id}-start-hint`} onChange={e => setPinned(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-owner`}>On cue</label>
        <select id={`${id}-owner`} className="ros-select" value={owner} onChange={e => setOwner(e.target.value)}>
          <option value="">No committee</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      <div className="form-field ros-editor__wide">
        <label htmlFor={`${id}-notes`}>Cue notes</label>
        <textarea id={`${id}-notes`} className="ros-textarea" value={notes} maxLength={2000} rows={3}
          placeholder="Walk-on music, lights, mic, slides" onChange={e => setNotes(e.target.value)} />
      </div>
    </div>
    {shown ? <p className="field-error" role="alert">{shown}</p> : null}
    <div className="ros-editor__actions">
      <button type="submit" className="button" disabled={busy}>{busy ? 'Saving…' : segment ? 'Save segment' : 'Add segment'}</button>
      <button type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  </form>
}
