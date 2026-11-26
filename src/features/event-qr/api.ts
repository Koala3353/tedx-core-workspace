import { mapCommandError, type CommandResult } from '../../lib/commands'
import type { createSupabaseClient } from '../../lib/supabase'

export type CheckInLink = { token: string | null; generation: number | null; rotatedAt: string | null; canRotate: boolean }
export type CheckInReceipt = { checkedInAt: string; already: boolean; name: string; termLabel: string }
export type CrewPerson = { membershipId: string; name: string; committee: string | null; committeeCode: string | null; checkedInAt: string | null }
export type CrewArrivals = { generation: number | null; rotatedAt: string | null; people: CrewPerson[] }

const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
const stamp = (v: unknown) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)))
const optText = (v: unknown) => v === null || typeof v === 'string'
const token = (v: unknown) => v === null || (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v))
const generation = (v: unknown) => v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v > 0)

export const validToken = (v: string | undefined): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

function validLink(v: unknown): v is CheckInLink {
  const l = v as CheckInLink
  return !!l && token(l.token) && generation(l.generation) && stamp(l.rotatedAt) && typeof l.canRotate === 'boolean'
}
function validReceipt(v: unknown): v is CheckInReceipt {
  const r = v as CheckInReceipt
  return !!r && typeof r.checkedInAt === 'string' && stamp(r.checkedInAt) && typeof r.already === 'boolean'
    && typeof r.name === 'string' && typeof r.termLabel === 'string'
}
function validArrivals(v: unknown): v is CrewArrivals {
  const a = v as CrewArrivals
  return !!a && generation(a.generation) && stamp(a.rotatedAt) && Array.isArray(a.people) && a.people.every(p =>
    p && uuid(p.membershipId) && typeof p.name === 'string' && optText(p.committee) && optText(p.committeeCode) && stamp(p.checkedInAt))
}

type RpcError = { code?: string; message?: string } | null
type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>
const missing = (error: RpcError) => !!error && (error.code === 'PGRST202' || error.code === '42883')

export interface EventQrApi {
  /** Null when the server functions are not deployed yet. */
  link(term: string): Promise<CheckInLink | null>
  rotate(term: string, key: string): Promise<CommandResult<CheckInLink>>
  arrivals(term: string): Promise<CrewArrivals | null>
  checkIn(token: string): Promise<CommandResult<CheckInReceipt>>
}

export function createEventQrApi(ready: ReturnType<typeof createSupabaseClient>): EventQrApi {
  async function rpc(): Promise<Rpc> {
    const client = await ready
    if (!client) throw { code: 'COMMAND_UNAVAILABLE' }
    return client.rpc.bind(client) as unknown as Rpc
  }
  async function read<T>(name: string, args: Record<string, unknown>, valid: (v: unknown) => v is T): Promise<T | null> {
    const { data, error } = await (await rpc())(name, args)
    if (missing(error)) return null
    if (error || !valid(data)) throw Error(`${name} could not be loaded`)
    return data
  }
  async function command<T>(name: string, args: Record<string, unknown>, valid: (v: unknown) => v is T): Promise<CommandResult<T>> {
    try {
      const { data, error } = await (await rpc())(name, args)
      if (error) {
        if (error.message === 'command_checkin_link_invalid') {
          return { ok: false, error: { kind: 'validation_failed', message: 'This check-in code is old or incomplete. Scan the code at the crew door again.', retryable: false } }
        }
        const mapped = mapCommandError(error)
        if (mapped.kind === 'permission_denied') return { ok: false, error: { ...mapped, message: 'Only organizers on this term’s roster can check in here.' } }
        return { ok: false, error: mapped }
      }
      if (!valid(data)) return { ok: false, error: { kind: 'unexpected', message: 'Your check-in couldn’t be confirmed. Try again.', retryable: true } }
      return { ok: true, value: data }
    } catch (error) { return { ok: false, error: mapCommandError(error) } }
  }
  return {
    link: term => read('read_crew_checkin_link', { p_term_id: term }, validLink),
    rotate: (term, key) => command('rotate_crew_checkin_token', { p_term_id: term, p_request_id: key }, validLink),
    arrivals: term => read('read_checkins', { p_term_id: term }, validArrivals),
    checkIn: value => command('check_in', { p_token: value }, validReceipt),
  }
}
