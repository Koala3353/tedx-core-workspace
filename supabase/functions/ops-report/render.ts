// Owner report emails (daily summary and urgent alerts): HTML plus plain text. Same visual system as the
// member emails (email-adapter/layout.ts): table layout, inline styles, palette that survives Gmail's
// forced dark inversion, TEDx dark palette under prefers-color-scheme, red used only as an accent.
// Every value from the snapshot goes through esc(); nothing from the database is treated as HTML.
import { esc,LICENSE_LINE,SIGNATURE } from '../email-adapter/layout.ts'
import { duration,list,num,obj,plural,str,type Alert,type Links } from './alerts.ts'

export const MAX_REPORT_HTML=60000
export type ReportMail={subject:string;text:string;html:string}

const RED='#EB0028',AMBER='#8a5a00'
const PAGE='#f2f2f2',CARD='#fcfcfc',INK='#1a1a1a',MUTED='#5c5c5c',LINE='#c4c4c4',BOX='#f0f0f0',BOX_LINE='#b3b3b3'
const SANS="Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"
const TZ='Asia/Manila'

const n=(value:unknown)=>num(value).toLocaleString('en-US')
const pct=(part:number,whole:number)=>whole>0?Math.round(part/whole*100)+'%':'0%'
const mb=(bytes:number)=>(bytes/1048576).toFixed(bytes<10485760?1:0)+' MB'

/** "Sat 29 Nov" in Manila time. */
export function shortDay(date:Date):string {
  const part=(o:Intl.DateTimeFormatOptions)=>date.toLocaleString('en-US',{timeZone:TZ,...o})
  return `${part({weekday:'short'})} ${part({day:'numeric'})} ${part({month:'short'})}`
}
function when(value:unknown):string {
  const t=Date.parse(str(value))
  if(!Number.isFinite(t))return 'never'
  return new Date(t).toLocaleString('en-US',{timeZone:TZ,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})
}
function ago(value:unknown,now:Date):string {
  const t=Date.parse(str(value))
  if(!Number.isFinite(t))return 'never'
  return duration((now.getTime()-t)/60000)+' ago'
}
function day(value:unknown):string {
  const v=str(value)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return ''
  return new Date(v+'T12:00:00+08:00').toLocaleDateString('en-US',{timeZone:TZ,weekday:'short',month:'short',day:'numeric'})
}
const clip=(value:unknown,max:number)=>{const v=str(value).replace(/\s+/g,' ').trim();return v.length>max?v.slice(0,max-3).trimEnd()+'...':v}

// HTML building blocks. Text is escaped at the last moment; callers pass plain strings.
type Cell=string|{text:string;href?:string;strong?:boolean;tone?:'red'|'muted'}
function cell(c:Cell,align:'left'|'right',first:boolean):string {
  const v=typeof c==='string'?{text:c}:c
  const color=v.tone==='red'?RED:v.tone==='muted'?MUTED:INK
  const cls=v.tone==='red'?'':v.tone==='muted'?'mt':'tx'
  const inner=v.href?`<a href="${esc(v.href)}" target="_blank" class="${cls}" style="color:${color};text-decoration:underline">${esc(v.text)}</a>`:esc(v.text)
  return `<td class="${cls} ln"${align==='right'?' align="right"':''} valign="top" style="padding:8px ${align==='right'?0:8}px 8px ${first?0:8}px;border-top:1px solid ${LINE};font-size:14px;line-height:20px${v.strong?';font-weight:600':''}${v.tone?';color:'+color:''}${first?';overflow-wrap:anywhere':''}">${inner}</td>`
}
function table(headers:string[]|null,rows:Cell[][],aligns:Array<'left'|'right'>):string {
  if(!rows.length)return ''
  const head=(headers??[]).map((h,i)=>`<th class="mt" align="${aligns[i]}" style="padding:0 ${aligns[i]==='right'?0:8}px 6px ${i?8:0}px;font-size:12px;line-height:16px;font-weight:600;color:${MUTED}">${esc(h)}</th>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;border-collapse:collapse;font-family:${SANS};color:${INK}">${headers?`<tr>${head}</tr>`:''}${rows.map(r=>`<tr>${r.map((c,i)=>cell(c,aligns[i],i===0)).join('')}</tr>`).join('')}</table>`
}
function facts(rows:Array<[string,string]>):string {
  return table(null,rows.map(([l,v])=>[{text:l,tone:'muted'},{text:v,strong:true}]),['left','right'])
}
function heading(title:string,note?:string):string {
  return `<tr><td class="px" style="padding:24px 32px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-left:3px solid ${RED};padding-left:10px;font-family:${SANS};font-size:17px;line-height:24px;font-weight:700;color:${INK}" class="tx">${esc(title)}</td>
${note?`<td align="right" class="mt" style="font-family:${SANS};font-size:13px;line-height:24px;color:${MUTED}">${esc(note)}</td>`:''}</tr></table></td></tr>`
}
function body(inner:string):string {
  return `<tr><td class="px" style="padding:4px 32px 0">${inner}</td></tr>`
}
function para(text:string,muted=false):string {
  return `<p class="${muted?'mt':'tx'}" style="margin:0 0 12px;font-family:${SANS};font-size:${muted?13:15}px;line-height:${muted?20:22}px;color:${muted?MUTED:INK}">${esc(text)}</p>`
}
type Tile={label:string;value:string;note:string;flag?:boolean}
function tiles(items:Tile[]):string {
  const rows:Tile[][]=[];for(let i=0;i<items.length;i+=3)rows.push(items.slice(i,i+3))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px">${rows.map(r=>`<tr>${r.map(t=>`<td width="33%" valign="top" style="padding:0 4px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${t.flag?'bx':'box'}" bgcolor="${BOX}" style="background:${BOX};border:1px solid ${t.flag?RED:BOX_LINE};border-radius:10px"><tr><td style="padding:12px">
<div class="mt" style="font-family:${SANS};font-size:12px;line-height:16px;color:${MUTED}">${esc(t.label)}</div>
<div class="${t.flag?'':'tx'}" style="font-family:${SANS};font-size:24px;line-height:32px;font-weight:700;color:${t.flag?RED:INK}">${esc(t.value)}</div>
<div class="mt" style="font-family:${SANS};font-size:12px;line-height:16px;color:${MUTED}">${esc(t.note)}</div>
</td></tr></table></td>`).join('')}</tr>`).join('')}</table>`
}
function alertBlock(alerts:Alert[]):string {
  if(!alerts.length)return ''
  return alerts.map(a=>`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ab" bgcolor="${BOX}" style="margin:0 0 10px;background:${BOX};border:1px solid ${BOX_LINE};border-left:4px solid ${a.severity==='critical'?RED:AMBER};border-radius:8px"><tr><td style="padding:12px 14px">
<div style="font-family:${SANS};font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.4px;color:${a.severity==='critical'?RED:AMBER}">${a.severity==='critical'?'CRITICAL':'WARNING'}</div>
<div class="tx" style="font-family:${SANS};font-size:15px;line-height:22px;font-weight:600;color:${INK}">${esc(a.title)}</div>
<div class="mt" style="font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${esc(a.detail)}</div>
${a.link?`<div style="padding-top:6px;font-family:${SANS};font-size:13px;line-height:20px"><a href="${esc(a.link.href)}" target="_blank" style="color:${RED};font-weight:600;text-decoration:underline">${esc(a.link.label)}</a></div>`:''}
</td></tr></table>`).join('')
}
function button(label:string,href:string):string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px"><tr>
<td align="center" bgcolor="${RED}" style="background:${RED};background-image:linear-gradient(${RED},${RED});border-radius:8px">
<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:11px 22px;border:1px solid ${RED};background-image:linear-gradient(${RED},${RED});border-radius:8px;font-family:${SANS};font-size:15px;line-height:18px;font-weight:600;color:#ffffff;text-decoration:none">${esc(label)}</a>
</td></tr></table>`
}
function linkLine(items:Array<[string,string]>):string {
  return `<p class="mt" style="margin:0 0 16px;font-family:${SANS};font-size:13px;line-height:22px;color:${MUTED}">${items.map(([l,h])=>`<a class="mt" href="${esc(h)}" target="_blank" style="color:${MUTED};text-decoration:underline">${esc(l)}</a>`).join(' &nbsp;|&nbsp; ')}</p>`
}

function page(title:string,preheader:string,heading1:string,sub:string,rows:string,reason:string):string {
  const pad='&#847;&zwnj;&nbsp;'.repeat(30)
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;text-size-adjust:100%}
@media (max-width:600px){.px{padding-left:16px!important;padding-right:16px!important}.outer{padding:12px 6px!important}}
@media (prefers-color-scheme:dark){
.bg{background:#000000!important}
.card{background:#111111!important;border-color:#333333!important}
.tx{color:#ffffff!important}
.mt{color:#a6a6a6!important}
.ln{border-color:#333333!important}
.box{background:#000000!important;border-color:#3d3d3d!important}
.bx{background:#000000!important}
.ab{background:#000000!important;border-top-color:#3d3d3d!important;border-right-color:#3d3d3d!important;border-bottom-color:#3d3d3d!important}
}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${PAGE}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE}">${esc(preheader)}${pad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" bgcolor="${PAGE}" style="background:${PAGE}">
<tr><td class="outer" align="center" style="padding:24px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px">
<tr><td style="padding:0 4px 14px;font-family:${SANS};font-size:20px;line-height:28px;font-weight:700;letter-spacing:-0.2px"><span style="color:${RED};font-weight:800">TEDx</span><span class="tx" style="color:${INK}">AteneodeManilaU</span><span class="mt" style="color:${MUTED};font-weight:600;font-size:14px"> &nbsp;Core Workspace</span></td></tr>
<tr><td class="card" bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:12px;padding:0 0 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="px" style="padding:28px 32px 0">
<h1 class="tx" style="margin:0 0 4px;font-family:${SANS};font-size:24px;line-height:31px;font-weight:700;letter-spacing:-0.3px;color:${INK}">${esc(heading1)}</h1>
<p class="mt" style="margin:0;font-family:${SANS};font-size:14px;line-height:20px;color:${MUTED}">${esc(sub)}</p>
</td></tr>
${rows}
</table>
</td></tr>
<tr><td style="padding:18px 4px 8px">
<p class="mt" style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:20px;font-weight:600;color:${MUTED}">${esc(SIGNATURE)}</p>
<p class="mt" style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${esc(reason)}</p>
<p class="mt" style="margin:0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${esc(LICENSE_LINE)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

const REASON='Sent to the workspace owner by the TEDx reminder relay (Apps Script). Counts only; no message contents or private profile data.'

function textAlerts(alerts:Alert[]):string[] {
  return alerts.flatMap(a=>[`[${a.severity.toUpperCase()}] ${a.title}`,`  ${a.detail}`,...(a.link?[`  ${a.link.label}: ${a.link.href}`]:[]),''])
}

/** Full lists first; if the HTML is over the size budget, the long lists are shortened (the text part keeps them all). */
export function renderDaily(report:unknown,alerts:Alert[],links:Links,mailQuota:number|null,now=new Date()):ReportMail {
  const full=renderDailyWith(report,alerts,links,mailQuota,now,10)
  return full.html.length<=MAX_REPORT_HTML?full:{...renderDailyWith(report,alerts,links,mailQuota,now,4),text:full.text}
}

function renderDailyWith(report:unknown,alerts:Alert[],links:Links,mailQuota:number|null,now:Date,cap:number):ReportMail {
  const r=obj(report),u=obj(r.usage),w=obj(r.work),h=obj(r.health),term=obj(r.term)
  const rem=obj(h.reminders),outbox=obj(h.outbox),email=obj(h.email),push=obj(h.push),errors=obj(h.clientErrors),db=obj(h.database)
  const tasks=obj(w.tasks),dels=obj(w.deliverables),overdue=obj(w.overdue),soon=obj(w.dueSoon),reqs=obj(w.requests),appr=obj(w.approvals)
  const members=num(u.members),dayLabel=shortDay(now)
  const subject=`TEDx Core daily report: ${dayLabel}`+(alerts.length?` (${plural(alerts.length,'alert')})`:'')
  const site=links.site,link=(path:unknown)=>site+str(path)
  const emailWindow=obj(email.window),pushWindow=obj(push.window)
  const emailSent=num(emailWindow.accepted)+num(emailWindow.delivered),emailFailed=num(emailWindow.failed)+num(emailWindow.bounced)
  const daysToEvent=num(term.daysToEvent),eventDay=day(term.eventDate)
  const reminderAge=str(rem.lastRunAt)?ago(rem.lastRunAt,now):'not checked'
  const dbShare=num(db.planBytes)>0?num(db.bytes)/num(db.planBytes):0

  const tileList:Tile[]=[
    {label:'Active today',value:n(u.active24h),note:`of ${plural(members,'member')}`},
    {label:'Active this week',value:n(u.active7d),note:pct(num(u.active7d),members)+' of the team'},
    {label:'Overdue work',value:n(overdue.count),note:`${n(soon.count)} due in 3 days`,flag:num(overdue.count)>0},
    {label:'Waiting for review',value:n(num(appr.waiting)+num(tasks.inReview)+num(dels.submitted)),note:'approvals, tasks, deliverables'},
    {label:'App errors (24h)',value:n(errors.hitsWindow),note:`${n(errors.newWindow)} new kinds`,flag:num(errors.newWindow)>0},
    {label:'Reminders',value:str(rem.lastRunAt)?duration(num(rem.minutesSince)).replace(/ minutes?/,' min').replace(/ hours?/,' h').replace(/ days?/,' d'):'none',note:str(rem.lastRunAt)?'since last run':'no recent run',flag:alerts.some(a=>a.key==='reminders_stalled'||a.key==='email_relay_failing')},
  ]
  const workItem=(i:Record<string,unknown>,soonList:boolean):Cell[]=>[
    {text:clip(i.title,70),href:link(i.path)},clip(i.committee,30)||'-',clip(i.owner,30)||'-',
    soonList?(num(i.days)===0?'today':`in ${plural(num(i.days),'day')}`):{text:plural(num(i.days),'day'),tone:'red'}]
  const rows:string[]=[]
  rows.push(body(para(`Covers the last 24 hours.${eventDay?` ${plural(daysToEvent,'day')} to the event (${eventDay}).`:''}`,true)))
  if(alerts.length){rows.push(heading('Needs attention',plural(alerts.length,'alert')));rows.push(body(alertBlock(alerts)))}
  rows.push(heading('At a glance'))
  rows.push(body(tiles(tileList)))

  rows.push(heading('Usage',`${plural(members,'member')}`))
  const methods=obj(u.signInMethods)
  rows.push(body(facts([
    ['Signed in at least once',`${n(u.signedInEver)} (${pct(num(u.signedInEver),members)})`],
    ['Signed in during the last 24 hours',n(u.signInsWindow)],
    ['New accounts in the last 24 hours',n(u.newAccountsWindow)],
    ['Installed the app',`${n(u.installed)} (${pct(num(u.installed),members)})`],
    ['Finished setup / tutorial',`${n(u.setupDone)} / ${n(u.tutorialDone)}`],
    ['Email reminders on',n(u.emailRemindersOn)],
    ['Device notifications',`${plural(num(u.pushMembers),'member')}, ${plural(num(u.pushDevices),'device')}`],
    ['Telegram linked',n(u.telegramLinked)],
    ['Sign-in method',Object.keys(methods).sort().map(k=>`${k==='email'?'email code':k} ${n(methods[k])}`).join(', ')||'-'],
  ])))
  const names=Array.isArray(u.neverSignedInNames)?u.neverSignedInNames.filter((x):x is string=>typeof x==='string'):[]
  if(num(u.neverSignedIn)>0)rows.push(body(para(`Never signed in (${n(u.neverSignedIn)}): ${names.map(x=>clip(x,40)).join(', ')}${num(u.neverSignedIn)>names.length?', and more':''}.`)))
  const committees=list(u.committees).slice(0,cap*3)
  if(committees.length)rows.push(body(table(['Committee','Members','Active 7 days'],committees.map(c=>[clip(c.name,40),n(c.members),
    {text:`${n(c.active7d)} (${pct(num(c.active7d),num(c.members))})`,tone:num(c.members)>0&&num(c.active7d)===0?'red':undefined}]),['left','right','right'])))

  rows.push(heading('Work',`${n(tasks.open)} open tasks, ${n(dels.open)} open deliverables`))
  rows.push(body(table(['','Open','New','Done','Blocked','In review'],[
    [{text:'Tasks',strong:true},n(tasks.open),n(tasks.createdWindow),n(tasks.doneWindow),n(tasks.blocked),n(tasks.inReview)],
    [{text:'Deliverables',strong:true},n(dels.open),n(dels.createdWindow),n(dels.acceptedWindow),n(dels.blocked),n(dels.submitted)],
  ],['left','right','right','right','right','right'])))
  rows.push(body(facts([
    ['Requests in review',`${n(reqs.inReview)}${num(reqs.inReview)?`, oldest ${plural(num(reqs.oldestInReviewDays),'day')}`:''}`],
    ['Requests needing revision',n(reqs.needsRevision)],
    ['New requests (24h)',n(reqs.createdWindow)],
    ['Approvals waiting',`${n(appr.waiting)}${num(appr.waiting)?`, oldest ${duration(num(appr.oldestHours)*60)}`:''}`],
  ])))
  const overdueItems=list(overdue.items).slice(0,cap),soonItems=list(soon.items).slice(0,cap)
  if(overdueItems.length){rows.push(body(para(`Most overdue (${n(overdue.count)} in total)`)));rows.push(body(table(['Item','Committee','Owner','Late'],overdueItems.map(i=>workItem(i,false)),['left','left','left','right'])))}
  else rows.push(body(para('Nothing is overdue.',true)))
  if(soonItems.length){rows.push(body(para(`Due in the next 3 days (${n(soon.count)})`)));rows.push(body(table(['Item','Committee','Owner','Due'],soonItems.map(i=>workItem(i,true)),['left','left','left','right'])))}
  const announcements=list(w.announcements)
  if(announcements.length){rows.push(body(para('Announcements from the last 14 days')));rows.push(body(table(['Announcement','Posted','Acknowledged'],
    announcements.map(a=>[clip(a.title,70),when(a.createdAt),`${n(a.acknowledged)} of ${n(members)}`]),['left','left','right'])))}
  const calendar=list(w.calendar)
  if(calendar.length){rows.push(body(para('Calendar, next 7 days')));rows.push(body(table(['Event','When'],
    calendar.map(c=>[clip(c.title,70),c.allDay===true?day(c.startOn)+' (all day)':when(c.startsAt)]),['left','right'])))}

  rows.push(heading('Bugs',`${n(errors.hitsWindow)} reports, ${n(errors.fingerprintsWindow)} kinds`))
  const top=list(errors.top).slice(0,cap)
  if(top.length)rows.push(body(table(['Error','Page','Count','People','Last seen'],top.map(e=>[
    {text:(e.isNew===true?'NEW  ':'')+clip(e.message,110)+(str(e.frame)?`  (${clip(str(e.frame).replace(/^at\s+/,'').replace(/https?:\/\/[^/\s]+/g,''),60)})`:''),tone:e.isNew===true?'red':undefined},
    clip(e.route,40),n(e.hitsWindow),n(e.people),ago(e.lastSeen,now).replace(/ minutes?/,' min').replace(/ hours?/,' h').replace(/ days?/,' d')]),['left','left','right','right','right'])))
  else rows.push(body(para('No app errors were reported in the last 24 hours.',true)))

  rows.push(heading('System health'))
  rows.push(body(facts([
    ['Reminder run (every 15 min)',str(rem.lastRunAt)?`last ${reminderAge}`:'no successful run on record'],
    ['Reminder emails (24h)',`${n(emailSent)} sent, ${n(emailFailed)} failed, ${n(emailWindow.uncertain)} uncertain`],
    ['Email cap today (UTC)',`${n(rem.attemptsToday)} of ${n(rem.dailyCap)}`],
    ['MailApp quota left today',mailQuota===null?'not reported':n(mailQuota)],
    ['In-app notifications (24h)',`${n(outbox.deliveredWindow)} delivered, ${n(outbox.failedWindow)} failed, ${n(outbox.pending)} pending`],
    ['Device notifications (24h)',`${n(pushWindow.sent)} sent, ${n(num(pushWindow.failed))} failed, ${n(pushWindow.gone)} expired devices`],
    ['Database',`${mb(num(db.bytes))} of 500 MB (${Math.round(dbShare*100)}%)`],
    ['Access audit events',`${n(obj(h.audit).restrictedEventsWindow)} today, about ${n(obj(h.audit).restrictedEventsTotal)} total`],
    ['Migrations applied',`${n(obj(h.migrations).count)}, latest ${str(obj(h.migrations).latest)||'-'}`],
  ])))
  const tablesList=list(db.tables).slice(0,Math.min(cap,6))
  if(tablesList.length)rows.push(body(table(['Biggest tables','Rows','Size'],tablesList.map(t=>[clip(t.name,50),n(t.rows),mb(num(t.bytes))]),['left','right','right'])))
  rows.push(body(button('Open the workspace',site)))
  rows.push(body(linkLine([['Supabase',links.supabase],['Function logs',links.supabase+'/functions'],['GitHub',links.github],['Deploys',links.github+'/actions'],['Apps Script',links.appsScript]])))

  const html=page(subject,alerts.length?`${plural(alerts.length,'alert')}: ${alerts[0].title}`:`${n(u.active24h)} active today, ${n(overdue.count)} overdue, ${n(errors.hitsWindow)} app errors`,
    'Daily report',`${dayLabel}${str(term.label)?`, term ${str(term.label)}`:''}`,rows.join('\n'),REASON)

  const t:string[]=[`TEDx Core daily report: ${dayLabel} (last 24 hours)`,eventDay?`${plural(daysToEvent,'day')} to the event (${eventDay}).`:'','']
  if(alerts.length)t.push('NEEDS ATTENTION',...textAlerts(alerts))
  t.push('AT A GLANCE',...tileList.map(x=>`- ${x.label}: ${x.value} (${x.note})`),'')
  t.push('USAGE',`- Members: ${n(members)}; signed in at least once ${n(u.signedInEver)}; never ${n(u.neverSignedIn)}`,
    `- Active 24h / 7 days: ${n(u.active24h)} / ${n(u.active7d)}`,`- Installed ${n(u.installed)}, setup done ${n(u.setupDone)}, tutorial done ${n(u.tutorialDone)}`,
    `- Email reminders on ${n(u.emailRemindersOn)}, device notifications ${n(u.pushMembers)} members (${n(u.pushDevices)} devices), Telegram ${n(u.telegramLinked)}`)
  if(names.length)t.push(`- Never signed in: ${names.join(', ')}`)
  committees.forEach(c=>t.push(`- ${str(c.name)}: ${n(c.members)} members, ${n(c.active7d)} active this week`))
  t.push('','WORK',`- Tasks: ${n(tasks.open)} open, ${n(tasks.createdWindow)} new, ${n(tasks.doneWindow)} done, ${n(tasks.blocked)} blocked, ${n(tasks.inReview)} in review`,
    `- Deliverables: ${n(dels.open)} open, ${n(dels.createdWindow)} new, ${n(dels.acceptedWindow)} accepted, ${n(dels.blocked)} blocked, ${n(dels.submitted)} submitted`,
    `- Requests in review ${n(reqs.inReview)}, needing revision ${n(reqs.needsRevision)}; approvals waiting ${n(appr.waiting)}`,
    `- Overdue: ${n(overdue.count)}`,...overdueItems.map(i=>`  * ${clip(i.title,80)} (${clip(i.committee,30)||'no committee'}, ${clip(i.owner,30)||'no owner'}): ${plural(num(i.days),'day')} late, ${link(i.path)}`),
    `- Due in 3 days: ${n(soon.count)}`,...soonItems.map(i=>`  * ${clip(i.title,80)} (${clip(i.committee,30)||'no committee'}, ${clip(i.owner,30)||'no owner'}): ${day(i.dueOn)}`),
    ...announcements.map(a=>`- Announcement "${clip(a.title,60)}": ${n(a.acknowledged)} of ${n(members)} acknowledged`),
    ...calendar.map(c=>`- Calendar: ${clip(c.title,60)}, ${c.allDay===true?day(c.startOn):when(c.startsAt)}`),
    '','BUGS',`- ${n(errors.hitsWindow)} error reports, ${n(errors.fingerprintsWindow)} kinds, ${n(errors.newWindow)} new`,
    ...top.map(e=>`  * ${e.isNew===true?'NEW ':''}${clip(e.message,120)} on ${str(e.route)}: ${n(e.hitsWindow)} times, ${plural(num(e.people),'person','people')}`),
    '','SYSTEM HEALTH',`- Reminder run: ${str(rem.lastRunAt)?'last '+reminderAge:'no successful run on record'}`,
    `- Reminder emails: ${n(emailSent)} sent, ${n(emailFailed)} failed; cap ${n(rem.attemptsToday)} of ${n(rem.dailyCap)}; MailApp quota left ${mailQuota===null?'not reported':n(mailQuota)}`,
    `- In-app notifications: ${n(outbox.deliveredWindow)} delivered, ${n(outbox.failedWindow)} failed, ${n(outbox.pending)} pending`,
    `- Device notifications: ${n(pushWindow.sent)} sent, ${n(pushWindow.failed)} failed`,
    `- Database: ${mb(num(db.bytes))} of 500 MB`,...tablesList.slice(0,5).map(x=>`  * ${str(x.name)}: ${mb(num(x.bytes))}`),
    `- Migrations: ${n(obj(h.migrations).count)}, latest ${str(obj(h.migrations).latest)}`,
    '',`Workspace: ${site}`,`Supabase: ${links.supabase}`,`GitHub: ${links.github}`,`Apps Script: ${links.appsScript}`,'',SIGNATURE)
  return {subject,html,text:t.filter((line,i,all)=>!(line===''&&all[i-1]==='')).join('\n')}
}

export function renderUrgent(report:unknown,alerts:Alert[],links:Links,mailQuota:number|null,now=new Date()):ReportMail|null {
  if(!alerts.length)return null
  const h=obj(obj(report).health),rem=obj(h.reminders),errors=obj(h.clientErrors),db=obj(h.database)
  const first=alerts[0].title
  const subject=`URGENT: TEDx Core: ${first.charAt(0).toLowerCase()+first.slice(1)}`.slice(0,180)+(alerts.length>1?` (+${alerts.length-1} more)`:'')
  const rows=[
    body(para(`${plural(alerts.length,'problem')} found at ${now.toLocaleString('en-US',{timeZone:TZ,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} Manila time. You get this email again only if a new problem appears or one is still open after 6 hours.`,true)),
    heading('Needs attention'),body(alertBlock(alerts)),heading('Current state'),
    body(facts([
      ['Last reminder run',str(rem.lastRunAt)?ago(rem.lastRunAt,now):'no successful run on record'],
      ['App errors in the last hour',n(errors.hitsHour)],
      ['MailApp quota left today',mailQuota===null?'not reported':n(mailQuota)],
      ['Database',`${mb(num(db.bytes))} of 500 MB`],
    ])),
    body(button('Open the workspace',links.site)),
    body(linkLine([['Supabase',links.supabase],['Function logs',links.supabase+'/functions'],['GitHub',links.github],['Apps Script',links.appsScript]])),
  ]
  const html=page(subject,first,alerts.length===1?'1 thing needs attention':`${alerts.length} things need attention`,'Urgent alert, TEDx Core Workspace',rows.join('\n'),REASON)
  const text=[subject,'',...textAlerts(alerts),`Last reminder run: ${str(rem.lastRunAt)?ago(rem.lastRunAt,now):'none on record'}`,
    `App errors in the last hour: ${n(errors.hitsHour)}`,`MailApp quota left: ${mailQuota===null?'not reported':n(mailQuota)}`,'',
    `Workspace: ${links.site}`,`Supabase: ${links.supabase}`,`Apps Script: ${links.appsScript}`,'',SIGNATURE].join('\n')
  return {subject,html,text}
}
