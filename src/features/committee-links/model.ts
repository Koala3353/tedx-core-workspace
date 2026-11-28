/** URL checks and title suggestions for committee quick links. Mirrors app_private.committee_link_url. */

export const TITLE_MAX = 120
export const NOTE_MAX = 280
export const URL_MAX = 2000

export type UrlCheck = { ok: true; url: string } | { ok: false; message: string }

const hostPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

/** Trims, adds https:// to a bare domain, and returns the normalised form the server accepts. */
export function checkUrl(input: string): UrlCheck {
  const raw = input.trim()
  if (!raw) return { ok: false, message: 'Paste the link.' }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw.replace(/^\/+/, '')
  let parsed: URL
  try { parsed = new URL(withScheme) } catch { return { ok: false, message: 'This isn\'t a web link. Copy it from the address bar and paste it again.' } }
  if (parsed.protocol === 'http:') return { ok: false, message: 'Only secure links work here. Use the https:// version of this link.' }
  if (parsed.protocol !== 'https:') return { ok: false, message: 'Only web links that start with https:// work here.' }
  if (parsed.username || parsed.password) return { ok: false, message: 'Remove the sign-in details from this link.' }
  if (!hostPattern.test(parsed.hostname)) return { ok: false, message: 'This link has no website name. Check it and try again.' }
  const url = parsed.href
  if (url.length > URL_MAX) return { ok: false, message: 'This link is too long. Use a shorter share link.' }
  return { ok: true, url }
}

/** "drive.google.com" style label, without "www.". */
export function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

const known: [RegExp, (u: URL) => string][] = [
  [/^docs\.google\.com$/, u => u.pathname.startsWith('/spreadsheets') ? 'Google Sheet' : u.pathname.startsWith('/presentation') ? 'Google Slides'
    : u.pathname.startsWith('/forms') ? 'Google Form' : 'Google Doc'],
  [/^drive\.google\.com$/, u => u.pathname.includes('/folders/') ? 'Drive folder' : 'Drive file'],
  [/^forms\.gle$/, () => 'Google Form'],
  [/^calendar\.google\.com$/, () => 'Google Calendar'],
  [/^meet\.google\.com$/, () => 'Google Meet'],
  [/(^|\.)canva\.com$/, () => 'Canva design'],
  [/(^|\.)figma\.com$/, () => 'Figma file'],
  [/(^|\.)notion\.(so|site)$/, () => 'Notion page'],
  [/^(m\.me|(www\.)?messenger\.com)$/, () => 'Messenger group chat'],
  [/^chat\.whatsapp\.com$/, () => 'WhatsApp group'],
  [/^t\.me$/, () => 'Telegram group'],
  [/(^|\.)discord\.(gg|com)$/, () => 'Discord server'],
  [/(^|\.)trello\.com$/, () => 'Trello board'],
  [/(^|\.)zoom\.us$/, () => 'Zoom meeting'],
]

const words = (segment: string) => decodeURIComponent(segment).replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * A starting title from the link: "Google Sheet", "Drive folder", or the site plus its last readable
 * path segment ("example.org: Speaker guide"). Empty when the link isn't valid.
 */
export function suggestTitle(input: string): string {
  const check = checkUrl(input)
  if (!check.ok) return ''
  const u = new URL(check.url)
  const host = u.hostname.replace(/^www\./, '')
  for (const [pattern, name] of known) if (pattern.test(host)) return name(u)
  const segment = u.pathname.split('/').filter(Boolean).map(words)
    .reverse().find(s => s.length > 2 && /[a-z]/i.test(s) && !/^[a-z0-9]{16,}$/i.test(s.replace(/ /g, '')))
  const label = segment ? host + ': ' + segment.charAt(0).toUpperCase() + segment.slice(1) : host
  return label.slice(0, TITLE_MAX)
}

/** Pinned first, then the committee's order. */
export function ordered<T extends { pinned: boolean; position: number; createdAt: string }>(links: readonly T[]): T[] {
  return [...links].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position || a.createdAt.localeCompare(b.createdAt))
}

/** Move one link up or down within its group (pinned or not). Returns the new full order, or null at an edge. */
export function moved<T extends { id: string; pinned: boolean }>(links: readonly T[], id: string, step: -1 | 1): T[] | null {
  const at = links.findIndex(l => l.id === id)
  const to = at + step
  if (at < 0 || to < 0 || to >= links.length || links[to].pinned !== links[at].pinned) return null
  const next = [...links]
  ;[next[at], next[to]] = [next[to], next[at]]
  return next
}
