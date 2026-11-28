import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { PendingButton } from '../../../components/PendingButton'
import { TextField } from '../../../components/TextField'
import { toast } from '../../../components/Toast'
import { celebrate } from '../../../components/celebrate'
import { formatDateTime } from '../../shared/dates'
import { useRevealOnMount } from '../../../components/useReveal'
import { invalidatePeopleOptions } from '../../people/peopleOptions'
import type { BatchItem, BatchPreview, BatchRowError, Deployment, OrganizationApi, OrganizationData } from './api'

export type BulkChange = { kind: 'move'; unitId: string } | { kind: 'level'; type: string } | { kind: 'end' }
export type BulkContext = { api: OrganizationApi; term: string; refresh: () => void }
type Row = { label: string; item: BatchItem; source: string }

export const placementTypes = ['member', 'head', 'associate', 'primary_contact', 'backup_contact']
export const typeName = (t: string) => { const x = t.replaceAll('_', ' '); return x[0].toUpperCase() + x.slice(1) }
const nextMinute = () => new Date(Math.ceil((Date.now() + 60000) / 60000) * 60000).toISOString()
const values = (d: Pick<Deployment, 'memberId' | 'unitId' | 'type' | 'from' | 'to' | 'state'> & { id: string | null }) =>
  ({ id: d.id, memberId: d.memberId, unitId: d.unitId, type: d.type, from: d.from, to: d.to, state: d.state })

/**
 * Turns a bulk change into the same deployment_save payloads the single editor publishes.
 * A placement's committee and level can't be edited in place, so moving or changing level ends the
 * old placement at `at` (or revokes it when it hasn't started) and starts the new one at the same
 * instant. A person who had that exact placement before gets the old row reopened (one row per
 * person, committee and level).
 */
export function buildBatch(v: OrganizationData, selected: Deployment[], change: BulkChange, at: string): { rows: Row[]; skipped: string[] } {
  const rows: Row[] = [], skipped: string[] = [], claimed = new Set<string>()
  const name = (d: Deployment) => v.members.find(m => m.id === d.memberId)?.name ?? 'Member'
  const unit = (id: string) => v.units.find(u => u.id === id)
  const ending = (d: Deployment): Row => Date.parse(d.from) >= Date.parse(at)
    ? { source: d.id, label: name(d) + ' · cancel upcoming ' + typeName(d.type).toLowerCase() + ' placement in ' + (unit(d.unitId)?.code ?? 'committee'), item: { kind: 'organization', action: 'deployment_save', values: values({ ...d, state: 'revoked' }) } }
    : { source: d.id, label: name(d) + ' · end ' + typeName(d.type).toLowerCase() + ' placement in ' + (unit(d.unitId)?.code ?? 'committee'), item: { kind: 'organization', action: 'deployment_save', values: values({ ...d, to: at }) } }
  for (const d of selected) {
    if (change.kind === 'end') { rows.push(ending(d)); continue }
    const unitId = change.kind === 'move' ? change.unitId : d.unitId, type = change.kind === 'level' ? change.type : d.type
    if (unitId === d.unitId && type === d.type) { skipped.push(name(d) + ' is already ' + typeName(type).toLowerCase() + ' in ' + (unit(unitId)?.code ?? 'that committee') + '.'); continue }
    const slot = d.memberId + unitId + type
    const existing = v.deployments.find(x => x.memberId === d.memberId && x.unitId === unitId && x.type === type)
    if (claimed.has(slot) || existing && existing.state === 'active' && Date.parse(existing.to) > Date.now()) {
      skipped.push(name(d) + ' already has a ' + typeName(type).toLowerCase() + ' placement in ' + (unit(unitId)?.code ?? 'that committee') + '.'); continue
    }
    claimed.add(slot)
    const from = Date.parse(d.from) > Date.parse(at) ? d.from : at
    rows.push(ending(d))
    rows.push({
      source: d.id,
      label: name(d) + ' · start as ' + typeName(type).toLowerCase() + ' in ' + (unit(unitId)?.code ?? 'committee'),
      item: { kind: 'organization', action: 'deployment_save', values: values({ id: existing?.id ?? null, memberId: d.memberId, unitId, type, from, to: d.to, state: 'active' }) },
    })
  }
  return { rows, skipped }
}

export function bulkTitle(v: OrganizationData, selected: Deployment[], change: BulkChange) {
  const people = new Set(selected.map(d => d.memberId)).size, who = people === 1 ? '1 person' : people + ' people'
  const placements = selected.length === 1 ? '1 placement' : selected.length + ' placements'
  if (change.kind === 'move') return 'Move ' + who + ' to ' + (v.units.find(u => u.id === change.unitId)?.name ?? 'another committee')
  if (change.kind === 'level') return 'Change ' + placements + ' to ' + typeName(change.type).toLowerCase()
  return 'End ' + placements
}

const rowReason = (e: BatchRowError) =>
  e.code === '55000' ? 'They still own open work or are a service contact here. Reassign that first.'
    : e.code === '23505' ? 'They already have this placement.'
      : e.code === '40001' ? 'This changed since you opened it. Preview again.'
        : e.code === '42501' ? 'You can\'t change this placement.'
          : e.code === '22023' || e.code === '22P02' || e.code === '22007' ? 'The dates don\'t fit their time on the roster, or the placement changed.'
            : 'This change couldn\'t be applied.'

/** Review panel for a bulk change: one reason, one preview for the whole batch, one publish. */
export function BulkEditor({ v, ctx, selected, change, close, done, leaveOut }: { v: OrganizationData; ctx: BulkContext; selected: Deployment[]; change: BulkChange; close: () => void; done: () => void; leaveOut: (deploymentId: string) => void }) {
  const [at] = useState(nextMinute)
  const { rows, skipped } = useMemo(() => buildBatch(v, selected, change, at), [v, selected, change, at])
  const [reason, setReason] = useState(''), [checked, setChecked] = useState<{ value: BatchPreview; reason: string; items: string } | null>(null)
  const [previewing, setPreviewing] = useState(false), [publishing, setPublishing] = useState(false), [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState(''), [published, setPublished] = useState<{ errors: BatchRowError[]; items: string } | null>(null), [retrying, setRetrying] = useState(false)
  const pending = useRef<{ signature: string; key: string } | null>(null)
  const root = useRevealOnMount<HTMLElement>()
  const title = bulkTitle(v, selected, change)
  const items = rows.map(r => r.item), signature = JSON.stringify(items)
  // A preview only counts for the exact rows it checked; changing the selection asks for a new one.
  const preview = checked && checked.items === signature ? checked : null
  const setPreview = (value: { value: BatchPreview; reason: string } | null) => setChecked(value && { ...value, items: signature })
  const failed = preview ? preview.value.errors : published && published.items === signature ? published.errors : []

  async function check() {
    setPreviewing(true); setError(''); setPublished(null); setConfirmed(false)
    try { setPreview({ value: await ctx.api.previewBatch!(ctx.term, items), reason }) }
    catch { setPreview(null); setError('Couldn\'t preview the impact. Check your connection, then preview again.') }
    finally { setPreviewing(false) }
  }
  async function publish(button: HTMLElement) {
    if (!preview || preview.value.blocked || !confirmed || !reason.trim()) return
    const command = { term: ctx.term, items, version: preview.value.version, fingerprint: preview.value.fingerprint, reason: reason.trim() }
    const signature = JSON.stringify(command)
    const request = pending.current?.signature === signature ? pending.current : { signature, key: crypto.randomUUID() }
    pending.current = request
    setPublishing(true); setError('')
    const result = await ctx.api.runBatch!(command, request.key)
    setPublishing(false)
    if (!result.ok) { setError(result.error.message); setRetrying(result.error.retryable); if (!result.error.retryable) pending.current = null; return }
    pending.current = null; setRetrying(false)
    if (!result.value.ok) {
      setPreview(null); setConfirmed(false); setPublished({ errors: result.value.errors, items: signature })
      setError(result.value.stale ? 'Something changed since your preview, so nothing was published. Preview again.' : 'Nothing was published. Fix or deselect the rows below, then preview again.')
      return
    }
    await celebrate(button, 'save')
    toast(result.value.count === 1 ? 'Published 1 change' : 'Published ' + result.value.count + ' changes')
    invalidatePeopleOptions(ctx.term)
    done(); ctx.refresh()
  }

  const openWork = preview ? [...new Map(preview.value.items.flatMap(i => i.impact?.openWork ?? []).map(w => [w.id, w])).values()] : []
  const notes = preview ? [...new Set(preview.value.items.map(i => i.impact?.accessDelta.message).filter((m): m is string => !!m))] : []
  const locked = previewing || publishing || retrying

  return <section ref={root} className="organization-inline-editor organization-bulk-editor reveal-enter" aria-labelledby="organization-bulk-title">
    <h2 id="organization-bulk-title">{title}</h2>
    <p className="muted">Takes effect {formatDateTime(at)}. Each person's old placement ends then and the new one starts at the same time.</p>
    {skipped.length ? <div className="organization-bulk-skipped"><p>Left out of this change:</p><ul>{skipped.map(s => <li key={s}>{s}</li>)}</ul></div> : null}
    {rows.length ? <>
      <details className="organization-bulk-rows"><summary>{rows.length === 1 ? '1 change' : rows.length + ' changes'} to publish</summary>
        <ol>{rows.map((r, i) => <li key={i}>{r.label}</li>)}</ol></details>
      <fieldset className="organization-editor" disabled={locked}>
        <TextField id="organization-bulk-reason" label="Change reason" required maxLength={1000} value={reason}
          hint="Saved with every change in this batch." onChange={e => { setReason(e.target.value); setConfirmed(false) }} />
        <PendingButton className="button button--secondary" pending={previewing} pendingLabel="Checking impact…" disabled={!rows.length} onClick={() => void check()}>Preview impact</PendingButton>
      </fieldset>
    </> : <p>Nothing to change. Pick different people or a different change.</p>}
    {error ? <p role="alert">{error}</p> : null}
    {failed.length ? <div role="alert" className="organization-bulk-errors"><p>{failed.length === 1 ? '1 row can\'t be published' : failed.length + ' rows can\'t be published'}:</p>
      <ul>{failed.map(e => <li key={e.index}><strong>{rows[e.index]?.label ?? 'Row ' + (e.index + 1)}</strong>. {rowReason(e)}{rows[e.index] ? <> <button type="button" className="button button--quiet organization-bulk-leave" disabled={publishing} onClick={() => leaveOut(rows[e.index].source)}>Leave out</button></> : null}</li>)}</ul></div> : null}
    {preview && !preview.value.blocked ? <section aria-label="Impact preview" className="reveal-enter">
      <h3>Impact preview</h3>
      <p>All {rows.length === 1 ? 'changes' : rows.length + ' changes'} checked. Nothing moves over automatically: roles, assignments and record access stay where they are.</p>
      {notes.map(n => <p key={n}>{n}</p>)}
      {openWork.length ? <><h4>Open work to check with the people involved</h4><ul>{openWork.map(w => <li key={w.id}>{w.href ? <Link to={w.href}>{w.title}</Link> : w.title}</li>)}</ul></> : null}
      <label className="organization-confirm"><input type="checkbox" disabled={locked} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I checked who gains or loses access and want to make these changes.</label>
    </section> : null}
    {!preview ? <p className="muted">Preview the impact first. Publishing unlocks once you've checked it.</p> : null}
    <div className="auth-actions">
      <PendingButton className="button" pending={publishing} pendingLabel="Publishing…"
        disabled={!preview || preview.value.blocked || !confirmed || previewing || !reason.trim() || preview.reason !== reason}
        onClick={e => void publish(e.currentTarget)}>{retrying ? 'Retry identical batch' : rows.length > 1 ? 'Publish ' + rows.length + ' changes' : 'Publish change'}</PendingButton>
      <button type="button" className="button button--secondary" disabled={publishing} onClick={close}>Cancel</button>
    </div>
  </section>
}

/** Sticky bar shown while placements are selected. */
export function BulkBar({ v, count, people, onApply, onClear, onSelectAll, allSelected }: {
  v: OrganizationData; count: number; people: number; onApply: (change: BulkChange) => void; onClear: () => void; onSelectAll: () => void; allSelected: boolean
}) {
  const units = v.units.filter(u => !u.archivedAt)
  const [unitId, setUnitId] = useState(units[0]?.id ?? ''), [type, setType] = useState('member')
  return <div className="organization-bulk-bar" role="region" aria-label="Bulk placement changes">
    <p className="organization-bulk-bar__count" aria-live="polite"><strong>{count === 1 ? '1 placement' : count + ' placements'}</strong> selected ({people === 1 ? '1 person' : people + ' people'})</p>
    <div className="organization-bulk-bar__actions">
      <div className="organization-bulk-bar__group">
        <label htmlFor="organization-bulk-unit" className="visually-hidden">Committee to move to</label>
        <select id="organization-bulk-unit" value={unitId} onChange={e => setUnitId(e.target.value)}>{units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <button type="button" className="button button--secondary" disabled={!unitId} onClick={() => onApply({ kind: 'move', unitId })}>Move</button>
      </div>
      <div className="organization-bulk-bar__group">
        <label htmlFor="organization-bulk-type" className="visually-hidden">New level</label>
        <select id="organization-bulk-type" value={type} onChange={e => setType(e.target.value)}>{placementTypes.map(t => <option key={t} value={t}>{typeName(t)}</option>)}</select>
        <button type="button" className="button button--secondary" onClick={() => onApply({ kind: 'level', type })}>Change level</button>
      </div>
      <button type="button" className="button button--secondary" onClick={() => onApply({ kind: 'end' })}>End placement</button>
      {!allSelected ? <button type="button" className="button button--quiet" onClick={onSelectAll}>Select all shown</button> : null}
      <button type="button" className="button button--quiet" onClick={onClear}>Clear</button>
    </div>
  </div>
}
