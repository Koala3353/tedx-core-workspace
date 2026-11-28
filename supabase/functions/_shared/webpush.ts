// Web Push sender: message encryption (RFC 8291, aes128gcm) and VAPID (RFC 8292), using only Web
// Crypto and fetch. No third-party package: Supabase Edge Runtime ships both natively, so nothing
// depends on Node compatibility (npm:web-push needs node:crypto ECDH and node:https), and the same
// file runs under Node for the tests in webpush.test.ts.

const text = new TextEncoder()

export function b64uEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) throw Error('Not base64url')
  const plain = value.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(plain + '='.repeat((4 - plain.length % 4) % 4))
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

// Web Crypto in Deno and Node both accept Uint8Array; the cast keeps strict lib typings quiet.
const buf = (bytes: Uint8Array) => bytes as unknown as BufferSource

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, key, length * 8))
}

export type PushTarget = { endpoint: string; p256dh: string; auth: string }
export type LocalKeys = { privateKey: CryptoKey; publicRaw: Uint8Array }

/** RFC 8291 single-record aes128gcm body. salt and local keys are injectable for the RFC test vector. */
export async function encryptPayload(plaintext: Uint8Array, target: Pick<PushTarget, 'p256dh' | 'auth'>,
  fixed?: { salt: Uint8Array; local: LocalKeys }): Promise<Uint8Array> {
  const uaPublic = b64uDecode(target.p256dh), authSecret = b64uDecode(target.auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw Error('Invalid subscription keys')
  if (plaintext.length > 3993) throw Error('Payload too large')
  let local = fixed?.local
  if (!local) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    local = { privateKey: pair.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) }
  }
  const uaKey = await crypto.subtle.importKey('raw', buf(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as EcdhKeyDeriveParams, local.privateKey, 256))
  const ikm = await hkdf(authSecret, shared, concat(text.encode('WebPush: info\0'), uaPublic, local.publicRaw), 32)
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, text.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, text.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, key, buf(concat(plaintext, new Uint8Array([2])))))
  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = 65
  return concat(header, local.publicRaw, sealed)
}

export type Vapid = { publicKey: string; key: CryptoKey; subject: string }

/** Imports the raw base64url VAPID pair (65-byte public point, 32-byte private scalar). */
export async function importVapid(publicKey: string, privateKey: string, subject: string): Promise<Vapid> {
  const point = b64uDecode(publicKey), scalar = b64uDecode(privateKey)
  if (point.length !== 65 || point[0] !== 4 || scalar.length !== 32) throw Error('Invalid VAPID keys')
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) throw Error('Invalid VAPID subject')
  const jwk = { kty: 'EC', crv: 'P-256', x: b64uEncode(point.slice(1, 33)), y: b64uEncode(point.slice(33)), d: b64uEncode(scalar), ext: false }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  return { publicKey: b64uEncode(point), key, subject }
}

/** VAPID Authorization header value for one push service origin, valid 12 hours. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const head = b64uEncode(text.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64uEncode(text.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: vapid.subject })))
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.key, text.encode(head + '.' + claims)))
  return `vapid t=${head}.${claims}.${b64uEncode(signature)}, k=${vapid.publicKey}`
}

/** Same allowlist as app_private.push_endpoint_allowed: the sender only ever posts to browser push services. */
export function allowedEndpoint(endpoint: string): boolean {
  if (endpoint.length < 30 || endpoint.length > 1000) return false
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
      && /^(fcm\.googleapis\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com)$/.test(url.hostname)
  } catch { return false }
}

export type PushOutcome = 'sent' | 'gone' | 'retry' | 'failed'
export type PushOptions = { ttl?: number; urgency?: 'normal' | 'high'; topic?: string; timeoutMs?: number; fetcher?: typeof fetch }

/** Maps a push service status to what the database records. */
export function classifyStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return 'sent'
  if (status === 404 || status === 410) return 'gone'
  if (status === 429 || status >= 500) return 'retry'
  return 'failed'
}

/** Encrypts and posts one message. Never throws: network trouble and timeouts come back as retry. */
export async function sendPush(target: PushTarget, payload: Uint8Array, vapid: Vapid, options: PushOptions = {}): Promise<PushOutcome> {
  if (!allowedEndpoint(target.endpoint)) return 'gone'
  let body: Uint8Array
  try { body = await encryptPayload(payload, target) } catch { return 'gone' }
  try {
    const headers: Record<string, string> = {
      Authorization: await vapidAuthorization(target.endpoint, vapid),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: String(options.ttl ?? 86400), Urgency: options.urgency ?? 'normal',
    }
    if (options.topic && /^[A-Za-z0-9_-]{1,32}$/.test(options.topic)) headers.Topic = options.topic
    const response = await (options.fetcher ?? fetch)(target.endpoint, { method: 'POST', headers, body: buf(body) as BodyInit,
      redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 8000) })
    await response.body?.cancel().catch(() => undefined)
    return classifyStatus(response.status)
  } catch { return 'retry' }
}

/** Short Topic header from the tag, so a newer alert for the same item replaces one still queued at the push service. */
export async function topicFor(tag: string): Promise<string> {
  return b64uEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(tag))).slice(0, 24))
}
