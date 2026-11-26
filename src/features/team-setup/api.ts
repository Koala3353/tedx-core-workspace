import type { createSupabaseClient } from '../../lib/supabase'

export type Wave = 'wave1' | 'wave1_5' | 'core'
export type NudgeKind = 'sign_in' | 'install' | 'tutorial' | 'reminders'

export type TeamPerson = {
  membershipId: string
  memberId: string
  name: string
  email: string
  committee: string | null
  committeeCode: string | null
  position: string | null
  /** Role code and tier of the position shown in `position`; null when they have none. */
  positionCode: string | null
  positionTier: PositionTier | null
  wave: Wave | null
  accountState: string
  signedIn: boolean
  lastSignInAt: string | null
  lastActiveAt: string | null
  installed: boolean
  tutorialDone: boolean
  tutorialStep: number
  remindersOn: boolean
  telegramLinked: boolean
  invitedAt: string | null
}

export type PositionTier = 'leadership' | 'head' | 'core'
/** Every position for the term. Leadership and head positions can have several holders. */
export type Position = {
  roleCode: string; roleName: string; committee: string | null; committeeCode: string | null
  tier: PositionTier; administrator: boolean
  /** People holding it now. */
  holders: number
  /** False when the viewer needs full admin access to give it. */
  allowed: boolean
}
/** Kept for older imports: the list is no longer limited to unheld positions. */
export type OpenPosition = Position
export type TeamTotals = { people: number; signedIn: number; installed: number; tutorialDone: number; remindersOn: number; neverOpened: number }
export type TeamSetup = { people: TeamPerson[]; openPositions: Position[]; totals: TeamTotals; canAssignAll: boolean }
export type Committee = { id: string; code: string; name: string }

export type NewPerson = { name: string; email: string; committeeCode?: string | null; roleCode?: string | null; wave?: Wave | null }
export type AddedPerson = { membershipId: string; memberId: string; name: string; email: string; committeeCode: string | null; roleCode: string | null; wave: Wave | null; welcomeQueued: boolean }
export type SkipReason =
  | 'invalid' | 'not_school_email' | 'invalid_name' | 'invalid_wave' | 'duplicate' | 'unknown_committee'
  | 'unknown_role' | 'role_committee_mismatch' | 'role_not_allowed' | 'account_unavailable' | 'already_on_roster'
export type SkippedPerson = { email: string; reason: SkipReason | string }
export type AddResult = { added: AddedPerson[]; skipped: SkippedPerson[] }

export type PositionFailure = Failure | 'not_allowed' | 'blocked' | 'conflict' | 'not_on_roster'
export type PositionOutcome = { ok: true; value: { changed: boolean } } | { ok: false; reason: PositionFailure }

/** Why a call did not return data. `not_deployed` means the database update has not been applied yet. */
export type Failure = 'not_deployed' | 'denied' | 'invalid' | 'unavailable'
export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: Failure }

export interface TeamSetupApi {
  read(termId: string): Promise<Outcome<TeamSetup>>
  committees(termId: string): Promise<Outcome<Committee[]>>
  /** One call; at most 100 people (the page sends chunks of 50). Reuse `requestId` to retry the same batch safely. */
  add(termId: string, people: NewPerson[], requestId: string): Promise<Outcome<AddResult>>
  nudge(termId: string, membershipIds: string[], kind: NudgeKind): Promise<Outcome<{ queued: number }>>
  /** Give, change or clear (roleCode null) someone's position. Works before they sign in. Reuse `requestId` to retry safely. */
  setPosition(termId: string, membershipId: string, roleCode: string | null, requestId: string): Promise<PositionOutcome>
}

type RpcError = { code?: string; message?: string } | null
type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>

const isString = (v: unknown): v is string => typeof v === 'string'
const isNullableString = (v: unknown): v is string | null => v === null || v === undefined || typeof v === 'string'
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
const waves: readonly string[] = ['wave1', 'wave1_5', 'core']
const tiers: readonly string[] = ['leadership', 'head', 'core']

function failure(error: RpcError): Failure {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  // PostgREST reports a missing function as PGRST202; Postgres itself as 42883.
  if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(message)) return 'not_deployed'
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST302' || message === 'command_permission_denied') return 'denied'
  if (code === '22023' || code === '22P02') return 'invalid'
  return 'unavailable'
}

function person(value: unknown): TeamPerson | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!isString(v.membershipId) || !isString(v.memberId) || !isString(v.email) || !isString(v.accountState)
    || !isNullableString(v.name) || !isNullableString(v.committee) || !isNullableString(v.committeeCode) || !isNullableString(v.position)
    || !isNullableString(v.lastSignInAt) || !isNullableString(v.lastActiveAt) || !isNullableString(v.invitedAt)
    || !isBool(v.signedIn) || !isBool(v.installed) || !isBool(v.tutorialDone) || !isBool(v.remindersOn) || !isBool(v.telegramLinked)) return null
  return {
    membershipId: v.membershipId, memberId: v.memberId, name: v.name || v.email, email: v.email,
    committee: v.committee ?? null, committeeCode: v.committeeCode ?? null, position: v.position ?? null,
    positionCode: isString(v.positionCode) ? v.positionCode : null,
    positionTier: isString(v.positionTier) && tiers.includes(v.positionTier) ? v.positionTier as PositionTier : null,
    wave: isString(v.wave) && waves.includes(v.wave) ? v.wave as Wave : null,
    accountState: v.accountState, signedIn: v.signedIn, lastSignInAt: v.lastSignInAt ?? null, lastActiveAt: v.lastActiveAt ?? null,
    installed: v.installed, tutorialDone: v.tutorialDone, tutorialStep: isCount(v.tutorialStep) ? v.tutorialStep : 0,
    remindersOn: v.remindersOn, telegramLinked: v.telegramLinked, invitedAt: v.invitedAt ?? null,
  }
}

function parseSetup(data: unknown): TeamSetup | null {
  if (!data || typeof data !== 'object') return null
  const v = data as Record<string, unknown>
  if (!Array.isArray(v.people) || !Array.isArray(v.openPositions) || !v.totals || typeof v.totals !== 'object') return null
  const people = v.people.map(person)
  if (people.some(p => !p)) return null
  const openPositions: Position[] = []
  for (const raw of v.openPositions) {
    const p = raw as Record<string, unknown> | null
    if (!p || !isString(p.roleCode) || !isString(p.roleName) || !isNullableString(p.committee) || !isNullableString(p.committeeCode)) return null
    // Older servers sent only open positions without tier or counts; fall back to safe defaults.
    const tier = isString(p.tier) && tiers.includes(p.tier) ? p.tier as PositionTier
      : !p.committeeCode ? 'leadership' : / head$/i.test(p.roleName) ? 'head' : 'core'
    openPositions.push({ roleCode: p.roleCode, roleName: p.roleName, committee: p.committee ?? null, committeeCode: p.committeeCode ?? null,
      tier, administrator: p.administrator === true, holders: isCount(p.holders) ? p.holders : 0, allowed: p.allowed !== false })
  }
  const t = v.totals as Record<string, unknown>
  const keys = ['people', 'signedIn', 'installed', 'tutorialDone', 'remindersOn', 'neverOpened'] as const
  if (!keys.every(key => isCount(t[key]))) return null
  return { people: people as TeamPerson[], openPositions, totals: Object.fromEntries(keys.map(key => [key, t[key]])) as TeamTotals, canAssignAll: v.canAssignAll === true }
}

function parseAdd(data: unknown): AddResult | null {
  if (!data || typeof data !== 'object') return null
  const v = data as Record<string, unknown>
  if (!Array.isArray(v.added) || !Array.isArray(v.skipped)) return null
  const added: AddedPerson[] = []
  for (const raw of v.added) {
    const a = raw as Record<string, unknown> | null
    if (!a || !isString(a.membershipId) || !isString(a.email)) return null
    added.push({
      membershipId: a.membershipId, memberId: isString(a.memberId) ? a.memberId : '', name: isString(a.name) ? a.name : a.email, email: a.email,
      committeeCode: isString(a.committeeCode) ? a.committeeCode : null, roleCode: isString(a.roleCode) ? a.roleCode : null,
      wave: isString(a.wave) && waves.includes(a.wave) ? a.wave as Wave : null, welcomeQueued: a.welcomeQueued === true,
    })
  }
  const skipped: SkippedPerson[] = []
  for (const raw of v.skipped) {
    const s = raw as Record<string, unknown> | null
    if (!s || !isString(s.reason)) return null
    skipped.push({ email: isString(s.email) ? s.email : '', reason: s.reason })
  }
  return { added, skipped }
}

/**
 * Team setup data for project managers: public.read_team_setup, public.add_roster_members,
 * public.nudge_members and public.set_member_position, plus the term's committees for the pickers. Every method resolves; a
 * missing function (before the migration is deployed) comes back as `not_deployed`.
 */
export function createTeamSetupApi(ready: ReturnType<typeof createSupabaseClient>): TeamSetupApi {
  async function call<T>(name: string, args: Record<string, unknown>, parse: (data: unknown) => T | null): Promise<Outcome<T>> {
    try {
      const client = await ready
      if (!client) return { ok: false, reason: 'unavailable' }
      const rpc = client.rpc.bind(client) as unknown as Rpc
      const { data, error } = await rpc(name, args)
      if (error) return { ok: false, reason: failure(error) }
      const value = parse(data)
      return value === null ? { ok: false, reason: 'unavailable' } : { ok: true, value }
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
  }
  return {
    read: termId => call('read_team_setup', { p_term_id: termId }, parseSetup),
    async committees(termId) {
      try {
        const client = await ready
        if (!client) return { ok: false, reason: 'unavailable' }
        const { data, error } = await client.from('org_units').select('id, code, name').eq('term_id', termId).is('archived_at', null).order('name')
        if (error || !Array.isArray(data)) return { ok: false, reason: failure(error) }
        return { ok: true, value: data.filter(u => isString(u.id) && isString(u.code) && isString(u.name)).map(u => ({ id: u.id, code: u.code, name: u.name })) }
      } catch {
        return { ok: false, reason: 'unavailable' }
      }
    },
    add: (termId, people, requestId) => call('add_roster_members', {
      p_term_id: termId,
      p_people: people.map(p => ({
        name: p.name, email: p.email,
        ...(p.committeeCode ? { committeeCode: p.committeeCode } : {}),
        ...(p.roleCode ? { roleCode: p.roleCode } : {}),
        ...(p.wave ? { wave: p.wave } : {}),
      })),
      p_request_id: requestId,
    }, parseAdd),
    async setPosition(termId, membershipId, roleCode, requestId) {
      try {
        const client = await ready
        if (!client) return { ok: false, reason: 'unavailable' }
        const rpc = client.rpc.bind(client) as unknown as Rpc
        const { data, error } = await rpc('set_member_position', { p_term_id: termId, p_membership_id: membershipId, p_role_code: roleCode, p_request_id: requestId })
        if (error) {
          const message = error.message ?? ''
          if (message === 'role_not_allowed') return { ok: false, reason: 'not_allowed' }
          if (message === 'command_dependency_blocked') return { ok: false, reason: 'blocked' }
          if (message === 'command_position_overlap' || error.code === '40001') return { ok: false, reason: 'conflict' }
          if (message === 'member_not_on_roster') return { ok: false, reason: 'not_on_roster' }
          return { ok: false, reason: failure(error) }
        }
        const changed = data && typeof data === 'object' ? (data as { changed?: unknown }).changed : undefined
        return typeof changed === 'boolean' ? { ok: true, value: { changed } } : { ok: false, reason: 'unavailable' }
      } catch {
        return { ok: false, reason: 'unavailable' }
      }
    },
    nudge: (termId, membershipIds, kind) => call('nudge_members', { p_term_id: termId, p_membership_ids: membershipIds, p_kind: kind },
      data => data && typeof data === 'object' && isCount((data as { queued?: unknown }).queued) ? { queued: (data as { queued: number }).queued } : null),
  }
}
