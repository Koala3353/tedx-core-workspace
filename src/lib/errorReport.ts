import type { createSupabaseClient } from './supabase'
import { stripBase } from './basePath'

/**
 * Reports app errors (uncaught errors, failed promises, page render errors, unexpected command
 * failures) to public.log_client_error so the owner's daily report can list real bugs.
 * Privacy: only the error message and top stack frames, the page path without its query string,
 * the build id and the browser family are sent; emails, URL queries, long tokens and long numbers are
 * removed here and again on the server. Never request bodies or form contents.
 * Signed-in sessions only (the server refuses anonymous callers). Never throws, never retries.
 */
export type ErrorKind = 'error' | 'rejection' | 'render' | 'command'

type Client = Awaited<ReturnType<typeof createSupabaseClient>>
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>

const PER_PAGE_LOAD = 15
const SAME_ERROR_MS = 5 * 60 * 1000
let ready: Promise<Client> | null = null
let sent = 0
const recent = new Map<string, number>()

// Noise that says nothing about this app: cross-origin script errors, browser extensions, layout loops.
const IGNORED = /^(?:Script error\.?|ResizeObserver loop|Non-Error promise rejection captured)|chrome-extension:|moz-extension:|safari-(?:web-)?extension:/i

export function scrub(text: string, limit: number): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[email]')
    .replace(/((?:https?:\/\/|\/)[^\s?#'"()]*)[?#][^\s'"()]*/g, '$1')
    .replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '[token]')
    .replace(/[A-Za-z0-9_+/=]{32,}/g, '[token]')
    .replace(/\d{7,}/g, '[number]')
    .trim().slice(0, limit)
}

/** "Chrome 141", "Safari 19 mobile". Family and major version only. */
export function browserFamily(agent: string): string {
  const mobile = /Mobi|Android|iPhone|iPad/.test(agent) ? ' mobile' : ''
  const families: Array<[string, RegExp]> = [['Edge', /Edg\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]]
  for (const [name, pattern] of families) {
    const version = pattern.exec(agent)?.[1]
    if (version) return `${name} ${version}${mobile}`
  }
  return 'Other' + mobile
}

function buildId(): string {
  // Production chunks carry a content hash in their file name; the dev server does not.
  return /-([A-Za-z0-9_-]{8})\.js$/.exec(import.meta.url)?.[1] ?? 'dev'
}

function describe(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    const frames = (error.stack ?? '').split('\n').map(line => line.trim()).filter(line => /^at |@/.test(line)).slice(0, 5)
    return { message: `${error.name}: ${error.message}`, stack: frames.join('\n') }
  }
  if (typeof error === 'string') return { message: error, stack: '' }
  try { return { message: JSON.stringify(error)?.slice(0, 300) ?? String(error), stack: '' } } catch { return { message: String(error), stack: '' } }
}

/** Gives the reporter the app's Supabase client. Called once by the auth gateway. */
export function attachErrorReporter(client: Promise<Client>): void { ready = client }

export function reportError(kind: ErrorKind, error: unknown): void {
  try {
    if (typeof window === 'undefined' || !ready || sent >= PER_PAGE_LOAD) return
    const { message: raw, stack: rawStack } = describe(error)
    if (!raw || IGNORED.test(raw) || IGNORED.test(rawStack)) return
    const message = scrub(raw, 300), stack = scrub(rawStack, 1200)
    const route = stripBase(window.location.pathname).slice(0, 200) || '/'
    const key = `${kind}\n${message}\n${route}`, now = Date.now()
    if ((recent.get(key) ?? 0) > now - SAME_ERROR_MS) return
    recent.set(key, now)
    sent++
    void ready.then(async client => {
      if (!client) return
      const { data } = await client.auth.getSession()
      if (!data.session) return
      const rpc = client.rpc.bind(client) as unknown as Rpc
      await rpc('log_client_error', { p_kind: kind, p_message: message, p_route: route, p_stack: stack || null,
        p_build: buildId(), p_agent: browserFamily(navigator.userAgent) })
    }).catch(() => { /* Reporting is best effort. */ })
  } catch { /* Never let reporting break the page. */ }
}

/** Unexpected or unavailable command results (mapCommandError). Plain network loss is not a bug. */
export function reportCommandError(kind: string, code: string, message: unknown): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (kind === 'unavailable' && (!code || code === 'COMMAND_UNAVAILABLE')) return
  reportError('command', `${kind}: ${code || 'no code'}${typeof message === 'string' && message ? ' ' + message.slice(0, 160) : ''}`)
}

/** Window-level listeners for uncaught errors and unhandled promise rejections. */
export function installErrorReporting(): void {
  window.addEventListener('error', event => reportError('error', event.error ?? event.message))
  window.addEventListener('unhandledrejection', event => reportError('rejection', event.reason))
}
