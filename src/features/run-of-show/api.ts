import { mapCommandError, type CommandResult } from '../../lib/commands'
import type { createSupabaseClient } from '../../lib/supabase'

export type SegmentKind = 'talk' | 'performance' | 'host' | 'break' | 'tech'
export type SegmentStatus = 'planned' | 'live' | 'done' | 'skipped'
export type ShowPhase = 'idle' | 'running' | 'held' | 'finished'
export type Unit = { id: string; code: string; name: string }
export type Segment = {
  id: string; position: number; title: string; kind: SegmentKind
  /** Pinned start "HH:MM", or null to follow the previous segment. */
  plannedStart: string | null
  /** Computed start "HH:MM" from the show start and earlier durations. */
  scheduledStart: string | null
  durationS: number; ownerUnitId: string | null; ownerUnit: string | null; ownerUnitCode: string | null
  cueNotes: string; status: SegmentStatus; actualStart: string | null; actualEnd: string | null; version: number
}
export type ShowState = {
  showStart: string | null; phase: ShowPhase; currentSegmentId: string | null; segmentStartedAt: string | null
  heldAt: string | null; heldS: number; delayS: number; version: number; updatedAt: string | null; updatedBy: string | null
}
export type RunOfShow = { serverNow: string; canEdit: boolean; units: Unit[]; segments: Segment[]; state: ShowState }
export type SegmentInput = {
  id?: string; version?: number; title: string; kind: SegmentKind; plannedStart: string | null
  durationS: number; ownerUnitId: string | null; cueNotes: string
}
export type PlanEdit =
  | { action: 'save'; segment: SegmentInput }
  | { action: 'move'; id: string; direction: 'up' | 'down' }
  | { action: 'remove'; id: string; version: number }
  | { action: 'set_start'; showStart: string | null }
  | { action: 'reset' }
export type LiveAction = 'go' | 'hold' | 'next' | 'plus' | 'minus' | 'skip'

export const segmentKinds: SegmentKind[] = ['talk', 'performance', 'host', 'break', 'tech']

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
const hhmm = (v: unknown) => v === null || (typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v))
const stamp = (v: unknown) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)))
const optText = (v: unknown) => v === null || typeof v === 'string'
const int = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min

function validSegment(s: Segment): boolean {
  return !!s && uuid(s.id) && int(s.position, 1) && typeof s.title === 'string' && segmentKinds.includes(s.kind)
    && hhmm(s.plannedStart) && hhmm(s.scheduledStart) && int(s.durationS) && (s.ownerUnitId === null || uuid(s.ownerUnitId))
    && optText(s.ownerUnit) && optText(s.ownerUnitCode) && typeof s.cueNotes === 'string'
    && ['planned', 'live', 'done', 'skipped'].includes(s.status) && stamp(s.actualStart) && stamp(s.actualEnd) && int(s.version, 1)
}
function validState(s: ShowState): boolean {
  return !!s && hhmm(s.showStart) && ['idle', 'running', 'held', 'finished'].includes(s.phase)
    && (s.currentSegmentId === null || uuid(s.currentSegmentId)) && stamp(s.segmentStartedAt) && stamp(s.heldAt)
    && int(s.heldS) && typeof s.delayS === 'number' && Number.isSafeInteger(s.delayS) && int(s.version, 1)
    && stamp(s.updatedAt) && optText(s.updatedBy)
}
export function validRunOfShow(v: unknown): v is RunOfShow {
  const r = v as RunOfShow
  return !!r && typeof r === 'object' && typeof r.canEdit === 'boolean' && stamp(r.serverNow) && r.serverNow !== null
    && Array.isArray(r.units) && r.units.every(u => u && uuid(u.id) && typeof u.code === 'string' && typeof u.name === 'string')
    && Array.isArray(r.segments) && r.segments.every(validSegment) && validState(r.state)
}

const problems: Record<string, string> = {
  command_run_of_show_live: 'This segment is on stage right now. Move to the next segment before removing it.',
  command_run_of_show_empty: 'There are no planned segments left to start.',
}
function commandError(error: unknown) {
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined
  const mapped = mapCommandError(error)
  if (typeof message === 'string' && problems[message]) return { ...mapped, message: problems[message] }
  if (mapped.kind === 'stale_version') return { ...mapped, message: 'Someone else just changed the show. The latest version is loaded. Check it and press again.' }
  if (mapped.kind === 'permission_denied') return { ...mapped, message: 'Only StageMan heads and admins can change the run of show.' }
  return mapped
}

type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>

export interface RunOfShowApi {
  /** Resolves null when the server functions are not deployed yet. */
  read(term: string): Promise<RunOfShow | null>
  edit(term: string, edit: PlanEdit, key: string): Promise<CommandResult<RunOfShow>>
  control(term: string, action: LiveAction, expectedVersion: number, key: string): Promise<CommandResult<RunOfShow>>
}

const missing = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883')

export function createRunOfShowApi(ready: ReturnType<typeof createSupabaseClient>): RunOfShowApi {
  async function rpc(): Promise<Rpc> {
    const client = await ready
    if (!client) throw { code: 'COMMAND_UNAVAILABLE' }
    return client.rpc.bind(client) as unknown as Rpc
  }
  async function command(name: string, args: Record<string, unknown>): Promise<CommandResult<RunOfShow>> {
    try {
      const { data, error } = await (await rpc())(name, args)
      if (error) return { ok: false, error: commandError(error) }
      if (!validRunOfShow(data)) return { ok: false, error: { kind: 'unexpected', message: 'The show could not be confirmed. Reload and check it.', retryable: false } }
      return { ok: true, value: data }
    } catch (error) { return { ok: false, error: commandError(error) } }
  }
  return {
    async read(term) {
      const { data, error } = await (await rpc())('read_run_of_show', { p_term_id: term })
      if (missing(error)) return null
      if (error || !validRunOfShow(data)) throw Error('Run of show could not be loaded')
      return data
    },
    edit(term, edit, key) {
      const payload = edit.action === 'save' ? {
        ...(edit.segment.id ? { id: edit.segment.id, version: edit.segment.version } : {}),
        title: edit.segment.title, kind: edit.segment.kind, plannedStart: edit.segment.plannedStart,
        durationS: edit.segment.durationS, ownerUnitId: edit.segment.ownerUnitId, cueNotes: edit.segment.cueNotes,
      } : edit.action === 'move' ? { id: edit.id, direction: edit.direction }
        : edit.action === 'remove' ? { id: edit.id, version: edit.version }
          : edit.action === 'set_start' ? { showStart: edit.showStart } : {}
      return command('edit_run_of_show', { p_term_id: term, p_action: edit.action, p_payload: payload, p_request_id: key })
    },
    control(term, action, expectedVersion, key) {
      return command('control_run_of_show', { p_term_id: term, p_action: action, p_expected_version: expectedVersion, p_request_id: key })
    },
  }
}
