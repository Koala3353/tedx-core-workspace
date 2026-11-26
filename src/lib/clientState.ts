import type { createSupabaseClient } from './supabase'

/**
 * Per-member app state: install, first-run tour and setup wizard progress. The setup keys and the
 * caller's committee/position arrive with migration 20261128200000; before it is deployed they
 * are missing, and callers fall back to browser storage.
 */
export type ClientState = {
  installed: boolean; tutorialStep: number; tutorialDone: boolean; tutorialVersion: number
  setupStep?: number; setupDone?: boolean; committee?: string | null; position?: string | null
}
export type ClientStatePatch = { installed?: boolean; tutorialStep?: number; tutorialDone?: boolean; tutorialVersion?: number }
export type SetupPatch = { step?: number; done?: boolean }

export interface ClientStateApi {
  /** Resolves null when the server functions are not deployed yet. */
  read(): Promise<ClientState | null>
  record(patch: ClientStatePatch): Promise<ClientState | null>
  /** public.record_setup_state. Resolves null when it is not deployed yet. */
  recordSetup(patch: SetupPatch): Promise<ClientState | null>
}

function valid(value: unknown): value is ClientState {
  if (!value || typeof value !== 'object') return false
  const v = value as ClientState
  return typeof v.installed === 'boolean' && typeof v.tutorialDone === 'boolean'
    && Number.isSafeInteger(v.tutorialStep) && Number.isSafeInteger(v.tutorialVersion)
    && (v.setupStep === undefined || Number.isSafeInteger(v.setupStep))
    && (v.setupDone === undefined || typeof v.setupDone === 'boolean')
    && (v.committee === undefined || v.committee === null || typeof v.committee === 'string')
    && (v.position === undefined || v.position === null || typeof v.position === 'string')
}

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>

/**
 * Wraps public.read_client_state / public.record_client_state / public.record_setup_state. Any failure, including
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
    recordSetup: patch => call('record_setup_state', {
      ...(patch.step !== undefined ? { p_step: patch.step } : {}),
      ...(patch.done !== undefined ? { p_done: patch.done } : {}),
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
