/**
 * Messenger and Telegram handles. People can type a bare username or paste a full link; we keep
 * the bare handle and build the tap-to-open link from it. Mirrors app_private.contact_handle in
 * supabase/migrations/20261128400000_profile_contacts.sql, so anything accepted here saves.
 */
export type ContactKind = 'messenger' | 'telegram'

const messengerPrefix = /^(https?:\/\/)?((www|m|web|mobile)\.)?(facebook\.com|fb\.com|fb\.me|messenger\.com\/t|m\.me)\//i
const telegramPrefix = /^(https?:\/\/)?(www\.)?(t\.me|telegram\.me|telegram\.dog)\//i

/** The bare handle, or null when the text isn't a recognisable handle. Blank input also gives null. */
export function contactHandle(kind: ContactKind, raw: string | null | undefined): string | null {
  let v = (raw ?? '').trim()
  if (!v || v.length > 300) return null
  if (kind === 'messenger') {
    v = v.replace(messengerPrefix, '')
    const profileId = /^profile\.php\?(.*&)?id=([0-9]{1,20})/i.exec(v)
    if (profileId) v = profileId[2]
    v = v.replace(/^@/, '').replace(/[/?#].*$/, '')
    return /^[A-Za-z0-9.]{1,50}$/.test(v) && !v.startsWith('.') && !/\.(com|me|net|org|ph)$/i.test(v) ? v : null
  }
  v = v.replace(telegramPrefix, '').replace(/^@/, '').replace(/[/?#].*$/, '')
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(v) ? v : null
}

export function contactUrl(kind: ContactKind, handle: string): string {
  return kind === 'messenger' ? `https://m.me/${encodeURIComponent(handle)}` : `https://t.me/${encodeURIComponent(handle)}`
}

export function contactText(kind: ContactKind, handle: string): string {
  return kind === 'telegram' ? `@${handle}` : handle
}

/** Inline error for a contact field, or '' when it's blank or valid. */
export function contactError(kind: ContactKind, raw: string | null | undefined): string {
  if (!(raw ?? '').trim() || contactHandle(kind, raw)) return ''
  return kind === 'messenger'
    ? 'Use your Facebook username or a facebook.com or m.me link.'
    : 'Use your Telegram username, like @juan_dc, or a t.me link. It has 5 to 32 letters, numbers or underscores.'
}
