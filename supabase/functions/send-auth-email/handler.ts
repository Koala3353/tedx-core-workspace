import { htmlPart,LICENSE_LINE,SIGNATURE } from '../email-adapter/layout.ts'
import { approvedRecipient,type Mail,type MailProvider } from '../email-adapter/provider.ts'

// Supabase Auth "Send Email Hook" (HTTPS). Auth signs every call with Standard Webhooks:
//   webhook-id, webhook-timestamp (unix seconds), webhook-signature ("v1,<base64>" entries, space separated)
//   signature = base64(HMAC-SHA256(base64decode(secret without "v1,whsec_"), id + "." + timestamp + "." + rawBody))
// Reply contract: 200 {} once the email is handed off, or {error:{http_code,message}} so Auth reports the failure.

const TOLERANCE_SECONDS=300
const MAX_BODY=65536
// Auth sends 'signup' for a first-time code (shouldCreateUser) and 'magiclink' (or 'email' on some versions)
// for a returning user. Recovery, invite, email change and reauthentication are not used by this workspace.
const CODE_ACTIONS=new Set(['signup','magiclink','email'])

type HookPayload={user?:{email?:unknown};email_data?:{token?:unknown;email_action_type?:unknown}}

export function hookSecretBytes(secret:string):Uint8Array|null {
  const encoded=secret.trim().replace(/^v1,/,'').replace(/^whsec_/,'')
  if(!/^[A-Za-z0-9+/]{16,}={0,2}$/.test(encoded))return null
  try {
    const raw=atob(encoded)
    const bytes=new Uint8Array(raw.length)
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i)
    return bytes.length>=16?bytes:null
  } catch {return null}
}

function decodeBase64(value:string):Uint8Array|null {
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value))return null
  try {
    const raw=atob(value)
    const bytes=new Uint8Array(raw.length)
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i)
    return bytes
  } catch {return null}
}

function sameBytes(a:Uint8Array,b:Uint8Array):boolean {
  let different=a.length^b.length
  for(let i=0;i<b.length;i++)different|=(a[i]??0)^b[i]
  return different===0
}

export async function verifyWebhook(secret:Uint8Array,headers:Headers,body:string,now=Date.now()):Promise<boolean> {
  const id=headers.get('webhook-id')??''
  const timestamp=headers.get('webhook-timestamp')??''
  const signatures=headers.get('webhook-signature')??''
  if(!id||id.length>256||!/^\d{1,12}$/.test(timestamp)||!signatures||signatures.length>4096)return false
  if(Math.abs(Math.floor(now/1000)-Number(timestamp))>TOLERANCE_SECONDS)return false
  const key=await crypto.subtle.importKey('raw',secret.slice(),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const expected=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(id+'.'+timestamp+'.'+body)))
  let matched=false
  for(const entry of signatures.split(' ')) {
    const [version,value]=entry.split(',',2)
    if(version!=='v1'||!value)continue
    const candidate=decodeBase64(value)
    // Check every entry so timing does not reveal which one matched.
    if(candidate&&sameBytes(candidate,expected))matched=true
  }
  return matched
}

const CODE_REASON='You are getting this because someone asked to sign in to the TEDxAteneodeManilaU core workspace with this email address.'

// The code is never in an image: plain text in both parts so it can be read aloud, selected and copied.
export function signInCodeMail(code:string):Mail {
  const subject='Your TEDx workspace sign-in code: '+code
  return {
    type:'auth_code',
    subject,
    text:'Your sign-in code is '+code+". It expires in 1 hour. If you didn't ask for this, ignore this email."
      +'\n\n'+SIGNATURE+'\n\n'+CODE_REASON+'\n'+LICENSE_LINE,
    ...htmlPart({subject,preheader:'Your code is '+code+'. It expires in 1 hour.',heading:'Your sign-in code',
      body:['Enter this code in the TEDx core workspace to finish signing in.'],
      detail:{kind:'code',label:'Sign-in code',code},
      // Must match Supabase Auth > Email OTP expiration (3600 seconds on this project).
      after:["It expires in 1 hour. If you didn't ask for this, you can ignore this email."],reason:CODE_REASON}),
  }
}

export function sendAuthEmail(provider:MailProvider,secret:Uint8Array,newJob:()=>string=()=>crypto.randomUUID()) {
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
  const fail=(status:number,message:string)=>reply({error:{http_code:status,message}},status)
  return async(request:Request)=>{
    if(request.method!=='POST')return fail(405,'Method not allowed')
    const declared=Number(request.headers.get('content-length')??'0')
    if(declared>MAX_BODY)return fail(413,'Payload too large')
    const body=await request.text()
    if(body.length>MAX_BODY)return fail(413,'Payload too large')
    if(!await verifyWebhook(secret,request.headers,body))return fail(401,'Invalid hook signature')
    let payload:HookPayload
    try {payload=JSON.parse(body) as HookPayload} catch {return fail(400,'Invalid hook payload')}
    const email=typeof payload?.user?.email==='string'?payload.user.email.trim().toLowerCase():''
    const action=payload?.email_data?.email_action_type
    const code=payload?.email_data?.token
    if(typeof action!=='string'||!CODE_ACTIONS.has(action))return fail(400,'This workspace only sends sign-in codes')
    if(email.length>254||!approvedRecipient.test(email))return fail(400,'Use your @student.ateneo.edu email')
    if(typeof code!=='string'||!/^\d{6,10}$/.test(code))return fail(500,'Sign-in code missing')
    const result=await provider.send(email,newJob(),signInCodeMail(code))
    if(result.outcome==='accepted')return reply({})
    if(result.outcome==='quota')return fail(429,'Too many emails today. Try again later or use Google sign-in.')
    if(result.outcome==='retry')return fail(503,'Email is busy. Try again in a minute.')
    if(result.outcome==='uncertain')return fail(504,'Email may not have been sent. Try again in a minute.')
    return fail(500,'Email could not be sent')
  }
}
