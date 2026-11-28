// ops-report: called only by the Apps Script project (apps-script/Code.gs sendDailyReport / checkUrgent).
// Authenticated the same way as the mail relay, in reverse: the shared HMAC_SECRET
// (APPS_SCRIPT_HMAC_SECRET here) signs ts + '.' + rawBody, the signature and timestamp travel as query
// parameters (POST ?ts=<unix seconds>&sig=<hex>), the timestamp must be within 5 minutes, and the body's
// nonce is accepted once (public.ops_report records it). The reply is the rendered email and the alert
// list; Apps Script decides whether to send it and always sends to its own fixed address.
import { evaluateAlerts,obj,type Alert,type Links } from './alerts.ts'
import { MAX_REPORT_HTML,renderDaily,renderUrgent,type ReportMail } from './render.ts'

export interface ReportBackend { rpc(name:string,args:Record<string,unknown>):Promise<unknown> }
export type ReportConfig={secret:string;links:Links;now?:()=>Date}
export type ReportReply={ok:true;kind:'daily'|'urgent';generatedAt:string;alerts:Array<Pick<Alert,'key'|'severity'|'title'>>;email:ReportMail|null}

const CLOCK_WINDOW_SECONDS=300,MAX_BODY=2048

function hexBytes(hex:string):Uint8Array<ArrayBuffer> {
  const out=new Uint8Array(hex.length/2)
  for(let i=0;i<out.length;i++)out[i]=parseInt(hex.slice(i*2,i*2+2),16)
  return out
}

export function opsReportHandler(backend:ReportBackend,config:ReportConfig) {
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(config.secret))throw Error('Report configuration required')
  const key=crypto.subtle.importKey('raw',new TextEncoder().encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['verify'])
  return async(request:Request)=>{
    const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
    if(request.method!=='POST')return reply({error:'method_not_allowed'},405)
    const url=new URL(request.url),ts=url.searchParams.get('ts')??'',sig=(url.searchParams.get('sig')??'').toLowerCase()
    let raw:string
    try {raw=await request.text()} catch {return reply({error:'invalid_request'},400)}
    if(!/^\d{10}$/.test(ts)||!/^[0-9a-f]{64}$/.test(sig)||!raw||raw.length>MAX_BODY)return reply({error:'denied'},403)
    const now=config.now?.()??new Date()
    if(Math.abs(Math.floor(now.getTime()/1000)-Number(ts))>CLOCK_WINDOW_SECONDS)return reply({error:'denied'},403)
    const valid=await crypto.subtle.verify('HMAC',await key,hexBytes(sig),new TextEncoder().encode(ts+'.'+raw))
    if(!valid)return reply({error:'denied'},403)

    let body:Record<string,unknown>
    try {body=obj(JSON.parse(raw))} catch {return reply({error:'invalid_request'},400)}
    const kind=body.kind,nonce=body.nonce,quota=body.mailQuota
    if(body.v!==1||String(body.ts)!==ts||(kind!=='daily'&&kind!=='urgent')||typeof nonce!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)
      ||(quota!==undefined&&quota!==null&&!(Number.isInteger(quota)&&(quota as number)>=0&&(quota as number)<=100000)))return reply({error:'invalid_request'},400)
    const mailQuota=typeof quota==='number'?quota:null

    let report:unknown
    try {report=await backend.rpc('ops_report',{p_kind:kind,p_nonce:nonce})} catch {return reply({error:'unavailable'},503)}
    if(obj(report).error==='replay')return reply({error:'replay'},409)
    if(obj(report).kind!==kind)return reply({error:'unavailable'},503)

    const alerts=evaluateAlerts(report,config.links,mailQuota,now)
    let email=kind==='daily'?renderDaily(report,alerts,config.links,mailQuota,now):renderUrgent(report,alerts,config.links,mailQuota,now)
    // Over the size budget the email goes out as plain text only rather than clipped HTML.
    if(email&&email.html.length>MAX_REPORT_HTML)email={...email,html:''}
    const result:ReportReply={ok:true,kind,generatedAt:now.toISOString(),alerts:alerts.map(a=>({key:a.key,severity:a.severity,title:a.title})),email}
    return reply(result)
  }
}
