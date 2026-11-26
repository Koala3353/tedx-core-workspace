import { htmlPart,LICENSE_LINE,SIGNATURE,type EmailLayout } from './layout.ts'
import { workspaceOrigin,type Mail } from './provider.ts'

// Per-kind reminder copy. Content comes from the email_digest_dispatch 'prepare' result, which the
// database computes from live state at send time; anything unexpected is refused (null), never guessed.
// Each kind has a plain-text body and an HTML body built from the shared layout (layout.ts).
export const reminderTypes=['task_due_soon','task_overdue','deliverable_due_soon','deliverable_overdue',
  'approval_waiting','announcement_unacknowledged','event_countdown','digest','welcome','nudge_sign_in','nudge_install',
  'nudge_tutorial','nudge_reminders','weekly_digest'] as const
export type ReminderType=typeof reminderTypes[number]

const CONTROL=new RegExp('[\\x00-\\x1f\\x7f'+String.fromCharCode(0x2028,0x2029)+']+','g')
const ELLIPSIS=String.fromCharCode(0x2026)
const FOOTER='You are getting this because email reminders are on in your workspace notification settings.'
// Welcome and nudge emails are sent without the reminder opt-in, so they say why they arrived instead.
const ROSTER_FOOTER='You are getting this because you were added to the TEDxAteneodeManilaU core team roster.'
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

type Html=Omit<EmailLayout,'subject'|'reason'|'button'>&{button:string}

// The text body is lines, link, signature, footer; the HTML body puts the link behind one button.
function compose(type:ReminderType,subject:string,lines:string[],link:string,html:Html,footer=FOOTER,afterLink:string[]=[]):Mail {
  const text=[...lines,'',link,...afterLink,'',SIGNATURE,'',footer,LICENSE_LINE].join('\n')
  return {type,subject,text,...htmlPart({...html,subject,reason:footer,button:{label:html.button,href:link}})}
}

export function reminderMail(base:WorkspaceLink,content:unknown):Mail|null {
  if(!content||typeof content!=='object'||Array.isArray(content))return null
  const c=content as Record<string,unknown>
  const type=c.type
  if(typeof type!=='string'||!(reminderTypes as readonly string[]).includes(type))return null
  if(typeof c.path!=='string'||!route.test(c.path))return null
  const link=base.origin+base.basePath+c.path
  const kind=type.startsWith('deliverable')?'deliverable':'task'
  const open=kind==='deliverable'?'Open deliverable':'Open task'
  switch(type as ReminderType) {
    case 'task_due_soon':
    case 'deliverable_due_soon': {
      const title=clean(c.title,160),due=day(c.dueOn),left=count(c.daysLeft,0,2)
      if(!title||!due||left===null||left===1)return null
      const when=left===0?'today':'in 2 days'
      return compose(type as ReminderType,(left===0?'Due today: ':'Due in 2 days: ')+clean(title,80),
        [`Hi, your ${kind} "${title}" is due ${when} (${due}).`,
          `If it's on track, nothing to do. If something's blocking it, flag it early so your head can help.`],link,
        {preheader:`"${clean(title,80)}" is due ${when}, ${due}.`,heading:left===0?'Due today':'Due in 2 days',
          body:[[`Hi, your ${kind} `,{strong:title},` is due ${when}.`]],
          detail:{kind:'facts',rows:[['Due',due]]},
          after:["If it's on track, nothing to do. If something's blocking it, flag it early so your head can help."],button:open})
    }
    case 'task_overdue':
    case 'deliverable_overdue': {
      const title=clean(c.title,160),due=day(c.dueOn),left=count(c.daysLeft,-60,-1)
      if(!title||!due||left===null)return null
      return compose(type as ReminderType,'Overdue: '+clean(title,80),
        [`Hi, your ${kind} "${title}" was due on ${due} and is still open.`,
          `If it's done, mark it complete. If the deadline needs to move, update it or let your head know.`],link,
        {preheader:`"${clean(title,80)}" was due ${due} and is still open.`,heading:`This ${kind} is overdue`,
          body:[[`Hi, your ${kind} `,{strong:title},' is still open.']],
          detail:{kind:'facts',rows:[['Was due',due],['Days overdue',String(-left)]]},
          after:["If it's done, mark it complete. If the deadline needs to move, update it or let your head know."],button:open})
    }
    case 'approval_waiting':
      return compose(type as ReminderType,'A request is waiting for your review',
        ['Hi, a request assigned to you has been waiting for your review for over a day.',
          'Open it to approve, decline, or ask for changes.'],link,
        {preheader:'It has been waiting for over a day.',heading:'A request is waiting for your review',
          body:['Hi, a request assigned to you has been waiting for your review for over a day.',
            'Open it to approve, decline, or ask for changes.'],button:'Review request'})
    case 'announcement_unacknowledged': {
      const title=clean(c.title,160)
      if(!title)return null
      return compose(type as ReminderType,"Confirm you've read: "+clean(title,80),
        [`Hi, the announcement "${title}" asks everyone to confirm they've read it, and we haven't seen yours yet.`,
          'Open it to confirm.'],link,
        {preheader:`"${clean(title,80)}" asks everyone to confirm they've read it.`,heading:"Confirm you've read this",
          body:[['Hi, the announcement ',{strong:title}," asks everyone to confirm they've read it, and we haven't seen yours yet."],
            'Open it to confirm.'],button:'Open announcement'})
    }
    case 'event_countdown': {
      const left=count(c.daysLeft,1,30),date=day(c.eventDate)
      if(left===null||![30,14,7,1].includes(left)||!date)return null
      const heading=left===1?'Event day is tomorrow':`${left} days to event day`
      return compose(type as ReminderType,heading,
        [left===1?`Hi, event day is tomorrow, ${date}. Thank you for everything you've put in.`
          :`Hi, ${left} days to go until event day on ${date}.`,
          left===1?'Check the workspace for any last-minute updates.':"Now's a good time to check what's still open on your plate."],link,
        {preheader:`Event day is ${date}.`,heading,
          body:[left===1?"Hi, event day is tomorrow. Thank you for everything you've put in.":`Hi, ${left} days to go until event day.`],
          detail:{kind:'facts',rows:[['Event day',date],['Days to go',String(left)]]},
          after:[left===1?'Check the workspace for any last-minute updates.':"Now's a good time to check what's still open on your plate."],
          button:'Open the workspace'})
    }
    case 'digest':
      return compose(type as ReminderType,'Workspace updates',['Hi, you have workspace updates waiting.','Sign in to open your notifications.'],link,
        {preheader:'Sign in to open your notifications.',heading:'You have workspace updates',
          body:['Hi, you have workspace updates waiting.','Sign in to open your notifications.'],button:'Open the workspace'})
    case 'welcome':
      return compose(type as ReminderType,'Welcome to the TEDxAteneodeManilaU core workspace',
        ["You've been added to the TEDxAteneodeManilaU core workspace. Sign in with your school Google account:"],link,
        {preheader:'Sign in with your school Google account to get started.',heading:'Welcome to the core workspace',
          body:["You've been added to the TEDxAteneodeManilaU core workspace, where the team keeps tasks, deadlines and announcements.",
            'Sign in with your school Google account to get started.'],
          after:['Install it to your home screen when prompted.'],button:'Sign in'},
        ROSTER_FOOTER,['','Install it to your home screen when prompted.'])
    case 'nudge_sign_in':
      return compose(type as ReminderType,'Sign in to the TEDx core workspace',
        ['Hi, your team is already working in the TEDxAteneodeManilaU core workspace.',
          'Sign in with your school Google account to see your tasks and announcements:'],link,
        {preheader:'Your team is already working there.',heading:'Your team is already in the workspace',
          body:['Hi, your team is already working in the TEDxAteneodeManilaU core workspace.',
            'Sign in with your school Google account to see your tasks and announcements.'],button:'Sign in'},ROSTER_FOOTER)
    case 'nudge_install':
      return compose(type as ReminderType,'Add the workspace to your home screen',
        ['Open the workspace on your phone and choose Install (or Add to Home Screen).',
          'Your tasks and announcements are then one tap away.'],link,
        {preheader:'Your tasks and announcements, one tap away.',heading:'Add the workspace to your home screen',
          body:['Open the workspace on your phone and choose Install (or Add to Home Screen).',
            'Your tasks and announcements are then one tap away.'],button:'Open the workspace'},ROSTER_FOOTER)
    case 'nudge_tutorial':
      return compose(type as ReminderType,'Take the 2-minute workspace tour',
        ['The workspace tour takes about two minutes and shows where your tasks, deadlines and announcements live.',
          'It starts when you open the workspace.'],link,
        {preheader:'See where your tasks, deadlines and announcements live.',heading:'Take the 2-minute workspace tour',
          body:['The workspace tour takes about two minutes and shows where your tasks, deadlines and announcements live.',
            'It starts when you open the workspace.'],button:'Start the tour'},ROSTER_FOOTER)
    case 'nudge_reminders':
      return compose(type as ReminderType,'Turn on workspace reminders',
        ['Turn on email or Telegram reminders in the workspace so you hear about deadlines before they slip.',
          'You can change this any time in your notification settings.'],link,
        {preheader:'Hear about deadlines before they slip.',heading:'Turn on workspace reminders',
          body:['Turn on email or Telegram reminders in the workspace so you hear about deadlines before they slip.',
            'You can change this any time in your notification settings.'],button:'Open the workspace'},ROSTER_FOOTER)
    case 'weekly_digest': {
      const due=count(c.dueThisWeek,0,10000),late=count(c.overdue,0,10000),meetings=count(c.meetings,0,10000)
      if(due===null||late===null||meetings===null)return null
      const plural=(n:number,one:string,many:string)=>n+' '+(n===1?one:many)
      const lines=["Hi, here's your week in the workspace:",
        '- Due this week: '+plural(due,'item','items'),
        '- Overdue: '+plural(late,'item','items'),
        '- Meetings this week: '+meetings]
      const rows:Array<[string,string]>=[['Due this week',plural(due,'item','items')],['Overdue',plural(late,'item','items')],
        ['Meetings this week',String(meetings)]]
      const committee=clean(c.committee,80),pct=count(c.onTrackPct,0,100)
      if(committee&&pct!==null) {
        lines.push(`- ${committee} on track: ${pct}%`)
        rows.push([`${committee} on track`,`${pct}%`])
      }
      lines.push('','Open the workspace to plan your week.')
      return compose(type as ReminderType,late>0?`Your week ahead (${late} overdue)`:'Your week ahead',lines,link,
        {preheader:`${plural(due,'item','items')} due this week, ${late} overdue, ${plural(meetings,'meeting','meetings')}.`,
          heading:'Your week ahead',body:["Hi, here's your week in the workspace."],detail:{kind:'facts',rows},
          after:['Open the workspace to plan your week.'],button:'Plan your week'})
    }
  }
  return null
}
