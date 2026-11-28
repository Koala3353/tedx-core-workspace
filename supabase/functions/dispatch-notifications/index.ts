import {dispatchHandler,type PushSender} from './handler.ts'
import {importVapid,sendPush,topicFor} from '../_shared/webpush.ts'
declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void}
const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),secret=Deno.env.get('NOTIFICATION_DISPATCH_SECRET');if(!url||!service||!secret)throw Error('Dispatch configuration required');
const backend={async rpc(name:string,args:Record<string,unknown>){const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:service,authorization:'Bearer '+service,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Dispatch unavailable');return response.json()}}

// Device notifications stay off until all three VAPID settings exist (scripts/setup-push.sh sets them).
const vapidPublic=Deno.env.get('VAPID_PUBLIC_KEY'),vapidPrivate=Deno.env.get('VAPID_PRIVATE_KEY'),vapidSubject=Deno.env.get('VAPID_SUBJECT')
let push:PushSender|null=null
if(vapidPublic&&vapidPrivate&&vapidSubject){
 const vapid=importVapid(vapidPublic,vapidPrivate,vapidSubject)
 vapid.catch(()=>console.warn('Device notifications are off: the VAPID settings are not valid.'))
 push=async item=>{
  const keys=await vapid.catch(()=>null);if(!keys)return 'retry'
  const payload=new TextEncoder().encode(JSON.stringify({title:item.title,body:item.body,url:item.url,tag:item.tag,ts:Date.now()}))
  return sendPush(item,payload,keys,{ttl:86400,urgency:item.urgency,topic:await topicFor(item.tag),timeoutMs:8000})
 }
}else console.log('Device notifications are off: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY or VAPID_SUBJECT is not set.')

Deno.serve(dispatchHandler(backend,secret,{push,appOrigin:Deno.env.get('APP_ORIGIN')}))
