import type { Committee, NewPerson, NudgeKind, Position, PositionTier, TeamPerson, Wave } from './api'

export const tutorialSteps = 7
export const schoolEmail = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@student\.ateneo\.edu$/

export const waveLabels: Record<Wave, string> = { wave1: 'Wave 1', wave1_5: 'Wave 1.5', core: 'Core' }
export const waveOptions: { value: Wave; label: string }[] = [
  { value: 'wave1', label: 'Wave 1' }, { value: 'wave1_5', label: 'Wave 1.5' }, { value: 'core', label: 'Core' },
]

export const skipReasons: Record<string, string> = {
  invalid: 'The row could not be read',
  not_school_email: 'Not an @student.ateneo.edu address',
  invalid_name: 'Name is missing or too long',
  invalid_wave: 'Wave must be Wave 1, Wave 1.5 or Core',
  duplicate: 'Listed twice in this batch',
  unknown_committee: 'Committee not found',
  unknown_role: 'Position not found',
  role_committee_mismatch: 'That position belongs to another committee',
  role_not_allowed: 'Only a full admin can give this position',
  account_unavailable: 'This account is closed or suspended',
  already_on_roster: 'Already on the roster',
}
export const skipReason = (reason: string) => skipReasons[reason] ?? 'Could not be added'

/** Which nudge fits a person now, in the order they move through setup. */
export const nudgeOpen: Record<NudgeKind, (p: TeamPerson) => boolean> = {
  sign_in: p => !p.signedIn,
  install: p => p.signedIn && !p.installed,
  tutorial: p => p.signedIn && !p.tutorialDone,
  reminders: p => p.signedIn && !p.remindersOn,
}
export const nudgeLabels: Record<NudgeKind, { group: string; button: (n: number) => string; single: string }> = {
  sign_in: { group: 'not signed in', button: n => `Nudge ${n} not signed in`, single: 'Resend invite' },
  install: { group: 'not installed', button: n => `Nudge ${n} to install`, single: 'Nudge to install' },
  tutorial: { group: 'tutorial unfinished', button: n => `Nudge ${n} to finish the tour`, single: 'Nudge to finish the tour' },
  reminders: { group: 'reminders off', button: n => `Nudge ${n} to turn on reminders`, single: 'Nudge to turn on reminders' },
}
export const nudgeKinds: NudgeKind[] = ['sign_in', 'install', 'tutorial', 'reminders']

export type StatusFilter = 'all' | 'not_signed_in' | 'not_installed' | 'tutorial' | 'reminders_off' | 'never_opened' | 'ready'
export const statusFilters: { value: StatusFilter; label: string; test: (p: TeamPerson) => boolean }[] = [
  { value: 'all', label: 'Everyone', test: () => true },
  { value: 'not_signed_in', label: 'Not signed in', test: p => !p.signedIn },
  { value: 'not_installed', label: 'Not installed', test: p => !p.installed },
  { value: 'tutorial', label: 'Tour unfinished', test: p => !p.tutorialDone },
  { value: 'reminders_off', label: 'Reminders off', test: p => !p.remindersOn },
  { value: 'never_opened', label: 'Never opened', test: p => !p.lastActiveAt },
  { value: 'ready', label: 'All set', test: p => p.signedIn && p.installed && p.tutorialDone && p.remindersOn },
]

export function tutorialLabel(p: TeamPerson): string {
  if (p.tutorialDone) return 'Done'
  if (p.tutorialStep <= 0) return 'Not started'
  return `Step ${Math.min(p.tutorialStep, tutorialSteps)}/${tutorialSteps}`
}

export function parseWave(raw: string): Wave | null | undefined {
  const v = raw.trim().toLowerCase().replace(/\s+/g, '')
  if (!v) return null
  if (['wave1', 'w1', '1', 'wave_1'].includes(v)) return 'wave1'
  if (['wave1.5', 'wave1_5', 'w1.5', '1.5', 'wave1,5', 'wave_1_5'].includes(v)) return 'wave1_5'
  if (['core', 'coreteam', 'wave0'].includes(v)) return 'core'
  return undefined
}

export function matchCommittee(raw: string, committees: Committee[]): Committee | null | undefined {
  const v = raw.trim().toLowerCase()
  if (!v) return null
  return committees.find(c => c.code.toLowerCase() === v || c.name.toLowerCase() === v)
    ?? committees.find(c => c.name.toLowerCase().replace(/\s+committee$/, '') === v.replace(/\s+committee$/, ''))
}

const plainMember = new Set(['', 'member', 'core member', 'committee member', 'associate', 'volunteer'])

/** Every position in a committee, or every position when none is chosen. Held positions stay listed. */
export function positionsFor(all: Position[], committeeCode: string | null): Position[] {
  return all.filter(p => (committeeCode ? p.committeeCode === committeeCode : true))
}

const tierLabels: Record<PositionTier, string> = { leadership: 'Leadership', head: 'Heads', core: 'Core' }
/** Positions grouped for a picker: Leadership, then Heads, then Core. Empty groups are left out. */
export function positionGroups(all: Position[]): { tier: PositionTier; label: string; items: Position[] }[] {
  return (['leadership', 'head', 'core'] as const)
    .map(tier => ({ tier, label: tierLabels[tier], items: all.filter(p => p.tier === tier) }))
    .filter(group => group.items.length)
}

/** Option text: the name, the committee when it isn't obvious, how many hold it, and the admin rule. */
export function positionLabel(p: Position, showCommittee: boolean): string {
  const parts = [p.roleName + (showCommittee && p.committeeCode && !p.roleName.toUpperCase().includes(p.committeeCode) ? ` (${p.committeeCode})` : '')]
  if (p.holders) parts.push(`${p.holders} ${p.holders === 1 ? 'person' : 'people'}`)
  if (!p.allowed) parts.push('full admin only')
  return parts.join(' · ')
}

export type PositionMatch = { roleCode: string | null; warning?: string; error?: string }
export function matchPosition(raw: string, committee: Committee | null, open: Position[]): PositionMatch {
  const v = raw.trim().toLowerCase()
  if (plainMember.has(v)) return { roleCode: null }
  const found = open.filter(p => p.roleName.toLowerCase() === v || p.roleCode.toLowerCase() === v)
  const inCommittee = committee ? found.find(p => p.committeeCode === committee.code) : found.length === 1 ? found[0] : undefined
  if (inCommittee) return { roleCode: inCommittee.roleCode }
  if (committee) return { roleCode: null, warning: `"${raw.trim()}" isn't a ${committee.code} position, so they'll join as a committee member` }
  return { roleCode: null, warning: `"${raw.trim()}" isn't a position we know. Check the spelling or add a committee` }
}

/* ---------- Paste a list ---------- */

export type Column = 'name' | 'email' | 'committee' | 'position' | 'wave'
const defaultOrder: Column[] = ['name', 'email', 'committee', 'position', 'wave']
const headerNames: Record<Column, RegExp> = {
  name: /^(full\s*)?name|^member|^student/,
  email: /e-?mail/,
  committee: /committee|team|department|dept|unit/,
  position: /position|role|title/,
  wave: /wave|batch|cohort/,
}
// Email first so "Student email" is not read as a name column.
const headerOrder: Column[] = ['email', 'committee', 'position', 'wave', 'name']

/** Reads CSV or tab-separated text (as pasted from Google Sheets), honouring quoted cells. */
export function splitRows(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delimiter) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  row.push(cell); rows.push(row)
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean))
}

export function detectColumns(first: string[]): { columns: (Column | null)[]; header: boolean } {
  const guessed = first.map(cell => {
    const v = cell.toLowerCase().trim()
    return headerOrder.find(col => headerNames[col].test(v)) ?? null
  })
  const looksLikeData = first.some(cell => cell.includes('@'))
  const known = new Set(guessed.filter(Boolean))
  if (!looksLikeData && known.size >= 2) {
    const seen = new Set<Column>()
    return { header: true, columns: guessed.map(col => (col && !seen.has(col) ? (seen.add(col), col) : null)) }
  }
  return { header: false, columns: first.map((_, i) => defaultOrder[i] ?? null) }
}

export type PreviewRow = {
  line: number
  name: string; email: string; committeeText: string; positionText: string; waveText: string
  person: NewPerson | null
  errors: string[]
  warnings: string[]
}

export function previewRows(text: string, committees: Committee[], open: Position[], roster: TeamPerson[]): { rows: PreviewRow[]; header: boolean; columns: (Column | null)[] } {
  const raw = splitRows(text)
  if (!raw.length) return { rows: [], header: false, columns: [] }
  const { columns, header } = detectColumns(raw[0])
  const onRoster = new Set(roster.map(p => p.email.toLowerCase()))
  const seen = new Map<string, number>()
  const rows = raw.slice(header ? 1 : 0).map((cells, index): PreviewRow => {
    const get = (col: Column) => { const i = columns.indexOf(col); return i >= 0 ? (cells[i] ?? '').trim() : '' }
    const name = get('name'), email = get('email').toLowerCase(), committeeText = get('committee'), positionText = get('position'), waveText = get('wave')
    const errors: string[] = [], warnings: string[] = []
    if (!name) errors.push('Name is missing')
    else if (name.length > 200) errors.push('Name is too long')
    if (!email) errors.push('Email is missing')
    else if (!schoolEmail.test(email) || email.length > 254) errors.push('Use an @student.ateneo.edu address')
    else if (onRoster.has(email)) errors.push('Already on the roster')
    else if (seen.has(email)) errors.push(`Same email as row ${seen.get(email)}`)
    if (email && !seen.has(email)) seen.set(email, index + 1)
    const committee = matchCommittee(committeeText, committees)
    if (committee === undefined) errors.push(`No committee called "${committeeText}"`)
    const wave = parseWave(waveText)
    if (wave === undefined) errors.push(`Wave "${waveText}" isn't Wave 1, Wave 1.5 or Core`)
    const position = matchPosition(positionText, committee ?? null, open)
    if (position.warning) warnings.push(position.warning)
    const person = errors.length ? null : { name, email, committeeCode: committee?.code ?? null, roleCode: position.roleCode, wave: wave ?? null }
    return { line: index + 1, name, email, committeeText, positionText, waveText, person, errors, warnings }
  })
  return { rows, header, columns }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
