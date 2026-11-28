import type { createSupabaseClient } from '../../lib/supabase'
import { safeStorage } from '../../lib/clientState'
import { isStandalone } from '../../app/InstallWorkspace'

/** One of the signed-in person's devices with notifications on. endpointHash finds "this device". */
export type PushDevice = { id: string; label: string | null; createdAt: string; lastSuccessAt: string | null; failing: boolean; endpointHash: string }
export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string }

export interface PushApi {
  /** Public VAPID key from VITE_VAPID_PUBLIC_KEY, or null when device notifications are not set up. */
  vapidKey: string | null
  devices(term: string): Promise<PushDevice[]>
  save(term: string, subscription: PushSubscriptionKeys, label: string): Promise<void>
  remove(target: { endpoint: string } | { id: string }): Promise<void>
  /** Queues a test alert to the caller's own devices (once a minute) and asks for it to go out now. */
  test(term: string): Promise<{ devices: number; sentNow: boolean }>
}

const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const validDevice = (d: PushDevice) => uuid(d.id) && (d.label === null || typeof d.label === 'string' && d.label.length <= 60)
  && Number.isFinite(Date.parse(d.createdAt)) && (d.lastSuccessAt === null || Number.isFinite(Date.parse(d.lastSuccessAt)))
  && typeof d.failing === 'boolean' && /^[a-f0-9]{64}$/.test(d.endpointHash)

export class PushCommandError extends Error {
  constructor(readonly kind: 'rate_limited' | 'no_device' | 'unavailable') { super(kind) }
}

export function createPushApi(ready: ReturnType<typeof createSupabaseClient>, vapidKey: string | undefined): PushApi {
  async function client() { const c = await ready; if (!c) throw new PushCommandError('unavailable'); return c }
  return {
    vapidKey: vapidKey ?? null,
    async devices(term) {
      const { data, error } = await (await client()).rpc('read_my_push_devices' as never, { p_term_id: term } as never)
      const rows = data as unknown as PushDevice[]
      if (error || !Array.isArray(rows) || rows.length > 20 || !rows.every(validDevice)) throw new PushCommandError('unavailable')
      return rows
    },
    async save(term, s, label) {
      const { error } = await (await client()).rpc('save_push_subscription' as never, { p_term_id: term, p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth, p_label: label } as never)
      if (error) throw new PushCommandError('unavailable')
    },
    async remove(target) {
      const { error } = await (await client()).rpc('remove_push_subscription' as never,
        ('id' in target ? { p_id: target.id } : { p_endpoint: target.endpoint }) as never)
      if (error) throw new PushCommandError('unavailable')
    },
    async test(term) {
      const c = await client()
      const { data, error } = await c.rpc('send_test_push' as never, { p_term_id: term } as never)
      if (error) throw new PushCommandError(error.message === 'command_quota_limit' ? 'rate_limited' : error.message === 'command_no_push_device' ? 'no_device' : 'unavailable')
      const result = data as unknown as { testId: string; devices: number }
      if (!result || !uuid(result.testId) || !Number.isSafeInteger(result.devices)) throw new PushCommandError('unavailable')
      // Ask the sender for this test now. If that call fails, the next scheduled run (every 15 minutes) sends it.
      const sentNow = await c.functions.invoke('dispatch-notifications', { body: { testId: result.testId } })
        .then(({ data: sent, error: sendError }) => !sendError && typeof (sent as { sent?: unknown } | null)?.sent === 'number' && (sent as { sent: number }).sent > 0)
        .catch(() => false)
      return { devices: result.devices, sentNow }
    },
  }
}

/* Browser side. */

export type DeviceSupport = 'supported' | 'unsupported' | 'ios-install' | 'dev'

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** Whether this browser can take device notifications right now. iOS needs the Home Screen app (16.4+). */
export function deviceSupport(): DeviceSupport {
  if (isIos() && !isStandalone()) return 'ios-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'supported'
}

/** The workspace's own service worker registration, or null (local development does not register one). */
export async function workspaceRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try { return (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)) ?? null } catch { return null }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await workspaceRegistration()
  try { return registration ? await registration.pushManager.getSubscription() : null } catch { return null }
}

export function permission(): NotificationPermission {
  try { return Notification.permission } catch { return 'default' }
}

function decodeKey(key: string): Uint8Array<ArrayBuffer> {
  const plain = key.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(plain + '='.repeat((4 - plain.length % 4) % 4)), c => c.charCodeAt(0))
}

function encodeKey(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function subscriptionKeys(subscription: PushSubscription): PushSubscriptionKeys {
  return { endpoint: subscription.endpoint, p256dh: encodeKey(subscription.getKey('p256dh')), auth: encodeKey(subscription.getKey('auth')) }
}

export async function endpointHash(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** A short name for this device, such as "Chrome on Android" or "Safari app on iPhone". */
export function deviceLabel(): string {
  const agent = navigator.userAgent
  const browser = /Edg\//.test(agent) ? 'Edge' : /SamsungBrowser/.test(agent) ? 'Samsung Internet' : /Firefox\//.test(agent) ? 'Firefox'
    : /OPR\//.test(agent) ? 'Opera' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser'
  const system = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(agent) ? 'Android' : /CrOS/.test(agent) ? 'Chromebook' : /Mac OS X|Macintosh/.test(agent) ? 'Mac'
      : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : 'this device'
  return `${browser}${isStandalone() ? ' app' : ''} on ${system}`
}

const savedKey = (term: string) => 'tedx-push-saved:' + term
const sameKey = (subscription: PushSubscription, key: string) =>
  encodeKey(subscription.options?.applicationServerKey ?? null) === key

/** Turn on: ask permission (must run from a click), subscribe with the workspace key, save it. */
export async function enableDevice(api: PushApi, term: string): Promise<'on' | 'blocked' | 'dismissed' | 'unavailable'> {
  if (!api.vapidKey) return 'unavailable'
  const answer = permission() === 'granted' ? 'granted' : await Notification.requestPermission()
  if (answer === 'denied') return 'blocked'
  if (answer !== 'granted') return 'dismissed'
  const registration = await workspaceRegistration()
  if (!registration) return 'unavailable'
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameKey(subscription, api.vapidKey)) { await subscription.unsubscribe().catch(() => false); subscription = null }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(api.vapidKey) })
  await api.save(term, subscriptionKeys(subscription), deviceLabel())
  safeStorage.set(savedKey(term), await endpointHash(subscription.endpoint))
  return 'on'
}

/** Turn off on this device: stop the browser subscription and forget it in the workspace. */
export async function disableDevice(api: PushApi, term: string): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  await api.remove({ endpoint: subscription.endpoint })
  await subscription.unsubscribe().catch(() => false)
  safeStorage.remove(savedKey(term))
}

/**
 * Keeps the saved subscription current after the browser rotates it (the service worker
 * re-subscribes on pushsubscriptionchange and tells open windows). Quiet; never asks permission.
 */
export async function syncDevice(api: PushApi, term: string): Promise<void> {
  if (!api.vapidKey || deviceSupport() !== 'supported' || permission() !== 'granted') return
  const subscription = await currentSubscription()
  if (!subscription || !sameKey(subscription, api.vapidKey)) return
  const hash = await endpointHash(subscription.endpoint)
  if (safeStorage.get(savedKey(term)) === hash) return
  await api.save(term, subscriptionKeys(subscription), deviceLabel())
  safeStorage.set(savedKey(term), hash)
}
