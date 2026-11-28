// Run: node supabase/functions/_shared/webpush.test.ts   (Node 24 strips the types; also runs under deno test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedEndpoint, b64uDecode, b64uEncode, classifyStatus, encryptPayload, importVapid, topicFor, vapidAuthorization } from './webpush.ts'

// RFC 8291 section 5 and appendix A.
const rfc = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml'
    + 'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT'
    + 'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

test('aes128gcm body matches the RFC 8291 example', async () => {
  const point = b64uDecode(rfc.asPublic)
  const privateKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: rfc.asPrivate,
    x: b64uEncode(point.slice(1, 33)), y: b64uEncode(point.slice(33)) }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const body = await encryptPayload(b64uDecode(rfc.plaintext), { p256dh: rfc.uaPublic, auth: rfc.auth },
    { salt: b64uDecode(rfc.salt), local: { privateKey, publicRaw: point } })
  assert.equal(b64uEncode(body), rfc.body)
})

test('random encryption has the right shape', async () => {
  const body = await encryptPayload(new TextEncoder().encode('{"title":"x"}'), { p256dh: rfc.uaPublic, auth: rfc.auth })
  assert.equal(body.length, 21 + 65 + 13 + 1 + 16)
  assert.equal(body[20], 65)
  await assert.rejects(encryptPayload(new Uint8Array(4000), { p256dh: rfc.uaPublic, auth: rfc.auth }))
  await assert.rejects(encryptPayload(new Uint8Array(1), { p256dh: 'BAAA', auth: rfc.auth }))
})

test('VAPID header is a valid ES256 JWT for the push service origin', async () => {
  const vapid = await importVapid(rfc.asPublic, rfc.asPrivate, 'mailto:workspace@example.org')
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, 1_800_000_000)
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
  assert.ok(match)
  const [, head, claims, signature, k] = match
  assert.equal(k, rfc.asPublic)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64uDecode(claims))), { aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 43200, sub: 'mailto:workspace@example.org' })
  const verify = await crypto.subtle.importKey('raw', b64uDecode(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verify, b64uDecode(signature), new TextEncoder().encode(head + '.' + claims)))
  await assert.rejects(importVapid(rfc.asPublic, 'short', 'mailto:a@b.c'))
  await assert.rejects(importVapid(rfc.asPublic, rfc.asPrivate, 'not a subject'))
})

test('only browser push services are allowed', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc:APA91b-xyz', 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
    'https://web.push.apple.com/QGuQyavXutnMH-1234567890', 'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2bAB'])
    assert.ok(allowedEndpoint(ok), ok)
  for (const bad of ['http://fcm.googleapis.com/fcm/send/abcdefghijklmnop', 'https://fcm.googleapis.com:8443/fcm/send/abcdefghijklmnop',
    'https://evil.example.com/fcm.googleapis.com/abcdefghij', 'https://fcm.googleapis.com.evil.example/abcdefghijklmnopq',
    'https://user@fcm.googleapis.com/fcm/send/abcdefghijklmnop'])
    assert.ok(!allowedEndpoint(bad), bad)
})

test('status mapping and topic', async () => {
  assert.deepEqual([201, 404, 410, 429, 503, 400, 413, 403].map(classifyStatus), ['sent', 'gone', 'gone', 'retry', 'retry', 'failed', 'failed', 'failed'])
  const topic = await topicFor('/tasks/68b84064-2772-401d-adc0-2da85596ba61')
  assert.match(topic, /^[A-Za-z0-9_-]{32}$/)
})
