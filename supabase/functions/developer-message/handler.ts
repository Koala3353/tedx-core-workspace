import { htmlPart,LICENSE_LINE,SIGNATURE,type Paragraph } from '../email-adapter/layout.ts'
import type { Mail,MailProvider } from '../email-adapter/provider.ts'

// "Message the developer": any signed-in workspace member or guest sends a short request, and the developer
// gets one HTML email with the details. Reply-To is the sender's address, so replying in Gmail answers them.
// Identity always comes from the caller's session on the server (auth user + resolve_auth_context), never
// from the request body. The relay limits each sender to 5 messages an hour.

export const topics={bug:'Something is broken',question:'Question',idea:'Idea or request',access:'Access or account',other:'Other'} as const
export type Topic=keyof typeof topics
export type Sender={id:string;email:string;name:string;role:'Admin'|'Member'|'Guest'}
export interface DeveloperBackend {
  identify(jwt:string):Promise<Sender|null>
}
export type DeveloperConfig={origin:string;basePath:string;to:string;now?:()=>Date}

const CONTROL=new RegExp('[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f'+String.fromCharCode(0x2028,0x2029)+']','g')
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function line(value:unknown,min:number,max:number):string|null {
  if(typeof value!=='string')return null
  const text=value.replace(CONTROL,'').replace(/\s+/g,' ').trim()
  return text.length>=min&&text.length<=max?text:null
}

// Keeps paragraph breaks; drops other control characters and collapses runs of blank lines.
function block(value:unknown,min:number,max:number):string|null {
  if(typeof value!=='string')return null
  const text=value.replace(/\r\n?/g,'\n').replace(CONTROL,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim()
  return text.length>=min&&text.length<=max?text:null
}

export type DeveloperRequest={requestId:string;topic:Topic;subject:string;message:string;
  context:{path?:string;userAgent?:string;viewport?:string;theme?:string;timezone?:string}|null}

export function parseRequest(body:unknown):DeveloperRequest|null {
  if(!body||typeof body!=='object'||Array.isArray(body))return null
  const b=body as Record<string,unknown>
  if(typeof b.requestId!=='string'||!uuid.test(b.requestId))return null
  if(typeof b.topic!=='string'||!Object.hasOwn(topics,b.topic))return null
  const subject=line(b.subject,3,120),message=block(b.message,10,4000)
  if(!subject||!message)return null
  let context:DeveloperRequest['context']=null
  if(b.context&&typeof b.context==='object'&&!Array.isArray(b.context)) {
    const c=b.context as Record<string,unknown>
    const path=line(c.path,1,300),agent=line(c.userAgent,1,300),viewport=line(c.viewport,3,11)
    const theme=line(c.theme,4,5),timezone=line(c.timezone,1,64)
    context={
      ...(path&&/^\/[A-Za-z0-9\-._~/%?=&+]*$/.test(path)?{path}:{}),
      ...(agent?{userAgent:agent}:{}),
      ...(viewport&&/^\d{2,5}x\d{2,5}$/.test(viewport)?{viewport}:{}),
      ...(theme==='light'||theme==='dark'?{theme}:{}),
      ...(timezone&&/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(timezone)?{timezone}:{}),
    }
  }
  return {requestId:b.requestId,topic:b.topic as Topic,subject,message,context}
}

export function developerMail(sender:Sender,request:DeveloperRequest,config:DeveloperConfig):Mail {
  const sent=(config.now?.()??new Date()).toLocaleString('en-US',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',
    year:'numeric',hour:'numeric',minute:'2-digit'})+' (Manila)'
  const topic=topics[request.topic]
  const subject=('[Workspace] '+topic+': '+request.subject).slice(0,200)
  const page=request.context?.path?config.origin+config.basePath.replace(/\/$/,'')+request.context.path:null
  const rows:Array<[string,string]>=[['From',sender.name],['Email',sender.email],['Role',sender.role],['Topic',topic],['Sent',sent]]
  if(page)rows.push(['Page',page])
  if(request.context?.userAgent)rows.push(['Device',request.context.userAgent])
  if(request.context?.viewport)rows.push(['Screen',request.context.viewport])
  if(request.context?.theme)rows.push(['Theme',request.context.theme])
  if(request.context?.timezone)rows.push(['Time zone',request.context.timezone])
  rows.push(['Account ID',sender.id])
  const first=sender.name.split(' ')[0]||sender.name
  const reason=`Sent from Message the developer in the TEDx core workspace. Replying to this email goes to ${sender.email}.`
  const paragraphs:Paragraph[]=request.message.split('\n').filter(p=>p.trim())
  const text=[`${sender.name} (${sender.role}) sent a message from the workspace.`,'',`Topic: ${topic}`,`Subject: ${request.subject}`,'',
    request.message,'',...rows.map(([k,v])=>`${k}: ${v}`),'',`Reply to this email to answer ${first} at ${sender.email}.`,'',SIGNATURE,'',LICENSE_LINE].join('\n')
  // The button is a fallback for mail apps that ignore Reply-To; normally Reply already goes to the sender.
  const reply='mailto:'+sender.email+'?subject='+encodeURIComponent('Re: '+request.subject)
  return {type:'developer_message',subject,text,replyTo:sender.email,...htmlPart({subject,
    preheader:`${sender.name}: ${request.message.slice(0,90)}`,heading:request.subject,
    body:[[{strong:sender.name},` (${sender.role}) sent a message about `,{strong:topic.toLowerCase()},'.'],...paragraphs],
    detail:{kind:'facts',rows},button:{label:`Reply to ${first}`,href:reply},reason})}
}

export function developerMessageHandler(backend:DeveloperBackend,provider:MailProvider,config:DeveloperConfig) {
  return async (request:Request)=>{
    const headers:Record<string,string>={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'}
    const reply=(value:unknown,status=200)=>Response.json(value,{status,headers})
    if(request.headers.get('origin')!==config.origin)return reply({error:{code:'denied'}},403)
    headers['Access-Control-Allow-Origin']=config.origin
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST',
      'Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Max-Age':'600'}})
    if(request.method!=='POST')return reply({error:{code:'invalid'}},405)
    const jwt=request.headers.get('authorization')??''
    if(!/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(jwt))return reply({error:{code:'denied'}},401)
    const raw=await request.text()
    if(raw.length>16384)return reply({error:{code:'invalid'}},413)
    let parsed:DeveloperRequest|null
    try {parsed=parseRequest(JSON.parse(raw))} catch {parsed=null}
    if(!parsed)return reply({error:{code:'invalid'}},400)
    let sender:Sender|null
    try {sender=await backend.identify(jwt)} catch {return reply({error:{code:'unavailable'}},503)}
    if(!sender)return reply({error:{code:'denied'}},403)
    const result=await provider.send(config.to,parsed.requestId,developerMail(sender,parsed,config))
    if(result.outcome==='accepted')return reply({sent:true})
    if(result.outcome==='limited')return reply({error:{code:'limited',retryAfter:result.delay}},429)
    if(result.outcome==='retry')return reply({error:{code:'busy',retryAfter:result.delay}},503)
    if(result.outcome==='quota')return reply({error:{code:'quota'}},503)
    if(result.outcome==='uncertain')return reply({error:{code:'uncertain'}},504)
    return reply({error:{code:'unavailable'}},502)
  }
}
