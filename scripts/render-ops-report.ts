// Renders sample owner report emails (daily and urgent) to local files for review:
//   node scripts/render-ops-report.ts [outDir]   (default email-previews/round11/reports)
// Writes <name>.html, <name>.forced-dark.html (approximation of Gmail iOS inversion) and <name>.txt.
// Sample data only (supabase/functions/ops-report/fixture.ts); sends nothing.
import { mkdirSync,writeFileSync } from 'node:fs'
import { join,resolve } from 'node:path'
import { evaluateAlerts } from '../supabase/functions/ops-report/alerts.ts'
import { MAX_REPORT_HTML,renderDaily,renderUrgent,type ReportMail } from '../supabase/functions/ops-report/render.ts'
import { NOW,sampleReport } from '../supabase/functions/ops-report/fixture.ts'

const out=resolve(process.argv[2]??'email-previews/round11/reports')
const links={site:'https://koala3353.github.io/tedx-core-workspace/',supabase:'https://supabase.com/dashboard/project/wyurosneoxfqqrrvstke',
  github:'https://github.com/Koala3353/tedx-core-workspace',appsScript:'https://script.google.com/home/executions'}

const daily=sampleReport('daily',{health:{email:{window:{accepted:12,delivered:29,failed:1},failedHour:1,uncertainHour:0,waitingLate:0,stuckSending:0}}})
const urgent=sampleReport('urgent',{health:{
  reminders:{lastRunAt:new Date(NOW.getTime()-131*60000).toISOString(),minutesSince:131,senderLive:true,approvalExpiresAt:'2027-05-25T00:00:00Z',dailyCap:1500,attemptsToday:40},
  outbox:{pending:6,pendingLate:6,oldestLateMinutes:118,stuck:0,failedHour:0},
  clientErrors:{hitsHour:9,top:[{fingerprint:'ad1333f3cb89',route:'/tasks/:id',message:"TypeError: Cannot read properties of undefined (reading 'dueOn')",people:5,hitsHour:9,
    firstSeen:new Date(NOW.getTime()-50*60000).toISOString()}]},
}})
const mails:Array<[string,ReportMail]>=[
  ['daily',renderDaily(daily,evaluateAlerts(daily,links,1380,NOW),links,1380,NOW)],
  ['urgent',renderUrgent(urgent,evaluateAlerts(urgent,links,1380,NOW),links,1380,NOW)!],
]
const forced=(html:string)=>html.replace(/@media \(prefers-color-scheme:dark\)\{[\s\S]*?\n\}\n/,'')
  .replace('</head>','<style>html{background:#fff;filter:invert(1) hue-rotate(180deg)}</style></head>')
mkdirSync(out,{recursive:true})
const problems:string[]=[]
for(const [name,mail] of mails) {
  const bytes=new TextEncoder().encode(mail.html).length
  if(!mail.html||bytes>MAX_REPORT_HTML)problems.push(`${name}: html missing or too large (${bytes} bytes)`)
  if(/[–—]/.test(mail.html+mail.text+mail.subject))problems.push(name+': contains an en or em dash')
  writeFileSync(join(out,name+'.html'),mail.html)
  writeFileSync(join(out,name+'.forced-dark.html'),forced(mail.html))
  writeFileSync(join(out,name+'.txt'),'Subject: '+mail.subject+'\n\n'+mail.text+'\n')
  console.log(`${name}: ${(bytes/1024).toFixed(1)} KB html, subject "${mail.subject}"`)
}
if(problems.length){console.error(problems.join('\n'));process.exit(1)}
