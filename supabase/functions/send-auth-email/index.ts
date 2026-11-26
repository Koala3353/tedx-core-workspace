import { appsScriptMail } from '../email-adapter/apps-script.ts'
import { hookSecretBytes,sendAuthEmail } from './handler.ts'

declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void}
const hookSecret=Deno.env.get('SEND_EMAIL_HOOK_SECRET')
const scriptUrl=Deno.env.get('APPS_SCRIPT_URL')
const hmacSecret=Deno.env.get('APPS_SCRIPT_HMAC_SECRET')
// The relay ignores the binding; it only has to pass appsScriptMail's shape checks. Reuse the
// email-adapter values when set so both functions describe the same sender.
const sender=Deno.env.get('EMAIL_FROM_ADDRESS')||'workspace@student.ateneo.edu'
const domainId=Deno.env.get('EMAIL_PROVIDER_DOMAIN_ID')||'00000000-0000-0000-0000-000000000000'

function configuredHandler() {
  const secret=hookSecret?hookSecretBytes(hookSecret):null
  if(!secret||!scriptUrl||!hmacSecret)return null
  return sendAuthEmail(appsScriptMail({url:scriptUrl,secret:hmacSecret,sender,domainId}),secret)
}

// Fail closed: Auth reports the error and no code is sent until the function is configured.
const blocked=async()=>Response.json({error:{http_code:503,message:'Sign-in email is not configured'}},
  {status:503,headers:{'Cache-Control':'no-store'}})
let handler:ReturnType<typeof sendAuthEmail>|null=null
try {handler=configuredHandler()} catch { /* Malformed configuration is held closed. */ }
Deno.serve(handler??blocked)
