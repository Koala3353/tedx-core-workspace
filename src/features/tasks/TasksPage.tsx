import {WorkReference} from '../work-references/WorkReference'
import {Status} from '../../components/Status'
import{useEffect,useState}from'react'
import{Link,useNavigate,useRouteLoaderData,useSearchParams}from'react-router'
import type{WorkspaceContext}from'../auth/gateway'
import{PageHeading,Panel}from'../../components/Page'
import{LoadingState,ErrorState,EmptyState}from'../../components/FeedbackState'
import{formatDue}from'../shared/dates'
import{useAutoRefresh}from'../shared/useAutoRefresh'
import{ViewTabs}from'../shared/ViewTabs'
import{Pager}from'../shared/Pager'
import{OverflowMenu}from'../shared/OverflowMenu'
import{TaskEditor}from'./TaskEditor'
import type{TasksApi,OwnedTask,TaskSummary}from'./api'
import {WorkCsvDownload} from '../exports/WorkCsvDownload'
import type {OperationalExport} from '../exports/operational'
const taskViews=[['assigned','Assigned to me'],['created','Created by me'],['watching','Shared with me'],['overdue','Overdue'],['unit','My committee']] as const
type TaskView=typeof taskViews[number][0]
export function TasksPage({api,exportCsv}:{api:TasksApi;exportCsv?:OperationalExport}){
 const context=useRouteLoaderData('workspace') as WorkspaceContext;const navigate=useNavigate();const[params,setParams]=useSearchParams();const view:TaskView=taskViews.some(([v])=>v===params.get('view'))?params.get('view') as TaskView:'assigned';const parsed=Number(params.get('page')??1);const page=Number.isInteger(parsed)&&parsed>=1&&parsed<=10000?parsed:1
 const[reload,setReload]=useState(0);const[creating,setCreating]=useState(params.get('new')==='1'||params.get('compose')==='1')
 // Quick add hands off here as ?compose=1&title=&due=&committee=<unitId>; read once, then drop the params.
 const[prefill]=useState(()=>params.get('compose')==='1'?{title:(params.get('title')??'').slice(0,240),dueOn:/^\d{4}-\d{2}-\d{2}$/.test(params.get('due')??'')?params.get('due')!:'',leadUnitId:params.get('committee')??''}:undefined)
 useEffect(()=>{if(params.get('compose')!=='1')return;const next=new URLSearchParams(params);for(const k of['compose','title','due','committee'])next.delete(k);setParams(next,{replace:true})},[params,setParams])
 ;const key=context.termId+':'+('memberId'in context?context.memberId:context.guestAccessId)+':'+page+':'+view+':'+reload
 const[state,setState]=useState<{key:string;items:(TaskSummary|OwnedTask)[];total:number;error:boolean}|null>(null)
 const[counts,setCounts]=useState<Partial<Record<TaskView,number>>>({})
 useAutoRefresh(()=>setReload(n=>n+1),{paused:creating})
 useEffect(()=>{let active=true;void(api.list?api.list(context.termId,page,view):api.read(context.termId,page)).then(r=>{if(active)setState({key,...r,error:false})}).catch(()=>{if(active)setState({key,items:[],total:0,error:true})});return()=>{active=false}},[api,context.termId,page,view,key])
 useEffect(()=>{if(!api.list)return;let active=true;const list=api.list;void Promise.all(taskViews.map(([v])=>list(context.termId,1,v).then(r=>[v,r.total] as const).catch(()=>null))).then(rows=>{if(active)setCounts(Object.fromEntries(rows.filter(r=>r!==null)))});return()=>{active=false}},[api,context.termId,reload])
 const current=state?.key===key?state:null;const move=(p:number)=>setParams({view,page:String(p)})
 return <><PageHeading title="My tasks" description="What you're working on and what's shared with you."/>
 <div className="page-actions">{api.execute?<button type="button" className="button" aria-expanded={creating} onClick={()=>setCreating(c=>!c)}>New task</button>:null}<span className="page-actions__spacer"/>{exportCsv?<OverflowMenu><WorkCsvDownload api={exportCsv} context={context} kind="task"/></OverflowMenu>:null}</div>
 {creating&&api.execute?<section className="panel" aria-label="New task"><h2>New task</h2><TaskEditor api={api} termId={context.termId} prefill={prefill} onCancel={()=>setCreating(false)} onSaved={id=>void navigate('/tasks/'+id)}/></section>:null}
 {api.list?<ViewTabs label="Task views" value={view} onChange={v=>setParams({view:v})} tabs={taskViews.map(([value,label])=>({value,label,count:counts[value]??null}))}/>:null}
 {!current?<LoadingState title="Loading tasks"/>:current.error?<ErrorState title="Couldn't load tasks" description="Check your connection and try again." action={<button className="button button--secondary" onClick={()=>setReload(reload+1)}>Try again</button>}/>:<>{current.items.length?<p role="status" className="muted">{current.total} {current.total===1?'task':'tasks'}</p>:null}{current.items.length?current.items.map(t=><Panel key={t.id} title={t.title}><WorkReference compact reference={t.reference} id={t.id} kind="task"/>{t.summary?<p>{t.summary}</p>:null}<p>{'assigneeName'in t?t.assigneeName??'Unassigned':'Unassigned'} · {'state'in t?<Status state={t.state}/>:t.category} · {t.dueAt||t.dueOn?formatDue(t.dueAt??t.dueOn):'No due date'}</p><Link className="button button--secondary" to={'/tasks/'+t.id}>Open task</Link></Panel>):<EmptyState title={emptyTitle(view)} description={emptyText(view)} action={api.execute&&!creating?<button type="button" className="button button--secondary" onClick={()=>setCreating(true)}>Create a task</button>:undefined}/>}<Pager label="Task pages" page={page} total={current.total} onMove={move}/></>}
 </>
}
function emptyTitle(view:TaskView){return view==='assigned'?'Nothing assigned to you yet':view==='overdue'?'Nothing overdue':view==='created'?"You haven't created any tasks":view==='watching'?'Nothing shared with you yet':'No committee tasks yet'}
function emptyText(view:TaskView){return view==='assigned'?'Your committee head assigns tasks. You can also create one yourself.':view==='overdue'?"You're all caught up.":view==='created'?'Tasks you create show up here.':view==='watching'?"Tasks where you're a collaborator show up here.":'Tasks for the committees you manage show up here.'}
