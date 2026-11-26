import { appsScriptMail } from '../email-adapter/apps-script.ts'
import { approvedRecipient } from '../email-adapter/provider.ts'
import { workspaceLink } from '../email-adapter/templates.ts'
import { developerMessageHandler,type Sender } from './handler.ts'

declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void}
const url=Deno.env.get('SUPABASE_URL')
const anon=Deno.env.get('SUPABASE_ANON_KEY')
const origin=Deno.env.get('APP_ORIGIN')
const basePath=Deno.env.get('APP_BASE_PATH')||'/'
const scriptUrl=Deno.env.get('APPS_SCRIPT_URL')
const hmacSecret=Deno.env.get('APPS_SCRIPT_HMAC_SECRET')
// Where messages go. The relay only delivers to @student.ateneo.edu.
const to=Deno.env.get('DEVELOPER_EMAIL')
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const address=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/

function configuredHandler() {
  if(!url||!anon||!origin||!scriptUrl||!hmacSecret||!to||!approvedRecipient.test(to))return null
  const link=workspaceLink(origin,basePath)
  const source=url.replace(/\/$/,'')
  async function call(path:string,jwt:string,body?:unknown) {
    const response=await fetch(source+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{Authorization:jwt,apikey:anon!,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
    if(response.status===401||response.status===403)return null
    if(!response.ok)throw Error('identity unavailable')
    return response.json()
  }
  return developerMessageHandler({
    async identify(jwt):Promise<Sender|null> {
      const user=await call('/auth/v1/user',jwt)
      if(!user||!uuid.test(user.id)||typeof user.email!=='string'||!address.test(user.email)||user.email.length>254)return null
      // Only people with workspace access can send; the same check the app runs at sign-in.
      const context=await call('/rest/v1/rpc/resolve_auth_context',jwt,{})
      if(!context||typeof context!=='object'||typeof context.displayName!=='string')return null
      const capabilities=Array.isArray(context.capabilities)?context.capabilities:[]
      const role=context.audience==='guest'?'Guest':capabilities.includes('admin.configure')?'Admin':'Member'
      const name=context.displayName.replace(/\s+/g,' ').trim().slice(0,120)||user.email
      return {id:user.id,email:user.email.toLowerCase(),name,role}
    },
  },appsScriptMail({url:scriptUrl,secret:hmacSecret,sender:'workspace@student.ateneo.edu',domainId:'00000000-0000-0000-0000-000000000000'}),
  {origin:link.origin,basePath:link.basePath,to})
}

// Fail closed until every secret is set.
const blocked=async()=>Response.json({error:{code:'unavailable'}},{status:503,headers:{'Cache-Control':'no-store'}})
let handler:ReturnType<typeof developerMessageHandler>|null=null
try {handler=configuredHandler()} catch { /* Malformed configuration is held closed. */ }
Deno.serve(handler??blocked)
