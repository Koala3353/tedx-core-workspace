// Sample public.ops_report snapshots for tests and previews (scripts/render-ops-report.ts). Made-up data.
export const NOW=new Date('2026-11-28T23:05:00Z') // Sun 29 Nov, 07:05 Manila
const at=(minutesAgo:number)=>new Date(NOW.getTime()-minutesAgo*60000).toISOString()
const id=(n:number)=>`3f2b8c1e-9a47-4d2b-8f61-${String(n).padStart(12,'0')}`

export function sampleReport(kind:'daily'|'urgent'='daily',overrides:{health?:Record<string,unknown>}={}) {
  const health={
    reminders:{lastRunAt:at(12),minutesSince:12,senderLive:true,quotaBlockedAt:null,approvalExpiresAt:'2027-05-25T11:36:58Z',dailyCap:1500,attemptsToday:37},
    outbox:{pending:2,pendingLate:0,oldestLateMinutes:0,stuck:0,failedWindow:0,failedHour:0,deliveredWindow:146},
    email:{window:{accepted:12,delivered:29,failed:1,skipped:3},failedHour:0,uncertainHour:0,waitingLate:0,stuckSending:0},
    push:{window:{sent:88,gone:2,failed:1},sentHour:6,failedHour:0,waitingLate:0,activeSubscriptions:31},
    clientErrors:{hitsWindow:23,hitsHour:2,fingerprintsWindow:3,newWindow:1,top:[
      {fingerprint:'ad1333f3cb89',kind:'error',message:"TypeError: Cannot read properties of undefined (reading 'dueOn')",route:'/tasks/:id',
        frame:'at TaskDetail (https://koala3353.github.io/tedx-core-workspace/assets/TaskDetail-AbC12345.js:1:2200)',build:'AbC12345',agent:'Chrome 141',
        hitsWindow:14,hitsHour:1,total:14,people:4,firstSeen:at(300),lastSeen:at(40),isNew:true},
      {fingerprint:'2e8fccf25c8c',kind:'command',message:'unexpected: create_task (PGRST116)',route:'/tasks',frame:null,build:'AbC12345',agent:'Safari 19',
        hitsWindow:6,hitsHour:1,total:41,people:2,firstSeen:at(9000),lastSeen:at(20),isNew:false},
      {fingerprint:'f0fc3d3ff4bd',kind:'rejection',message:'Failed to fetch dynamically imported module',route:'/calendar',frame:null,build:'Zz998877',agent:'Chrome 140',
        hitsWindow:3,hitsHour:0,total:9,people:3,firstSeen:at(12000),lastSeen:at(500),isNew:false},
    ]},
    database:{bytes:41_200_000,planBytes:524_288_000,tables:[
      {name:'public.restricted_access_events',bytes:5_420_000,rows:14210},{name:'app_private.disposition_sources',bytes:557_056,rows:221},
      {name:'public.work_items',bytes:401_408,rows:312},{name:'auth.users',bytes:270_336,rows:64},{name:'public.notifications',bytes:229_376,rows:1880}]},
    audit:{restrictedEventsWindow:2140,restrictedEventsTotal:14210},
    migrations:{count:134,latest:'20261129700000'},
    ...overrides.health,
  }
  if(kind==='urgent')return {kind,generatedAt:NOW.toISOString(),since:at(60),term:{label:'2026-2027',eventDate:'2027-04-17',daysToEvent:139},usage:{},work:{},health}
  return {kind,generatedAt:NOW.toISOString(),since:at(1440),term:{label:'2026-2027',eventDate:'2027-04-17',daysToEvent:139},
    usage:{members:64,signedInEver:58,neverSignedIn:6,neverSignedInNames:['Andrea Lim','Bea Santos','Carlo Reyes','Diego Tan','Ella Cruz','Franco Uy'],
      active24h:37,active7d:55,signInsWindow:21,newAccountsWindow:2,installed:29,tutorialDone:47,setupDone:51,pushMembers:24,pushDevices:31,
      emailRemindersOn:44,telegramLinked:0,signInMethods:{google:52,email:6},
      committees:[{name:'Curatorial',members:9,active7d:8},{name:'Events',members:12,active7d:10},{name:'Finance',members:5,active7d:5},
        {name:'Marketing and Communications',members:11,active7d:9},{name:'Sponsorships',members:8,active7d:0},{name:'Website Development',members:4,active7d:4}]},
    work:{tasks:{open:118,createdWindow:9,doneWindow:14,blocked:3,inReview:5},deliverables:{open:27,createdWindow:1,acceptedWindow:2,blocked:1,submitted:2},
      overdue:{count:12,items:[
        {kind:'task',title:'Send sponsor deck to partners',committee:'Sponsorships',owner:'Bea Santos',dueOn:'2026-11-18',days:11,path:'tasks/'+id(1)},
        {kind:'deliverable',title:'Venue floor plan v3',committee:'Events',owner:'Miguel Ramos',dueOn:'2026-11-23',days:6,path:'deliverables/'+id(2)},
        {kind:'task',title:'Confirm speaker travel for Session 2',committee:'Curatorial',owner:'Ana Lopez',dueOn:'2026-11-26',days:3,path:'tasks/'+id(3)},
        {kind:'task',title:'<script>alert("x")</script> & poster copy',committee:null,owner:null,dueOn:'2026-11-28',days:1,path:'tasks/'+id(4)}]},
      dueSoon:{count:7,items:[
        {kind:'task',title:'Finalise ticketing page copy',committee:'Marketing and Communications',owner:'Ella Cruz',dueOn:'2026-11-29',days:0,path:'tasks/'+id(5)},
        {kind:'deliverable',title:'Budget v2 for approval',committee:'Finance',owner:'Paolo Garcia',dueOn:'2026-12-01',days:2,path:'deliverables/'+id(6)}]},
      requests:{inReview:4,needsRevision:1,createdWindow:3,oldestInReviewDays:5},approvals:{waiting:3,oldestHours:52},
      announcements:[{title:'Updated rehearsal schedule',createdAt:at(2000),acknowledged:41}],
      calendar:[{title:'General assembly',startsAt:'2026-11-30T10:00:00Z',startOn:null,allDay:false},{title:'Org-wide moratorium',startsAt:null,startOn:'2026-12-03',allDay:true}]},
    health}
}
