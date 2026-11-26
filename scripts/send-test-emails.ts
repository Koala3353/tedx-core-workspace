// Sends one real test email of every workspace kind through the Apps Script relay, signed exactly as the
// edge functions sign it (same appsScriptMail transport). Touches no database rows.
//   APPS_SCRIPT_URL=... APPS_SCRIPT_HMAC_SECRET=... node scripts/send-test-emails.ts you@student.ateneo.edu [kind ...]
// The relay only delivers to @student.ateneo.edu. Each send gets a fresh job id, so reruns are not deduplicated.
import { appsScriptMail } from '../supabase/functions/email-adapter/apps-script.ts'
import { reminderMail,workspaceLink } from '../supabase/functions/email-adapter/templates.ts'
import { signInCodeMail } from '../supabase/functions/send-auth-email/handler.ts'

const url=process.env.APPS_SCRIPT_URL??'',secret=process.env.APPS_SCRIPT_HMAC_SECRET??''
const [to,...only]=process.argv.slice(2)
if(!url||!secret||!to) {
  console.error('Usage: APPS_SCRIPT_URL=... APPS_SCRIPT_HMAC_SECRET=... node scripts/send-test-emails.ts <to> [kind ...]')
  process.exit(2)
}
const origin=process.env.APP_ORIGIN??'https://koala3353.github.io',basePath=process.env.APP_BASE_PATH??'/tedx-core-workspace/'
const base=workspaceLink(origin,basePath)
// The relay ignores the binding; these only satisfy appsScriptMail's shape checks.
const mail=appsScriptMail({url,secret,sender:'workspace@student.ateneo.edu',domainId:'00000000-0000-0000-0000-000000000000'})
const id='3f2b8c1e-9a47-4d2b-8f61-2c5e7a9d0b14',id2='7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const iso=(offset:number)=>new Date(Date.now()+offset*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})

const samples:Array<[string,unknown]>=[
  ['task_due_soon',{type:'task_due_soon',path:'tasks/'+id,title:'Test: finalise speaker brief',dueOn:iso(0),daysLeft:0}],
  ['deliverable_due_soon',{type:'deliverable_due_soon',path:'deliverables/'+id,title:'Test: venue floor plan',dueOn:iso(2),daysLeft:2}],
  ['task_overdue',{type:'task_overdue',path:'tasks/'+id,title:'Test: send sponsor deck',dueOn:iso(-3),daysLeft:-3}],
  ['deliverable_overdue',{type:'deliverable_overdue',path:'deliverables/'+id,title:'Test: ticketing page copy',dueOn:iso(-4),daysLeft:-4}],
  ['approval_waiting',{type:'approval_waiting',path:'reviews/'+id+'/'+id2}],
  ['announcement_unacknowledged',{type:'announcement_unacknowledged',path:'announcements/'+id,title:'Test: rehearsal schedule'}],
  ['event_countdown',{type:'event_countdown',path:'',daysLeft:30,eventDate:'2027-04-17'}],
  ['digest',{type:'digest',path:''}],
  ['welcome',{type:'welcome',path:''}],
  ['nudge_sign_in',{type:'nudge_sign_in',path:''}],
  ['nudge_install',{type:'nudge_install',path:''}],
  ['nudge_tutorial',{type:'nudge_tutorial',path:''}],
  ['nudge_reminders',{type:'nudge_reminders',path:''}],
  ['weekly_digest',{type:'weekly_digest',path:'',dueThisWeek:5,overdue:2,meetings:3,committee:'Programs',onTrackPct:82}],
]

let failed=0
for(const [name,content] of samples) {
  if(only.length&&!only.includes(name))continue
  const message=reminderMail(base,content)
  if(!message){console.log(name.padEnd(28),'template refused sample');failed++;continue}
  const result=await mail.send(to,crypto.randomUUID(),message)
  console.log(name.padEnd(28),result.outcome)
  if(result.outcome!=='accepted')failed++
}
if(only.includes('auth_code')) {
  // Sample code only; the real sign-in path is POST /auth/v1/otp, which goes through send-auth-email.
  const result=await mail.send(to,crypto.randomUUID(),signInCodeMail('000000'))
  console.log('auth_code (sample 000000)'.padEnd(28),result.outcome)
  if(result.outcome!=='accepted')failed++
}
process.exit(failed?1:0)
