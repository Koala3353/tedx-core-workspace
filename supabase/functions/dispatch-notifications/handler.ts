export interface DispatchBackend{rpc(name:string,args:Record<string,unknown>):Promise<unknown>}
/** One leased device alert from claim_push_batch. */
export type PushItem={id:string;lease:string;endpoint:string;p256dh:string;auth:string;title:string;body:string;url:string;tag:string;urgency:'normal'|'high'}
export type PushOutcome='sent'|'gone'|'retry'|'failed'
/** Sends one alert; resolves the outcome and never throws. Null when VAPID keys are not set. */
export type PushSender=(item:PushItem)=>Promise<PushOutcome>
export type DispatchOptions={push?:PushSender|null;appOrigin?:string}
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max
const validItem=(i:unknown):i is PushItem=>{const p=i as PushItem;return !!p&&uuid(p.id)&&uuid(p.lease)&&text(p.endpoint,1000)&&text(p.p256dh,100)&&text(p.auth,40)&&text(p.title,200)&&text(p.body,400)&&text(p.url,200)&&p.url.startsWith('/')&&text(p.tag,200)&&(p.urgency==='normal'||p.urgency==='high')}
const PUSH_BATCH=50,PUSH_CONCURRENCY=6

/** Leases a batch of device alerts, sends them a few at a time, and records every outcome. */
export async function pushBatch(backend:DispatchBackend,send:PushSender,testId?:string){
 const items=await backend.rpc('claim_push_batch',testId?{p_limit:10,p_test_id:testId}:{p_limit:PUSH_BATCH})
 if(!Array.isArray(items)||items.length>PUSH_BATCH)throw Error('Push batch unavailable')
 const results:{id:string;lease:string;outcome:PushOutcome}[]=[]
 for(let offset=0;offset<items.length;offset+=PUSH_CONCURRENCY){await Promise.all(items.slice(offset,offset+PUSH_CONCURRENCY).map(async(item:unknown)=>{
  const i=item as PushItem;if(!uuid(i?.id)||!uuid(i?.lease))return
  results.push({id:i.id,lease:i.lease,outcome:validItem(i)?await send(i):'failed'})}))}
 if(results.length)await backend.rpc('mark_push_results',{p_results:results})
 const count=(o:PushOutcome)=>results.filter(r=>r.outcome===o).length
 return{claimed:items.length,sent:count('sent'),gone:count('gone'),retry:count('retry'),failed:count('failed')}
}

export function dispatchHandler(backend:DispatchBackend,secret:string,options:DispatchOptions={}){if(secret.length<32)throw Error('Dispatch configuration required');const push=options.push??null;return async(request:Request)=>{
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 const origin=request.headers.get('origin'),fromApp=!!options.appOrigin&&origin===options.appOrigin
 if(fromApp)Object.assign(headers,{'Access-Control-Allow-Origin':options.appOrigin!,'Vary':'Origin'})
 // The app's "Send a test notification" asks for its own queued test right away. The test id is an
 // unguessable capability returned only to that member by send_test_push; it can only release that
 // member's already-queued test alerts to their own devices, so no other secret is needed here.
 if(request.method==='OPTIONS'){if(!fromApp)return new Response(null,{status:403});return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Max-Age':'600'}})}
 if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
 if(!request.headers.has('x-notification-dispatch-secret')){
  let body:unknown;try{const raw=await request.text();if(raw.length>200)return reply({error:'invalid_request'},400);body=JSON.parse(raw)}catch{return reply({error:'invalid_request'},400)}
  const testId=(body as{testId?:unknown})?.testId;if(!uuid(testId))return reply({error:'invalid_request'},400)
  if(!push)return reply({push:'off'})
  try{const result=await pushBatch(backend,push,testId as string);return reply({sent:result.sent,queued:result.claimed===0})}catch{return reply({error:'dispatch_unavailable'},503)}
 }
 const supplied=request.headers.get('x-notification-dispatch-secret')??'',expected=secret;let difference=supplied.length^expected.length;for(let i=0;i<expected.length;i++)difference|=(supplied.charCodeAt(i)||0)^expected.charCodeAt(i);if(difference)return reply({error:'dispatch_denied'},403);if(request.body&&(await request.text()).length)return reply({error:'empty_body_required'},400);
 try{await backend.rpc('enqueue_notification_reminders',{p_limit:100});const jobs=await backend.rpc('claim_notification_jobs',{p_limit:20});if(!Array.isArray(jobs)||jobs.length>20||!jobs.every(j=>j&&uuid(j.id)&&uuid(j.lease)))throw Error();let delivered=0,deferred=0;
 for(let offset=0;offset<jobs.length;offset+=4){await Promise.all(jobs.slice(offset,offset+4).map(async j=>{try{const result=await backend.rpc('deliver_notification_job',{p_job_id:j.id,p_lease:j.lease})as{state?:string};if(result?.state==='delivered')delivered++;else deferred++}catch{deferred++}}))}
 // Device alerts go out after delivery, so notifications made in this run are pushed in this run.
 // A push failure never fails the in-app dispatch.
 let pushed:unknown='off';if(push){try{pushed=await pushBatch(backend,push)}catch{pushed='unavailable'}}
 return reply({claimed:jobs.length,delivered,deferred,push:pushed,externalAdapters:'disabled'});
 }catch{return reply({error:'dispatch_unavailable'},503)}
}}
