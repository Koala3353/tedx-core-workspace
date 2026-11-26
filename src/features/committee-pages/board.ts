import type { createSupabaseClient } from '../../lib/supabase'

/**
 * Shared read for the war room, "Who do I ask" and committee pages:
 * public.read_coordination_board(p_term_id) (migration 20261127200000_coordination_board.sql).
 */
export type BoardPerson = { id: string; name: string; contact: string | null; role: 'head' | 'primary_contact' | 'backup_contact' | 'member' }
export type BoardService = { id: string; label: string; need: string }
export type BoardUnit = { id: string; code: string; name: string; delivery: boolean; canNudge: boolean; people: BoardPerson[]; services: BoardService[] }
export type BoardDeliverable = {
  id: string; title: string; unitId: string | null; supportingUnitIds: string[]
  ownerId: string; ownerName: string; ownerContact: string | null
  dueOn: string | null; dueAt: string | null; phase: string | null
  state: 'proposed' | 'draft' | 'in_progress' | 'submitted' | 'accepted' | 'cancelled'
  blocked: boolean; waiting: boolean; tasksDone: number; tasksTotal: number
}
export type BoardAsk = { id: string; kind: 'agreement' | 'handoff'; fromUnitId: string | null; toUnitId: string; title: string; dueOn: string | null; state: string; href: string }
export type Board = { today: string; refreshedAt: string; units: BoardUnit[]; deliverables: BoardDeliverable[]; asks: BoardAsk[] }

/** Thrown when the server function is not deployed yet, so pages can say so plainly. */
export class BoardUnavailable extends Error {}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const day = /^\d{4}-\d{2}-\d{2}$/
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && uuid.test(v)
const text = (v: unknown): v is string => typeof v === 'string'
const maybe = <T>(v: unknown, check: (x: unknown) => x is T) => v === null || check(v)
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0
const isDay = (v: unknown): v is string => text(v) && day.test(v)

function person(v: unknown): v is BoardPerson {
  return obj(v) && id(v.id) && text(v.name) && maybe(v.contact, text) && ['head', 'primary_contact', 'backup_contact', 'member'].includes(v.role as string)
}
function service(v: unknown): v is BoardService { return obj(v) && id(v.id) && text(v.label) && text(v.need) }
function unit(v: unknown): v is BoardUnit {
  return obj(v) && id(v.id) && text(v.code) && text(v.name) && typeof v.delivery === 'boolean' && typeof v.canNudge === 'boolean'
    && Array.isArray(v.people) && v.people.every(person) && Array.isArray(v.services) && v.services.every(service)
}
function deliverable(v: unknown): v is BoardDeliverable {
  return obj(v) && id(v.id) && text(v.title) && maybe(v.unitId, id) && Array.isArray(v.supportingUnitIds) && v.supportingUnitIds.every(id)
    && id(v.ownerId) && text(v.ownerName) && maybe(v.ownerContact, text) && maybe(v.dueOn, isDay) && maybe(v.dueAt, text) && maybe(v.phase, text)
    && ['proposed', 'draft', 'in_progress', 'submitted', 'accepted', 'cancelled'].includes(v.state as string)
    && typeof v.blocked === 'boolean' && typeof v.waiting === 'boolean' && count(v.tasksDone) && count(v.tasksTotal) && (v.tasksDone as number) <= (v.tasksTotal as number)
}
function ask(v: unknown): v is BoardAsk {
  return obj(v) && id(v.id) && (v.kind === 'agreement' || v.kind === 'handoff') && maybe(v.fromUnitId, id) && id(v.toUnitId) && text(v.title)
    && maybe(v.dueOn, isDay) && text(v.state) && text(v.href) && v.href.startsWith('/working-together/')
}
export function parseBoard(v: unknown): Board | null {
  if (!obj(v) || !isDay(v.today) || !text(v.refreshedAt) || !Array.isArray(v.units) || !v.units.every(unit)
    || !Array.isArray(v.deliverables) || !v.deliverables.every(deliverable) || !Array.isArray(v.asks) || !v.asks.every(ask)) return null
  return v as unknown as Board
}

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>

/** Reads the board. "Function does not exist" (not deployed yet) becomes BoardUnavailable. */
export function createBoardReader(ready: ReturnType<typeof createSupabaseClient>): (termId: string) => Promise<Board> {
  return async termId => {
    const client = await ready
    if (!client) throw new BoardUnavailable('The workspace connection is unavailable.')
    const rpc = client.rpc.bind(client) as unknown as Rpc
    const { data, error } = await rpc('read_coordination_board', { p_term_id: termId })
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') throw new BoardUnavailable('This view is not switched on yet.')
      throw new Error('This view could not load. Check your connection and try again.')
    }
    const board = parseBoard(data)
    if (!board) throw new Error('This view could not load. Check your connection and try again.')
    return board
  }
}

/** Committee codes compared loosely: "RecSec", "RECSEC" and "rec-sec" are the same. */
export function codeKey(code: string): string { return code.toUpperCase().replace(/[^A-Z0-9]/g, '') }

export function findUnit(units: readonly BoardUnit[], codes: readonly string[]): BoardUnit | null {
  for (const code of codes) {
    const hit = units.find(u => codeKey(u.code) === codeKey(code))
    if (hit) return hit
  }
  // Fall back to the committee name ("LOGISTICS" finds a unit named "Logistics").
  for (const code of codes) {
    const hit = units.find(u => codeKey(u.name) === codeKey(code))
    if (hit) return hit
  }
  return null
}

/** Heads first, then primary and backup contacts. */
export function leadContacts(unit: BoardUnit): BoardPerson[] {
  const heads = unit.people.filter(p => p.role === 'head')
  return heads.length ? heads : unit.people.filter(p => p.role === 'primary_contact' || p.role === 'backup_contact')
}

export const roleLabel: Record<BoardPerson['role'], string> = { head: 'Head', primary_contact: 'Main contact', backup_contact: 'Backup contact', member: 'Member' }
