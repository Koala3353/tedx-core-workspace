import type { createSupabaseClient } from '../../lib/supabase'
import { mapCommandError, type CommandResult } from '../../lib/commands'

/**
 * Committee quick links: public.read_committee_links, read_my_committee_links, save_committee_link and
 * reorder_committee_links (migration 20261129400000_committee_links.sql). Members of a committee,
 * its heads and full admins can read; heads and full admins can change.
 */
export type CommitteeLink = { id: string; version: number; title: string; url: string; note: string | null; pinned: boolean; position: number; createdAt: string; updatedAt: string }
export type CommitteeLinks = { unitId: string; limit: number; canManage: boolean; links: CommitteeLink[]; refreshedAt: string }
export type MyCommitteeLinks = { units: { unitId: string; code: string; name: string; canManage: boolean; total: number; links: CommitteeLink[] }[] }
export type LinkValues = { title: string; url: string; note?: string | null; pinned?: boolean; archived?: boolean }
export type SavedLink = CommitteeLink & { archived: boolean }

/** Read result: the list, "not allowed" (outside the committee), or "not switched on yet". */
export type LinksRead = { kind: 'ok'; value: CommitteeLinks } | { kind: 'denied' } | { kind: 'unavailable' }

/** Method names are unique so the committee pages API can include them (lazy APIs are flat). */
export interface CommitteeLinksApi {
  readLinks(termId: string, unitId: string): Promise<LinksRead>
  /** Null when not deployed yet. */
  readMyLinks(termId: string, limit?: number): Promise<MyCommitteeLinks | null>
  saveLink(termId: string, unitId: string, link: CommitteeLink | null, values: LinkValues, requestId: string): Promise<CommandResult<SavedLink>>
  reorderLinks(termId: string, unitId: string, order: string[], requestId: string): Promise<CommandResult<CommitteeLinks>>
}

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const stamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))

function link(v: unknown): v is CommitteeLink {
  return obj(v) && uuid(v.id) && Number.isSafeInteger(v.version) && typeof v.title === 'string' && v.title.length <= 120
    && typeof v.url === 'string' && v.url.startsWith('https://') && v.url.length <= 2000
    && (v.note === null || (typeof v.note === 'string' && v.note.length <= 280))
    && typeof v.pinned === 'boolean' && Number.isSafeInteger(v.position) && stamp(v.createdAt) && stamp(v.updatedAt)
}
function list(v: unknown): v is CommitteeLinks {
  return obj(v) && uuid(v.unitId) && Number.isSafeInteger(v.limit) && typeof v.canManage === 'boolean'
    && Array.isArray(v.links) && v.links.length <= 50 && v.links.every(link) && stamp(v.refreshedAt)
}
function mine(v: unknown): v is MyCommitteeLinks {
  return obj(v) && Array.isArray(v.units) && v.units.every(u => obj(u) && uuid(u.unitId) && typeof u.code === 'string' && typeof u.name === 'string'
    && typeof u.canManage === 'boolean' && Number.isSafeInteger(u.total) && Array.isArray(u.links) && u.links.every(link))
}
const saved = (v: unknown): v is SavedLink => link(v) && typeof (v as SavedLink).archived === 'boolean'

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
const missing = (error: { code?: string } | null) => !!error && ['PGRST202', '42883'].includes(error.code ?? '')
const unavailable = { ok: false as const, error: mapCommandError({ code: 'COMMAND_UNAVAILABLE' }) }

export function createCommitteeLinksApi(ready: ReturnType<typeof createSupabaseClient>): CommitteeLinksApi {
  async function rpc(name: string, args: Record<string, unknown>) {
    const client = await ready
    if (!client) throw new Error('Workspace connection is not set up.')
    return (client.rpc.bind(client) as unknown as Rpc)(name, args)
  }
  return {
    async readLinks(termId, unitId) {
      const { data, error } = await rpc('read_committee_links', { p_term_id: termId, p_unit_id: unitId })
      if (missing(error)) return { kind: 'unavailable' }
      if (error?.code === '42501') return { kind: 'denied' }
      if (error || !list(data)) throw new Error('Links could not be loaded.')
      return { kind: 'ok', value: data }
    },
    async readMyLinks(termId, limit = 5) {
      const { data, error } = await rpc('read_my_committee_links', { p_term_id: termId, p_limit: limit })
      if (missing(error)) return null
      if (error || !mine(data)) throw new Error('Links could not be loaded.')
      return data
    },
    async saveLink(termId, unitId, current, values, requestId) {
      try {
        const { data, error } = await rpc('save_committee_link', {
          p_term_id: termId, p_unit_id: unitId, p_link_id: current?.id ?? null, p_values: values,
          p_expected_version: current?.version ?? null, p_request_id: requestId,
        })
        if (error) return { ok: false, error: mapCommandError(error) }
        return saved(data) ? { ok: true, value: data } : unavailable
      } catch { return unavailable }
    },
    async reorderLinks(termId, unitId, order, requestId) {
      try {
        const { data, error } = await rpc('reorder_committee_links', { p_term_id: termId, p_unit_id: unitId, p_order: order, p_request_id: requestId })
        if (error) return { ok: false, error: mapCommandError(error) }
        return list(data) ? { ok: true, value: data } : unavailable
      } catch { return unavailable }
    },
  }
}
