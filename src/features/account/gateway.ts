import type { createSupabaseClient } from '../../lib/supabase'
/**
 * The profile fields the app still asks for. Older fields (phone, other contact, skills, name
 * pronunciation, affiliation) stay in the database but are no longer sent, so saving never clears them.
 */
export type ProfileValues = { course: string | null; yearLevel: string | null; messenger: string | null; telegram: string | null }
/** Visibility is set automatically: everything the app asks for is shown to core members. */
export type ProfileVisibility = { shareCourse: boolean; shareYearLevel: boolean; shareMessenger?: boolean; shareTelegram?: boolean }
export type OwnProfile = ProfileValues & ProfileVisibility & {
  memberId: string; displayName: string; version: number
  /** False until the Messenger and Telegram database update is applied. */
  contactsAvailable: boolean
}
export interface ProfileGateway {
  read(termId: string): Promise<OwnProfile>
  save(termId: string, values: ProfileValues, version: number, requestId: string): Promise<OwnProfile>
  share(termId: string, visibility: ProfileVisibility, version: number, requestId: string): Promise<OwnProfile>
}
const text = (v: unknown) => v === null || v === undefined || typeof v === 'string'
function profile(data: unknown): OwnProfile {
  if (!data || typeof data !== 'object') throw new Error('Your profile could not be loaded. Check access and try again.')
  const value = data as Record<string, unknown>
  if (typeof value.memberId !== 'string' || typeof value.displayName !== 'string' || !Number.isInteger(value.version) || (value.version as number) < 0
    || !['course','yearLevel','messenger','telegram'].every(key => text(value[key]))
    || !['shareCourse','shareYearLevel'].every(key => typeof value[key] === 'boolean')) throw new Error('Your profile could not be loaded. Check access and try again.')
  const contactsAvailable = typeof value.shareMessenger === 'boolean' && typeof value.shareTelegram === 'boolean'
  return {
    memberId: value.memberId, displayName: value.displayName, version: value.version as number,
    course: (value.course as string | null) ?? null, yearLevel: (value.yearLevel as string | null) ?? null,
    messenger: (value.messenger as string | null) ?? null, telegram: (value.telegram as string | null) ?? null,
    shareCourse: value.shareCourse as boolean, shareYearLevel: value.shareYearLevel as boolean,
    ...(contactsAvailable ? { shareMessenger: value.shareMessenger as boolean, shareTelegram: value.shareTelegram as boolean } : {}),
    contactsAvailable,
  }
}
export function createProfileGateway(ready: ReturnType<typeof createSupabaseClient>): ProfileGateway {
  const failure = (code?: string, message?: string) => new Error(code === '40001' ? 'Your profile changed elsewhere. Reload the profile before saving again.'
    : code === '42501' ? 'Profile access is unavailable or the term is frozen. Check with your workspace maintainer.'
      : message === 'profile_invalid_contact' ? 'Check your Messenger or Telegram username and try again.'
        : message === 'profile_invalid_field' ? "Messenger and Telegram aren't switched on yet. Try again after the next update."
          : 'The profile request could not be confirmed. Retry with the same details, or reload the profile.')
  const known = (error: unknown) => error instanceof Error && /^(Your profile changed|Profile access|Check your Messenger|Messenger and Telegram)/.test(error.message)
  return {
    async read(termId) {
      const client = await ready
      if (!client) throw failure()
      const { data, error } = await client.rpc('read_own_profile', { p_term_id: termId })
      if (error) throw failure(error.code)
      return profile(data)
    },
    async save(termId, values, version, requestId) {
      const client = await ready
      if (!client) throw failure()
      try {
        const { data, error } = await client.rpc('save_private_profile', { p_term_id: termId, p_values: values, p_expected_version: version, p_request_id: requestId })
        if (error) throw failure(error.code, error.message)
        return profile(data)
      } catch (error) { if (known(error)) throw error; throw failure() }
    },
    async share(termId, visibility, version, requestId) {
      const client = await ready
      if (!client) throw failure()
      try {
        const { data, error } = await client.rpc('set_profile_visibility', { p_term_id: termId, p_visibility: visibility, p_expected_version: version, p_request_id: requestId })
        if (error) throw failure(error.code, error.message)
        return profile(data)
      } catch (error) { if (known(error)) throw error; throw failure() }
    },
  }
}

/** Fields shown in the profile forms (Account and the setup wizard). */
export const profileFields = [
  { value: 'course', label: 'Course', max: 200, hint: undefined, placeholder: undefined },
  { value: 'yearLevel', label: 'Year level', max: 80, hint: undefined, placeholder: undefined },
  { value: 'messenger', label: 'Messenger', max: 300, hint: 'Your Facebook username or profile link.', placeholder: 'facebook.com/yourname' },
  { value: 'telegram', label: 'Telegram', max: 300, hint: 'Your Telegram username.', placeholder: '@yourname' },
] as const

/** The visibility every saved profile should have: all asked-for fields visible to core members. */
export function visibleToCore(base: OwnProfile): ProfileVisibility | null {
  const wanted: ProfileVisibility = { shareCourse: true, shareYearLevel: true, ...(base.contactsAvailable ? { shareMessenger: true, shareTelegram: true } : {}) }
  const differs = (Object.keys(wanted) as (keyof ProfileVisibility)[]).some(key => base[key] !== wanted[key])
  return differs ? wanted : null
}
