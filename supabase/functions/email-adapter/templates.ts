import { workspaceOrigin,type Mail } from './provider.ts'

// Per-kind reminder copy. Content comes from the email_digest_dispatch 'prepare' result, which the
// database computes from live state at send time; anything unexpected is refused (null), never guessed.
export const reminderTypes=['task_due_soon','task_overdue','deliverable_due_soon','deliverable_overdue',
  'approval_waiting','announcement_unacknowledged','event_countdown','digest'] as const
export type ReminderType=typeof reminderTypes[number]

const CONTROL=new RegExp('[\\x00-\\x1f\\x7f'+String.fromCharCode(0x2028,0x2029)+']+','g')
const ELLIPSIS=String.fromCharCode(0x2026),DASH=String.fromCharCode(0x2014)
const SIGNATURE='TEDxAteneodeManilaU Core Workspace'
const FOOTER='You are getting this because email reminders are on in your workspace notification settings.'
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const route=new RegExp('^(?:(?:tasks|deliverables|announcements)/'+uuid+'|(?:reviews|finance/reviews|publicity)/'+uuid+'/'+uuid+')?$')

export type WorkspaceLink={origin:string;basePath:string}

export function workspaceLink(origin:string,basePath='/'):WorkspaceLink {
  if(!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(basePath))throw Error('Invalid email workspace base path')
  return {origin:workspaceOrigin(origin),basePath}
}

function clean(value:unknown,limit:number):string|null {
  if(typeof value!=='string')return null
  const text=value.replace(CONTROL,' ').replace(/\s+/g,' ').trim()
  if(!text)return null
  return text.length>limit?text.slice(0,limit-1).trimEnd()+ELLIPSIS:text
}

function day(value:unknown):string|null {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null
  const date=new Date(value+'T12:00:00+08:00')
  if(Number.isNaN(date.getTime()))return null
  return date.toLocaleDateString('en-US',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',year:'numeric'})
}

function count(value:unknown,min:number,max:number):number|null {
  return typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max?value:null
}

function compose(type:ReminderType,subject:string,lines:string[],link:string):Mail {
  return {type,subject,text:[...lines,'',link,'',DASH+' '+SIGNATURE,'',FOOTER].join('\n')}
}

export function reminderMail(base:WorkspaceLink,content:unknown):Mail|null {
  if(!content||typeof content!=='object'||Array.isArray(content))return null
  const c=content as Record<string,unknown>
  const type=c.type
  if(typeof type!=='string'||!(reminderTypes as readonly string[]).includes(type))return null
  if(typeof c.path!=='string'||!route.test(c.path))return null
  const link=base.origin+base.basePath+c.path
  const kind=type.startsWith('deliverable')?'deliverable':'task'
  switch(type as ReminderType) {
    case 'task_due_soon':
    case 'deliverable_due_soon': {
      const title=clean(c.title,160),due=day(c.dueOn),left=count(c.daysLeft,0,2)
      if(!title||!due||left===null||left===1)return null
      const when=left===0?'today':'in 2 days'
      return compose(type as ReminderType,(left===0?'Due today: ':'Due in 2 days: ')+clean(title,80),
        [`Hi! A quick heads-up: your ${kind} "${title}" is due ${when} (${due}).`,
          `If it's on track, nothing to do. If something's blocking it, flag it early so your head can help.`],link)
    }
    case 'task_overdue':
    case 'deliverable_overdue': {
      const title=clean(c.title,160),due=day(c.dueOn),left=count(c.daysLeft,-60,-1)
      if(!title||!due||left===null)return null
      return compose(type as ReminderType,'Overdue: '+clean(title,80),
        [`Hi! Your ${kind} "${title}" was due on ${due} and is still open.`,
          `If it's done, mark it complete. If the deadline needs to move, update it or let your head know.`],link)
    }
    case 'approval_waiting':
      return compose(type as ReminderType,'A request is waiting for your review',
        ['Hi! A request assigned to you has been waiting for your review for over a day.',
          'Open it to approve, decline, or ask for changes.'],link)
    case 'announcement_unacknowledged': {
      const title=clean(c.title,160)
      if(!title)return null
      return compose(type as ReminderType,'Please acknowledge: '+clean(title,80),
        [`Hi! The announcement "${title}" asks everyone to confirm they've read it, and we haven't seen yours yet.`,
          'It only takes a moment.'],link)
    }
    case 'event_countdown': {
      const left=count(c.daysLeft,1,30),date=day(c.eventDate)
      if(left===null||![30,14,7,1].includes(left)||!date)return null
      return compose(type as ReminderType,left===1?'Event day is tomorrow':`${left} days to event day`,
        [left===1?`Hi! Event day is tomorrow, ${date}. Thank you for everything you've put in.`
          :`Hi! ${left} days to go until event day on ${date}.`,
          left===1?'Check the workspace for any last-minute updates.':'A good moment to check what is still open on your plate.'],link)
    }
    case 'digest':
      return compose(type as ReminderType,'Workspace updates',['Hi! You have workspace updates waiting.','Sign in to open your notifications.'],link)
  }
  return null
}
