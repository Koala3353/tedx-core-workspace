import { bounded } from '../files/validation.ts'
import { approvedRecipient,type MailOutcome,type MailProvider } from './provider.ts'

// Google Apps Script web app transport (see apps-script/README.md). doPost cannot read request headers,
// so the timestamp and HMAC travel as query parameters: sig=hex(HMAC-SHA256(secret, ts+'.'+body)).
// The web app answers HTTP 200 for every handled request, so the JSON {outcome} is always authoritative.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const mailbox=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/
const endpoint=/^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+\/|macros\/)s\/[A-Za-z0-9_-]{20,200}\/exec$/

type Reply={outcome?:unknown;id?:unknown;delay?:unknown;remaining?:unknown;error?:unknown}

export function appsScriptMail(config:{url:string;secret:string;sender:string;domainId:string},fetcher:typeof fetch=fetch):MailProvider {
  if(!endpoint.test(config.url)||!/^[A-Za-z0-9_-]{32,128}$/.test(config.secret)||!mailbox.test(config.sender)
    ||config.sender.length>254||!uuid.test(config.domainId))throw Error('Invalid Apps Script email configuration')
  const keyed=crypto.subtle.importKey('raw',new TextEncoder().encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])

  async function call(fields:Record<string,unknown>,timeout:number):Promise<Reply> {
    const ts=String(Math.floor(Date.now()/1000))
    const body=JSON.stringify({v:1,...fields,ts,nonce:crypto.randomUUID()})
    const mac=await crypto.subtle.sign('HMAC',await keyed,new TextEncoder().encode(ts+'.'+body))
    const sig=Array.from(new Uint8Array(mac),byte=>byte.toString(16).padStart(2,'0')).join('')
    const response=await fetcher(config.url+'?ts='+ts+'&sig='+sig,{
      method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body,redirect:'follow',signal:AbortSignal.timeout(timeout),
    })
    if(!response.ok)throw Error('Apps Script unavailable')
    const result=JSON.parse(new TextDecoder().decode(await bounded(response.body,16384)))
    if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Apps Script reply invalid')
    return result as Reply
  }

  return {
    binding:{sender:config.sender,domainId:config.domainId},
    async verify() {
      try {
        const result=await call({action:'health'},10000)
        return result.outcome==='ok'&&typeof result.remaining==='number'&&Number.isInteger(result.remaining)&&result.remaining>=1
      } catch {return false}
    },
    async send(recipient,job,message):Promise<MailOutcome> {
      if(!approvedRecipient.test(recipient)||recipient.length>254||!uuid.test(job))return {outcome:'failed'}
      let result:Reply
      try {
        result=await call({action:'send',type:message.type??'reminder',jobId:job,to:recipient,subject:message.subject,text:message.text,
          ...(message.html?{html:message.html}:{}),...(message.replyTo?{replyTo:message.replyTo}:{})},25000)
      } catch {return {outcome:'uncertain'}}
      if(result.outcome==='accepted')return result.id===job?{outcome:'accepted',providerId:job}:{outcome:'uncertain'}
      if(result.outcome==='quota')return {outcome:'quota'}
      if(result.outcome==='retry') {
        const delay=Number(result.delay)
        const bounded=Number.isInteger(delay)&&delay>=1&&delay<=3600?delay:300
        // Only developer messages carry a per-sender cap; reminders keep the plain retry path.
        return result.error==='limited'&&message.type==='developer_message'?{outcome:'limited',delay:bounded}:{outcome:'retry',delay:bounded}
      }
      if(result.outcome==='failed')return {outcome:'failed'}
      return {outcome:'uncertain'}
    },
    // MailApp has no delivery receipts; acceptance by Gmail is the final observable state.
    async status(delivery) {
      return uuid.test(delivery)?'delivered':'pending'
    },
  }
}
