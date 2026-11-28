// Run: node supabase/functions/ops-report/handler.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { opsReportHandler } from './handler.ts'
import { evaluateAlerts } from './alerts.ts'
import { MAX_REPORT_HTML,renderDaily } from './render.ts'
import { NOW,sampleReport } from './fixture.ts'

const secret='s'.repeat(48)
const links={site:'https://koala3353.github.io/tedx-core-workspace/',supabase:'https://supabase.com/dashboard/project/ref',github:'https://github.com/o/r',appsScript:'https://script.google.com/home/executions'}
const ts=String(Math.floor(NOW.getTime()/1000))

function signed(fields:Record<string,unknown>,options:{ts?:string;key?:string;tamper?:boolean}={}) {
  const t=options.ts??ts
  const body=JSON.stringify({v:1,ts:t,nonce:'n0nce-abcdefghijklmnop',...fields})
  const sig=createHmac('sha256',options.key??secret).update(t+'.'+body).digest('hex')
  return new Request(`https://x/functions/v1/ops-report?ts=${t}&sig=${sig}`,{method:'POST',body:options.tamper?body.replace('daily','urgent'):body})
}
function fake(report:unknown=sampleReport()) {
  const calls:Array<Record<string,unknown>>=[],seen=new Set<string>()
  return {calls,backend:{async rpc(name:string,args:Record<string,unknown>) {
    assert.equal(name,'ops_report');calls.push(args)
    if(seen.has(args.p_nonce as string))return {error:'replay'}
    seen.add(args.p_nonce as string)
    return typeof report==='function'?report(args):{...(report as object),kind:args.p_kind}
  }}}
}
const handler=(backend=fake().backend)=>opsReportHandler(backend,{secret,links,now:()=>NOW})

test('a signed daily request returns the rendered report', async () => {
  const {backend,calls}=fake()
  const response=await handler(backend)(signed({kind:'daily',mailQuota:1400}))
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.kind,'daily')
  assert.deepEqual(calls,[{p_kind:'daily',p_nonce:'n0nce-abcdefghijklmnop'}])
  assert.equal(body.email.subject,'TEDx Core daily report: Sun 29 Nov')
  assert.match(body.email.html,/Send sponsor deck to partners/)
  assert.match(body.email.text,/Never signed in: Andrea Lim/)
  assert.ok(body.email.html.length<MAX_REPORT_HTML,'html size '+body.email.html.length)
})

test('bad signature, wrong key, tampered body, stale timestamp and GET are refused', async () => {
  const h=handler()
  assert.equal((await h(signed({kind:'daily'},{key:'k'.repeat(48)}))).status,403)
  assert.equal((await h(signed({kind:'daily'},{tamper:true}))).status,403)
  assert.equal((await h(signed({kind:'daily'},{ts:String(Number(ts)-301)}))).status,403)
  assert.equal((await h(signed({kind:'daily'},{ts:String(Number(ts)+301)}))).status,403)
  assert.equal((await h(new Request('https://x/?ts='+ts+'&sig='+'0'.repeat(64),{method:'POST',body:'{}'}))).status,403)
  assert.equal((await h(new Request('https://x/',{method:'GET'}))).status,405)
})

test('replayed nonce is refused', async () => {
  const h=handler()
  assert.equal((await h(signed({kind:'urgent'}))).status,200)
  assert.equal((await h(signed({kind:'urgent'}))).status,409)
})

test('invalid fields are refused after the signature check', async () => {
  const h=handler()
  assert.equal((await h(signed({kind:'weekly'}))).status,400)
  assert.equal((await h(signed({kind:'daily',nonce:'short'}))).status,400)
  assert.equal((await h(signed({kind:'daily',mailQuota:-1}))).status,400)
  assert.equal((await h(signed({kind:'daily',ts:'1'}))).status,400)
})

test('backend failure is 503, never a partial email', async () => {
  const h=handler({async rpc(){throw Error('down')}})
  assert.equal((await h(signed({kind:'daily'}))).status,503)
})

test('urgent with a healthy system returns no email', async () => {
  const {backend}=fake(sampleReport('urgent'))
  const body=await (await handler(backend)(signed({kind:'urgent',mailQuota:900}))).json()
  assert.deepEqual(body.alerts,[])
  assert.equal(body.email,null)
})

test('urgent with problems returns alerts sorted by severity and an URGENT subject', async () => {
  const report=sampleReport('urgent',{health:{
    reminders:{lastRunAt:new Date(NOW.getTime()-130*60000).toISOString(),minutesSince:130,senderLive:true,approvalExpiresAt:'2027-05-25T00:00:00Z',dailyCap:1500,attemptsToday:10},
    outbox:{pending:3,pendingLate:3,oldestLateMinutes:95,stuck:0,failedHour:1},
  }})
  const body=await (await handler(fake(report).backend)(signed({kind:'urgent',mailQuota:3}))).json()
  assert.deepEqual(body.alerts.map((a:{key:string;severity:string})=>a.key+':'+a.severity),
    ['reminders_stalled:critical','outbox_stuck:critical','mail_quota:critical','outbox_failed:warning'])
  assert.equal(body.email.subject,"URGENT: TEDx Core: reminders haven't run in 2 hours (+3 more)")
  assert.match(body.email.text,/\[CRITICAL\] Reminders haven't run in 2 hours/)
})

test('alert thresholds', () => {
  const base=sampleReport('urgent')
  const keys=(health:Record<string,unknown>,quota:number|null=null)=>evaluateAlerts({...base,health:{...base.health,...health}},links,quota,NOW).map(a=>a.key+':'+a.severity)
  assert.deepEqual(keys({}),[])
  assert.deepEqual(keys({reminders:{...base.health.reminders,minutesSince:50}}),['reminders_stalled:warning'])
  assert.deepEqual(keys({reminders:{...base.health.reminders,lastRunAt:null}}),['email_relay_failing:critical'])
  assert.deepEqual(keys({reminders:{...base.health.reminders,senderLive:false}}),['email_sender_off:critical'])
  assert.deepEqual(keys({reminders:{...base.health.reminders,quotaBlockedAt:'2026-11-28T20:00:00Z'}}),['email_quota_blocked:critical'])
  assert.deepEqual(keys({reminders:{...base.health.reminders,approvalExpiresAt:'2026-12-05T00:00:00Z'}}),['email_sender_expiring:warning'])
  assert.deepEqual(keys({reminders:{...base.health.reminders,attemptsToday:1300}}),['email_cap_near:warning'])
  assert.deepEqual(keys({email:{failedHour:2,uncertainHour:0,waitingLate:1,stuckSending:0}}),['email_failed:warning','email_backlog:warning'])
  assert.deepEqual(keys({push:{sentHour:1,failedHour:5,waitingLate:0}}),['push_failures:warning'])
  assert.deepEqual(keys({push:{sentHour:10,failedHour:5,waitingLate:0}}),[])
  assert.deepEqual(keys({clientErrors:{hitsHour:51,top:[]}}),['client_error_spike:critical'])
  const top=(hitsHour:number,firstMinutesAgo:number)=>({clientErrors:{hitsHour,top:[{fingerprint:'abcdef1234567890',route:'/x',message:'m',people:2,hitsHour,
    firstSeen:new Date(NOW.getTime()-firstMinutesAgo*60000).toISOString()}]}})
  assert.deepEqual(keys(top(5,60)),['client_error:abcdef123456:warning'])
  assert.deepEqual(keys(top(4,60)),[])
  assert.deepEqual(keys(top(9,3000)),[],'old fingerprints do not page')
  assert.deepEqual(keys({database:{bytes:430e6,planBytes:524288000}}),['db_size:warning'])
  assert.deepEqual(keys({database:{bytes:510e6,planBytes:524288000}}),['db_size:critical'])
  assert.deepEqual(keys({},19),['mail_quota:warning'])
  assert.deepEqual(keys({},20),[])
})

test('render escapes content and keeps house style', () => {
  const mail=renderDaily(sampleReport(),[],links,1200,NOW)
  assert.ok(!mail.html.includes('<script>alert'))
  assert.match(mail.html,/&lt;script&gt;alert/)
  for(const part of [mail.html,mail.text,mail.subject]) {
    assert.ok(!/[–—]/.test(part),'no en or em dashes')
    assert.ok(!/\p{Extended_Pictographic}/u.test(part),'no emoji')
  }
  assert.match(mail.html,/prefers-color-scheme:dark/)
  assert.match(mail.html,/href="https:\/\/koala3353\.github\.io\/tedx-core-workspace\/tasks\/3f2b8c1e-9a47-4d2b-8f61-000000000001"/)
})

test('a report with every list full still fits the HTML budget', () => {
  const r=sampleReport() as unknown as {work:{overdue:{items:unknown[]};dueSoon:{items:unknown[]}};usage:{committees:unknown[]};health:{clientErrors:{top:unknown[]}}}
  const item=(i:number)=>({kind:'task',title:'A fairly long task title that goes on for a while, number '+i,committee:'Marketing and Communications',owner:'Firstname Lastname',dueOn:'2026-11-20',days:9,path:'tasks/3f2b8c1e-9a47-4d2b-8f61-'+String(i).padStart(12,'0')})
  r.work.overdue.items=Array.from({length:10},(_,i)=>item(i));r.work.dueSoon.items=Array.from({length:10},(_,i)=>item(i+20))
  r.usage.committees=Array.from({length:18},(_,i)=>({name:'Committee '+i,members:5,active7d:3}))
  const e=r.health.clientErrors.top[0];r.health.clientErrors.top=Array.from({length:10},()=>e)
  const mail=renderDaily(r,evaluateAlerts(r,links,3,NOW),links,3,NOW)
  assert.ok(mail.html.length>0&&mail.html.length<=MAX_REPORT_HTML,'html size '+mail.html.length)
  assert.match(mail.text,/number 9/)
})
