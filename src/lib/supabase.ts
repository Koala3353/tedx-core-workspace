import type { Database } from './database.types'
import type { ClientEnvironment } from './env'
import { createDedupedFetch } from './requestDedupe'

export async function createSupabaseClient(environment: ClientEnvironment) {
  if (environment.state !== 'configured') return null
  const { createClient } = await import('@supabase/supabase-js')
  // One client per app load; identical reads issued together share one round trip (see requestDedupe).
  const fetchFresh: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' })
  return createClient<Database>(environment.supabaseUrl, environment.supabasePublishableKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
    global: { fetch: createDedupedFetch(fetchFresh) },
  })
}
