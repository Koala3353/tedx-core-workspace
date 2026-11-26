import type { createSupabaseClient } from './supabase'

/** Per-member app state: install and first-run tour progress. */
export type ClientState = { installed: boolean; tutorialStep: number; tutorialDone: boolean; tutorialVersion: number }
export type ClientStatePatch = { installed?: boolean; tutorialStep?: number; tutorialDone?: boolean; tutorialVersion?: number }

export interface ClientStateApi {
  /** Resolves null when the server functions are not deployed yet. */
  read(): Promise<ClientState | null>
  record(patch: ClientStatePatch): Promise<ClientState | null>
}

function valid(value: unknown): value is ClientState {
  if (!value || typeof value !== 'object') return false
  const v = value as ClientState
  return typeof v.installed === 'boolean' && typeof v.tutorialDone === 'boolean'
    && Number.isSafeInteger(v.tutorialStep) && Number.isSafeInteger(v.tutorialVersion)
}

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>

/**
 * Wraps public.read_client_state / public.record_client_state. Any failure, including
 * "function does not exist" before the migration is deployed, resolves to null so callers
 * fall back to browser storage.
 */
export function createClientStateApi(ready: ReturnType<typeof createSupabaseClient>): ClientStateApi {
  async function call(name: string, args?: Record<string, unknown>): Promise<ClientState | null> {
    try {
      const client = await ready
      if (!client) return null
      const rpc = client.rpc.bind(client) as unknown as Rpc
      const { data, error } = await rpc(name, args)
      return !error && valid(data) ? data : null
    } catch { return null }
  }
  return {
    read: () => call('read_client_state'),
    record: patch => call('record_client_state', {
      ...(patch.installed !== undefined ? { p_installed: patch.installed } : {}),
      ...(patch.tutorialStep !== undefined ? { p_tutorial_step: patch.tutorialStep } : {}),
      ...(patch.tutorialDone !== undefined ? { p_tutorial_done: patch.tutorialDone } : {}),
      ...(patch.tutorialVersion !== undefined ? { p_tutorial_version: patch.tutorialVersion } : {}),
    }),
  }
}

/** Browser-storage helpers that never throw (private mode, blocked storage). */
export const safeStorage = {
  get(key: string): string | null { try { return window.localStorage.getItem(key) } catch { return null } },
  set(key: string, value: string): void { try { window.localStorage.setItem(key, value) } catch { /* Storage optional. */ } },
  remove(key: string): void { try { window.localStorage.removeItem(key) } catch { /* Storage optional. */ } },
  session: {
    get(key: string): string | null { try { return window.sessionStorage.getItem(key) } catch { return null } },
    set(key: string, value: string): void { try { window.sessionStorage.setItem(key, value) } catch { /* Storage optional. */ } },
  },
}
