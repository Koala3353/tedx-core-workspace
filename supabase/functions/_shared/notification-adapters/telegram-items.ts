import { validateTelegramOrigin,type TelegramButton,type TelegramKeyboard } from './telegram.ts'

// Reminder items returned by telegram_job_items / telegram_daily. Each callback button carries one
// single-use token ('a:' + 32 hex); the database stores only its SHA-256. Approve and return stay in
// the app, so approvals only get an Open link.
export type TelegramItem={
  kind:'task'|'deliverable'|'approval'|'announcement'
  title:string|null
  when:string|null
  path:string
  done?:string
  snooze?:string
  ack?:string
}
export type TelegramLink={origin:string;basePath:string}

const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const route=new RegExp('^(?:(?:tasks|deliverables|announcements)/'+uuid+'|(?:reviews|finance/reviews|publicity)/'+uuid+'/'+uuid+')$')
const token=/^[a-f0-9]{32}$/
export const callbackData=/^a:([a-f0-9]{32})$/
const CONTROL=new RegExp('[\\x00-\\x1f\\x7f'+String.fromCharCode(0x2028,0x2029)+']+','g')

export function telegramLink(origin:string,basePath='/'):TelegramLink {
  validateTelegramOrigin(origin)
  if(!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(basePath))throw Error('Telegram frontend base path is invalid')
  return {origin,basePath}
}

function text(value:unknown,limit:number):string|null {
  if(typeof value!=='string')return null
  const clean=value.replace(CONTROL,' ').replace(/\s+/g,' ').trim()
  return clean?clean.slice(0,limit):null
}

function optionalToken(value:unknown):string|undefined {
  if(value===undefined||value===null)return undefined
  if(typeof value!=='string'||!token.test(value))throw Error('Invalid Telegram action token')
  return value
}

// Strict parse: anything unexpected throws, so a malformed reply never reaches a chat.
export function parseTelegramItems(value:unknown):TelegramItem[] {
  if(!Array.isArray(value)||value.length>3)throw Error('Invalid Telegram items')
  return value.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid Telegram item')
    const item=raw as Record<string,unknown>
    const kind=item.kind
    if(kind!=='task'&&kind!=='deliverable'&&kind!=='approval'&&kind!=='announcement')throw Error('Invalid Telegram item')
    if(typeof item.path!=='string'||!route.test(item.path))throw Error('Invalid Telegram item')
    const parsed:TelegramItem={kind,title:text(item.title,120),when:text(item.when,60),path:item.path,
      done:optionalToken(item.done),snooze:optionalToken(item.snooze),ack:optionalToken(item.ack)}
    if((parsed.done&&kind!=='task')||(parsed.ack&&kind!=='announcement')||(parsed.snooze&&kind!=='task'&&kind!=='deliverable'))
      throw Error('Invalid Telegram item')
    return parsed
  })
}

function describe(item:TelegramItem):string {
  switch(item.kind) {
    case 'task':
    case 'deliverable': {
      const name=item.title?'"'+item.title+'"':item.kind==='task'?'A restricted task':'A restricted deliverable'
      return item.when?name+', '+item.when:name
    }
    case 'approval':
      return 'A request is waiting for your review'
    case 'announcement':
      return item.title?'Please confirm you have read "'+item.title+'"':'An announcement asks you to confirm you have read it'
  }
}

export function telegramItemsMessage(link:TelegramLink,heading:string,items:TelegramItem[]):{text:string;keyboard:TelegramKeyboard} {
  const numbered=items.length>1
  const lines=items.map((item,index)=>(numbered?(index+1)+'. ':'')+describe(item))
  const keyboard=items.map((item,index)=>{
    const tag=numbered?' ('+(index+1)+')':''
    const row:TelegramButton[]=[]
    if(item.done)row.push({text:'Done'+tag,callback_data:'a:'+item.done})
    if(item.snooze)row.push({text:'Snooze 1 day'+tag,callback_data:'a:'+item.snooze})
    if(item.ack)row.push({text:'Got it'+tag,callback_data:'a:'+item.ack})
    row.push({text:'Open'+tag,url:link.origin+link.basePath+item.path})
    return row
  })
  return {text:[heading,'',...lines].join('\n'),keyboard}
}

export type TelegramActionResult='done'|'snoozed'|'acknowledged'|'failed'|'expired'|'denied'|'invalid'

export function telegramActionReply(result:unknown,repeat:boolean,title:unknown):{toast:string;line:string|null} {
  const name=text(title,120)
  if(repeat)return {toast:'Already handled.',line:null}
  switch(result) {
    case 'done':return {toast:'Marked done.',line:'Done: '+(name??'task')}
    case 'snoozed':return {toast:'Snoozed for a day.',line:'Snoozed until tomorrow: '+(name??'item')}
    case 'acknowledged':return {toast:'Thanks for confirming.',line:'Confirmed as read.'}
    case 'expired':return {toast:'This button has expired. Open the workspace instead.',line:null}
    case 'failed':return {toast:"Couldn't do that from Telegram. Open the workspace to finish it.",line:null}
    default:return {toast:'This button no longer works for this chat.',line:null}
  }
}

// Drops the row that holds the pressed button and keeps every other item's buttons as they were.
export function keyboardWithout(markup:unknown,pressed:string):TelegramKeyboard {
  const rows=(markup as {inline_keyboard?:unknown}|null)?.inline_keyboard
  if(!Array.isArray(rows))return []
  const kept:TelegramKeyboard=[]
  for(const row of rows.slice(0,10)) {
    if(!Array.isArray(row))continue
    const buttons:TelegramButton[]=[]
    for(const button of row.slice(0,8)) {
      const b=button as Record<string,unknown>|null
      const label=text(b?.text,64)
      if(!label)continue
      if(typeof b?.callback_data==='string'&&callbackData.test(b.callback_data))buttons.push({text:label,callback_data:b.callback_data})
      else if(typeof b?.url==='string'&&/^https:\/\//.test(b.url)&&b.url.length<=512)buttons.push({text:label,url:b.url})
    }
    if(buttons.length&&!buttons.some(b=>'callback_data'in b&&b.callback_data===pressed))kept.push(buttons)
  }
  return kept
}
