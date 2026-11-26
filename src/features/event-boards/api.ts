import type { createSupabaseClient } from '../../lib/supabase'
import { mapCommandError, type CommandResult } from '../../lib/commands'

export type BoardId = 'contest' | 'tedify'
export type BoardItem = {
  id: string; kind: 'task' | 'deliverable'; title: string; dueOn: string | null; dueAt: string | null
  /** status_definitions.semantic_category */
  state: string; stateLabel: string; committee: string | null
}
export type TedifySession = { id: string; version: number; title: string; speakerName: string | null; room: string | null; startsAt: string | null; endsAt: string | null; note: string | null }
export type BoardData = { items: BoardItem[]; sessions: TedifySession[] | null; canManageSessions: boolean; refreshedAt: string }
export type SessionValues = { title: string; speakerName?: string | null; room?: string | null; startsAt?: string | null; endsAt?: string | null; note?: string | null; archived?: boolean }

export interface EventBoardsApi {
  /** Null when the server functions are not deployed yet. Throws when the read fails. */
  read(termId: string, board: BoardId): Promise<BoardData | null>
  saveSession(termId: string, session: TedifySession | null, values: SessionValues, requestId: string): Promise<CommandResult<TedifySession>>
}

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const optText = (v: unknown, max: number) => v === null || (typeof v === 'string' && v.length <= max)
const stamp = (v: unknown) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)))
const day = (v: unknown) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))

function item(v: unknown): v is BoardItem {
  if (!v || typeof v !== 'object') return false
  const i = v as BoardItem
  return uuid(i.id) && (i.kind === 'task' || i.kind === 'deliverable') && typeof i.title === 'string' && i.title.length <= 240
    && day(i.dueOn) && stamp(i.dueAt) && typeof i.state === 'string' && typeof i.stateLabel === 'string' && optText(i.committee, 200)
}
function session(v: unknown): v is TedifySession {
  if (!v || typeof v !== 'object') return false
  const s = v as TedifySession
  return uuid(s.id) && Number.isSafeInteger(s.version) && typeof s.title === 'string' && s.title.length <= 160
    && optText(s.speakerName, 200) && optText(s.room, 120) && stamp(s.startsAt) && stamp(s.endsAt) && optText(s.note, 500)
}
function board(v: unknown): v is BoardData {
  if (!v || typeof v !== 'object') return false
  const b = v as BoardData
  return Array.isArray(b.items) && b.items.length <= 60 && b.items.every(item)
    && (b.sessions === null || (Array.isArray(b.sessions) && b.sessions.every(session)))
    && typeof b.canManageSessions === 'boolean' && stamp(b.refreshedAt)
}

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
const missing = (error: { code?: string } | null) => !!error && ['PGRST202', '42883'].includes(error.code ?? '')

/** Wraps read_event_board / save_tedify_session from 20261127310000_event_boards.sql. */
export function createEventBoardsApi(ready: ReturnType<typeof createSupabaseClient>): EventBoardsApi {
  async function rpc(name: string, args: Record<string, unknown>) {
    const client = await ready
    if (!client) throw new Error('Workspace connection is not set up.')
    return (client.rpc.bind(client) as unknown as Rpc)(name, args)
  }
  return {
    async read(termId, id) {
      const { data, error } = await rpc('read_event_board', { p_term_id: termId, p_board: id })
      if (missing(error)) return null
      if (error || !board(data)) throw new Error('Board could not be loaded.')
      return data
    },
    async saveSession(termId, current, values, requestId) {
      try {
        const { data, error } = await rpc('save_tedify_session', {
          p_term_id: termId, p_session_id: current?.id ?? null, p_values: values, p_expected_version: current?.version ?? null, p_request_id: requestId,
        })
        if (error) return { ok: false, error: mapCommandError(error) }
        return session(data) ? { ok: true, value: data } : { ok: false, error: mapCommandError({ code: 'COMMAND_UNAVAILABLE' }) }
      } catch { return { ok: false, error: mapCommandError({ code: 'COMMAND_UNAVAILABLE' }) } }
    },
  }
}
