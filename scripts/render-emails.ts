// Renders every workspace email to local files for review: node scripts/render-emails.ts [outDir]
// Writes <name>.html (the email as sent), <name>.forced-dark.html (an approximation of Gmail's full
// colour inversion on iOS), <name>.txt (the plain-text part) and index.html linking them all.
// Uses sample data only and sends nothing. Exits non-zero if a render breaks a size or copy rule.
import { mkdirSync,writeFileSync } from 'node:fs'
import { join,resolve } from 'node:path'
import { MAX_HTML } from '../supabase/functions/email-adapter/layout.ts'
import type { Mail } from '../supabase/functions/email-adapter/provider.ts'
import { reminderMail,workspaceLink } from '../supabase/functions/email-adapter/templates.ts'
import { signInCodeMail } from '../supabase/functions/send-auth-email/handler.ts'
import { developerMail } from '../supabase/functions/developer-message/handler.ts'

const out=resolve(process.argv[2]??'email-previews')
const base=workspaceLink('https://koala3353.github.io','/tedx-core-workspace/')
const id='3f2b8c1e-9a47-4d2b-8f61-2c5e7a9d0b14',id2='7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const samples:Array<[string,unknown]>=[
  ['task_due_soon',{type:'task_due_soon',path:'tasks/'+id,title:'Finalise speaker brief for Session 2',dueOn:'2026-12-01',daysLeft:0}],
  ['deliverable_due_soon',{type:'deliverable_due_soon',path:'deliverables/'+id,title:'Venue floor plan v3',dueOn:'2026-12-03',daysLeft:2}],
  ['task_overdue',{type:'task_overdue',path:'tasks/'+id,title:'Send sponsor deck to partners',dueOn:'2026-11-20',daysLeft:-6}],
  ['deliverable_overdue',{type:'deliverable_overdue',path:'deliverables/'+id,title:'Ticketing page copy',dueOn:'2026-11-22',daysLeft:-4}],
  ['approval_waiting',{type:'approval_waiting',path:'reviews/'+id+'/'+id2}],
  ['announcement_unacknowledged',{type:'announcement_unacknowledged',path:'announcements/'+id,title:'Updated rehearsal schedule for March'}],
  ['event_countdown_30',{type:'event_countdown',path:'',daysLeft:30,eventDate:'2027-04-17'}],
  ['event_countdown_1',{type:'event_countdown',path:'',daysLeft:1,eventDate:'2027-04-17'}],
  ['digest',{type:'digest',path:''}],
  ['welcome',{type:'welcome',path:''}],
  ['nudge_sign_in',{type:'nudge_sign_in',path:''}],
  ['nudge_install',{type:'nudge_install',path:''}],
  ['nudge_tutorial',{type:'nudge_tutorial',path:''}],
  ['nudge_reminders',{type:'nudge_reminders',path:''}],
  ['weekly_digest',{type:'weekly_digest',path:'',dueThisWeek:5,overdue:2,meetings:3,committee:'Programs',onTrackPct:82}],
  // Hostile title: must come out escaped, never as markup.
  ['escaping_check',{type:'task_due_soon',path:'tasks/'+id,title:'<script>alert("x")</script> & <b>bold</b>',dueOn:'2026-12-01',daysLeft:0}],
]

const mails:Array<[string,Mail]>=samples.map(([name,content])=>{
  const mail=reminderMail(base,content)
  if(!mail)throw Error('Template refused sample '+name)
  return [name,mail]
})
mails.push(['sign_in_code',signInCodeMail('48291375')])
mails.push(['developer_message',developerMail({id:'8b1f0c2e-3d4a-4b5c-9d6e-7f8091a2b3c4',email:'juan.dela.cruz@student.ateneo.edu',name:'Juan dela Cruz',role:'Member'},{
  requestId:id,topic:'bug',subject:'Task due dates show a day early',
  message:'When I open a task due Friday, the list says Thursday.\nIt started after I changed my phone to dark mode. Screenshots on request.',
  context:{path:'/tasks/'+id,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',viewport:'390x844',theme:'dark',timezone:'Asia/Manila'}},
  {origin:base.origin,basePath:base.basePath,to:'developer@student.ateneo.edu',now:()=>new Date('2026-11-26T09:30:00+08:00')})])

// Gmail iOS ignores prefers-color-scheme, then inverts lightness while roughly keeping hue;
// dropping the media block and applying invert + hue-rotate is the usual approximation.
const forced=(html:string)=>html.replace(/@media \(prefers-color-scheme:dark\)\{[\s\S]*?\n\}\n/,'')
  .replace('</head>','<style>html{background:#fff;filter:invert(1) hue-rotate(180deg)}</style></head>')

mkdirSync(out,{recursive:true})
const problems:string[]=[]
const rows:string[]=[]
for(const [name,mail] of mails) {
  const html=mail.html
  if(!html){problems.push(name+': no html part');continue}
  const bytes=new TextEncoder().encode(html).length
  if(html.length>MAX_HTML||bytes>60000)problems.push(`${name}: html too large (${bytes} bytes)`)
  if(/—/.test(html+mail.text+mail.subject))problems.push(name+': contains an em dash')
  if(name==='escaping_check'&&/<script|<b>/.test(html))problems.push(name+': dynamic value not escaped')
  writeFileSync(join(out,name+'.html'),html)
  writeFileSync(join(out,name+'.forced-dark.html'),forced(html))
  writeFileSync(join(out,name+'.txt'),'Subject: '+mail.subject+'\n\n'+mail.text+'\n')
  rows.push(`<tr><td>${name}</td><td>${mail.subject.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</td><td>${(bytes/1024).toFixed(1)} KB</td>`
    +`<td><a href="${name}.html">light</a> · <a href="${name}.forced-dark.html">forced dark</a> · <a href="${name}.txt">text</a></td></tr>`)
}
writeFileSync(join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>Email previews</title>
<style>body{font:15px/1.5 system-ui;margin:24px}td,th{padding:6px 12px;border-bottom:1px solid #ddd;text-align:left}</style>
<h1>Workspace email previews</h1><table><tr><th>Template</th><th>Subject</th><th>HTML size</th><th>Open</th></tr>${rows.join('')}</table>`)
console.log(`Rendered ${mails.length} emails to ${out}`)
if(problems.length){console.error(problems.join('\n'));process.exit(1)}
