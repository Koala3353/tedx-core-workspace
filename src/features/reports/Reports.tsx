import{useCallback,useEffect,useRef,useState}from'react'
import{Link,useRouteLoaderData,useSearchParams}from'react-router'
import{PageHeading,Panel}from'../../components/Page'
import{isGuest,type WorkspaceContext}from'../auth/gateway'
import type{Report,ReportsApi,Usage}from'./api'
import{OperationalFlows,WorkloadSummary}from'./Operations'
import'../overview/overview.css'
import'./reports.css'
import{Info}from'lucide-react'
import{RefreshButton}from'../shared/RefreshButton'
import{HowThisWorks}from'../shared/HowThisWorks'
import{formatDay,formatDateTime}from'../shared/dates'
import'../shared/shared.css'
function currentWeek(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),part=(key:string)=>parts.find(p=>p.type===key)!.value;const d=new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10)}
const date=(value:string|null)=>value?value.length===10?formatDay(value):formatDateTime(value):'Not set'
export function Reports({api}:{api:ReportsApi}){const c=useRouteLoaderData('workspace')as WorkspaceContext;return isGuest(c)||!c.capabilities.includes('reports.view')?<><PageHeading title="Reports"/><p>Reports are for committee heads and leadership. <Link to="/">Back to overview</Link></p></>:<ReportsBody key={c.termId+('memberId'in c?c.memberId:'')} api={api} term={c.termId}/>}
function Activity({v}:{v:Usage}){if(v.state==='available')return <><p>{v.active} of {v.eligible} core members worked in the app this week ({v.percent}%). Target: 80% ({v.required} people) · {v.targetMet?'Met':'Not met yet'}.</p>{v.partialWeek?<p className="muted">Partial week. Tracking started {date(v.captureStartedAt??null)}.</p>:null}</>;return <p>{v.state==='unconfigured'?'Activity tracking isn\'t switched on.':v.state==='empty'?'No core members in this week.':v.state==='suppressed'?'Hidden because the group is too small to stay anonymous.':v.state==='term_only'?'Activity is only shown for all committees together. Choose All my committees.':'This week is too old; activity data has been deleted.'}</p>}
function ReportsBody({api,term}:{api:ReportsApi;term:string}){
 // Filters live in the URL so Back from a source record and reloads keep the same report.
 const[params,setParams]=useSearchParams(),[defaultWeek]=useState(currentWeek),week=/^\d{4}-\d{2}-\d{2}$/.test(params.get('week')??'')?params.get('week')!:defaultWeek
 const unit=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.get('unit')??'')?params.get('unit')!:'',view=['overdue','blocked','unassigned'].includes(params.get('view')??'')?params.get('view')!:'all'
 const[report,setReport]=useState<Report|null>(null),[units,setUnits]=useState<Report['units']>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),sequence=useRef(0)
 const load=useCallback(async(after:string|null=null)=>{const current=++sequence.current;setReport(null);setError('');setBusy(true);try{const v=await api.read(term,week,unit||null,view,after);if(current===sequence.current){setReport(v);setUnits(v.units)}}catch(e){if(current===sequence.current)setError((e as{kind?:string}).kind==='denied'?'You don\'t have access to reports for this committee.':(e as{kind?:string}).kind==='validation'?'Pick a Monday for the week.':'Couldn\'t load the report. Check your connection and try again.')}finally{if(current===sequence.current)setBusy(false)}},[api,term,week,unit,view])
 useEffect(()=>{void load();const refresh=()=>{if(document.visibilityState!=='hidden')void load()};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);const interval=setInterval(refresh,30000);return()=>{sequence.current++;clearInterval(interval);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}},[load])
 function change(key:'week'|'unit'|'view',value:string){sequence.current++;setReport(null);setError('');const next=new URLSearchParams(params);if(value&&value!==(key==='week'?defaultWeek:key==='view'?'all':''))next.set(key,value);else next.delete(key);setParams(next,{replace:true})}
 return <><PageHeading title="Reports" description="How committee work is going this week. Counts cover work, never individual people."/>
 <form className="report-filters" onSubmit={e=>{e.preventDefault();void load()}}><label>Week of (Monday)<input className="overview-example" type="date" value={week} onChange={e=>change('week',e.target.value)}/></label><label>Committee<select className="overview-example" value={unit} onChange={e=>change('unit',e.target.value)}><option value="">All my committees</option>{units.map(u=><option key={u.id} value={u.id}>{u.label}</option>)}</select></label><label>Show<select className="overview-example" value={view} onChange={e=>change('view',e.target.value)}><option value="all">All work</option><option value="overdue">Overdue</option><option value="blocked">Blocked tasks</option><option value="unassigned">Unassigned tasks</option></select></label><RefreshButton disabled={busy} onRefresh={()=>void load()} updatedAt={report?.asOf}/></form>
 {busy?<p role="status" className="muted">Loading report…</p>:null}{error?<p role="alert">{error}</p>:null}
 {report?<><p className="muted">Updated {date(report.asOf)} (Manila time) · Activity for {date(report.week)} – {date(report.weekEnd)}</p>
 <ul className="kpi-tiles" aria-label="This week at a glance">{[
  ['Open',report.summary.open,'Tasks and deliverables that aren\'t done or cancelled.'],
  ['Overdue',report.summary.overdue,'Open work past its current due date.'],
  ['Blocked',report.summary.blocked,'Tasks someone marked as blocked.'],
  ['Unassigned',report.summary.unassignedOpen,'Open tasks with no assignee.'],
  ['Awaiting review',report.operations.queue.total,'Submitted requests waiting for a reviewer\'s decision.'],
 ].map(([label,value,definition])=><li className="kpi-tile" key={label as string}><span className="kpi-tile__label">{label}<span className="kpi-tile__info" role="img" tabIndex={0} aria-label={`About ${label}: ${definition}`} title={definition as string}><Info size={14} strokeWidth={1.75} aria-hidden="true"/></span></span><span className="kpi-tile__value">{value}</span></li>)}</ul>
 <Panel title="Weekly activity"><Activity v={report.usage}/></Panel>
 <Panel title="Work to look at">{report.total===0?<p>Nothing matches. Try another committee or filter.</p>:<><p className="muted">{report.total} {report.total===1?'item':'items'}. Open one to see what's next.</p><ul>{report.items.map(r=><li key={r.id}><h2><Link className="report-title" to={r.href}>{r.title}</Link></h2><p>{r.reference?r.reference+' · ':''}{r.state.replaceAll('_',' ')}{r.kind==='task'&&r.declaredEffort?' · Effort: '+r.declaredEffort:''}</p><p>Due {date(r.dueAt??r.dueOn)}{(r.originalDueAt??r.originalDueOn)&&(r.originalDueAt??r.originalDueOn)!==(r.dueAt??r.dueOn)?' (originally '+date(r.originalDueAt??r.originalDueOn)+')':''}</p>{r.state==='blocked'?<p>{r.blockedSince?`Blocked for ${r.blockedDays} days, since ${date(r.blockedSince)}.`:'Blocked. Open the task to see why.'}</p>:null}</li>)}</ul>{report.nextAfter?<button className="button button--secondary" onClick={()=>void load(report.nextAfter)}>Next</button>:null}</>}</Panel>
 <WorkloadSummary value={report.workload}/><OperationalFlows value={report.operations}/>
 <HowThisWorks title="How these numbers work"><p>Counts include the regular tasks and deliverables in committees you supervise ({report.summary.total} in total). Confidential records are left out.</p><p>Original deadline missed: {report.summary.originalOverdue} open items are past the due date they first had, even if it was moved later.</p><p>Deliverables with every checklist item done: {report.summary.readyDeliverables}. They still need to be accepted.</p><p>Weekly activity counts core members (not guests or test accounts) who opened or updated work between Monday and Sunday, Manila time. It isn't a ranking of people.</p></HowThisWorks>
 </>:null}
 </>
}
