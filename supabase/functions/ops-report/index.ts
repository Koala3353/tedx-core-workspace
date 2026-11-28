import { opsReportHandler } from './handler.ts'

declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void}
const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),secret=Deno.env.get('APPS_SCRIPT_HMAC_SECRET')
const origin=Deno.env.get('APP_ORIGIN'),basePath=Deno.env.get('APP_BASE_PATH')||'/'
// Dashboard links in the email. OPS_REPORT_REPO overrides the GitHub repository (owner/name).
const repo=Deno.env.get('OPS_REPORT_REPO')||'Koala3353/tedx-core-workspace'
if(!url||!service||!secret||!origin)throw Error('Report configuration required')
const ref=new URL(url).hostname.split('.')[0]

const backend={async rpc(name:string,args:Record<string,unknown>){
  const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{apikey:service,authorization:'Bearer '+service,'content-type':'application/json'},body:JSON.stringify(args)})
  if(!response.ok)throw Error('Report unavailable')
  return response.json()
}}

Deno.serve(opsReportHandler(backend,{secret,links:{
  site:origin.replace(/\/$/,'')+(basePath.startsWith('/')?basePath:'/'+basePath).replace(/\/?$/,'/'),
  supabase:'https://supabase.com/dashboard/project/'+ref,
  github:'https://github.com/'+repo,
  appsScript:'https://script.google.com/home/executions',
}}))
