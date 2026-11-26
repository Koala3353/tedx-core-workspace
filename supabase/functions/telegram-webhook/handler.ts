import { bounded } from '../files/validation.ts'
import { driveHash,importDriveKey,sealDriveToken } from '../google-oauth/protocol.ts'
import { matchesTelegramSecret } from '../_shared/notification-adapters/backend.ts'
import { telegramChat,type TelegramBot } from '../_shared/notification-adapters/telegram.ts'
import { callbackData,keyboardWithout,telegramActionReply } from '../_shared/notification-adapters/telegram-items.ts'

type Stage={startHash:string;confirmHash:string;chatHash:string;sealedChat:string}
export type ActionOutcome={result?:unknown;repeat?:unknown;title?:unknown}
interface WebhookBackend {
  stage(staged:Stage):Promise<boolean>
  abandon(staged:Stage):Promise<void>
  block(chatHash:string,providerSeconds:number):Promise<void>
  action(tokenHash:string,chatHash:string):Promise<ActionOutcome|null>
}

const formatSecret=/^[A-Za-z0-9_-]{32,128}$/
const linkCommand=/^\/start ([A-Za-z0-9_-]{43})$/
const confirmCode=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))))
  .replaceAll('+','-').replaceAll('/','_')

export async function telegramWebhook(backend:WebhookBackend,bot:TelegramBot,config:{secret:string;encryptionKey:string}) {
  if(!formatSecret.test(config.secret)) throw Error('Telegram webhook configuration is invalid')
  const key=await importDriveKey(config.encryptionKey)
  const bytes=new TextEncoder()
  const hashKey=await crypto.subtle.importKey('raw',bytes.encode(config.encryptionKey),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  async function chatHash(chat:string) {
    const hash=await crypto.subtle.sign('HMAC',hashKey,bytes.encode('TEDx.telegram.chat:'+chat))
    return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')
  }
  return async(request:Request)=>{
    const reply=(ok:boolean,status=200)=>Response.json({ok},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
    if(request.method!=='POST')return reply(false,405)
    if(!matchesTelegramSecret(request.headers.get('x-telegram-bot-api-secret-token'),config.secret))return reply(false,403)
    let input
    try{input=JSON.parse(new TextDecoder().decode(await bounded(request.body,16384)))}
    catch{return reply(false,400)}
    const query=input?.callback_query
    if(Number.isSafeInteger(input?.update_id)&&query&&typeof query==='object') {
      // Inline button press. Only a private chat with its own human user, and only our token shape.
      const source=query.message
      const match=typeof query.data==='string'?query.data.match(callbackData):null
      if(typeof query.id!=='string'||query.from?.is_bot!==false||source?.chat?.type!=='private'
        ||!Number.isSafeInteger(source.chat.id)||query.from.id!==source.chat.id||!Number.isSafeInteger(source.message_id)
        ||!match)return reply(true)
      const chat=String(source.chat.id)
      if(!telegramChat.test(chat))return reply(true)
      try {
        const outcome=await backend.action(await driveHash(match[1]),await chatHash(chat))
        const answer=telegramActionReply(outcome?.result,outcome?.repeat===true,outcome?.title)
        await bot.answer(query.id,answer.toast)
        if(answer.line&&typeof source.text==='string'&&source.text.length<=3800)
          await bot.edit(chat,source.message_id,source.text+'\n\n'+answer.line,keyboardWithout(source.reply_markup,query.data))
        return reply(true)
      } catch {
        return reply(false,503)
      }
    }
    const message=input?.message
    if(!Number.isSafeInteger(input?.update_id)||message?.chat?.type!=='private'
      ||message?.from?.is_bot!==false||!Number.isSafeInteger(message.chat.id)||message.from.id!==message.chat.id
      ||message.forward_origin||message.sender_chat||message.via_bot||message.is_automatic_forward
      ||typeof message.text!=='string')return reply(true)
    const chat=String(message.chat.id)
    if(!telegramChat.test(chat))return reply(true)
    try {
      if(message.text==='/stop'&&Number.isSafeInteger(message.date)&&message.date>0) {
        await backend.block(await chatHash(chat),message.date)
        return reply(true)
      }
      const match=message.text.match(linkCommand)
      if(!match)return reply(true)
      const code=confirmCode()
      const hash=await chatHash(chat)
      const attempt={
        startHash:await driveHash(match[1]),confirmHash:await driveHash(code),chatHash:hash,
        sealedChat:await sealDriveToken(key,'telegram-chat:'+hash,chat),
      }
      if(await backend.stage(attempt)){
        const result=await bot.send(chat,'Enter this private code in the workspace tab where you started linking. Keep it to yourself.\n'+code)
        if(['failed','relink','retry'].includes(result.outcome))await backend.abandon(attempt)
      }
      return reply(true)
    } catch {
      return reply(false,503)
    }
  }
}
