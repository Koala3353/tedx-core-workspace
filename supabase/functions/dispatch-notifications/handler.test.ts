// Run: node supabase/functions/dispatch-notifications/handler.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchHandler, type PushItem, type PushOutcome } from './handler.ts'

const secret = 'x'.repeat(40)
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = (n: number, extra: Partial<PushItem> = {}): PushItem => ({ id: id(n), lease: id(100 + n), endpoint: 'https://fcm.googleapis.com/fcm/send/abc' + n,
  p256dh: 'B' + 'a'.repeat(86), auth: 'b'.repeat(22), title: 'Poster', body: 'Work due reminder', url: '/tasks/' + id(9), tag: '/tasks/' + id(9), urgency: 'normal', ...extra })

function fake(items: unknown[] = []) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  return { calls, backend: { async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args })
    if (name === 'claim_notification_jobs') return [{ id: id(1), lease: id(2) }]
    if (name === 'deliver_notification_job') return { state: 'delivered' }
    if (name === 'claim_push_batch') return items
    return {}
  } } }
}
const cron = () => new Request('https://x/functions/v1/dispatch-notifications', { method: 'POST', headers: { 'x-notification-dispatch-secret': secret } })

test('without VAPID keys the cron run is unchanged and push is off', async () => {
  const { backend, calls } = fake([item(1)])
  const body = await (await dispatchHandler(backend, secret)(cron())).json()
  assert.equal(body.delivered, 1)
  assert.equal(body.push, 'off')
  assert.ok(!calls.some(c => c.name === 'claim_push_batch'))
})

test('cron run sends the claimed batch and records each outcome', async () => {
  const outcomes: Record<string, PushOutcome> = { [id(1)]: 'sent', [id(2)]: 'gone', [id(3)]: 'retry' }
  const { backend, calls } = fake([item(1), item(2), item(3), { ...item(4), url: 'https://evil.example' }])
  const sent: string[] = []
  const handler = dispatchHandler(backend, secret, { push: async i => { sent.push(i.id); return outcomes[i.id] } })
  const body = await (await handler(cron())).json()
  assert.deepEqual(body.push, { claimed: 4, sent: 1, gone: 1, retry: 1, failed: 1 })
  assert.deepEqual(sent.sort(), [id(1), id(2), id(3)])
  const mark = calls.find(c => c.name === 'mark_push_results')
  assert.equal((mark?.args.p_results as unknown[]).length, 4)
  assert.ok(calls.findIndex(c => c.name === 'deliver_notification_job') < calls.findIndex(c => c.name === 'claim_push_batch'))
})

test('a push failure does not fail the in-app dispatch', async () => {
  const backend = { async rpc(name: string) {
    if (name === 'claim_notification_jobs') return []
    if (name === 'claim_push_batch') throw Error('down')
    return {}
  } }
  const response = await dispatchHandler(backend, secret, { push: async () => 'sent' })(cron())
  assert.equal(response.status, 200)
  assert.equal((await response.json()).push, 'unavailable')
})

test('wrong secret is still denied', async () => {
  const { backend } = fake()
  const response = await dispatchHandler(backend, secret)(new Request('https://x', { method: 'POST', headers: { 'x-notification-dispatch-secret': 'nope' } }))
  assert.equal(response.status, 403)
})

test('test request releases only that test id', async () => {
  const { backend, calls } = fake([item(1, { tag: 'tedx-test' })])
  const handler = dispatchHandler(backend, secret, { push: async () => 'sent', appOrigin: 'https://app.example' })
  const response = await handler(new Request('https://x', { method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json' }, body: JSON.stringify({ testId: id(7) }) }))
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example')
  assert.deepEqual(await response.json(), { sent: 1, queued: false })
  assert.deepEqual(calls.map(c => c.name), ['claim_push_batch', 'mark_push_results'])
  assert.deepEqual(calls[0].args, { p_limit: 10, p_test_id: id(7) })
  const bad = await handler(new Request('https://x', { method: 'POST', body: '{"testId":"nope"}' }))
  assert.equal(bad.status, 400)
})

test('preflight only for the app origin', async () => {
  const handler = dispatchHandler(fake().backend, secret, { appOrigin: 'https://app.example' })
  assert.equal((await handler(new Request('https://x', { method: 'OPTIONS', headers: { origin: 'https://app.example' } }))).status, 204)
  assert.equal((await handler(new Request('https://x', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }))).status, 403)
})
