/** Lower-case and strip accents so "Peña" matches "pena" and "JOSÉ" matches "jose". */
export function fold(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Every word of the query must appear somewhere in the haystack (any order). */
export function matchesWords(haystack: string, query: string): boolean {
  const words = fold(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = fold(haystack)
  return words.every(word => text.includes(word))
}

/** Read and write a small JSON value in sessionStorage. Never throws (private mode, blocked storage). */
export const sessionMemory = {
  read<T>(key: string): T | null {
    try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as T : null } catch { return null }
  },
  write(key: string, value: unknown) {
    try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
  },
}
