import { bounded } from '../../files/validation.ts'

export type TelegramOutcome={outcome:'sent'|'relink'|'failed'|'uncertain'}|{outcome:'retry';delay:number}
export type TelegramButton={text:string;callback_data:string}|{text:string;url:string}
export type TelegramKeyboard=TelegramButton[][]
export interface TelegramBot {
  send(chat:string,text:string,keyboard?:TelegramKeyboard):Promise<TelegramOutcome>
  // Best effort: a failed answer or edit never changes what the button already did.
  answer(callbackId:string,text:string):Promise<boolean>
  edit(chat:string,messageId:number,text:string,keyboard:TelegramKeyboard):Promise<boolean>
}
export const telegramChat=/^[1-9][0-9]{0,15}$/

export function validateTelegramOrigin(origin:string) {
  const url=new URL(origin)
  if(url.origin!==origin||url.protocol!=='https:'||url.port||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname))
    throw Error('Telegram frontend origin is invalid')
}

export function telegramAlert(origin:string,mode:'immediate'|'digest') {
  validateTelegramOrigin(origin)
  return (mode==='digest'?'You have workspace updates.':'You have a workspace update.')+
    ' Open your notifications.\n'+origin+'/notifications'
}

export function telegramBot(token:string,fetcher:typeof fetch=fetch):TelegramBot {
  if(!/^[0-9]{6,16}:[A-Za-z0-9_-]{25,75}$/.test(token)) throw Error('Telegram bot configuration is invalid')
  async function call(method:string,body:Record<string,unknown>) {
    const response=await fetcher('https://api.telegram.org/bot'+token+'/'+method,{
      method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(5000),
      body:JSON.stringify(body),
    })
    return {response,result:JSON.parse(new TextDecoder().decode(await bounded(response.body,8192)))}
  }
  return {
    async answer(callbackId,text) {
      if(!/^[A-Za-z0-9_-]{1,64}$/.test(callbackId)) return false
      try {
        const {response,result}=await call('answerCallbackQuery',{callback_query_id:callbackId,text:text.slice(0,200)})
        return response.ok&&result?.ok===true
      } catch {return false}
    },
    async edit(chat,messageId,text,keyboard) {
      if(!telegramChat.test(chat)||!Number.isSafeInteger(messageId)||messageId<1) return false
      try {
        const {response,result}=await call('editMessageText',{chat_id:chat,message_id:messageId,text:text.slice(0,4096),
          link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:keyboard}})
        return response.ok&&result?.ok===true
      } catch {return false}
    },
    async send(chat,text,keyboard) {
      if(!telegramChat.test(chat)) return {outcome:'failed'}
      try {
        const response=await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{
          method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(5000),
          body:JSON.stringify({chat_id:chat,text,protect_content:true,link_preview_options:{is_disabled:true},
            ...(keyboard&&keyboard.length?{reply_markup:{inline_keyboard:keyboard}}:{})}),
        })
        const result=JSON.parse(new TextDecoder().decode(await bounded(response.body,8192)))
        if(response.ok&&result?.ok===true&&Number.isSafeInteger(result.result?.message_id)
          &&String(result.result?.chat?.id)===chat) return {outcome:'sent'}
        if(result?.ok===false&&result.error_code===response.status) {
          if(response.status===403) return {outcome:'relink'}
          if(response.status===429) {
            const delay=result.parameters?.retry_after
            if(Number.isSafeInteger(delay)&&delay>=1&&delay<=3600) return {outcome:'retry',delay}
            return {outcome:'failed'}
          }
          if([400,401,404].includes(response.status)) return {outcome:'failed'}
        }
        return {outcome:'uncertain'}
      } catch {
        // Telegram has no send idempotency key. The same alert cannot safely be sent again.
        return {outcome:'uncertain'}
      }
    },
  }
}
