import type { createSupabaseClient } from '../../lib/supabase'
import { mapCommandError, type CommandResult } from '../../lib/commands'

/** What a speaker owes us. One row per thing; several script drafts are several rows. */
export type RequirementKind = 'bio' | 'headshot' | 'outline' | 'script' | 'slides' | 'rehearsal_rsvp' | 'other'
export type RequirementStatus = 'not_started' | 'submitted' | 'changes_requested' | 'done'
export type Requirement = {
  id: string; version: number; kind: RequirementKind; label: string; dueOn: string | null; status: RequirementStatus
  linkUrl: string | null; note: string | null; guestNote: string | null; submittedAt: string | null
}
export type Contact = { membershipId: string; name: string; email: string; position: string | null }
export type SharedWork = { id: string; kind: 'task' | 'deliverable'; title: string; dueOn: string | null; dueAt: string | null; state: string; stateLabel: string }
export type PortalEvent = { id: string; title: string; location: string; allDay: boolean; startOn: string | null; endOn: string | null; startsAt: string | null; endsAt: string | null }
export type MyPart = {
  speaker: { name: string; talkTitle: string | null } | null
  requirements: Requirement[]
  contact: Contact | null
  eventDate: string
  shared: SharedWork[]
  events: PortalEvent[]
}
export type InvitationState = 'pending' | 'accepted' | 'expired' | 'revoked'
export type TrackedSpeaker = {
  id: string; version: number; email: string; name: string; talkTitle: string | null; contact: Contact | null
  invitation: { state: InvitationState; expiresAt: string } | null; requirements: Requirement[]
}
export type SpeakerTracker = { canManage: boolean; speakers: TrackedSpeaker[]; contacts: Contact[] }
export type SpeakerValues = { email: string; name: string; talkTitle?: string | null; contactMembershipId?: string | null; archived?: boolean }
export type RequirementValues = {
  speakerId?: string; kind: RequirementKind; label: string; dueOn?: string | null; status?: RequirementStatus
  linkUrl?: string | null; note?: string | null; archived?: boolean
}
export type SpeakerReceipt = { id: string; version: number; archived: boolean }

export interface SpeakerPortalApi {
  /** Null when the server functions are not deployed yet. Throws when the read fails. */
  readMyPart(termId: string): Promise<MyPart | null>
  submit(termId: string, item: Requirement, link: string, note: string, requestId: string): Promise<CommandResult<Requirement>>
  readTracker(termId: string): Promise<SpeakerTracker | null>
  saveSpeaker(termId: string, speaker: TrackedSpeaker | null, values: SpeakerValues, requestId: string): Promise<CommandResult<SpeakerReceipt>>
  saveRequirement(termId: string, item: Requirement | null, values: RequirementValues, requestId: string): Promise<CommandResult<Requirement>>
}

const kinds: readonly string[] = ['bio', 'headshot', 'outline', 'script', 'slides', 'rehearsal_rsvp', 'other']
const statuses: readonly string[] = ['not_started', 'submitted', 'changes_requested', 'done']
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && v.length <= max
const optText = (v: unknown, max = 4000) => v === null || text(v, max)
const day = (v: unknown) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
const stamp = (v: unknown) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)))
const https = (v: unknown) => v === null || (typeof v === 'string' && /^https:\/\/\S+$/.test(v))

function requirement(v: unknown): v is Requirement {
  if (!v || typeof v !== 'object') return false
  const r = v as Requirement
  return uuid(r.id) && Number.isSafeInteger(r.version) && r.version > 0 && kinds.includes(r.kind) && text(r.label, 120) && r.label.length > 0
    && day(r.dueOn) && statuses.includes(r.status) && https(r.linkUrl) && optText(r.note, 500) && optText(r.guestNote, 500) && stamp(r.submittedAt)
}
function contact(v: unknown): v is Contact {
  if (!v || typeof v !== 'object') return false
  const c = v as Contact
  return uuid(c.membershipId) && text(c.name, 200) && text(c.email, 254) && optText(c.position, 200)
}
function shared(v: unknown): v is SharedWork {
  if (!v || typeof v !== 'object') return false
  const s = v as SharedWork
  return uuid(s.id) && (s.kind === 'task' || s.kind === 'deliverable') && text(s.title, 240) && day(s.dueOn) && stamp(s.dueAt) && text(s.state, 60) && text(s.stateLabel, 120)
}
function portalEvent(v: unknown): v is PortalEvent {
  if (!v || typeof v !== 'object') return false
  const e = v as PortalEvent
  return uuid(e.id) && text(e.title, 240) && text(e.location, 1000) && typeof e.allDay === 'boolean'
    && day(e.startOn) && day(e.endOn) && stamp(e.startsAt) && stamp(e.endsAt)
}
function myPart(v: unknown): v is MyPart {
  if (!v || typeof v !== 'object') return false
  const p = v as MyPart
  const speakerOk = p.speaker === null || (typeof p.speaker === 'object' && text(p.speaker.name, 200) && optText(p.speaker.talkTitle, 240))
  return speakerOk && Array.isArray(p.requirements) && p.requirements.every(requirement) && (p.contact === null || contact(p.contact))
    && typeof p.eventDate === 'string' && day(p.eventDate) && Array.isArray(p.shared) && p.shared.every(shared)
    && Array.isArray(p.events) && p.events.every(portalEvent)
}
function tracked(v: unknown): v is TrackedSpeaker {
  if (!v || typeof v !== 'object') return false
  const s = v as TrackedSpeaker
  const inv = s.invitation
  return uuid(s.id) && Number.isSafeInteger(s.version) && text(s.email, 254) && text(s.name, 200) && optText(s.talkTitle, 240)
    && (s.contact === null || contact(s.contact))
    && (inv === null || (typeof inv === 'object' && ['pending', 'accepted', 'expired', 'revoked'].includes(inv.state) && stamp(inv.expiresAt)))
    && Array.isArray(s.requirements) && s.requirements.every(requirement)
}
function tracker(v: unknown): v is SpeakerTracker {
  if (!v || typeof v !== 'object') return false
  const t = v as SpeakerTracker
  return typeof t.canManage === 'boolean' && Array.isArray(t.speakers) && t.speakers.every(tracked) && Array.isArray(t.contacts) && t.contacts.every(contact)
}
function receipt(v: unknown): v is SpeakerReceipt {
  return !!v && typeof v === 'object' && uuid((v as SpeakerReceipt).id) && Number.isSafeInteger((v as SpeakerReceipt).version) && typeof (v as SpeakerReceipt).archived === 'boolean'
}

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
// PostgREST reports an undeployed function as PGRST202 (or 42883 from Postgres).
const missing = (error: { code?: string } | null) => !!error && ['PGRST202', '42883'].includes(error.code ?? '')
const unexpected: CommandResult<never> = { ok: false, error: { kind: 'unexpected', message: 'Something changed while saving. Refresh the page and check before trying again.', retryable: false } }

/** Wraps the speaker portal RPCs in 20261127300000_speaker_portal.sql. */
export function createSpeakerPortalApi(ready: ReturnType<typeof createSupabaseClient>): SpeakerPortalApi {
  async function rpc(name: string, args: Record<string, unknown>) {
    const client = await ready
    if (!client) throw new Error('Workspace connection is not set up.')
    return (client.rpc.bind(client) as unknown as Rpc)(name, args)
  }
  async function read<T>(name: string, args: Record<string, unknown>, valid: (v: unknown) => v is T): Promise<T | null> {
    const { data, error } = await rpc(name, args)
    if (missing(error)) return null
    if (error || !valid(data)) throw new Error('This page could not be loaded.')
    return data
  }
  async function command<T>(name: string, args: Record<string, unknown>, valid: (v: unknown) => v is T): Promise<CommandResult<T>> {
    try {
      const { data, error } = await rpc(name, args)
      if (error) return { ok: false, error: mapCommandError(error) }
      return valid(data) ? { ok: true, value: data } : unexpected
    } catch { return { ok: false, error: mapCommandError({ code: 'COMMAND_UNAVAILABLE' }) } }
  }
  return {
    readMyPart: termId => read('read_my_part', { p_term_id: termId }, myPart),
    submit: (termId, item, link, note, requestId) => command('submit_my_requirement', {
      p_term_id: termId, p_requirement_id: item.id, p_link_url: link.trim() || null, p_note: note.trim() || null,
      p_expected_version: item.version, p_request_id: requestId,
    }, requirement),
    readTracker: termId => read('read_speaker_tracker', { p_term_id: termId }, tracker),
    saveSpeaker: (termId, speaker, values, requestId) => command('save_speaker', {
      p_term_id: termId, p_speaker_id: speaker?.id ?? null, p_values: values, p_expected_version: speaker?.version ?? null, p_request_id: requestId,
    }, receipt),
    saveRequirement: (termId, item, values, requestId) => command('save_speaker_requirement', {
      p_term_id: termId, p_requirement_id: item?.id ?? null, p_values: values, p_expected_version: item?.version ?? null, p_request_id: requestId,
    }, requirement),
  }
}
