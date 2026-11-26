import type { createSupabaseClient } from '../../lib/supabase'

// Client for the developer-message edge function. The server takes the sender's name, email and role
// from their session; the browser only sends what they typed plus optional page and device details.

export type DeveloperTopic = 'bug' | 'question' | 'idea' | 'access' | 'other'
export type DeveloperMessage = {
  requestId: string; topic: DeveloperTopic; subject: string; message: string
  context: { path: string; userAgent: string; viewport: string; theme: string; timezone: string } | null
}
export type DeveloperFailure = 'limited' | 'busy' | 'quota' | 'denied' | 'invalid' | 'offline' | 'unavailable'
export class DeveloperMessageError extends Error {
  readonly code: DeveloperFailure
  readonly retryAfter?: number
  constructor(code: DeveloperFailure, retryAfter?: number) { super(code); this.name = 'DeveloperMessageError'; this.code = code; this.retryAfter = retryAfter }
}
export interface DeveloperMessageApi { send(message: DeveloperMessage): Promise<void> }

const known: readonly DeveloperFailure[] = ['limited', 'busy', 'quota', 'denied', 'invalid']

export function createDeveloperMessageApi(ready: ReturnType<typeof createSupabaseClient> | Promise<null>): DeveloperMessageApi {
  return {
    async send(message) {
      const client = await ready
      if (!client) throw new DeveloperMessageError('unavailable')
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new DeveloperMessageError('offline')
      let result: Awaited<ReturnType<typeof client.functions.invoke>>
      try { result = await client.functions.invoke('developer-message', { body: message }) }
      catch { throw new DeveloperMessageError('offline') }
      if (!result.error) return
      const response = (result.error as { context?: unknown }).context
      if (response instanceof Response) {
        const value = await response.json().catch(() => null) as { error?: { code?: unknown; retryAfter?: unknown } } | null
        const code = value?.error?.code
        const retry = Number(value?.error?.retryAfter)
        throw new DeveloperMessageError(typeof code === 'string' && (known as string[]).includes(code) ? code as DeveloperFailure : 'unavailable',
          Number.isFinite(retry) && retry > 0 ? retry : undefined)
      }
      throw new DeveloperMessageError('offline')
    },
  }
}
