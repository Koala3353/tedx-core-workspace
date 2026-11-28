/**
 * A fetch wrapper for the Supabase client that collapses duplicate reads.
 *
 * Pages often ask for the same thing more than once within a moment: a record guard and the
 * record page both read the task, focus and visibility fire together on a tab return, React
 * mounts twice in development. Each was a separate database round trip (and, with 60-70 people
 * at once, a separate connection slot). Here, identical read requests that are in flight share
 * one response, and a finished read is reused for `ttlMs` (default 1.5 s).
 *
 * Safety rules:
 *  - only reads are shared: GET on the REST API, and POST to RPCs whose names are reads
 *    (read_*, list_*, search_*, *_options, *_status, resolve_auth_context, explain_access);
 *  - the key includes the method, URL, body, and the auth/profile headers, so two people or two
 *    sessions never share a response;
 *  - any other request (a write) clears everything, so a read after a save always goes to the
 *    server and never joins a read that started before the save;
 *  - requests with an AbortSignal, and non-2xx responses, are never cached.
 */
type Snapshot = { status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer }
type Entry = { at: number; result: Promise<Snapshot> }

const READ_RPC = /\/rest\/v1\/rpc\/(read_[a-z0-9_]+|list_[a-z0-9_]+|search_[a-z0-9_]+|[a-z0-9_]+_options|[a-z0-9_]+_status|resolve_auth_context|explain_access)$/

export function isSharedRead(method: string, url: string): boolean {
  let path: string
  try { path = new URL(url).pathname } catch { return false }
  if (method === 'GET') return path.startsWith('/rest/v1/') && !path.startsWith('/rest/v1/rpc/')
  return method === 'POST' && READ_RPC.test(path)
}

function headerKey(headers: Headers): string {
  return ['authorization', 'apikey', 'accept', 'accept-profile', 'content-profile', 'prefer', 'range'].map(name => headers.get(name) ?? '').join('\u0001')
}

const toResponse = (s: Snapshot) => new Response(s.status === 204 || s.status === 304 ? null : s.body.slice(0), { status: s.status, statusText: s.statusText, headers: s.headers })

export function createDedupedFetch(base: typeof fetch, { ttlMs = 1500, now = () => Date.now() }: { ttlMs?: number; now?: () => number } = {}): typeof fetch {
  const entries = new Map<string, Entry>()
  let generation = 0
  return async (input, init) => {
    const request = input instanceof Request ? input : null
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const signal = init?.signal ?? null
    const body = init?.body ?? null
    if (!isSharedRead(method, url)) {
      // A write (or anything unrecognised): forget cached and in-flight reads first, so reads
      // issued after it can't be answered with data from before it.
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') { entries.clear(); generation++ }
      return base(input, init)
    }
    if (signal || request || (body !== null && typeof body !== 'string')) return base(input, init)
    const key = method + ' ' + url + '\u0002' + (body ?? '') + '\u0002' + headerKey(new Headers(init?.headers))
    const at = now()
    for (const [k, e] of entries) if (at - e.at > ttlMs) entries.delete(k)
    const hit = entries.get(key)
    if (hit) return toResponse(await hit.result)
    const started = generation
    const result = base(input, init).then(async response => ({ status: response.status, statusText: response.statusText, headers: [...response.headers.entries()], body: await response.arrayBuffer() }))
    const entry: Entry = { at, result }
    entries.set(key, entry)
    let snapshot: Snapshot
    try { snapshot = await result } catch (error) { if (entries.get(key) === entry) entries.delete(key); throw error }
    // Keep only successful reads, and only if no write happened while this one was in flight.
    if (snapshot.status < 200 || snapshot.status > 299 || started !== generation) { if (entries.get(key) === entry) entries.delete(key) }
    else entry.at = now()
    return toResponse(snapshot)
  }
}
