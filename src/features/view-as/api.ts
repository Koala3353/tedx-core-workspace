import type { createSupabaseClient } from '../../lib/supabase'
import type { OverviewResult } from '../overview/api'
import type { OwnedTask } from '../tasks/api'
import type { NotificationPage } from '../notifications/api'

export type PreviewView = 'today' | 'work' | 'notifications'

export type DirectoryMember = {
  membershipId: string
  name: string
  committee: string | null
  committeeCode: string | null
  position: string | null
  signedIn: boolean
  isSelf: boolean
}

type PreviewData = { today: OverviewResult; work: { items: OwnedTask[]; total: number; page: number }; notifications: NotificationPage }
type PreviewMember = { membershipId: string; name: string }

export type MemberPreviewResult<V extends PreviewView = PreviewView> =
  | { state: 'ok'; view: V; member: PreviewMember; targetIsAdmin: boolean; data: PreviewData[V] }
  | { state: 'not_signed_in_yet' | 'unavailable'; view: V; member: PreviewMember }

/** Why a call returned nothing. `not_deployed` means the database update is not applied yet. */
export type ViewAsFailure = 'not_deployed' | 'denied' | 'invalid' | 'unavailable'
export type ViewAsOutcome<T> = { ok: true; value: T } | { ok: false; reason: ViewAsFailure }

export interface ViewAsApi {
  directory(termId: string): Promise<ViewAsOutcome<DirectoryMember[]>>
  view<V extends PreviewView>(termId: string, membershipId: string, view: V): Promise<ViewAsOutcome<MemberPreviewResult<V>>>
}

type RpcError = { code?: string; message?: string } | null
type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isNullableString = (v: unknown): v is string | null => v === null || v === undefined || typeof v === 'string'
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function failure(error: RpcError): ViewAsFailure {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  // PostgREST reports a missing function as PGRST202; Postgres itself as 42883.
  if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(message)) return 'not_deployed'
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST302' || message === 'command_permission_denied') return 'denied'
  if (code === '22023' || code === '22P02') return 'invalid'
  return 'unavailable'
}

function directoryMember(value: unknown): DirectoryMember | null {
  if (!isRecord(value) || typeof value.membershipId !== 'string' || !uuid.test(value.membershipId)
    || !isNullableString(value.name) || !isNullableString(value.committee) || !isNullableString(value.committeeCode)
    || !isNullableString(value.position) || typeof value.signedIn !== 'boolean') return null
  return {
    membershipId: value.membershipId, name: value.name || 'Unnamed member', committee: value.committee ?? null,
    committeeCode: value.committeeCode ?? null, position: value.position ?? null, signedIn: value.signedIn, isSelf: value.isSelf === true,
  }
}

// Light shape checks: the data comes from the same readers the member's own app calls.
function validData(view: PreviewView, data: unknown): boolean {
  if (!isRecord(data) || !Array.isArray(data.items)) return false
  if (view === 'today') return typeof data.hasMore === 'boolean' && data.items.every(i => isRecord(i) && typeof i.id === 'string' && typeof i.title === 'string' && typeof i.source === 'string')
  if (view === 'work') return Number.isSafeInteger(data.total) && data.items.every(i => isRecord(i) && typeof i.id === 'string' && typeof i.title === 'string')
  return Number.isSafeInteger(data.unread) && data.items.every(i => isRecord(i) && typeof i.id === 'string' && typeof i.label === 'string')
}

/** Read-only "view as a member" for full administrators. Every preview call is audited server side. */
export function createViewAsApi(ready: ReturnType<typeof createSupabaseClient>): ViewAsApi {
  async function call(name: string, args: Record<string, unknown>): Promise<ViewAsOutcome<unknown>> {
    try {
      const client = await ready
      if (!client) return { ok: false, reason: 'unavailable' }
      const rpc = client.rpc.bind(client) as unknown as Rpc
      const { data, error } = await rpc(name, args)
      return error ? { ok: false, reason: failure(error) } : { ok: true, value: data }
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
  }
  return {
    async directory(termId) {
      const result = await call('read_member_directory_for_preview', { p_term_id: termId })
      if (!result.ok) return result
      const list = isRecord(result.value) && Array.isArray(result.value.members) ? result.value.members.map(directoryMember) : null
      if (!list || list.some(m => m === null)) return { ok: false, reason: 'unavailable' }
      return { ok: true, value: list as DirectoryMember[] }
    },
    async view(termId, membershipId, view) {
      const result = await call('preview_member_view', { p_term_id: termId, p_membership_id: membershipId, p_view: view })
      if (!result.ok) return result
      const v = result.value
      if (!isRecord(v) || v.view !== view || !isRecord(v.member) || typeof v.member.membershipId !== 'string') return { ok: false, reason: 'unavailable' }
      const member = { membershipId: v.member.membershipId, name: typeof v.member.name === 'string' && v.member.name ? v.member.name : 'Unnamed member' }
      if (v.state === 'not_signed_in_yet' || v.state === 'unavailable') return { ok: true, value: { state: v.state, view, member } }
      if (v.state !== 'ok' || !validData(view, v.data)) return { ok: false, reason: 'unavailable' }
      return { ok: true, value: { state: 'ok', view, member, targetIsAdmin: v.targetIsAdmin === true, data: v.data as PreviewData[typeof view] } }
    },
  }
}
