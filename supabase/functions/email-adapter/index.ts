import { appsScriptMail } from './apps-script.ts'
import { emailDispatch } from './handler.ts'
import { approvedMail,type MailProvider } from './provider.ts'

declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void}
const url=Deno.env.get('SUPABASE_URL')
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const origin=Deno.env.get('APP_ORIGIN')
const basePath=Deno.env.get('APP_BASE_PATH')||'/'
const term=Deno.env.get('EMAIL_TERM_ID')
const secret=Deno.env.get('EMAIL_DISPATCH_SECRET')
const sender=Deno.env.get('EMAIL_FROM_ADDRESS')
const domainId=Deno.env.get('EMAIL_PROVIDER_DOMAIN_ID')
// EMAIL_TRANSPORT selects the mail provider: 'resend' (default) or 'apps_script'.
const transport=Deno.env.get('EMAIL_TRANSPORT')||'resend'

function configuredProvider():MailProvider|null {
  if(!sender||!domainId)return null
  if(transport==='apps_script') {
    const scriptUrl=Deno.env.get('APPS_SCRIPT_URL')
    const hmacSecret=Deno.env.get('APPS_SCRIPT_HMAC_SECRET')
    return scriptUrl&&hmacSecret?appsScriptMail({url:scriptUrl,secret:hmacSecret,sender,domainId}):null
  }
  if(transport!=='resend')return null
  const sendKey=Deno.env.get('EMAIL_PROVIDER_SEND_KEY')
  const readKey=Deno.env.get('EMAIL_PROVIDER_READ_KEY')
  return sendKey&&readKey?approvedMail({sender,domainId,sendKey,readKey}):null
}

function configuredHandler() {
  if(Deno.env.get('EMAIL_DIGEST_ENABLED')!=='true'||!url||!service||!origin||!term||!secret)return null
  const provider=configuredProvider()
  if(!provider)return null
  return emailDispatch(async(name,body)=>{
    const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{
      method:'POST',headers:{apikey:service,authorization:'Bearer '+service,'content-type':'application/json'},
      body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(5000),
    })
    if(!response.ok)throw Error('Email service unavailable')
    return response.json()
  },provider,{term,origin,basePath,secret})
}

const blocked=async()=>Response.json({state:'blocked',reason:'sender'},{status:503,headers:{'Cache-Control':'no-store'}})
let handler:ReturnType<typeof emailDispatch>|null=null
try {handler=configuredHandler()} catch { /* Malformed configuration is held closed. */ }
Deno.serve(handler??blocked)
