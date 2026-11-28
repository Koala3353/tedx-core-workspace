import { useCallback, useEffect, useState } from 'react'
import type { createSupabaseClient } from '../../lib/supabase'
import { useShellServices } from '../../app/shellServices'
import type { PickerPerson } from '../../components/list'

/**
 * Committee and position for everyone the caller can see in the directory (public.read_people_options).
 * Pickers use it only to label and group the option list they already have: it never adds people.
 */
export type PersonOption = {
  membershipId: string
  memberId: string
  name: string
  committeeCodes: string[]
  committeeNames: string[]
  position: string | null
  tier: 'leadership' | 'head' | 'core' | null
  signedIn: boolean
}
export interface PeopleOptionsApi { read(termId: string): Promise<PersonOption[]> }

type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')

export function parsePeopleOptions(value: unknown): PersonOption[] | null {
  if (!Array.isArray(value)) return null
  const out: PersonOption[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const p = raw as Record<string, unknown>
    if (!uuid(p.membershipId) || !uuid(p.memberId) || typeof p.name !== 'string' || !strings(p.committeeCodes) || !strings(p.committeeNames)
      || !(p.position === null || typeof p.position === 'string') || !(p.tier === null || p.tier === 'leadership' || p.tier === 'head' || p.tier === 'core')
      || typeof p.signedIn !== 'boolean') return null
    out.push({ membershipId: p.membershipId, memberId: p.memberId, name: p.name, committeeCodes: p.committeeCodes, committeeNames: p.committeeNames,
      position: p.position as string | null, tier: p.tier as PersonOption['tier'], signedIn: p.signedIn })
  }
  return out
}

export function createPeopleOptionsApi(ready: ReturnType<typeof createSupabaseClient>): PeopleOptionsApi {
  return {
    async read(termId) {
      const client = await ready
      if (!client) throw new Error('unavailable')
      const rpc = client.rpc.bind(client) as unknown as Rpc
      const { data, error } = await rpc('read_people_options', { p_term_id: termId })
      const parsed = error ? null : parsePeopleOptions(data)
      if (!parsed) throw new Error('unavailable')
      return parsed
    },
  }
}

// One in-memory copy per term, shared by every picker on every page. Kept for the session and
// refreshed in the background once it is older than STALE_MS, or on demand.
const STALE_MS = 5 * 60 * 1000
type Entry = { value: PersonOption[] | null; at: number; loading: Promise<void> | null }
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(fn => fn())

function load(api: PeopleOptionsApi, term: string, force = false) {
  const entry = cache.get(term) ?? { value: null, at: 0, loading: null }
  cache.set(term, entry)
  if (entry.loading || (!force && entry.value && Date.now() - entry.at < STALE_MS)) return
  entry.loading = api.read(term)
    .then(value => { entry.value = value; entry.at = Date.now() })
    // Labels are optional: on failure pickers keep their plain names and the next mount retries.
    .catch(() => { entry.at = 0 })
    .finally(() => { entry.loading = null; notify() })
}

/** Forget cached people (for example after a placement or name change) so the next read is fresh. */
export function invalidatePeopleOptions(term?: string) {
  if (term) cache.delete(term)
  else cache.clear()
  notify()
}

export type PeopleOptions = {
  /** Null until loaded, or when the list could not be read. */
  people: PersonOption[] | null
  refresh: () => void
}

export function usePeopleOptions(term: string | null | undefined): PeopleOptions {
  const api = useShellServices().gateway?.peopleOptions
  const [, setTick] = useState(0)
  useEffect(() => {
    // Re-render on any change; reload right away when the cached copy was invalidated.
    const listener = () => { setTick(t => t + 1); if (api && term && !cache.has(term)) load(api, term) }
    listeners.add(listener)
    if (api && term) load(api, term)
    return () => { listeners.delete(listener) }
  }, [api, term])
  const refresh = useCallback(() => { if (api && term) load(api, term, true) }, [api, term])
  return { people: term ? cache.get(term)?.value ?? null : null, refresh }
}

/**
 * Labels an existing option list with committee and position. The list itself (who is in it, and the
 * id each option submits) never changes: `key` says whether the ids are member ids or membership ids.
 * People missing from the directory list keep their plain name.
 */
export function labelPeople<T extends { id: string; name: string }>(list: T[], people: PersonOption[] | null, key: 'memberId' | 'membershipId'): (T & PickerPerson)[] {
  if (!people) return list
  const index = new Map(people.map(p => [p[key], p]))
  return list.map(item => {
    const p = index.get(item.id)
    if (!p) return item
    return {
      ...item,
      committee: p.committeeNames[0] ?? null,
      position: p.position,
      leadership: p.tier === 'leadership',
      extra: p.committeeNames.length > 1 ? 'Also ' + p.committeeCodes.slice(1).join(', ') : null,
      keywords: p.committeeCodes.join(' '),
    }
  })
}
