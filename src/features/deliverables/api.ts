import {optionalWorkReference,type WorkReferenceValue} from '../work-references/api'
import {readinessCategories,type ReadinessCategory} from './readiness-api'
import type { createSupabaseClient } from '../../lib/supabase'
import type { Json } from '../../lib/database.types'
import { MY_COMMITTEE, compactFilters, readMyUnits, validOptionalCount, validUnitFacets, type MyUnit, type UnitFacet } from '../shared/serverList'
export type Named = { id: string; name: string }
export type Deliverable = {
  reference?: WorkReferenceValue|null
  workflowState?: 'proposed'|'draft'|'in_progress'|'submitted'|'accepted'|'cancelled'
  id: string; termId: string; title: string; summary: string; owner: Named & { active: boolean }; leadUnit: Named | null
  supportingUnits: Named[]; phase: string | null; dueAt: string | null; dueOn: string | null; originalDueAt: string | null; originalDueOn: string | null
  overdue: boolean; blocked: boolean; blocker: string | null; readiness: ReadinessCategory | 'blocked_provisional' | 'pending_gate_verification'; reviewRequired?:boolean; tasksComplete?:boolean; nextAction: string
  gates: { finance: 'pending_assessment'|'not_required'|'verified'|'pending'; publicity: 'pending_assessment'|'not_required'|'verified'|'pending'; acceptance: 'pending_definition'|ReadinessCategory }; updatedAt: string; archivedAt: string | null; version: number
}
export type DeliverableDetail = Deliverable & { details: { outcome: string | null; acceptanceCriteria: string | null; body: string } | null }
export type DeliverableSort = 'due' | 'title' | 'updated' | 'committee'
export const deliverableSorts: [DeliverableSort, string][] = [['due', 'Due date'], ['title', 'Title (A–Z)'], ['updated', 'Recently updated'], ['committee', 'Committee']]
/**
 * `unit` is one committee id, or 'mine' for the viewer's own committees (resolved into `units` by the page).
 * `q`, `sort` and `units` are optional so other callers can keep passing the original fields.
 */
export type Filters = { phase: string; unit: string; owner: string; blocked: boolean; overdue: boolean; mine: boolean; review: boolean; page: number; q?: string; sort?: DeliverableSort; units?: string[] }
export type DeliverableList = { items: Deliverable[]; total: number; page: number; pageSize: number; options: { phases: string[]; units: Named[]; owners: Named[] }; unfilteredTotal?: number; facets?: { units?: UnitFacet[] } }
export interface DeliverablesApi { list(termId: string, filters: Filters): Promise<DeliverableList>; read(id: string): Promise<DeliverableDetail | null>; myUnits?(termId: string): Promise<MyUnit[]> }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function parseFilters(search: string): Filters {
  const p = new URLSearchParams(search); const page = Number(p.get('page') ?? 1)
  const unit = p.get('unit') ?? ''; const sort = p.get('sort') ?? ''
  return { phase: (p.get('phase') ?? '').slice(0,80), unit: uuid.test(unit) || unit === MY_COMMITTEE ? unit : '', owner: uuid.test(p.get('owner') ?? '') ? p.get('owner')! : '',
    blocked: p.get('blocked') === '1', overdue: p.get('overdue') === '1', mine: p.get('mine') === '1', review: p.get('review') === '1', page: Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1,
    q: (p.get('q') ?? '').trim().slice(0, 200), sort: deliverableSorts.some(([s]) => s === sort) ? sort as DeliverableSort : 'due' }
}
export function filterSearch(f: Filters): string {
  const p = new URLSearchParams()
  for (const key of ['phase','unit','owner'] as const) if (f[key]) p.set(key,f[key])
  if (f.q?.trim()) p.set('q',f.q.trim())
  if (f.sort && f.sort !== 'due') p.set('sort',f.sort)
  for (const key of ['blocked','overdue','mine','review'] as const) if (f[key]) p.set(key,'1')
  if (f.page > 1) p.set('page',String(f.page))
  return p.toString() ? '?' + p.toString() : ''
}
function object(v: unknown): Record<string, unknown> | null { return v !== null && typeof v === 'object' ? v as Record<string, unknown> : null }
function named(v: unknown): v is Named { const n = object(v); return !!n && typeof n.id === 'string' && uuid.test(n.id) && typeof n.name === 'string' }
function row(v: unknown): v is Deliverable {
  const r = object(v); if (!r) return false
  const gates = object(r.gates); const owner = object(r.owner)
  if(r.workflowState!==undefined&&!['proposed','draft','in_progress','submitted','accepted','cancelled'].includes(r.workflowState as string))return false
  return optionalWorkReference(r.reference,'deliverable',r.termId as string)&&typeof r.id === 'string' && uuid.test(r.id) && typeof r.termId === 'string' && uuid.test(r.termId)
    && ['title','summary','nextAction','updatedAt'].every(k => typeof r[k] === 'string') && Number.isFinite(Date.parse(r.updatedAt as string))
    && ['phase','dueAt','dueOn','originalDueAt','originalDueOn','blocker','archivedAt'].every(k => r[k] === null || typeof r[k] === 'string')
    && named(r.owner) && !!owner && typeof owner.active === 'boolean' && (r.leadUnit === null || named(r.leadUnit))
    && Array.isArray(r.supportingUnits) && r.supportingUnits.every(named) && typeof r.overdue === 'boolean' && typeof r.blocked === 'boolean'
    && [...readinessCategories,'blocked_provisional','pending_gate_verification'].includes(r.readiness as string)&&(r.reviewRequired===undefined||typeof r.reviewRequired==='boolean')&&(r.tasksComplete===undefined||typeof r.tasksComplete==='boolean')
    && !!gates && ['pending_assessment','not_required','verified','pending'].includes(gates.finance as string) && ['pending_assessment','not_required','verified','pending'].includes(gates.publicity as string) && [...readinessCategories,'pending_definition'].includes(gates.acceptance as string)
    && Number.isInteger(r.version) && (r.version as number) > 0
}
export function createDeliverablesApi(ready: ReturnType<typeof createSupabaseClient>): DeliverablesApi {
  const message = 'Deliverables could not be loaded. Check your workspace access or connection and try again.'
  return {
    async list(termId, f) {
      try {
        const client = await ready; if (!client) throw new Error()
        // A single committee id still goes to p_unit_id; search, several committees ("My committee") and sort go in p_filters.
        const extra = compactFilters({ q: f.q, units: f.units, sort: f.sort && f.sort !== 'due' ? f.sort : undefined })
        const { data, error } = await client.rpc('list_deliverables', { p_term_id:termId,p_phase:f.phase || null,p_unit_id:uuid.test(f.unit) ? f.unit : null,p_owner_id:f.owner || null,p_blocked:f.blocked,p_overdue:f.overdue,p_involves_my_unit:f.mine,p_review_pending:f.review,p_page:f.page,p_page_size:20,...(Object.keys(extra).length ? { p_filters: extra as Json } : {}) })
        const r = object(data); const options = object(r?.options)
        if (error || !r || !Array.isArray(r.items) || !r.items.every(row) || !Number.isSafeInteger(r.total) || (r.total as number) < 0 || r.page !== f.page || r.pageSize !== 20
          || !validOptionalCount(r.unfilteredTotal) || (r.facets !== undefined && (!object(r.facets) || !validUnitFacets(object(r.facets)!.units)))
          || !options || !Array.isArray(options.phases) || !options.phases.every(v => typeof v === 'string') || !Array.isArray(options.units) || !options.units.every(named) || !Array.isArray(options.owners) || !options.owners.every(named)) throw new Error()
        return r as unknown as DeliverableList
      } catch { throw new Error(message) }
    },
    myUnits: termId => readMyUnits(ready, termId),
    async read(id) {
      if (!uuid.test(id)) return null
      try {
        const client = await ready; if (!client) throw new Error()
        const { data, error } = await client.rpc('read_deliverable', { p_work_item_id:id })
        if (error) throw new Error()
        if (data === null) return null
        const r = object(data); const detail = object(r?.details)
        if (!row(data) || !r || !(r.details === null || (detail && (detail.outcome === null || typeof detail.outcome === 'string') && (detail.acceptanceCriteria === null || typeof detail.acceptanceCriteria === 'string') && typeof detail.body === 'string'))) throw new Error()
        return data as unknown as DeliverableDetail
      } catch { throw new Error(message) }
    },
  }
}
