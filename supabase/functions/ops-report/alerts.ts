// Urgent alert rules for the owner reports. Input is the public.ops_report snapshot (see migration
// 20261129700000_ops_reports.sql) plus the MailApp quota that Apps Script reports about itself.
// Every alert has a stable key; Apps Script emails when a key (or its severity) is new, or when the same
// alert is still open 6 hours after the last email.

export type Severity='critical'|'warning'
export type Alert={key:string;severity:Severity;title:string;detail:string;link?:{label:string;href:string}}
export type Links={site:string;supabase:string;github:string;appsScript:string}

type Json=Record<string,unknown>
export const obj=(value:unknown):Json=>value&&typeof value==='object'&&!Array.isArray(value)?value as Json:{}
export const list=(value:unknown):Json[]=>Array.isArray(value)?value.map(obj):[]
export const num=(value:unknown):number=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^-?\d+(\.\d+)?$/.test(value)?Number(value):0
export const str=(value:unknown):string=>typeof value==='string'?value:''
export const plural=(n:number,one:string,many=one+'s')=>`${n.toLocaleString('en-US')} ${n===1?one:many}`

/** "2 hours", "45 minutes", "3 days": whole units, rounded down. */
export function duration(minutes:number):string {
  if(minutes<120)return plural(Math.max(0,Math.floor(minutes)),'minute')
  if(minutes<48*60)return plural(Math.floor(minutes/60),'hour')
  return plural(Math.floor(minutes/1440),'day')
}

export const THRESHOLDS={
  remindersWarnMinutes:45, remindersCriticalMinutes:120,
  outboxLateMinutes:30, errorSpikePerHour:50, newErrorHitsPerHour:5,
  pushFailuresPerHour:5, dbWarnShare:0.8, dbCriticalShare:0.95,
  mailQuotaWarn:20, mailQuotaCritical:5, senderExpiryDays:14, emailCapShare:0.8,
}

export function evaluateAlerts(report:unknown,links:Links,mailQuota:number|null,now=new Date()):Alert[] {
  const health=obj(obj(report).health),alerts:Alert[]=[]
  const add=(alert:Alert)=>alerts.push(alert)
  const fnLogs={label:'Open function logs',href:links.supabase+'/functions'}

  const r=health.reminders
  if(r&&typeof r==='object') {
    const rem=obj(r)
    if(rem.senderLive!==true)add({key:'email_sender_off',severity:'critical',title:'Email reminders are switched off',
      detail:'The approved email sender for this term has expired or was revoked, so no reminder email goes out. Renew it with supabase/snippets/approve-email-sender.sql.',
      link:{label:'Open SQL editor',href:links.supabase+'/sql/new'}})
    else if(str(rem.quotaBlockedAt))add({key:'email_quota_blocked',severity:'critical',title:'Email sending is paused: the daily quota ran out',
      detail:'The relay reported that MailApp is out of quota. Sending pauses for 24 hours and then resumes on its own.',link:{label:'Open Apps Script',href:links.appsScript}})
    else if(!str(rem.lastRunAt))add({key:'email_relay_failing',severity:'critical',title:'The email relay failed its last health check',
      detail:'The last reminder run could not reach the Apps Script relay, or the relay refused it (wrong HMAC_SECRET, deployment changed, or quota). Check the latest runReminders execution.',
      link:{label:'Open Apps Script executions',href:links.appsScript}})
    else {
      const minutes=num(rem.minutesSince)
      if(minutes>THRESHOLDS.remindersWarnMinutes)add({key:'reminders_stalled',
        severity:minutes>THRESHOLDS.remindersCriticalMinutes?'critical':'warning',
        title:`Reminders haven't run in ${duration(minutes)}`,
        detail:'runReminders normally runs every 15 minutes. Check that its time trigger still exists in Apps Script and that recent executions succeeded.',
        link:{label:'Open Apps Script executions',href:links.appsScript}})
    }
    const expires=Date.parse(str(rem.approvalExpiresAt))
    if(rem.senderLive===true&&Number.isFinite(expires)&&expires-now.getTime()<THRESHOLDS.senderExpiryDays*86400000)add({key:'email_sender_expiring',severity:'warning',
      title:`The email sender approval expires in ${duration((expires-now.getTime())/60000)}`,
      detail:'Renew it before it lapses, or reminder emails stop. See supabase/snippets/approve-email-sender.sql.',link:{label:'Open SQL editor',href:links.supabase+'/sql/new'}})
    const cap=num(rem.dailyCap),attempts=num(rem.attemptsToday)
    if(cap>0&&attempts>=cap*THRESHOLDS.emailCapShare)add({key:'email_cap_near',severity:'warning',
      title:`Reminder emails are at ${attempts} of today's cap of ${cap}`,detail:'Once the cap is reached, reminder emails wait until tomorrow (UTC).'})
  }

  const outbox=obj(health.outbox)
  if(num(outbox.stuck)>0||num(outbox.pendingLate)>0)add({key:'outbox_stuck',severity:'critical',
    title:`${plural(num(outbox.stuck)+num(outbox.pendingLate),'notification job')} stuck`,
    detail:`${num(outbox.pendingLate)} waiting more than ${THRESHOLDS.outboxLateMinutes} minutes past due (oldest ${duration(num(outbox.oldestLateMinutes))}), ${num(outbox.stuck)} claimed but never finished. The dispatch-notifications run may be failing.`,
    link:fnLogs})
  if(num(outbox.failedHour)>0)add({key:'outbox_failed',severity:'warning',title:`${plural(num(outbox.failedHour),'notification job')} failed in the last hour`,
    detail:'In-app notifications for these jobs were not delivered. Check last_error in public.outbox_jobs.',link:{label:'Open table editor',href:links.supabase+'/editor'}})

  const email=obj(health.email)
  if(num(email.failedHour)>0||num(email.uncertainHour)>0)add({key:'email_failed',severity:'warning',
    title:`${plural(num(email.failedHour)+num(email.uncertainHour),'reminder email')} failed in the last hour`,
    detail:`${num(email.failedHour)} failed or bounced, ${num(email.uncertainHour)} uncertain (the relay did not confirm). Check the email-adapter logs and the relay executions.`,link:fnLogs})
  if(num(email.waitingLate)>0||num(email.stuckSending)>0)add({key:'email_backlog',severity:'warning',
    title:`${plural(num(email.waitingLate)+num(email.stuckSending),'reminder email')} overdue to send`,
    detail:`${num(email.waitingLate)} waiting more than 45 minutes past their send time, ${num(email.stuckSending)} stuck while sending.`,link:fnLogs})

  const push=obj(health.push)
  if(num(push.failedHour)>=THRESHOLDS.pushFailuresPerHour&&num(push.failedHour)>num(push.sentHour))add({key:'push_failures',severity:'warning',
    title:`${plural(num(push.failedHour),'device notification')} failed in the last hour`,
    detail:`Only ${num(push.sentHour)} were sent in the same hour. Check the VAPID settings and the dispatch-notifications logs.`,link:fnLogs})
  if(num(push.waitingLate)>0)add({key:'push_backlog',severity:'warning',title:`${plural(num(push.waitingLate),'device notification')} overdue to send`,
    detail:'They have waited more than 45 minutes. The dispatch-notifications run may be failing.',link:fnLogs})

  const errors=obj(health.clientErrors)
  if(num(errors.hitsHour)>THRESHOLDS.errorSpikePerHour)add({key:'client_error_spike',severity:'critical',
    title:`${plural(num(errors.hitsHour),'app error')} reported in the last hour`,
    detail:'Browsers are reporting far more errors than usual. A recent deploy may have broken a page.',link:{label:'Open GitHub Actions',href:links.github+'/actions'}})
  const dayAgo=now.getTime()-86400000
  for(const e of list(errors.top)) {
    const first=Date.parse(str(e.firstSeen))
    if(num(e.hitsHour)>=THRESHOLDS.newErrorHitsPerHour&&Number.isFinite(first)&&first>dayAgo)add({key:'client_error:'+str(e.fingerprint).slice(0,12),severity:'warning',
      title:`New app error on ${str(e.route)||'/'}: ${num(e.hitsHour)} times in the last hour`,
      detail:`${str(e.message).slice(0,200)} (${plural(num(e.people),'person','people')} affected)`})
  }

  const db=obj(health.database),bytes=num(db.bytes),plan=num(db.planBytes)
  if(plan>0&&bytes/plan>THRESHOLDS.dbWarnShare)add({key:'db_size',severity:bytes/plan>THRESHOLDS.dbCriticalShare?'critical':'warning',
    title:`Database is at ${Math.round(bytes/plan*100)}% of the 500 MB plan`,
    detail:'Above the limit Supabase makes the database read-only. Check the biggest tables in the daily report.',link:{label:'Open database usage',href:links.supabase+'/settings/usage'}})

  if(mailQuota!==null&&mailQuota<THRESHOLDS.mailQuotaWarn)add({key:'mail_quota',severity:mailQuota<THRESHOLDS.mailQuotaCritical?'critical':'warning',
    title:`Only ${plural(mailQuota,'email')} left in today's MailApp quota`,
    detail:'Reminder, sign-in code and report emails all share this quota. It resets about 24 hours after the first send.',link:{label:'Open Apps Script',href:links.appsScript}})

  const rank={critical:0,warning:1}
  return alerts.sort((a,b)=>rank[a.severity]-rank[b.severity])
}
